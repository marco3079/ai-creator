// Leitura de respostas SSE (text/event-stream) disparadas por POST, como POST /api/agentes/:id/executar.
// O EventSource nativo só faz GET e não envia cabeçalho Authorization, por isso o corpo é lido à mão.

const CHAVE_TOKEN = 'aicreator.token';

export async function lerEventos(
  caminho: string,
  corpo: unknown,
  aoEvento: (e: unknown) => void,
  sinal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem(CHAVE_TOKEN);
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) cabecalhos['Authorization'] = `Bearer ${token}`;

  const resposta = await fetch('/api' + caminho, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify(corpo),
    signal: sinal,
  });

  if (!resposta.ok) {
    let mensagem = 'Erro inesperado';
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados?.erro) mensagem = dados.erro;
    } catch {
      // Sem JSON no corpo: fica a mensagem padrão.
    }
    throw new Error(mensagem);
  }

  if (!resposta.body) return;

  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';

  // Cada evento é uma ou mais linhas "data: <json>", separadas por linha em branco.
  function processarBloco(bloco: string): void {
    for (const linha of bloco.split('\n')) {
      if (!linha.startsWith('data:')) continue;
      const json = linha.slice(5).trim();
      if (!json) continue;
      try {
        aoEvento(JSON.parse(json));
      } catch {
        // Linha que não é JSON válido: ignorada.
      }
    }
  }

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    const blocos = buffer.split('\n\n');
    buffer = blocos.pop() ?? '';
    for (const bloco of blocos) processarBloco(bloco);
  }

  buffer += decodificador.decode();
  if (buffer.trim()) processarBloco(buffer);
}
