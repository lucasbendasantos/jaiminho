# Engenharia reversa — Postman (e Bruno) com REA

> 2026-10-23 · autor: CLAUDE · ferramenta: REA (`rea-agents` 6.7.0, github.com/morluto/rea) · status: concluído (v1)

## Escopo e limite (ler primeiro)

- **Analisado:** os pacotes **open source** do motor do Postman (Apache-2.0) e o **Bruno** (MIT), que é Electron como o Postman e tem gRPC em código aberto.
- **Analisado também:** o Postman **12.25.6 instalado** no PC do autor (`resources/app.asar`), só leitura. Ver §0.
- **Regra:** o Jaiminho não copia código do Postman. Usa o que é aberto (formato Collection v2.1, lista de variáveis dinâmicas, ordem de scripts) e reimplementa o comportamento.

## 0. Postman 12.25.6 instalado (o app real)

**Como:** `app.asar` copiado e extraído; REA no processo principal (`main.js`, 3 preloads, 5 bundles `main-*-ipc-handlers`) + leitura do `package.json` e busca de strings nos bundles. O REA no `app.asar` inteiro (414 bundles minificados, até 10 MB cada) foi interrompido: em 10 min passou de 3 arquivos.

| Tema | O que o Postman usa | Impacto no Jaiminho |
|---|---|---|
| Shell | Electron, `engines.node` 24.14.0, Squirrel para update | Electron; sem auto-update (offline) |
| Motor | `postman-runtime` ^7.56.1, `postman-collection` ^5.3.1, `postman-request` (fork), `@postman/runtime.platform`, `@postman/runtime.runtime-rpc-electron` | usar `postman-runtime`/`postman-collection` open source |
| gRPC | `@postman/grpc-js` 1.14.0-postman.4, `@postman/grpc-reflection-js`, `@postman/proto-loader`, `@postman/protobufjs` (forks dos oficiais) | mesma base com os pacotes oficiais `@grpc/*` e `protobufjs` |
| Onde o gRPC roda | bundle `@postman/runtime/dist/server-methods` dentro do `AgentWorker.js`, processo separado lançado por `Agent.spawnAgentProcess` | utility process "carteiro" |
| Reflection | strings `grpc.reflection.v1alpha...` e `grpc.reflection.v1.ServerReflection` (as duas versões) | fallback v1 → v1alpha |
| Tipos de chamada | `unary`, `server-stream`, `client-stream`, `bidi` | iguais |
| Eventos gRPC | `grpc:invoke`, `grpc:write`, `grpc:sent-request-header`, `grpc:sent-request-data`, `grpc:received-response-header`, `grpc:received-response-data`, `grpc:status`, `grpc:error`, `grpc:close`, `grpc:transient-error` | mesmos nomes no contrato IPC |
| Hooks de script gRPC | `beforeInvoke`, `onIncomingMessage`, `afterResponse` | mesmos hooks |
| Opções de canal | `grpc.max_receive/send_message_length`, `grpc.keepalive_time_ms`, `grpc.ssl_target_name_override`, `grpc.http_connect_target` (proxy), `grpc.enable_http_proxy`, backoff de reconexão | mesmas opções em `grpc.md` §5 |
| Erros | lê `grpc-status-details-bin`; trata WKT (`Any`, `Timestamp`, `Struct`, wrappers) | decodificar e mostrar |
| Mock server | `mock-server-runtime/http-server-worker.js` aceita `application/grpc(+proto/+json)` e `grpc-web` | fase 4 |
| Dados locais | `nedb` (36 refs no `main.js`), `electron-json-storage`, `duckdb` (datasets) | YAML em pasta (partilhável) |
| Segredos | `keytar` (cofre do SO), `@1password/sdk` | `safeStorage` do Electron |
| Arquivos e git | `@parcel/watcher`, bundles `main-git-ipc-handlers`, `main-file-system-ipc-handlers`, `@vscode/ripgrep` | `@parcel/watcher`; git na fase 3 |
| IPC | REA no main: 19 operações, só 6 canais literais e **11 dinâmicos** (RPC próprio, não `ipcMain.handle` fixo) | contrato tipado com canais fixos (mais fácil de auditar) |
| Segurança das janelas | `webPreferences` no `main.js`: 5× `nodeIntegration: true`, 5× `contextIsolation: false` | Jaiminho faz melhor: renderer em sandbox, sem Node |
| Outros | `@modelcontextprotocol/sdk` (servidor MCP), `graphql-ws`, `mqtt`, `socket.io`, `@sentry/node` (telemetria), `@azure/msal-node`, `openid-client` | sem telemetria; OAuth2 via `postman-runtime` |

## Alvos e comando

```bash
npx rea-agents@6.7.0 analyze-javascript-application <pasta> --json
```

| Alvo | Versão | Arquivos JS lidos | Achados | O que interessou |
|---|---|---|---|---|
| `postman-runtime/lib` | 7.56.3 | 52 | 482 | pipeline de envio, auth, runner |
| `postman-collection` | 5.3.1 | 1 135 (com deps) | 5 209 | modelo de dados, escopos de variáveis, variáveis dinâmicas |
| `openapi-to-postmanv2` | 6.4.1 | 1 276 | 4 033 | importação de Swagger |
| `bruno/packages/bruno-requests` | main (2026-10-23) | 63 | 669 | cliente gRPC |
| `bruno/packages/bruno-electron` | main (2026-10-23) | 207 | 2 250 | processo principal, IPC, import/export |

Saídas brutas (JSON de 68–141 MB) ficaram na sessão de análise e não foram copiadas; regenerar com o comando acima.

## Achados

### 1. Arquitetura: a UI nunca chama a rede (Bruno, e o mesmo padrão do Postman)
REA no `bruno-electron`: **4 janelas, 1 preload com 4 APIs no `contextBridge`, 268 operações IPC, 191 canais literais, 264 handlers no processo principal**. Canais do gRPC:

```
grpc:start-connection   grpc:send-message      grpc:end-request     grpc:cancel-request
grpc:load-methods-reflection   grpc:load-methods-proto   grpc:generate-sample-message
grpc:generate-grpcurl   grpc:get-active-connections
```
Canais de import/export: `renderer:import-collection`, `renderer:export-collection-postman`, `renderer:export-collection-zip`, `renderer:import-collection-zip`, ambientes globais e de coleção, `.env` de workspace.
→ No Jaiminho isso vira o contrato REST/WS de `docs\projeto\arquitetura.md` §6 e o protocolo de streaming de `grpc.md` §4 (start/send/end/cancel).

### 2. gRPC no Bruno (código aberto)
- Libs: `@grpc/grpc-js`, `@grpc/proto-loader`, `grpc-js-reflection-client`, `@grpc/reflection`.
- Tenta reflection **v1 e cai para v1alpha** (`reflectionServices = ['grpc.reflection.v1alpha.ServerReflection', 'grpc.reflection.v1.ServerReflection']`).
- Manda a metadata do request também na reflection (servidor com auth recusa reflection anônima).
- Suporta Unix socket e named pipe do Windows na URL.
- Gera mensagem de exemplo a partir do descriptor (`grpcMessageGenerator.js`, 131 linhas).
- Ordem de busca de imports: pasta do arquivo → import paths da coleção (na ordem) → caminhos padrão do protobuf (doc do Bruno).
→ Mesmo comportamento no executor gRPC do Jaiminho (`grpc.md`).

### 3. Motor do Postman (`postman-runtime`)
- Diretórios: `runner/` (cursor, partições, instruções, extensões `waterfall`/`parallel`/`delay`/`event`/`request`), `requester/` (fork `postman-request`, cookies `@postman/tough-cookie`, `sse-processor`), `authorizer/`.
- **Auths do Postman** (um arquivo cada): apikey, asap, aws4, basic, bearer, digest, edgegrid, hawk, jwt, ntlm, oauth1, oauth2, noauth. NTLM usa `js-md4` + `des.js`; JWT usa `jose`.
- `runner/resolve-secrets.js`: segredos resolvidos no momento do envio, separados das variáveis comuns.
- `request-helpers-presend.js` / `postsend.js`: o que roda antes/depois do envio (auth, cookies, scripts).
→ Lista de auths da fase 1–3 e pipeline do envio (`arquitetura.md` §5).

### 4. Variáveis (`postman-collection`)
- `VariableScope` com **camadas** (`_layers`): a busca percorre as camadas e o escopo mais restrito ganha; confirma a regra da doc oficial (local > data > environment > collection > global).
- **118 variáveis dinâmicas** (`$guid`, `$timestamp`, `$isoTimestamp`, `$randomInt`, `$randomPhoneNumber`, `$randomCity`...), geradas com `@faker-js/faker`, tudo local.
→ `workspace_e_variaveis.md` §2–3.

### 5. Swagger (`openapi-to-postmanv2`)
- 1 276 arquivos com deps; tem `libV2/SpecificationCollectionSyncing/spec-to-collection`, ou seja, o Postman já trata **sincronização** spec ↔ coleção, não só import único.
→ O Jaiminho faz o mesmo com diff por operação (`importacao_exportacao.md` §2).

## Próximo passo
- Se precisar de mais detalhe de um fluxo do Postman (ex.: como monta o JSON de exemplo do gRPC), rodar o REA só no bundle certo (`vendors-node_modules_postman_runtime_dist_server-methods*.js`) com `rea decompile`/`function`, em vez do `app.asar` inteiro.
