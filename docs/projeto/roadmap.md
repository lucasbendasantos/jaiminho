# Jaiminho — Roadmap

> v0.3 · 2026-10-24 · autor: CLAUDE · status: ativo
> **Atualização 2026-10-24:** fases 0, 1 e 2 e boa parte da 3 implementadas na v0.1.0 (ver `README.md`). Pendentes da fase 3: painel git e import Insomnia/Bruno/HAR, e o fluxo OAuth2 authcode+PKCE com janela do app. Fase 4: Correio na LAN, mock server configurável pelo usuário, gRPC-Web, WebSocket/SSE.
> Mais baixas que na v0.1 porque o motor open source do Postman entra pronto (HTTP, auth, scripts, Swagger, codegen).

| Fase | Entrega | Pronto quando | Estimativa |
|---|---|---|---|
| 0 — Esqueleto | monorepo pnpm, Electron + electron-vite + React, preload/IPC tipado, utility process "carteiro", ícone, `electron-builder` gerando instalador NSIS e portátil | `Jaiminho-Setup.exe` instala e abre com a rede externa cortada | 10–15 h |
| 1 — Postman do dia a dia (HTTP/JSON) | workspace em YAML ⇄ Collection v2.1, árvore, abas, envio via `postman-runtime` (todas as auths dele), ambientes + escopos + valor local + segredos (`safeStorage`), scripts `pm.*`, histórico, import/export Postman v2.1, import Swagger (URL/arquivo/Swagger UI), cURL importa/exporta, bundle `.jaiminho` | o autor troca o Postman pelo Jaiminho nas APIs REST do dia a dia por uma semana | 50–75 h |
| 2 — XML/SOAP e gRPC | SOAP (envelopes, WSDL import, XSD com `xmllint-wasm`, XPath), gRPC completo (`grpc.md`), mTLS por host, CAs do Windows, grpcurl, hooks de script gRPC | testes de um serviço SOAP e de um gateway gRPC reais rodando pelo Jaiminho | 70–100 h |
| 3 — Time | Collection Runner (data file, relatório HTML/JUnit), CLI `jaiminho run`, fluxo OAuth2 authcode+PKCE com janela do app, sync de Swagger com diff, import Insomnia/Bruno/HAR, painel git (status/commit/pull), codegen Spring `RestClient` | runner no Jenkins interno com a CLI | 50–75 h |
| 4 — Extras | Correio na LAN, mock server HTTP e gRPC, gRPC-Web/Connect, WebSocket/SSE, GraphQL, temas, instalador assinado, atualização por pasta de rede | — | a definir |

Total até a fase 3: **180–265 h** (a confirmar).

## Ordem dentro da fase 1 (fatias verticais)
1. Abrir pasta → árvore → abrir request → enviar GET pelo `postman-runtime` → ver resposta.
2. Variáveis e ambientes (com o painel 👁).
3. Salvar/editar → YAML no disco → watcher.
4. Import Postman v2.1 (testar com coleções reais do time).
5. Import Swagger (testar com o `api-docs` de uma API real em QUA).
6. cURL e bundle.

## Critérios gerais de pronto
- Teste automatizado do executor e do importador com arquivos reais (coleções e swaggers anonimizados em `src/test/resources`).
- Funciona offline (teste com rede desligada no CI: `--network none` no container de teste).
- Nenhum segredo em arquivo partilhado (teste que varre o workspace e o bundle).
