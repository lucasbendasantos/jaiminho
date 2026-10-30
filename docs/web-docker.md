# Jaiminho Web e Docker

A mesma interface do app desktop, servida a um **navegador**. O motor (envio de requests, gRPC, scripts, import/export) roda no **servidor**; quem usa só precisa de um browser. Serve para:

- quem **não consegue instalar** programas na máquina (basta abrir uma URL);
- colocar o Jaiminho num **servidor Linux** da equipe, com um workspace compartilhado;
- rodar em container (Docker/Compose).

> As requests saem **do servidor**, não do computador de quem usa o navegador. Para alcançar um serviço interno ou atrás de VPN, o servidor (ou o container) precisa ter rota até ele.

## Subir com Docker Compose

```bash
cp .env.example .env            # edite JAIMINHO_PASSWORD (e, se quiser, JAIMINHO_USERS)
docker compose up -d --build
# abra http://localhost:8080  (usuário e senha do .env)
```

Só com Docker, sem Compose:

```bash
docker build -t jaiminho-web .
docker run -d --name jaiminho --init --restart unless-stopped -p 127.0.0.1:8080:8080 -v jaiminho-data:/data -e JAIMINHO_USER=ana -e JAIMINHO_PASSWORD='troque-esta-senha' jaiminho-web
```

Sem Docker (Node 20+ e o repositório clonado):

```bash
npm ci && npm run build:ui && JAIMINHO_USER=ana JAIMINHO_PASSWORD='troque-esta-senha' npm run web      # http://127.0.0.1:8080
```

## Configuração (variáveis de ambiente)

| Variável | Padrão | O que faz |
|---|---|---|
| `JAIMINHO_USER` + `JAIMINHO_PASSWORD` | — | Usuário e senha (HTTP Basic). Sem nenhuma definição, o servidor gera uma senha na 1ª subida e a mostra no log (guardada em `/data/auth.json`). |
| `JAIMINHO_USERS` | — | Vários usuários: `ana:senha1,beto:senha2`. Cada um tem o **seu motor**, workspace aberto, configurações e uploads (não compartilham o estado da tela). |
| `JAIMINHO_PORT` / `JAIMINHO_HOST` | `8080` / `127.0.0.1` (no Docker `0.0.0.0`) | Onde escuta. |
| `JAIMINHO_ROOT` | `~/.jaiminho-web` (no Docker `/data`) | Tudo o que é gravado: `workspaces/`, `users/<nome>/`, `secrets.key`. É o volume a **guardar em backup**. |
| `JAIMINHO_SECRET_KEY` | arquivo `secrets.key` | Chave (base64 de 32 bytes: `openssl rand -base64 32`) que cifra os segredos dos ambientes. Quem perde a chave perde os valores dos segredos. |
| `JAIMINHO_TLS_CERT` / `JAIMINHO_TLS_KEY` | — | Serve HTTPS direto (ou ponha um proxy reverso na frente). |
| `JAIMINHO_AUTH=none` | — | Desliga a senha. **Só** atrás de um proxy que já autentica (SSO). |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | — | Proxy do servidor para as requests (localhost e 127.0.0.1 vão sempre direto). |
| `JAIMINHO_IDLE_MIN` | `30` | Minutos sem uso até desligar o motor de um usuário (volta sozinho no próximo acesso). |
| `JAIMINHO_MAX_UPLOAD_MB` | `300` | Limite de cada arquivo enviado pelo navegador. |

## Como fica no navegador

| No desktop | No navegador |
|---|---|
| Janela "Abrir pasta" | Seletor de pastas **do servidor**, dentro da página, com botão **Nova pasta…** (limitado a `JAIMINHO_ROOT`). |
| Janela "Abrir arquivo" (Postman, Swagger, `.proto`, certificados, CSV) | Seletor com **Enviar do meu computador…**: o arquivo vai para o servidor (`users/<nome>/uploads/`) e passa a ser usado de lá. Vários `.proto` de uma vez ficam na mesma pasta, então os `import` se resolvem. |
| "Salvar como" (exportar Postman, `.jaiminho`, JUnit) | O servidor gera o arquivo e o **navegador baixa**. |
| Segredos cifrados com o cofre do Windows | Cifrados com a chave do servidor (`secrets.key`). |
| Ctrl+N, Ctrl+W | O navegador reserva essas teclas. Use os botões e o menu `+` das abas. |
| Área de transferência | Precisa de HTTPS (ou `localhost`) para colar automaticamente; senão o app abre uma caixa para você colar. |

Ao recarregar a página, o workspace aberto continua aberto (o estado fica no servidor). Se houver abas com alterações não salvas, o navegador avisa antes de fechar.

## Segurança: leia antes de expor

O Jaiminho é, por natureza, uma máquina de **fazer requests e rodar scripts a partir do servidor**. Quem tem acesso pode tentar alcançar qualquer coisa que o servidor alcança. Por isso:

- **Sempre com senha** (o padrão). Não deixe `JAIMINHO_AUTH=none` fora de um proxy autenticado.
- **Use HTTPS** quando não for só `localhost`: a senha vai em HTTP Basic. O compose publica em `127.0.0.1` por padrão; para a rede use um proxy reverso com TLS (veja abaixo) ou `JAIMINHO_PUBLISH=0.0.0.0:8080` só em rede confiável.
- O servidor limita arquivos e pastas à área `JAIMINHO_ROOT`, recusa POSTs de outros sites (proteção CSRF) e bloqueia o IP após 10 senhas erradas em 5 minutos. Quem se autentica é considerado **confiável**: os scripts `pm.*` rodam em sandbox, mas as requests são feitas com a rede do servidor.
- Rode como usuário comum (a imagem já usa `node`, sem root) e, se possível, em uma rede separada.

## Proxy reverso com HTTPS

O app usa SSE (`/api/events`); o proxy não pode guardar a resposta em buffer.

**Caddy** (HTTPS automático):

```
jaiminho.suaempresa.com {
    reverse_proxy 127.0.0.1:8080 { flush_interval -1 }
}
```

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
    client_max_body_size 300m;
}
```

## Backup, atualização e diagnóstico

- **Backup:** o volume `/data` (`docker run --rm -v jaiminho-data:/data -v "$PWD":/b alpine tar czf /b/jaiminho-data.tgz -C /data .`). Os workspaces são pastas de arquivos YAML; dá para versioná-los no git.
- **Atualizar:** `git pull && docker compose up -d --build` (o volume é mantido).
- **Saúde:** `GET /healthz` (sem senha) devolve `{"ok":true}`; o `HEALTHCHECK` da imagem usa isso. Logs: `docker compose logs -f`.
- **Servidores mock** (REST, SOAP, gRPC, HTTPS/mTLS) sobem **dentro do container**, com portas fixas (4010, 4443, 4444, 50051–50053). Servem para o workspace de exemplo; dois usuários não conseguem ligá-los ao mesmo tempo.
- **Alcançar a rede do host/VPN:** descomente `network_mode: host` no compose (Linux) ou rode sem Docker.

## Testes

```bash
npm run build:ui && cd apps/desktop && node ../../qa/e2e-web.js     # Chromium + servidor: login, CSRF, seletor, envio, download, upload, recarga
```
