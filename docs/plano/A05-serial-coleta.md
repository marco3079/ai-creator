# A05 — Monitor serial, coleta de dados e modelos de firmware

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §6, `client/src/lib/tipos-melhorias.ts` (`MetadadosColeta`) e `client/src/modules/firmware/gravarEsp.ts` (como o projeto já usa Web Serial com esptool-js).

## Arquivos (só estes)
- servidor: `server/src/modules/projetos/modelos.ts`
- cliente: `client/src/modules/firmware/{serial.ts, MonitorSerial.tsx, Coleta.tsx, GraficoAoVivo.tsx, simulador.ts, coleta.css}` (novos), `client/src/modules/firmware/Projetos.tsx` (modal "Novo projeto": escolher modelo BLINK/COLETOR)
Rotas e menu ficam com o A08; o encaixe do monitor no editor de projeto fica com o A07.

## Passos
1. `modelos.ts`: assinatura nova `arquivosModelo(placa, nome, modelo = 'BLINK')` e o firmware COLETOR (§6) por placa, em C++ Arduino sem bibliotecas externas (MPU6050 por `Wire` direto: acordar em 0x6B, ler 0x3B..0x40). Mantenha o BLINK atual igual.
2. `serial.ts`: `ConexaoSerial` (Web Serial; `TextDecoderStream`; quebra por `\n`; `aoLinha` chamado com a linha sem `\r`; `fechar` libera o reader/writer e a porta). `export function suportaSerial(): boolean`.
3. `MonitorSerial.tsx`: conectar/desconectar, baud (9600…921600, padrão 115200), área de saída rolável com até 2000 linhas, auto-rolagem, limpar, enviar linha (com/sem `\n`), carimbo de hora opcional, baixar log `.txt`. Sem `navigator.serial`: `Aviso` explicando (Chrome/Edge no computador).
4. `simulador.ts`: gera linhas no formato de coleta (3 canais, 50 Hz) para os gestos "parado", "acenar", "circulo" (ruído + senoides), com o metadado `#`.
5. `Coleta.tsx` (`/app/coleta`): fonte = placa (serial) ou simulador; lê os metadados `# AIC-COLETA`; gráfico ao vivo (`GraficoAoVivo.tsx`, SVG próprio, últimos 200 pontos por canal, cores por canal, claro/escuro por variáveis CSS); campos rótulo e janela (amostras por exemplo, padrão 50); botão "Gravar exemplo" (captura as próximas `janela` linhas); contagem por rótulo; lista com excluir; "Salvar como dataset" → CSV `rotulo,f0..fN` com os canais intercalados por amostra (`c0_t0,c1_t0,c2_t0,c0_t1,...`) e `POST /api/datasets` `{nome, tipo:'SERIE_TEMPORAL', janela, csv}`; depois link para `/app/datasets`. Dica de como usar: "Grave pelo menos 20 exemplos de cada gesto".
6. `Projetos.tsx`: no modal, Selecao "Modelo" (Pisca-LED / Coletor de sensores) enviando `modelo`.

## Verificação
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit && npx vite build`.
- Compile o firmware COLETOR de ESP32 no builder do Docker: escreva os arquivos gerados por `arquivosModelo('ESP32','Coletor','COLETOR')` numa pasta temporária dentro do volume (`docker compose cp` para `/tmp/coletor` no container `builder`) e rode `pio run -d /tmp/coletor` lá dentro (`MSYS_NO_PATHCONV=1 docker compose exec -T builder ...`). Publique o resultado (SUCCESS/erros).
