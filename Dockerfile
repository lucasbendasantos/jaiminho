# syntax=docker/dockerfile:1
# Jaiminho Web: o mesmo app do desktop, servido a um navegador. Uso: docker compose up -d --build  (veja docs/web-docker.md)

# ---------- 1) compila a interface (React + Vite) ----------
FROM node:22-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_update_notifier=false
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/mocks/package.json packages/mocks/
RUN npm ci --no-audit --no-fund
COPY apps apps
COPY packages packages
RUN npm run build:ui

# ---------- 2) imagem final: só o motor, o servidor e a interface já compilada ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production JAIMINHO_HOST=0.0.0.0 JAIMINHO_PORT=8080 JAIMINHO_ROOT=/data npm_config_update_notifier=false
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/mocks/package.json packages/mocks/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY packages packages
COPY apps/web apps/web
COPY apps/desktop/main apps/desktop/main
COPY --from=build /app/apps/desktop/renderer/dist apps/desktop/renderer/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.JAIMINHO_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
