# Relatório de QA — Jaiminho 0.1.0

Data: 2026-10-24 · commit base `d70d3ea` (+ este relatório)

## Resultado final

| Suíte | O que cobre | Resultado |
|---|---|---|
| `packages/engine` (`npm test`) | testes unitários/integração do motor | 42/42 |
| `qa/01-variaveis-scripts.js` | precedência, dinâmicas, `pm.*`, scripts herdados, CSV do runner | 26/26 |
| `qa/02-http.js` | métodos, bodies, auth (basic/bearer/apikey/digest/OAuth2), cookies, redirect, gzip, cancelamento | 52/52 |
| `qa/03-tls.js` | SSL on/off, CA do workspace e do sistema, mTLS PEM/P12 (HTTP e gRPC), TLS×plaintext | 32/32 |
| `qa/04-grpc.js` | reflection, .proto, protoset, 4 tipos de chamada, validação de mensagem, erros ricos | 51/53 (*) |
| `qa/05-import-export.js` | Postman, cURL (bash/cmd/PowerShell), grpcurl, Swagger URL/arquivo, WSDL, bundle | 71/71 |
| `qa/06-workspace.js` | disco: nomes Windows, mover/duplicar/apagar, YAML corrompido, ids duplicados, histórico | 31/31 |
| `qa/07-offline.js` | nenhuma chamada à internet | 3/3 |
| `qa/08-xml-soap.js` | pretty/XPath/XSD/SOAP fault | 10/10 |
| `qa/zz-codegen-zipslip.js` | codegen e zip slip no bundle | 2/2 |
| `apps/desktop/e2e/flow.js` | fluxo completo na UI (dev **e** build empacotado) | 22/22 e 22/22 |
| `qa/e2e-extra.js` | workspace novo pela UI, segredos, import/export, runner CSV, cancelar, fechar com aba suja | 10/10 |

(*) As 2 falhas de `04` são premissas do teste, não bugs: (1) copiar só o `.proto` sem os imports não compila (o app usa "+ Adicionar .proto", que copia os imports juntos); (2) mensagem vazia `{}` é enviada certo e o mock responde `NOT_FOUND` por não ter id.

## Bugs achados e corrigidos nesta rodada

| Área | Bug | Correção |
|---|---|---|
| Variáveis | variável de request ganhava de `data` do runner | chaves do `data` saem do escopo local |
| Variáveis | variável criada por script/`unset` não persistia | valores locais com sentinela `UNSET` |
| Scripts | erro de `pm.response.json()` em HTML pouco claro | prefixo `JSONError: resposta não é JSON válido` |
| Runner | CSV com aspas multilinha e `;` quebrava | parser próprio (vírgula, `;`, tab) |
| HTTP | cancelar só voltava quando o servidor respondia | resolve "Cancelado" na hora |
| HTTP | OAuth2 client_credentials/password não buscava token sozinho | busca e guarda o token |
| TLS | CA configurada inexistente era ignorada em silêncio | aviso no resultado e no erro |
| TLS | mTLS com host sem porta não valia | host sem porta = qualquer porta |
| gRPC | plaintext × TLS trocados sem dica | dica `grpcs://` / `grpc://` |
| gRPC | script gRPC podia escapar do sandbox (`constructor.constructor`) | contexto sem protótipo, sem `eval`, só JSON |
| Workspace | nomes `CON`, `NUL`, `AUX` geravam arquivo inválido no Windows | sufixo no slug |
| Workspace | um YAML corrompido impedia abrir o workspace | arquivo ignorado + aviso na UI |
| Workspace | dois arquivos com o mesmo id: um sumia | id novo para o repetido |
| Workspace | trocar json→xml em body grande deixava arquivo órfão | remove o irmão antigo |
| Workspace | duplicar coleção/ambiente perdia segredos | segredos copiados |
| Workspace | apagar 2 itens no mesmo ms perdia um na lixeira | pasta única por remoção |
| Workspace | histórico fora de ordem no mesmo ms | nome com timestamp + sequência |
| Bundle | zip slip com `..\` (Windows) | caminhos inseguros recusados no preview |
| XML | pretty quebrava CDATA e comentários | preservados |
| UI | fechar a janela com aba suja fechava sozinho após 1,5 s | só força se a tela não responder |

## Versão 1.1.0 (só as novidades)

| Suíte | Resultado | O que cobre |
|---|---|---|
| `e2e-melhorias.js` | 8/8 | Ctrl+Enter, Ctrl+F (3 casos), botão de layout, arrastar 3 requests, Shift+clique |
| `e2e-v110-bordas.js` | 13/13 | pasta+filho, soltar na própria pasta, mover e reordenar entre coleções, Delete em lote (confirma/cancela), Ctrl+Enter em scripts, Esc da busca, layout após recarregar, 1000 px sem estourar a janela, contraste da busca nos 3 temas, aria |
| `e2e-web.js` | 13/13 | 401/healthz, CSRF, guarda de caminhos, página, seletor de pasta, envio, download, upload, recarga |
| `web-api.js` | 11/11 | dois usuários isolados, travessia (`..`, `/etc`, symlink), download de outro usuário, upload (nome, lote, limite), SSE com e sem senha, rota/JSON inválidos, bloqueio por senha errada, `AUTH=none`, `auth.json` 0600 |
| `uxreview/ux-v110.js` | 12/12 | diálogos web: aria, foco, Tab, Esc, 390 px, 3 temas |

Bugs encontrados nesta rodada e corrigidos: bloqueio por IP contava requisições sem credencial; `HTTPS_PROXY` era aplicado a localhost (agora `NO_PROXY` e localhost direto); download sem nome ASCII no Content-Disposition; layout estourando a janela abaixo de ~1100 px; diálogos web sem `aria-modal`, foco solto e Tab vazando para o app; abas e botões sobrepostos no lado a lado.

Não testado aqui: a **imagem Docker** (o Docker Hub é bloqueado no ambiente de build). O estágio de execução foi simulado em diretório limpo (`npm ci --omit=dev` + servidor + `/healthz`). Rode `docker compose up -d --build` uma vez no seu servidor para confirmar.

Como rodar tudo: `bash qa/run-all.sh`

## Como rodar

```
cd packages/engine && npm test
cd qa && for f in 0*.js zz-*.js; do node $f; done
cd apps/desktop && xvfb-run -a node e2e/flow.js && xvfb-run -a node ../../qa/e2e-extra.js
```
