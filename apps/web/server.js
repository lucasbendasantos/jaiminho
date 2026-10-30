#!/usr/bin/env node
'use strict';
// Jaiminho Web: o mesmo app, servido a um navegador. O motor roda aqui no servidor (um processo "carteiro" por usuário),
// a interface é a mesma do desktop e conversa com ele por HTTP (/api/call) e SSE (/api/events).
// Tudo que o desktop faz com janelas do sistema (escolher pasta/arquivo, salvar) vira um seletor dentro da página.
//
// Variáveis de ambiente:
//   JAIMINHO_PORT (8080)   JAIMINHO_HOST (127.0.0.1; no Docker 0.0.0.0)   JAIMINHO_ROOT (~/.jaiminho-web; no Docker /data)
//   JAIMINHO_USER + JAIMINHO_PASSWORD   ou   JAIMINHO_USERS="ana:senha1,beto:senha2"   (sem isso, gera uma senha na 1ª subida)
//   JAIMINHO_AUTH=none  (só atrás de um proxy que já autentica)   JAIMINHO_TLS_CERT / JAIMINHO_TLS_KEY (HTTPS direto)
//   JAIMINHO_SECRET_KEY (base64 de 32 bytes; padrão: arquivo secrets.key em JAIMINHO_ROOT)   JAIMINHO_UI_DIR (padrão: ../desktop/renderer/dist)
//   JAIMINHO_IDLE_MIN (30)  minutos sem uso até desligar o motor de um usuário    JAIMINHO_MAX_UPLOAD_MB (300)
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const ROOT = (() => { const r = path.resolve(process.env.JAIMINHO_ROOT || path.join(os.homedir(), '.jaiminho-web')); fs.mkdirSync(r, { recursive: true }); return fs.realpathSync(r); })();
const PORT = Number(process.env.JAIMINHO_PORT || 8080);
const HOST = process.env.JAIMINHO_HOST || '127.0.0.1';
const UI_DIR = path.resolve(process.env.JAIMINHO_UI_DIR || path.join(__dirname, '..', 'desktop', 'renderer', 'dist'));
const IDLE_MS = Number(process.env.JAIMINHO_IDLE_MIN || 30) * 60 * 1000;
const MAX_UPLOAD = Number(process.env.JAIMINHO_MAX_UPLOAD_MB || 300) * 1024 * 1024;
const AUTH_NONE = String(process.env.JAIMINHO_AUTH || '').toLowerCase() === 'none';
const WORKSPACES_DIR = path.join(ROOT, 'workspaces');
fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
const VERSION = (() => { try { return require('../desktop/package.json').version; } catch { return 'web'; } })();

// ---------------------------------------------------------------- segredo (cifra os segredos dos ambientes)
function secretKey() {
  if (process.env.JAIMINHO_SECRET_KEY) { const k = Buffer.from(process.env.JAIMINHO_SECRET_KEY, 'base64'); if (k.length !== 32) throw new Error('JAIMINHO_SECRET_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32)'); return k; }
  const f = path.join(ROOT, 'secrets.key');
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64');
  const k = crypto.randomBytes(32); fs.writeFileSync(f, k.toString('base64'), { mode: 0o600 }); return k;
}
const KEY = secretKey();

// ---------------------------------------------------------------- usuários
const safeUser = (u) => String(u).toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 40) || 'user';
const USERS = new Map(); // nome → sha256(senha)
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function loadUsers() {
  if (AUTH_NONE) return;
  const add = (u, p) => { if (u && p) USERS.set(u, sha(p)); };
  if (process.env.JAIMINHO_USERS) for (const pair of process.env.JAIMINHO_USERS.split(',')) { const i = pair.indexOf(':'); if (i > 0) add(pair.slice(0, i).trim(), pair.slice(i + 1)); }
  if (process.env.JAIMINHO_USER && process.env.JAIMINHO_PASSWORD) add(process.env.JAIMINHO_USER, process.env.JAIMINHO_PASSWORD);
  if (USERS.size) return;
  const f = path.join(ROOT, 'auth.json');
  let a; try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { a = null; }
  if (!a) { a = { user: 'jaiminho', password: crypto.randomBytes(12).toString('base64url') }; fs.writeFileSync(f, JSON.stringify(a, null, 2), { mode: 0o600 }); console.log(`\n  Primeira subida: usuário "${a.user}" com senha gerada: ${a.password}\n  (guardada em ${f}; para definir a sua, use JAIMINHO_USER e JAIMINHO_PASSWORD)\n`); }
  add(a.user, a.password);
}
loadUsers();

const fails = new Map(); // ip → { n, until }
function authenticate(req) {
  if (AUTH_NONE) return 'local';
  const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  const ip = req.socket.remoteAddress;
  const f = fails.get(ip);
  if (f && f.until > Date.now() && f.n >= 10) return 'blocked';
  if (m) {
    const raw = Buffer.from(m[1], 'base64').toString('utf8'); const i = raw.indexOf(':');
    const u = raw.slice(0, i); const p = raw.slice(i + 1);
    const want = USERS.get(u);
    if (want && crypto.timingSafeEqual(want, sha(p))) { fails.delete(ip); return safeUser(u); }
  }
  if (m) fails.set(ip, { n: ((f && f.until > Date.now() ? f.n : 0)) + 1, until: Date.now() + 5 * 60 * 1000 }); // só conta senha errada (o navegador manda a 1ª requisição sem credenciais)
  return null;
}

// ---------------------------------------------------------------- caminhos permitidos
function realOf(p) {
  let cur = path.resolve(p); const rest = [];
  while (!fs.existsSync(cur)) { rest.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return path.join(fs.realpathSync(cur), ...rest);
}
function inside(p, base = ROOT) { const r = realOf(p); return r === base || r.startsWith(base + path.sep); }
function mustInside(p, base) { if (typeof p !== 'string' || !inside(p, base)) throw new Error('Caminho fora da área permitida do servidor (JAIMINHO_ROOT).'); return realOf(p); }
const PATH_KEYS = ['dir', 'file', 'dataFile'];
function guardArgs(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 4) return;
  for (const [k, x] of Object.entries(v)) { if (PATH_KEYS.includes(k) && typeof x === 'string') mustInside(x); else if (x && typeof x === 'object') guardArgs(x, depth + 1); }
}
const userDir = (u) => path.join(ROOT, 'users', u);

// ---------------------------------------------------------------- um motor ("carteiro") por usuário
// Proxy do servidor: respeita HTTP_PROXY/HTTPS_PROXY e NO_PROXY (localhost e 127.0.0.1 sempre direto)
function proxyFor(url) {
  let u; try { u = new URL(url); } catch { return 'DIRECT'; }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return 'DIRECT';
  const no = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (no.some((n) => n === '*' || host === n.replace(/^\./, '') || host.endsWith(n.startsWith('.') ? n : `.${n}`))) return 'DIRECT';
  const e = u.protocol === 'https:' ? (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) : (process.env.HTTP_PROXY || process.env.http_proxy);
  if (!e) return 'DIRECT';
  try { const p = new URL(e); return `PROXY ${p.hostname}:${p.port || 80}`; } catch { return 'DIRECT'; }
}
class Backend {
  constructor(user) { this.user = user; this.pending = new Map(); this.seq = 0; this.clients = new Set(); this.child = null; this.ready = null; this.last = Date.now(); }
  start() {
    const userData = userDir(this.user); fs.mkdirSync(path.join(userData, 'downloads'), { recursive: true });
    const child = fork(path.join(__dirname, 'carteiro-host.js'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: process.env });
    this.child = child;
    this.ready = new Promise((resolve) => {
      child.on('message', (msg) => {
        if (msg.type === 'ready') return resolve();
        if (msg.type === 'event') return this.broadcast(msg.event);
        if (msg.type === 'proxy-req') return child.send({ type: 'proxy-res', id: msg.id, result: proxyFor(msg.url) });
        const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
      });
    });
    child.on('exit', (code) => {
      for (const [, p] of this.pending) p.reject(new Error(`O motor parou (código ${code}); tente de novo (ele reinicia sozinho)`));
      this.pending.clear(); if (this.child === child) { this.child = null; this.ready = null; }
    });
    child.send({ type: 'init', key: KEY.toString('base64'), userData, resources: path.join(__dirname, '..', '..') });
  }
  async call(op, args) {
    this.last = Date.now();
    if (!this.child) this.start();
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.send({ type: 'call', id, op, args }); });
  }
  broadcast(event) { const d = `data: ${JSON.stringify(event)}\n\n`; for (const r of this.clients) r.write(d); }
  idle() { return !this.clients.size && !this.pending.size && Date.now() - this.last > IDLE_MS; }
  stop() { try { this.child && this.child.kill(); } catch { /* ignore */ } }
}
const backends = new Map();
const backendOf = (u) => { let b = backends.get(u); if (!b) { b = new Backend(u); backends.set(u, b); } return b; };
setInterval(() => { for (const b of backends.values()) if (b.child && b.idle()) { console.log(`[web] desligando o motor ocioso de ${b.user}`); b.stop(); } }, 60 * 1000).unref();
setInterval(() => { // limpa exportações com mais de 1 dia
  for (const u of fs.existsSync(path.join(ROOT, 'users')) ? fs.readdirSync(path.join(ROOT, 'users')) : []) {
    const d = path.join(ROOT, 'users', u, 'downloads'); if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) { try { const p = path.join(d, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.rmSync(p, { force: true }); } catch { /* ignore */ } }
  }
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.map': 'application/json' };
const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(b); };
function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Corpo grande demais')); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
}
const SHIM_TAG = '<script src="/__web/shim.js"></script>';
let indexHtml = null;
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname); if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/__web/shim.js') { res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(path.join(__dirname, 'client', 'shim.js'))); }
  const file = path.join(UI_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
  if (path.basename(file) === 'index.html') {
    indexHtml = indexHtml || fs.readFileSync(file, 'utf8').replace('<head>', `<head>${SHIM_TAG}`);
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' }); return res.end(indexHtml);
  }
  const hashed = /\/assets\//.test(rel);
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function listDir(p, withFiles) {
  const dir = mustInside(p || WORKSPACES_DIR);
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    if (d.isDirectory()) entries.push({ name: d.name, type: 'dir', workspace: fs.existsSync(path.join(dir, d.name, 'jaiminho.yaml')) });
    else if (withFiles && d.isFile()) entries.push({ name: d.name, type: 'file' });
    if (entries.length >= 3000) break;
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: dir, parent: dir === ROOT ? null : path.dirname(dir), root: ROOT, entries };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'); const pathname = url.pathname;
  if (pathname === '/healthz') return json(res, 200, { ok: true, version: VERSION });
  const user = authenticate(req);
  if (user === 'blocked') { res.writeHead(429, { 'retry-after': '300' }); return res.end('Muitas tentativas. Aguarde alguns minutos.'); }
  if (!user) { await new Promise((r) => setTimeout(r, 300)); res.writeHead(401, { 'www-authenticate': 'Basic realm="Jaiminho", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' }); return res.end('Autenticação necessária'); }
  const isApi = pathname.startsWith('/api/');
  if (isApi) {
    // CSRF: POST exige cabeçalho próprio (força preflight) e mesma origem; GET não pode vir de outro site
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (req.headers['x-jaiminho-web'] !== '1' || (origin && new URL(origin).host !== req.headers.host)) return json(res, 403, { ok: false, error: 'Requisição recusada (origem)' });
    } else if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { ok: false, error: 'Requisição recusada (origem)' });
  } else return serveStatic(req, res, pathname);

  const b = backendOf(user);
  try {
    if (pathname === '/api/call' && req.method === 'POST') {
      const { op, args } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (typeof op !== 'string') throw new Error('op inválida');
      guardArgs(args);
      try { return json(res, 200, { ok: true, result: await b.call(op, args || {}) }); } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': ok\n\n'); b.clients.add(res);
      const hb = setInterval(() => res.write(': hb\n\n'), 25000);
      req.on('close', () => { clearInterval(hb); b.clients.delete(res); b.last = Date.now(); });
      return;
    }
    if (pathname === '/api/info') return json(res, 200, { version: VERSION, user, root: ROOT, workspacesDir: WORKSPACES_DIR, downloadsDir: path.join(userDir(user), 'downloads'), userData: userDir(user), platform: 'web', node: process.versions.node, electron: 'navegador', secretsProtection: 'arquivo (servidor)', auth: !AUTH_NONE });
    if (pathname === '/api/fs' && req.method === 'GET') return json(res, 200, listDir(url.searchParams.get('path'), url.searchParams.get('files') === '1'));
    if (pathname === '/api/fs/mkdir' && req.method === 'POST') {
      const { path: p, name } = JSON.parse((await readBody(req)).toString('utf8'));
      const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim(); if (!n || n === '.' || n === '..') throw new Error('Nome inválido');
      const dir = path.join(mustInside(p), n); mustInside(dir); fs.mkdirSync(dir, { recursive: true }); return json(res, 200, { ok: true, path: dir });
    }
    if (pathname === '/api/upload' && req.method === 'POST') {
      const batch = url.searchParams.get('batch') || ''; const name = path.basename(String(url.searchParams.get('name') || '')).replace(/[\u0000-\u001f]/g, '');
      if (!/^[A-Za-z0-9-]{8,48}$/.test(batch) || !name || name.startsWith('.')) throw new Error('Envio inválido');
      const dir = path.join(userDir(user), 'uploads', batch); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name); fs.writeFileSync(file, await readBody(req, MAX_UPLOAD)); return json(res, 200, { ok: true, path: file });
    }
    if (pathname === '/api/download' && req.method === 'GET') {
      const file = mustInside(url.searchParams.get('path'), realOf(path.join(userDir(user), 'downloads')));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('não encontrado'); }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${path.basename(file).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'arquivo'}"; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`, 'content-length': fs.statSync(file).size });
      return fs.createReadStream(file).pipe(res);
    }
    return json(res, 404, { ok: false, error: 'rota desconhecida' });
  } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}

const tlsOpts = process.env.JAIMINHO_TLS_CERT && process.env.JAIMINHO_TLS_KEY ? { cert: fs.readFileSync(process.env.JAIMINHO_TLS_CERT), key: fs.readFileSync(process.env.JAIMINHO_TLS_KEY) } : null;
const server = (tlsOpts ? https.createServer(tlsOpts, (q, s) => handle(q, s).catch((e) => { try { s.writeHead(500); s.end(String(e.message)); } catch { /* ignore */ } }))
  : http.createServer((q, s) => handle(q, s).catch((e) => { try { s.writeHead(500); s.end(String(e.message)); } catch { /* ignore */ } })));
server.requestTimeout = 0; server.headersTimeout = 30000; // uploads grandes e SSE longo
if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) { console.error(`Interface não encontrada em ${UI_DIR}. Rode "npm run build:ui -w apps/desktop" antes.`); process.exit(1); }
server.listen(PORT, HOST, () => {
  console.log(`Jaiminho Web ${VERSION} em ${tlsOpts ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (dados em ${ROOT})`);
  if (AUTH_NONE) console.warn('ATENÇÃO: JAIMINHO_AUTH=none, sem senha. Use só atrás de um proxy que autentique.');
  else if (HOST !== '127.0.0.1' && !tlsOpts) console.warn('Dica: a senha trafega em Basic; ponha HTTPS na frente (proxy reverso) ou use JAIMINHO_TLS_CERT/JAIMINHO_TLS_KEY.');
});
const bye = () => { for (const b of backends.values()) b.stop(); server.close(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
module.exports = { server, ROOT };
