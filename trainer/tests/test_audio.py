import io
import wave

import numpy as np
import pytest

from app.modelos import audio


def _wav(amostras: np.ndarray, taxa: int = 16000, canais: int = 1, largura: int = 2) -> bytes:
    """Gera um WAV PCM em memória. `amostras` em float [-1, 1]; estéreo recebe o mesmo sinal nos dois canais."""
    dados = np.clip(np.asarray(amostras, dtype=np.float64) * 32767, -32768, 32767).astype('<i2')
    if canais == 2:
        dados = np.stack([dados, dados], axis=1).reshape(-1)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as w:
        w.setnchannels(canais)
        w.setsampwidth(largura)
        w.setframerate(taxa)
        w.writeframes(dados.tobytes())
    return buffer.getvalue()


def test_ler_wav_mono_16_bits_devolve_taxa_e_amostras():
    sinal = np.array([0.0, 0.5, -0.5, 0.25], dtype=np.float32)
    x, taxa = audio.ler_wav(_wav(sinal, taxa=8000))
    assert taxa == 8000
    assert x.dtype == np.float32
    assert np.allclose(x, sinal, atol=1e-3)


def test_ler_wav_estereo_vira_mono_pela_media():
    sinal = np.array([0.2, -0.4, 0.6], dtype=np.float32)
    x, taxa = audio.ler_wav(_wav(sinal, taxa=16000, canais=2))
    assert taxa == 16000
    assert x.shape == (3,)
    assert np.allclose(x, sinal, atol=1e-3)


def test_ler_wav_rejeita_8_bits():
    with pytest.raises(ValueError, match='16 bits'):
        audio.ler_wav(_wav(np.zeros(4), largura=1))


def test_ler_wav_rejeita_arquivo_que_nao_e_wav():
    with pytest.raises(ValueError, match='WAV inválido'):
        audio.ler_wav(b'isto nao e um wav')


def test_reamostrar_dobra_a_quantidade_de_amostras():
    x = np.ones(100, dtype=np.float32) * 0.3
    y = audio.reamostrar(x, 8000, 16000)
    assert y.shape == (200,)
    assert np.allclose(y, 0.3, atol=1e-6)


def test_reamostrar_mesma_taxa_nao_muda():
    x = np.linspace(-1, 1, 50, dtype=np.float32)
    assert np.array_equal(audio.reamostrar(x, 16000, 16000), x)


def test_ajustar_duracao_corta_e_completa():
    x = np.ones(20000, dtype=np.float32)
    cortado = audio.ajustar_duracao(x, 16000, 1000)
    assert cortado.shape == (16000,)
    curto = audio.ajustar_duracao(np.ones(8000, dtype=np.float32), 16000, 1000)
    assert curto.shape == (16000,)
    assert np.all(curto[8000:] == 0)
    assert np.all(curto[:8000] == 1)


def test_preparar_onda_leva_a_taxa_e_a_duracao_do_config():
    sinal = np.zeros(8000, dtype=np.float32)  # 1 s a 8 kHz
    cfg = {'taxaHz': 16000, 'duracaoMs': 500}
    onda = audio.preparar_onda(_wav(sinal, taxa=8000), cfg)
    assert onda.shape == (8000,)


def test_quadros_esperados_com_padrao_kws():
    # 1 s a 16 kHz, janela 30 ms (480 amostras), passo 20 ms (320 amostras): 1 + (16000 - 480) // 320 = 49
    assert audio.quadros_esperados({'taxaHz': 16000, 'duracaoMs': 1000, 'janelaMs': 30, 'passoMs': 20}) == 49


def test_quadros_esperados_zero_quando_janela_maior_que_sinal():
    assert audio.quadros_esperados({'taxaHz': 16000, 'duracaoMs': 10, 'janelaMs': 30, 'passoMs': 20}) == 0


def test_gerar_header_features_tem_os_defines():
    cfg = {'taxaHz': 16000, 'duracaoMs': 1000, 'janelaMs': 30, 'passoMs': 20, 'canaisMel': 40}
    cabecalho = audio.gerar_header_features(cfg)
    assert '#pragma once' in cabecalho
    assert '#define AIC_AUDIO_TAXA_HZ 16000' in cabecalho
    assert '#define AIC_AUDIO_DURACAO_MS 1000' in cabecalho
    assert '#define AIC_AUDIO_JANELA_MS 30' in cabecalho
    assert '#define AIC_AUDIO_PASSO_MS 20' in cabecalho
    assert '#define AIC_AUDIO_CANAIS_MEL 40' in cabecalho
    assert '#define AIC_AUDIO_JANELA_AMOSTRAS 480' in cabecalho
    assert '#define AIC_AUDIO_PASSO_AMOSTRAS 320' in cabecalho
    assert '#define AIC_AUDIO_QUADROS 49' in cabecalho
    assert 'AIC_AUDIO_MEDIA' not in cabecalho


def test_gerar_header_features_com_normalizacao():
    cfg = {'taxaHz': 16000, 'duracaoMs': 1000, 'janelaMs': 30, 'passoMs': 20, 'canaisMel': 40}
    cabecalho = audio.gerar_header_features(cfg, {'media': 2.5, 'desvio': 4.0})
    assert '#define AIC_AUDIO_MEDIA 2.500000f' in cabecalho
    assert '#define AIC_AUDIO_DESVIO 4.000000f' in cabecalho


def test_gerar_header_features_usa_padroes_quando_faltam_chaves():
    cabecalho = audio.gerar_header_features({})
    assert '#define AIC_AUDIO_TAXA_HZ 16000' in cabecalho
    assert '#define AIC_AUDIO_CANAIS_MEL 40' in cabecalho
