from app.exportar import para_header_c


def test_para_header_c_bytes():
    cabecalho = para_header_c(b'\x01\x02')
    assert '0x01, 0x02' in cabecalho
    assert 'g_model_len = 2' in cabecalho
