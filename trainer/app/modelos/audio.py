"""Áudio para palavra-chave (KWS): leitura de WAV, reamostragem, features e header C.

Os parâmetros (`audio` do config) são os de `entrada.audio` do modelo:
`{taxaHz, duracaoMs, janelaMs, passoMs, canaisMel}`.

As features são calculadas pelo micro-frontend do TFLite (o mesmo do exemplo
micro_speech do TFLite Micro), para a placa calcular igual. Se o módulo do
micro-frontend não existir no pacote instalado, cai para log-mel com `tf.signal`
(e o log avisa que a placa precisa do mesmo cálculo).

Só numpy e wave no import: o TensorFlow é importado dentro de
`features_de_onda`, para que as funções puras sejam testadas sem TensorFlow.
"""

import io
import wave

import numpy as np

TAXA_HZ_PADRAO = 16000
DURACAO_MS_PADRAO = 1000
JANELA_MS_PADRAO = 30
PASSO_MS_PADRAO = 20
CANAIS_MEL_PADRAO = 40
FAIXA_INFERIOR_HZ = 125.0
FAIXA_SUPERIOR_HZ = 7500.0


def _parametros(audio: dict) -> dict:
    """Valores do config com os padrões quando faltarem."""
    return {
        'taxaHz': int(audio.get('taxaHz', TAXA_HZ_PADRAO)),
        'duracaoMs': int(audio.get('duracaoMs', DURACAO_MS_PADRAO)),
        'janelaMs': int(audio.get('janelaMs', JANELA_MS_PADRAO)),
        'passoMs': int(audio.get('passoMs', PASSO_MS_PADRAO)),
        'canaisMel': int(audio.get('canaisMel', CANAIS_MEL_PADRAO)),
    }


def amostras_de_ms(ms: float, taxa: int) -> int:
    return int(round(taxa * ms / 1000.0))


def _faixa_superior(taxa: int) -> float:
    return min(FAIXA_SUPERIOR_HZ, taxa / 2.0)


def ler_wav(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    """Lê um WAV PCM de 16 bits (mono ou estéreo). Devolve (amostras float32 em [-1, 1], taxa)."""
    try:
        with wave.open(io.BytesIO(wav_bytes), 'rb') as arquivo:
            canais = arquivo.getnchannels()
            largura = arquivo.getsampwidth()
            taxa = arquivo.getframerate()
            bruto = arquivo.readframes(arquivo.getnframes())
    except (wave.Error, EOFError) as erro:
        raise ValueError(f'Arquivo WAV inválido: {erro}') from erro
    if largura != 2:
        raise ValueError('O áudio precisa ser WAV PCM de 16 bits')
    if canais not in (1, 2):
        raise ValueError('O áudio precisa ser mono ou estéreo')
    x = np.frombuffer(bruto, dtype='<i2').astype(np.float32) / 32768.0
    if canais == 2:
        x = x.reshape(-1, 2).mean(axis=1).astype(np.float32)
    return x, taxa


def reamostrar(x: np.ndarray, taxa_origem: int, taxa_destino: int) -> np.ndarray:
    """Reamostragem por interpolação linear."""
    x = np.asarray(x, dtype=np.float32)
    if taxa_origem == taxa_destino or x.size == 0:
        return x.copy()
    if taxa_origem <= 0 or taxa_destino <= 0:
        raise ValueError('Taxa de amostragem inválida')
    n_destino = int(round(x.size * taxa_destino / taxa_origem))
    if n_destino <= 0:
        return np.zeros(0, dtype=np.float32)
    instantes = np.arange(n_destino, dtype=np.float64) * taxa_origem / taxa_destino
    return np.interp(instantes, np.arange(x.size, dtype=np.float64), x).astype(np.float32)


def ajustar_duracao(x: np.ndarray, taxa: int, duracao_ms: int) -> np.ndarray:
    """Corta ou completa com silêncio (zeros) até `duracao_ms`."""
    n = amostras_de_ms(duracao_ms, taxa)
    x = np.asarray(x, dtype=np.float32)
    if x.size >= n:
        return x[:n].copy()
    return np.concatenate([x, np.zeros(n - x.size, dtype=np.float32)])


def preparar_onda(wav_bytes: bytes, audio: dict) -> np.ndarray:
    """WAV → onda float32 na taxa e na duração do config (sem features)."""
    p = _parametros(audio)
    x, taxa = ler_wav(wav_bytes)
    x = reamostrar(x, taxa, p['taxaHz'])
    return ajustar_duracao(x, p['taxaHz'], p['duracaoMs'])


def _micro_frontend():
    """Módulo do micro-frontend do TFLite, ou None se não existir neste pacote."""
    try:
        from tensorflow.lite.experimental.microfrontend.python.ops import audio_microfrontend_op
    except Exception:
        return None
    return audio_microfrontend_op


def _features_micro_frontend(onda: np.ndarray, p: dict, op) -> np.ndarray:
    import tensorflow as tf

    amostras16 = np.clip(np.round(onda * 32768.0), -32768, 32767).astype(np.int16)
    saida = op.audio_microfrontend(
        tf.constant(amostras16),
        sample_rate=p['taxaHz'],
        window_size=p['janelaMs'],
        window_step=p['passoMs'],
        num_channels=p['canaisMel'],
        upper_band_limit=_faixa_superior(p['taxaHz']),
        lower_band_limit=FAIXA_INFERIOR_HZ,
        out_scale=1,
        out_type=tf.uint16,
    )
    return np.asarray(saida.numpy(), dtype=np.float32)


def _features_log_mel(onda: np.ndarray, p: dict) -> np.ndarray:
    import tensorflow as tf

    janela = amostras_de_ms(p['janelaMs'], p['taxaHz'])
    passo = amostras_de_ms(p['passoMs'], p['taxaHz'])
    fft = 1
    while fft < janela:
        fft *= 2
    espectro = tf.signal.stft(
        tf.constant(onda, dtype=tf.float32),
        frame_length=janela,
        frame_step=passo,
        fft_length=fft,
        window_fn=tf.signal.hann_window,
        pad_end=False,
    )
    potencia = tf.abs(espectro) ** 2
    pesos = tf.signal.linear_to_mel_weight_matrix(
        num_mel_bins=p['canaisMel'],
        num_spectrogram_bins=fft // 2 + 1,
        sample_rate=p['taxaHz'],
        lower_edge_hertz=FAIXA_INFERIOR_HZ,
        upper_edge_hertz=_faixa_superior(p['taxaHz']),
    )
    mel = tf.matmul(potencia, pesos)
    return np.asarray(tf.math.log(mel + 1e-6).numpy(), dtype=np.float32)


def usa_micro_frontend() -> bool:
    """True se o micro-frontend do TFLite está disponível neste ambiente."""
    return _micro_frontend() is not None


def features_de_onda(onda: np.ndarray, audio: dict) -> np.ndarray:
    """Features (quadros × canaisMel, float32) de uma onda já na taxa e duração do config."""
    p = _parametros(audio)
    onda = np.asarray(onda, dtype=np.float32)
    op = _micro_frontend()
    if op is not None:
        return _features_micro_frontend(onda, p, op)
    return _features_log_mel(onda, p)


def extrair_features_audio(wav_bytes: bytes, audio: dict) -> np.ndarray:
    """WAV → features (quadros × canaisMel, float32)."""
    return features_de_onda(preparar_onda(wav_bytes, audio), audio)


def quadros_esperados(audio: dict) -> int:
    """Número de quadros da janela deslizante para a duração e os passos do config."""
    p = _parametros(audio)
    n = amostras_de_ms(p['duracaoMs'], p['taxaHz'])
    janela = amostras_de_ms(p['janelaMs'], p['taxaHz'])
    passo = amostras_de_ms(p['passoMs'], p['taxaHz'])
    if n < janela:
        return 0
    return 1 + (n - janela) // passo


def gerar_header_features(audio: dict, normalizacao: dict | None = None) -> str:
    """Header C com os parâmetros do front-end (e a normalização do treino, se informada)."""
    p = _parametros(audio)
    linhas = [
        '// Parâmetros do front-end de áudio usados no treino. Gerado automaticamente. Não editar.',
        '#pragma once',
        '',
        f'#define AIC_AUDIO_TAXA_HZ {p["taxaHz"]}',
        f'#define AIC_AUDIO_DURACAO_MS {p["duracaoMs"]}',
        f'#define AIC_AUDIO_JANELA_MS {p["janelaMs"]}',
        f'#define AIC_AUDIO_PASSO_MS {p["passoMs"]}',
        f'#define AIC_AUDIO_CANAIS_MEL {p["canaisMel"]}',
        f'#define AIC_AUDIO_JANELA_AMOSTRAS {amostras_de_ms(p["janelaMs"], p["taxaHz"])}',
        f'#define AIC_AUDIO_PASSO_AMOSTRAS {amostras_de_ms(p["passoMs"], p["taxaHz"])}',
        f'#define AIC_AUDIO_QUADROS {quadros_esperados(audio)}',
        f'#define AIC_AUDIO_FAIXA_INFERIOR_HZ {FAIXA_INFERIOR_HZ:.1f}f',
        f'#define AIC_AUDIO_FAIXA_SUPERIOR_HZ {_faixa_superior(p["taxaHz"]):.1f}f',
    ]
    if normalizacao:
        linhas.append(f'#define AIC_AUDIO_MEDIA {float(normalizacao["media"]):.6f}f')
        linhas.append(f'#define AIC_AUDIO_DESVIO {float(normalizacao["desvio"]):.6f}f')
    return '\n'.join(linhas) + '\n'
