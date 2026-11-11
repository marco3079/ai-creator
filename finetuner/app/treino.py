"""Fine-tuning LoRA local de modelos Llama 3.2 em segundo plano.

Recebe o pedido de `POST /treinos` (treinoId, dataset, saidaDir, config,
nomeOllama, ollamaUrl, callbackUrl, callbackToken), treina o adaptador LoRA,
grava os arquivos em saidaDir, registra o modelo no Ollama e avisa o servidor
pelo callback com EXECUTANDO, SUCESSO ou FALHA.

torch/transformers/peft/trl só são importados dentro das funções, para que o
módulo possa ser importado (e testado) sem eles.
"""

import logging
import multiprocessing
import os
import tempfile
import traceback
from pathlib import Path

import httpx

from app import dados, ollama

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get('DATA_DIR', '/data')
BASES_HF = {
    'llama3.2:1b': 'unsloth/Llama-3.2-1B-Instruct',
    'llama3.2:3b': 'unsloth/Llama-3.2-3B-Instruct',
}
MODULOS_LORA = ['q_proj', 'k_proj', 'v_proj', 'o_proj']
DROPOUT_LORA = 0.05
PASSOS_POR_ENVIO = 10


class Registro:
    """Acumula o log do treino e envia ao servidor só as linhas novas."""

    def __init__(self, pedido):
        self.pedido = pedido
        self.linhas: list[str] = []
        self.enviadas = 0

    def adicionar(self, texto: str) -> None:
        self.linhas.append(texto)

    def pendente(self) -> str:
        texto = '\n'.join(self.linhas[self.enviadas:])
        self.enviadas = len(self.linhas)
        return texto

    def enviar(self, status: str, **extra) -> None:
        corpo = {'status': status, 'log': self.pendente(), **extra}
        _callback(self.pedido, corpo)


def _callback(pedido, corpo: dict) -> None:
    """Chama o servidor. Nunca lança: falha de callback só é registrada."""
    try:
        resposta = httpx.post(
            pedido.callbackUrl,
            json=corpo,
            headers={'X-Interno-Token': pedido.callbackToken},
            timeout=15,
        )
        if resposta.status_code >= 300:
            logger.warning('Callback do treino %s respondeu %s', pedido.treinoId, resposta.status_code)
    except httpx.HTTPError as erro:
        logger.warning('Falha no callback do treino %s: %s', pedido.treinoId, erro)


def _relativo_a_dados(caminho: Path) -> str:
    return os.path.relpath(caminho, DATA_DIR).replace('\\', '/')


def executar(pedido) -> None:
    """Ponto de entrada do treino em segundo plano. Nunca lança exceção.

    O treino roda em um processo filho (spawn), para que uma falha nativa não
    derrube o uvicorn. Se o filho morrer antes de enviar o callback final, o pai
    envia FALHA.
    """
    contexto = multiprocessing.get_context('spawn')
    terminou = contexto.Value('b', False)
    processo = contexto.Process(target=_executar_no_processo, args=(pedido, terminou))
    processo.start()
    processo.join()

    if processo.exitcode != 0 and not terminou.value:
        logger.error('Processo do treino %s terminou com código %s', pedido.treinoId, processo.exitcode)
        _callback(pedido, {
            'status': 'FALHA',
            'log': (
                f'O processo de treino terminou de forma inesperada (código {processo.exitcode}). '
                'Veja os logs do container finetuner.'
            ),
        })


def _executar_no_processo(pedido, terminou) -> None:
    try:
        _executar_local(pedido)
    finally:
        terminou.value = True


def _executar_local(pedido) -> None:
    registro = Registro(pedido)
    try:
        registro.adicionar(f'Treino {pedido.treinoId} iniciado.')
        registro.enviar('EXECUTANDO')

        resultado = _treinar(pedido, registro)

        registro.adicionar('Treino concluído com sucesso.')
        registro.enviar('SUCESSO', **resultado)
    except Exception:
        registro.adicionar('Erro durante o treino:')
        registro.adicionar(traceback.format_exc())
        registro.enviar('FALHA')


def _dispositivo(registro: Registro):
    import torch

    if torch.cuda.is_available():
        registro.adicionar('Dispositivo: CUDA (fp16).')
        return 'cuda', torch.float16
    registro.adicionar(
        'Dispositivo: CPU (fp32). Sem GPU o treino é muito lento; use o perfil gpu com NVIDIA.'
    )
    return 'cpu', torch.float32


def _criar_callback_log(registro: Registro, historico: list[dict]):
    from transformers import TrainerCallback

    class _LogPerda(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if not logs or 'loss' not in logs:
                return
            passo = state.global_step
            perda = float(logs['loss'])
            historico.append({'epoca': passo, 'perda': perda})
            total = state.max_steps or '?'
            registro.adicionar(f'Passo {passo}/{total}: perda={perda:.4f}')
            if passo % PASSOS_POR_ENVIO == 0:
                registro.enviar('EXECUTANDO')

    return _LogPerda()


def _treinar(pedido, registro: Registro) -> dict:
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    cfg = pedido.config
    modelo_hf = BASES_HF[cfg.modeloBase]
    dispositivo, tipo = _dispositivo(registro)

    registro.adicionar(f'Carregando base {modelo_hf}...')
    tokenizer = AutoTokenizer.from_pretrained(modelo_hf)
    modelo = AutoModelForCausalLM.from_pretrained(modelo_hf, torch_dtype=tipo)

    conversas = dados.carregar_conversas(pedido.dataset)
    textos = dados.formatar(conversas, tokenizer, cfg.promptSistema)
    registro.adicionar(f'Dataset: {len(textos)} conversas.')
    treino_ds = Dataset.from_dict({'text': textos})

    lora = LoraConfig(
        r=cfg.loraRank,
        lora_alpha=cfg.loraAlpha,
        target_modules=MODULOS_LORA,
        lora_dropout=DROPOUT_LORA,
        bias='none',
        task_type='CAUSAL_LM',
    )
    modelo = get_peft_model(modelo, lora)
    modelo.print_trainable_parameters()

    historico: list[dict] = []
    pasta_tmp = tempfile.mkdtemp(prefix='treino-')
    args = SFTConfig(
        output_dir=pasta_tmp,
        num_train_epochs=cfg.epocas,
        per_device_train_batch_size=cfg.tamanhoLote,
        learning_rate=cfg.taxaAprendizado,
        max_seq_length=cfg.comprimentoMax,
        dataset_text_field='text',
        logging_steps=1,
        save_strategy='no',
        report_to=[],
        fp16=dispositivo == 'cuda',
        use_cpu=dispositivo == 'cpu',
    )
    trainer = SFTTrainer(
        model=modelo,
        args=args,
        train_dataset=treino_ds,
        tokenizer=tokenizer,
        callbacks=[_criar_callback_log(registro, historico)],
    )
    registro.adicionar(f'Treinando: {cfg.epocas} épocas, lote {cfg.tamanhoLote}.')
    trainer.train()

    perda_final = historico[-1]['perda'] if historico else None
    registro.adicionar(f'Perda final: {perda_final}')

    pasta = Path(pedido.saidaDir)
    pasta.mkdir(parents=True, exist_ok=True)
    modelo.save_pretrained(str(pasta))
    arquivos = {
        nome: pasta / nome
        for nome in ('adapter_model.safetensors', 'adapter_config.json')
    }
    faltando = [nome for nome, caminho in arquivos.items() if not caminho.exists()]
    if faltando:
        raise RuntimeError(f'O PEFT não gerou os arquivos: {", ".join(faltando)}')
    registro.adicionar('Adaptador LoRA gravado em saidaDir.')

    modelo_resultante = _registrar_no_ollama(pedido, registro, arquivos)

    artefatos = [
        {
            'nome': nome,
            'tipo': 'ADAPTER',
            'caminho': _relativo_a_dados(caminho),
            'tamanhoBytes': caminho.stat().st_size,
        }
        for nome, caminho in arquivos.items()
    ]
    metricas = {
        'perda': perda_final,
        'historico': historico,
        'principal': {'nome': 'perda', 'rotulo': 'Perda final', 'valor': perda_final, 'formato': 'numero'},
    }
    return {
        'metricas': metricas,
        'artefatos': artefatos,
        'modeloResultante': modelo_resultante,
    }


def _registrar_no_ollama(pedido, registro: Registro, arquivos: dict[str, Path]) -> str | None:
    """Registra o adaptador no Ollama. Se o Ollama não responder, segue com aviso."""
    cfg = pedido.config
    try:
        registro.adicionar(f'Registrando {pedido.nomeOllama} no Ollama ({pedido.ollamaUrl})...')
        ollama.garantir_base(pedido.ollamaUrl, cfg.modeloBase)
        ollama.registrar_adaptador(
            pedido.ollamaUrl,
            pedido.nomeOllama,
            cfg.modeloBase,
            {nome: str(caminho) for nome, caminho in arquivos.items()},
            cfg.promptSistema or None,
        )
        registro.adicionar(f'Modelo {pedido.nomeOllama} disponível no Ollama.')
        return pedido.nomeOllama
    except (httpx.HTTPError, RuntimeError, OSError, ValueError) as erro:
        registro.adicionar(
            f'AVISO: não foi possível registrar no Ollama ({erro}). '
            'O adaptador foi salvo, mas o modelo não ficou disponível para agentes.'
        )
        return None
