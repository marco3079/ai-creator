# g08 — Cliente: firmware (projetos, compilações, gravação, dispositivos)

Leia antes: `docs/plano/CONTRATOS.md` (§2 Placas, §3 projetos/builds/dispositivos, §4 inteiro). Use os componentes de `client/src/ui` e o visual do REF. Se a base do g02 ainda não existir, aguarde.

## Arquivos que você pode criar/editar (só estes)
- `client/src/modules/firmware/*` (index.tsx, Projetos.tsx, EditorProjeto.tsx, ArvoreArquivos.tsx, EditorCodigo.tsx, Compilacoes.tsx, DetalheBuild.tsx, Gravador.tsx, gravarEsp.ts, Dispositivos.tsx, firmware.css)
(O g02 já coloca `"esptool-js": "0.7.1"` no `client/package.json`; você não edita esse arquivo.)

## Passos
1. `index.tsx`: rotas `/app/projetos`, `/app/projetos/:id`, `/app/builds`, `/app/dispositivos` (contrato).
2. `Projetos.tsx`: grade de cartões (nome, placa como selo, descrição, nº de arquivos, último build com `Selo` de status) + "Novo projeto" (Modal: nome, descrição, placa).
3. `EditorProjeto.tsx` (`/app/projetos/:id`): layout tipo IDE — à esquerda `ArvoreArquivos` (pastas recolhíveis montadas a partir dos caminhos, novo arquivo, renomear = criar novo + apagar, excluir), ao centro `EditorCodigo`, à direita (ou abaixo em telas estreitas) painel "Compilar": Selecao "Embutir modelo TinyML" (agentes TINYML com `ultimoTreinoId`), botão "Compilar" → `POST /projetos/:id/build`, acompanha com polling 2 s até terminar, log ao vivo, e quando SUCESSO mostra `Gravador`. Cabeçalho com nome, selo da placa, trocar placa (Selecao → `PUT /projetos/:id`).
4. `EditorCodigo.tsx`: `<textarea>` monoespaçado com numeração de linhas sincronizada (coluna lateral), Tab insere 2 espaços, Ctrl+S salva (`PUT /projetos/:id/arquivo`), indicador "não salvo". Sem bibliotecas novas.
5. `Gravador.tsx` (recebe `build`): 
   - Sempre: botão "Baixar firmware" (fetch com token → blob).
   - ESP32/ESP32S3 e navegador com `navigator.serial`: botão "Gravar via USB (Web Serial)" usando `gravarEsp.ts`, barra de progresso e log.
   - RP2040: instruções "Segure BOOTSEL, conecte, arraste o .uf2 para a unidade RPI-RP2".
   - Outras placas: "Use a extensão do VS Code (Gravar) ou o PlatformIO local".
   - Campo "Porta no servidor" + "Gravar pelo servidor" (`POST /builds/:id/gravar`) com nota de que exige Linux com o USB mapeado.
6. `gravarEsp.ts`: `export async function gravarEsp(binario: Uint8Array, offset: number, aoLog: (t: string) => void, aoProgresso: (pct: number) => void): Promise<void>` usando `esptool-js` 0.7.1 (`ESPLoader`, `Transport`; `navigator.serial.requestPort()`, baud 921600, `main()`, `writeFlash({ fileArray: [{ data, address }], flashSize: 'keep', eraseAll: false, compress: true, reportProgress })`, `after()` / hard reset). **Antes de escrever**, confira a API real em `client/node_modules/esptool-js/lib/*.d.ts` (rode `npm install` depois de acrescentar a dependência) — se `data` for string binária na versão instalada, converta. Declare os tipos mínimos do Web Serial se o TS reclamar (`declare global { interface Navigator { serial: any } }` num arquivo seu).
7. `Compilacoes.tsx` (`/app/builds`): Tabela de todos os builds (projeto, placa, status, tamanho, data) com filtro por projeto; clique abre `DetalheBuild` (Modal: log, download, Gravador).
8. `Dispositivos.tsx` (`/app/dispositivos`): cartões de dispositivos (nome, placa, porta, último build, última gravação) + CRUD em Modal. Botão "Detectar porta (Web Serial)" que preenche a porta com `getInfo()` (usbVendorId/usbProductId) quando disponível.

## Aceite / verificação
- `cd client && npm install && npx tsc --noEmit && npx vite build` sem erros.
