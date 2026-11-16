// Conexão serial pelo navegador (Web Serial API), para o monitor serial e a coleta de dados.
// Chrome/Edge no computador, em contexto seguro (https ou localhost).

/** Indica se o navegador expõe a Web Serial API. */
export function suportaSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Forma mínima da porta da Web Serial API (evita depender dos tipos globais).
interface PortaWeb {
  open(opcoes: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

/**
 * Uma conexão serial aberta pelo usuário. Entrega as linhas recebidas (sem o '\r' final).
 *
 * Uso:
 *   const conexao = new ConexaoSerial();
 *   const parar = conexao.aoLinha((linha) => console.log(linha));
 *   await conexao.abrir(115200);
 *   await conexao.escrever('status\n');
 *   await conexao.fechar();
 */
export class ConexaoSerial {
  private porta: PortaWeb | null = null;
  private leitor: ReadableStreamDefaultReader<string> | null = null;
  private pipeLeitura: Promise<void> | null = null;
  private escritor: WritableStreamDefaultWriter<string> | null = null;
  private pipeEscrita: Promise<void> | null = null;
  private ouvintes = new Set<(linha: string) => void>();
  private ouvintesFechar = new Set<() => void>();
  private aberta = false;

  /** true enquanto a porta estiver aberta. */
  get conectada(): boolean {
    return this.aberta;
  }

  /**
   * Pede ao usuário a porta (seletor do navegador) e abre com a taxa indicada.
   * Lança Error com mensagem em português se o navegador não tiver Web Serial ou o usuário cancelar.
   */
  async abrir(baud: number): Promise<void> {
    if (!suportaSerial()) {
      throw new Error('Este navegador não suporta Web Serial. Use Chrome ou Edge no computador.');
    }
    if (this.aberta) return;

    const serial = (navigator as unknown as { serial: { requestPort(): Promise<PortaWeb> } }).serial;
    const porta = await serial.requestPort();
    await porta.open({ baudRate: baud });
    this.porta = porta;
    this.aberta = true;

    if (porta.readable) {
      const decodificador = new TextDecoderStream();
      this.pipeLeitura = porta.readable.pipeTo(decodificador.writable).catch(() => undefined);
      this.leitor = decodificador.readable.getReader();
      void this.lerLoop(this.leitor);
    }
    if (porta.writable) {
      const codificador = new TextEncoderStream();
      this.pipeEscrita = codificador.readable.pipeTo(porta.writable).catch(() => undefined);
      this.escritor = codificador.writable.getWriter();
    }
  }

  /** Envia texto pela porta. Não faz nada se estiver fechada. */
  async escrever(texto: string): Promise<void> {
    if (!this.escritor) throw new Error('A porta serial não está aberta.');
    await this.escritor.write(texto);
  }

  /** Registra um ouvinte de linhas. Devolve a função que remove o ouvinte. */
  aoLinha(cb: (linha: string) => void): () => void {
    this.ouvintes.add(cb);
    return () => {
      this.ouvintes.delete(cb);
    };
  }

  /** Registra um ouvinte chamado quando a porta fecha sozinha (desligou a placa, cabo removido). */
  aoFecharInesperado(cb: () => void): () => void {
    this.ouvintesFechar.add(cb);
    return () => {
      this.ouvintesFechar.delete(cb);
    };
  }

  /** Fecha o leitor e o escritor e libera a porta. Pode ser chamada mais de uma vez. */
  async fechar(): Promise<void> {
    const pedidoFechamento = this.aberta;
    this.aberta = false;

    if (this.leitor) {
      await this.leitor.cancel().catch(() => undefined);
      this.leitor.releaseLock();
      this.leitor = null;
    }
    if (this.pipeLeitura) {
      await this.pipeLeitura;
      this.pipeLeitura = null;
    }
    if (this.escritor) {
      await this.escritor.close().catch(() => undefined);
      this.escritor = null;
    }
    if (this.pipeEscrita) {
      await this.pipeEscrita;
      this.pipeEscrita = null;
    }
    if (this.porta) {
      const porta = this.porta;
      this.porta = null;
      await porta.close().catch(() => undefined);
    }
    if (pedidoFechamento) {
      // Fechamento pedido pelo usuário: não avisa como queda inesperada.
      this.ouvintesFechar.clear();
    }
  }

  private async lerLoop(leitor: ReadableStreamDefaultReader<string>): Promise<void> {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        if (value) buffer += value;
        let indice = buffer.indexOf('\n');
        while (indice >= 0) {
          const linha = buffer.slice(0, indice).replace(/\r$/, '');
          buffer = buffer.slice(indice + 1);
          this.emitirLinha(linha);
          indice = buffer.indexOf('\n');
        }
      }
    } catch {
      // Porta perdida ou leitura cancelada pelo fechar(): tratado abaixo.
    }
    if (this.aberta) {
      // Saiu do laço sem fechar() do usuário: a porta caiu.
      this.aberta = false;
      for (const cb of [...this.ouvintesFechar]) cb();
    }
  }

  private emitirLinha(linha: string): void {
    for (const cb of [...this.ouvintes]) {
      try {
        cb(linha);
      } catch {
        // um ouvinte com erro não derruba os outros
      }
    }
  }
}
