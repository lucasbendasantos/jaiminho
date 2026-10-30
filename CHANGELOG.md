# Changelog

## 1.1.0 · 2026-10-30

**Novo**
- Versão **web**: a mesma interface num navegador, com o motor no servidor (`apps/web`, `npm run web`). Login (HTTP Basic, vários usuários), seletor de pastas do servidor, envio de arquivos do computador, download das exportações. Ver `docs/web-docker.md`.
- Versão **Docker** (`Dockerfile`, `docker-compose.yml`, `.env.example`): volume `/data`, healthcheck, usuário sem root.
- **Multi-seleção** na árvore (Ctrl/Shift+clique): arrastar várias requests de uma vez para outra coleção/pasta e apagar em lote.
- **Layout lado a lado** entre request e resposta, com botão ao lado de Salvar (a escolha é lembrada).
- **Ctrl+F** funciona: busca no editor/resposta em foco, ou no filtro da árvore.

**Corrigido**
- Ctrl+Enter enviava a request, mas também quebrava a linha do JSON.
- Janelas estreitas (≤ ~1100 px): o conteúdo ficava mais largo que a janela e cortava o botão Enviar.
- Contraste dos botões do painel de busca nos três temas.
- Diálogos da versão web: foco preso, `aria-modal`, foco devolvido ao fechar.

**Segurança (web):** CSRF, limite de caminhos à raiz do servidor (inclui links simbólicos), bloqueio após 10 senhas erradas, arquivos de segredo com permissão 0600.

## 1.0.0 · 2026-10
- Primeira versão estável: HTTP/JSON, XML/SOAP e gRPC (TLS, mTLS, reflection, `.proto`), workspaces em YAML, ambientes e segredos, scripts `pm.*`, runner com CSV/JSON, importar/exportar Postman/OpenAPI/cURL, mocks locais, instalador e versão portátil para Windows.
- Importação do Swagger UI respeita `?urls.primaryName=` e informa os grupos disponíveis.
