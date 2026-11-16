// Tipos da tela Sistema → Atualização (contrato CONTRATO-ATUALIZADOR.md §4 e §5).

export interface Commit {
  commit: string;
  curto: string;
  data: string;
  mensagem: string;
}

export interface EstadoAtualizacao {
  ramo: string | null;
  repositorio: string | null;
  instalado: Commit | null;
  implantado: string | null;
  remoto: Commit | null;
  atras: number;
  novidades: { curto: string; mensagem: string; data: string }[];
  precisaReconstruir: boolean;
  atualizadorMudou: boolean;
  verificadoEm: string | null;
  erroVerificacao: string | null;
  verificando?: boolean;
  servicos: string[];
  copias: { nome: string; tamanhoBytes: number; criadoEm: string }[];
  tarefa: {
    estado: 'PARADA' | 'EXECUTANDO' | 'CONCLUIDA' | 'FALHOU';
    etapa: string;
    iniciadaEm: string | null;
    terminadaEm: string | null;
    erro: string | null;
    log: string[];
  };
}

export type AtualizacaoDTO =
  | { disponivel: false; motivo: string }
  | ({ disponivel: true } & EstadoAtualizacao);

// Resposta de GET /atualizacao/resumo (aviso no topo).
export interface ResumoAtualizacao {
  disponivel: boolean;
  atras: number;
  remoto: string | null;
}
