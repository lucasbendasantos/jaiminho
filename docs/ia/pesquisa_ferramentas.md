# Pesquisa — clientes de API de referência

> 2026-10-23 · autor: CLAUDE · fontes no fim · status: referência

| | Postman | Bruno | Kreya | Yaak | Jaiminho (alvo) |
|---|---|---|---|---|---|
| Base | Electron, nuvem | Electron, local | .NET, local | Tauri (Rust), local | **Electron + motor open source do Postman, local** |
| Precisa de conta/internet | sim para colaborar | não | não (licença offline) | não | **não** |
| Onde guarda | banco local + nuvem | arquivos `.bru` (git) | JSON por arquivo (git) | arquivos (git) | **YAML por arquivo (git)** |
| REST / SOAP-XML | sim / sim (raw) | sim / raw | sim / — | sim / raw | sim / **WSDL + XSD + XPath** |
| gRPC reflection | sim | v1 → v1alpha | sim, contínua | sim | v1 → v1alpha + congelar |
| gRPC `.proto` + imports | sim (Protobuf API, import paths por request) | sim (por coleção) | observa pasta | sim | pasta `protos/` + import paths |
| Streaming gRPC | 4 tipos | 4 tipos | 4 tipos + HTTP/3 | sim | 4 tipos |
| Escopos de variáveis | global, coleção, ambiente, data, local + vault | global, coleção, ambiente, pasta, request, runtime, `.env` | ambientes herdados | ambientes | **Postman + pasta + request + `.env`** |
| Segredos | vault, tipo secret | `.env` / secrets | cofre de auth | — | cifrados fora do workspace |
| Import | muitos | Postman, Insomnia, OpenAPI | Postman, Insomnia, HAR, cURL, grpcurl | Postman, Insomnia, OpenAPI, cURL | Postman, OpenAPI, WSDL, cURL, grpcurl, Insomnia, Bruno, HAR |
| Scripts | JS (`pm`) | JS (`bru` + `pm` parcial) | JS | plugins | JS `pm` compatível |
| CLI | Postman CLI / Newman | `bru` CLI | CLI | — | `jaiminho run` |

O que pegar de cada um:
- **Postman:** UX, sintaxe `{{ }}`, escopos, `pm.*`, sincronização spec↔coleção.
- **Bruno:** arquivos no git, variáveis de pasta/request, `.env`, gRPC com fallback de reflection, export grpcurl.
- **Kreya:** congelar/observar schemas, mTLS por host, import de grpcurl, foco em privacidade.
- **Yaak:** leveza e app local sem conta.

## Fontes
- Postman — service definitions gRPC: https://learning.postman.com/docs/use/send-requests/protocols/grpc/using-service-definition/
- Postman — variáveis: https://learning.postman.com/docs/use/send-requests/variables/variables/
- Bruno — gRPC proto: https://docs.usebruno.com/send-requests/grpc/grpc-proto
- Bruno — código: https://github.com/usebruno/bruno (packages/bruno-requests/src/grpc)
- Kreya: https://kreya.app/
- Yaak: https://openapi.tools/tools/yaak
- REA: https://github.com/morluto/rea
