"""Treino de modelos tabulares clássicos (scikit-learn) com exportação para C.

Ponto de entrada: `executar_tabular(pedido, enviar)`, chamado por `executar.py`
em processo filho. Nunca deixa exceção escapar: falhas viram FALHA no callback.
"""

import json
import math
import re
import traceback
from pathlib import Path, PurePosixPath
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

SEMENTE = 42
COLUNA_ALVO = 'rotulo'
NOME_JOBLIB = 'modelo.joblib'
NOME_HEADER = 'modelo_tabular.h'
NOME_METRICAS = 'metricas.json'
ARQUIVO_FINAL = '.final'

# Tipo de cada hiperparâmetro conhecido (contrato §3). Chaves fora daqui são ignoradas com aviso.
HIPERPARAMETROS: dict[str, dict[str, type]] = {
    'ARVORE': {'max_depth': int, 'min_samples_leaf': int},
    'RANDOM_FOREST': {'n_estimators': int, 'max_depth': int},
    'GRADIENT_BOOSTING': {'n_estimators': int, 'learning_rate': float, 'max_depth': int},
    'LOGISTICA': {'C': float, 'max_iter': int},
    'LINEAR': {'alpha': float},
    'KNN': {'n_neighbors': int},
    'SVM': {'C': float, 'kernel': str},
}

# Algoritmos que o m2cgen consegue exportar (contrato §3). SVM só com kernel linear.
# GRADIENT_BOOSTING fica de fora: o m2cgen 0.10 não suporta GradientBoostingClassifier/Regressor do scikit-learn.
EXPORTAVEIS = {'ARVORE', 'RANDOM_FOREST', 'LOGISTICA', 'LINEAR', 'SVM'}


def executar_tabular(pedido: dict, enviar: Callable[..., None]) -> None:
    """Treina o modelo tabular descrito em `pedido` e envia o resultado por `enviar`."""
    log: list[str] = []

    def registrar(mensagem: str) -> None:
        log.append(mensagem)
        enviar(log=mensagem + '\n')

    try:
        _executar(pedido, enviar, registrar)
    except Exception:
        erro = traceback.format_exc()
        saida = Path(pedido['saidaDir'])
        saida.mkdir(parents=True, exist_ok=True)
        (saida / ARQUIVO_FINAL).write_text('FALHA', encoding='utf-8')
        enviar(status='FALHA', log='Erro durante o treino tabular:\n' + erro)


def _executar(pedido: dict, enviar: Callable[..., None], registrar: Callable[[str], None]) -> None:
    config = pedido.get('config') or {}
    tarefa = pedido['tarefa']
    algoritmo = config.get('algoritmo')
    if tarefa not in ('CLASSIFICACAO', 'REGRESSAO'):
        raise ValueError(f'Tarefa não suportada para TABULAR: {tarefa}')
    if algoritmo not in HIPERPARAMETROS:
        raise ValueError(f'Algoritmo desconhecido: {algoritmo}')
    if algoritmo == 'LOGISTICA' and tarefa != 'CLASSIFICACAO':
        raise ValueError('Regressão logística só serve para CLASSIFICACAO')
    if algoritmo == 'LINEAR' and tarefa != 'REGRESSAO':
        raise ValueError('Regressão linear (Ridge) só serve para REGRESSAO')

    teste_fracao = float(config.get('testeFracao', 0.2))
    if not 0 < teste_fracao < 1:
        raise ValueError(f'testeFracao deve estar entre 0 e 1, veio {teste_fracao}')
    validacao_cv = int(config.get('validacaoCruzada', 5))
    normalizar = bool(config.get('normalizar', True))
    exportar_c = bool(config.get('exportarC', True))

    registrar(f'Treino tabular: {algoritmo} ({tarefa}).')

    caminho_csv = pedido['dataset']['caminho']
    df = pd.read_csv(caminho_csv)
    if COLUNA_ALVO not in df.columns:
        raise ValueError(f'Coluna "{COLUNA_ALVO}" não encontrada no CSV')
    features = [c for c in df.columns if c != COLUNA_ALVO]
    if not features:
        raise ValueError('O CSV não tem colunas de entrada além de "rotulo"')

    antes = len(df)
    df = df.dropna()
    if len(df) < antes:
        registrar(f'Linhas com valores vazios removidas: {antes - len(df)}.')
    X = df[features].astype(float)
    if tarefa == 'CLASSIFICACAO':
        y = df[COLUNA_ALVO].astype(str)
    else:
        y = df[COLUNA_ALVO].astype(float)
    registrar(f'Dataset: {len(df)} amostras, {len(features)} entradas: {", ".join(features)}.')

    hiperparametros = _converter_hiperparametros(algoritmo, config.get('hiperparametros') or {}, registrar)
    base = _criar_estimador(algoritmo, tarefa, hiperparametros)

    estratificar = tarefa == 'CLASSIFICACAO' and y.value_counts().min() >= 2
    if tarefa == 'CLASSIFICACAO' and not estratificar:
        registrar('Aviso: alguma classe tem menos de 2 amostras; split sem estratificação.')
    X_treino, X_teste, y_treino, y_teste = train_test_split(
        X,
        y,
        test_size=teste_fracao,
        random_state=SEMENTE,
        stratify=y if estratificar else None,
    )

    modelo = Pipeline([('escala', StandardScaler()), ('modelo', base)]) if normalizar else base

    metricas: dict[str, Any] = {'algoritmo': algoritmo, 'tarefa': tarefa, 'normalizar': normalizar}
    if validacao_cv >= 2:
        scoring = 'accuracy' if tarefa == 'CLASSIFICACAO' else 'r2'
        registrar(f'Validação cruzada {validacao_cv}-fold ({scoring})...')
        try:
            notas = cross_val_score(modelo, X_treino, y_treino, cv=validacao_cv, scoring=scoring)
        except ValueError as erro:
            registrar(f'Validação cruzada ignorada: {erro}')
        else:
            metricas['validacaoCruzada'] = {
                'media': float(np.mean(notas)),
                'desvio': float(np.std(notas)),
                'k': validacao_cv,
            }
            registrar(f'Validação cruzada: média {metricas["validacaoCruzada"]["media"]:.4f}.')

    registrar('Treinando no conjunto de treino...')
    modelo.fit(X_treino, y_treino)
    previsao = modelo.predict(X_teste)

    if tarefa == 'CLASSIFICACAO':
        classes = [str(c) for c in modelo.classes_]
        acuracia = float(accuracy_score(y_teste, previsao))
        metricas.update(
            {
                'acuracia': acuracia,
                'f1': float(f1_score(y_teste, previsao, average='macro', zero_division=0)),
                'precisao': float(precision_score(y_teste, previsao, average='macro', zero_division=0)),
                'recall': float(recall_score(y_teste, previsao, average='macro', zero_division=0)),
                'matrizConfusao': confusion_matrix(y_teste, previsao, labels=classes).tolist(),
                'classes': classes,
                'principal': {
                    'nome': 'acuracia',
                    'rotulo': 'Acurácia (teste)',
                    'valor': acuracia * 100,
                    'formato': 'percentual',
                },
            }
        )
    else:
        r2 = float(r2_score(y_teste, previsao))
        metricas.update(
            {
                'mae': float(mean_absolute_error(y_teste, previsao)),
                'rmse': float(math.sqrt(mean_squared_error(y_teste, previsao))),
                'r2': r2,
                'principal': {'nome': 'r2', 'rotulo': 'R²', 'valor': r2, 'formato': 'numero'},
            }
        )
    registrar(f'Métricas de teste: {json.dumps(metricas["principal"], ensure_ascii=False)}')

    saida = Path(pedido['saidaDir'])
    saida.mkdir(parents=True, exist_ok=True)
    artefatos = []

    caminho_joblib = saida / NOME_JOBLIB
    joblib.dump(modelo, caminho_joblib)
    artefatos.append(_artefato(caminho_joblib, 'JOBLIB'))

    if exportar_c:
        cabecalho = _gerar_header(
            modelo=modelo,
            normalizar=normalizar,
            features=features,
            algoritmo=algoritmo,
            kernel=hiperparametros.get('kernel'),
            tarefa=tarefa,
            registrar=registrar,
        )
        if cabecalho is not None:
            caminho_header = saida / NOME_HEADER
            caminho_header.write_text(cabecalho, encoding='utf-8')
            artefatos.append(_artefato(caminho_header, 'HEADER_C'))
    else:
        registrar('Exportação C desativada na configuração.')

    caminho_metricas = saida / NOME_METRICAS
    caminho_metricas.write_text(json.dumps(metricas, ensure_ascii=False, indent=2), encoding='utf-8')
    artefatos.append(_artefato(caminho_metricas, 'METRICAS'))

    (saida / ARQUIVO_FINAL).write_text('SUCESSO', encoding='utf-8')
    enviar(status='SUCESSO', log='Treino tabular concluído.\n', metricas=metricas, artefatos=artefatos)


def _converter_hiperparametros(
    algoritmo: str, brutos: dict, registrar: Callable[[str], None]
) -> dict[str, Any]:
    tipos = HIPERPARAMETROS[algoritmo]
    convertidos: dict[str, Any] = {}
    for chave, valor in brutos.items():
        if chave not in tipos:
            registrar(f'Aviso: hiperparâmetro desconhecido para {algoritmo} ignorado: {chave}')
            continue
        tipo = tipos[chave]
        if tipo is int:
            convertidos[chave] = int(float(valor))
        elif tipo is float:
            convertidos[chave] = float(valor)
        else:
            convertidos[chave] = str(valor)
    return convertidos


def _criar_estimador(algoritmo: str, tarefa: str, hp: dict[str, Any]):
    clf = tarefa == 'CLASSIFICACAO'
    if algoritmo == 'ARVORE':
        cls = DecisionTreeClassifier if clf else DecisionTreeRegressor
        return cls(random_state=SEMENTE, **hp)
    if algoritmo == 'RANDOM_FOREST':
        cls = RandomForestClassifier if clf else RandomForestRegressor
        return cls(random_state=SEMENTE, **hp)
    if algoritmo == 'GRADIENT_BOOSTING':
        cls = GradientBoostingClassifier if clf else GradientBoostingRegressor
        return cls(random_state=SEMENTE, **hp)
    if algoritmo == 'LOGISTICA':
        return LogisticRegression(random_state=SEMENTE, **hp)
    if algoritmo == 'LINEAR':
        return Ridge(random_state=SEMENTE, **hp)
    if algoritmo == 'KNN':
        cls = KNeighborsClassifier if clf else KNeighborsRegressor
        return cls(**hp)
    if algoritmo == 'SVM':
        return SVC(random_state=SEMENTE, **hp) if clf else SVR(**hp)
    raise ValueError(f'Algoritmo desconhecido: {algoritmo}')


def _gerar_header(
    *,
    modelo,
    normalizar: bool,
    features: list[str],
    algoritmo: str,
    kernel: str | None,
    tarefa: str,
    registrar: Callable[[str], None],
) -> str | None:
    """Gera o header C do modelo ou devolve None (com aviso no log) se não der."""
    if algoritmo not in EXPORTAVEIS:
        registrar(f'Aviso: {algoritmo} não tem exportação para C; header não gerado.')
        return None
    if algoritmo == 'SVM' and kernel != 'linear':
        registrar('Aviso: SVM só exporta para C com kernel linear; header não gerado.')
        return None

    try:
        from m2cgen import export_to_c

        estimador = modelo.steps[-1][1] if normalizar else modelo
        codigo = export_to_c(estimador)
    except Exception as erro:  # noqa: BLE001 - exportação é opcional
        registrar(f'Aviso: m2cgen falhou ao exportar para C ({erro}); header não gerado.')
        return None

    # Assinatura real gerada pelo m2cgen: escalar (regressão/binário) ou com vetor de saída (multiclasse).
    assinatura_vetor = re.search(r'void\s+score\s*\(\s*double\s*\*\s*\w+\s*,\s*double\s*\*\s*\w+\s*\)', codigo)
    codigo = re.sub(r'^(double|void)\s+score\s*\(', r'static \1 aic_prever_bruto(', codigo, flags=re.M)
    if 'aic_prever_bruto(' not in codigo:
        registrar('Aviso: não foi possível localizar score() no código do m2cgen; header não gerado.')
        return None

    n = len(features)
    linhas_cabecalho = [
        '// Modelo tabular gerado automaticamente pelo trainer do AI Creator. Não editar.',
        f'// Algoritmo: {algoritmo} ({tarefa}).',
        '// Ordem das colunas de entrada (entrada[N]): ' + ', '.join(features),
        '// Uso:',
        f'//   double entrada[{n}] = {{ ... }};  // valores crus, nessa ordem',
    ]
    partes = ['#pragma once', '']
    partes.extend(linhas_cabecalho)
    partes.append('')
    partes.append(f'#define AIC_N_FEATURES {n}')

    # Tamanho da saída: 1 (escalar: regressão ou escore binário) ou o nº de classes (vetor de probabilidades).
    n_saidas = len(modelo.classes_) if assinatura_vetor else 1
    partes.append(f'#define AIC_N_SAIDAS {n_saidas}')
    partes.append('// saida tem AIC_N_SAIDAS valores: se 1, é o escore bruto (classificação binária: > 0 -> aic_classes[1];')
    partes.append('// regressão: o valor previsto); senão, vence o índice de maior valor (argmax).')

    classes: list[str] = []
    if tarefa == 'CLASSIFICACAO':
        classes = [str(c) for c in modelo.classes_]
        partes.append(f'#define AIC_N_CLASSES {len(classes)}')
        partes.append('static const char* aic_classes[] = {' + ', '.join(json.dumps(c, ensure_ascii=False) for c in classes) + '};')
    partes.append('')

    if normalizar:
        escalador = modelo.steps[0][1]
        media = ', '.join(f'{v!r}' for v in escalador.mean_)
        escala = ', '.join(f'{v!r}' for v in escalador.scale_)
        partes.append(f'static const double aic_media[AIC_N_FEATURES] = {{{media}}};')
        partes.append(f'static const double aic_escala[AIC_N_FEATURES] = {{{escala}}};')
        partes.append('')
        partes.append('static inline void aic_normalizar(double* x) {')
        partes.append('  for (int i = 0; i < AIC_N_FEATURES; i++) x[i] = (x[i] - aic_media[i]) / aic_escala[i];')
        partes.append('}')
        partes.append('')

    partes.append(codigo.rstrip())
    partes.append('')
    partes.append('// Entrada crua; aic_prever normaliza internamente quando o modelo foi treinado normalizado.')
    partes.append('static inline void aic_prever(double* entrada, double* saida) {')
    partes.append('  double x[AIC_N_FEATURES];')
    partes.append('  for (int i = 0; i < AIC_N_FEATURES; i++) x[i] = entrada[i];')
    if normalizar:
        partes.append('  aic_normalizar(x);')
    if assinatura_vetor:
        partes.append('  aic_prever_bruto(x, saida);')
    else:
        partes.append('  saida[0] = aic_prever_bruto(x);')
    partes.append('}')
    partes.append('')
    return '\n'.join(partes)


def _artefato(caminho: Path, tipo: str) -> dict:
    """Artefato com caminho relativo a /data (quando o saidaDir está em /data)."""
    texto = str(PurePosixPath(str(caminho).replace('\\', '/')))
    if texto.startswith('/data/'):
        texto = texto[len('/data/'):]
    return {
        'nome': caminho.name,
        'tipo': tipo,
        'caminho': texto,
        'tamanhoBytes': caminho.stat().st_size,
    }
