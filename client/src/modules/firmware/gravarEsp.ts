import { ESPLoader, Transport } from 'esptool-js';

/** Indica se o navegador expõe a Web Serial API (Chrome/Edge em contexto seguro). */
export function suportaWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Grava um binário num ESP32 / ESP32-S3 via USB usando a Web Serial API.
 * O usuário escolhe a porta no seletor do navegador.
 *
 * @param binario   imagem completa (ex.: firmware-merged.bin) em Uint8Array
 * @param offset    endereço de gravação (0x0 para o binário mesclado)
 * @param aoLog     recebe linhas de log do esptool
 * @param aoProgresso recebe percentual 0..100
 */
export async function gravarEsp(
  binario: Uint8Array,
  offset: number,
  aoLog: (t: string) => void,
  aoProgresso: (pct: number) => void,
): Promise<void> {
  if (!suportaWebSerial()) {
    throw new Error('Este navegador não suporta Web Serial. Use Chrome ou Edge.');
  }

  // Tipo da porta vem do próprio esptool-js; o cast evita depender dos tipos globais do Web Serial.
  type PortaSerial = ConstructorParameters<typeof Transport>[0];
  const serial = (navigator as unknown as { serial: { requestPort(): Promise<PortaSerial> } }).serial;
  const porta = await serial.requestPort();
  const transporte = new Transport(porta);
  const terminal = {
    clean: () => {},
    writeLine: (texto: string) => aoLog(texto),
    write: (texto: string) => aoLog(texto),
  };

  const carregador = new ESPLoader({ transport: transporte, baudrate: 921600, terminal });

  try {
    aoLog('Conectando ao chip (bootloader)...');
    const chip = await carregador.main();
    aoLog(`Chip detectado: ${chip}`);

    aoLog(`Gravando ${binario.length} bytes em 0x${offset.toString(16)}...`);
    await carregador.writeFlash({
      fileArray: [{ data: binario, address: offset }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_indice, escrito, total) =>
        aoProgresso(total > 0 ? Math.round((escrito / total) * 100) : 0),
    });

    aoLog('Gravação concluída. Reiniciando o dispositivo...');
    await carregador.after();
    aoProgresso(100);
  } finally {
    await transporte.disconnect().catch(() => {});
  }
}

/** Baixa o artefato de um build (com o token do usuário) e devolve os bytes. */
export async function buscarFirmware(buildId: number): Promise<Uint8Array> {
  const token = localStorage.getItem('aicreator.token');
  const resposta = await fetch(`/api/builds/${buildId}/firmware`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resposta.ok) {
    let mensagem = 'Não foi possível baixar o firmware';
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados.erro) mensagem = dados.erro;
    } catch {
      // corpo não é JSON: mantém a mensagem padrão
    }
    throw new Error(mensagem);
  }
  return new Uint8Array(await resposta.arrayBuffer());
}

/** Salva bytes como arquivo no computador do usuário. */
export function salvarArquivo(bytes: Uint8Array, nome: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
