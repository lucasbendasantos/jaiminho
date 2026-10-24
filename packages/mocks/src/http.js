'use strict';
// Mock HTTP: REST/JSON, XML, SOAP 1.1/1.2 + WSDL, OpenAPI 3 e Swagger 2, auths, cookies, redirects, form, upload.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { URL } = require('url');
const { openapi3, swagger2 } = require('./specs');
const soap = require('./soap');

const USERS = { basic: ['jaiminho', 'carteiro'], digest: ['jaiminho', 'carteiro'] };
const TOKEN = 'jaiminho-token';
const API_KEY = 'chave-123';

function seed() {
  return new Map([
    ['1', { id: '1', firstName: 'Jaime', lastName: 'Palillo', nationality: 'MX', email: 'jaime@correio.mx', documents: [{ type: 'PASSPORT', number: 'P123' }] }],
    ['2', { id: '2', firstName: 'Ana', lastName: 'Silva', nationality: 'PT', email: 'ana@exemplo.pt', documents: [] }],
    ['3', { id: '3', firstName: 'Lucas', lastName: 'Santos', nationality: 'BR', email: 'lucas@exemplo.br', documents: [] }],
  ]);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const isStr = typeof body === 'string';
  const payload = isBuf || isStr ? body : JSON.stringify(body, null, 2);
  const ct = headers['content-type'] || (isBuf || isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  res.writeHead(status, { 'content-type': ct, 'x-mock': 'jaiminho', ...headers });
  res.end(payload);
}

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return [];
  const boundary = '--' + (m[1] || m[2]);
  const parts = buf.toString('latin1').split(boundary).slice(1, -1);
  return parts.map((p) => {
    const [rawHead, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    const body = rest.join('\r\n\r\n').replace(/\r\n$/, '');
    const name = /name="([^"]*)"/i.exec(rawHead)?.[1];
    const filename = /filename="([^"]*)"/i.exec(rawHead)?.[1];
    const ctype = /content-type:\s*([^\r\n]+)/i.exec(rawHead)?.[1];
    return filename !== undefined
      ? { name, filename, contentType: ctype, size: Buffer.byteLength(body, 'latin1'), ...(Buffer.byteLength(body, 'latin1') <= 2048 && /text|json|xml/i.test(ctype || '') ? { content: Buffer.from(body, 'latin1').toString('utf8') } : {}) }
      : { name, value: Buffer.from(body, 'latin1').toString('utf8') };
  });
}

function digestCheck(req, method) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Digest ')) return false;
  const p = {};
  h.slice(7).replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, v1, v2) => { p[k] = v1 !== undefined ? v1 : v2; });
  const [u, pw] = USERS.digest;
  if (p.username !== u) return false;
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${u}:${p.realm}:${pw}`);
  const ha2 = md5(`${method}:${p.uri}`);
  const expected = p.qop ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  return expected === p.response;
}

function createHandler(opts = {}) {
  const db = seed();
  let seq = 100;
  return async function handler(req, res) {
    const base = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const url = new URL(req.url, base);
    const p = url.pathname;
    const method = req.method.toUpperCase();
    const raw = await readBody(req);
    const ct = req.headers['content-type'] || '';
    let json; if (/json/i.test(ct) && raw.length) { try { json = JSON.parse(raw.toString('utf8')); } catch { json = undefined; } }
    const peer = req.socket.getPeerCertificate ? req.socket.getPeerCertificate() : null;

    try {
      // ---------- utilidades ----------
      if (p === '/' || p === '/api/health') return send(res, 200, { status: 'UP', mock: 'jaiminho', tls: !!req.socket.encrypted, clientCert: peer && peer.subject ? peer.subject.CN : null });

      if (p === '/echo' || p.startsWith('/echo/')) {
        let form;
        if (/x-www-form-urlencoded/i.test(ct)) form = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
        if (/multipart\/form-data/i.test(ct)) form = parseMultipart(raw, ct);
        return send(res, 200, {
          method, path: p, query: Object.fromEntries(url.searchParams), headers: req.headers,
          cookies: parseCookies(req.headers.cookie), body: raw.toString('utf8'), json, form,
          tls: !!req.socket.encrypted, clientCert: peer && peer.subject ? peer.subject.CN : null,
        });
      }
      let m;
      if ((m = /^\/status\/(\d{3})$/.exec(p))) return send(res, Number(m[1]), { status: Number(m[1]) });
      if ((m = /^\/delay\/(\d+)$/.exec(p))) { await new Promise((r) => setTimeout(r, Math.min(Number(m[1]), 30000))); return send(res, 200, { delayedMs: Number(m[1]) }); }
      if ((m = /^\/redirect\/(\d+)$/.exec(p))) {
        const n = Number(m[1]);
        res.writeHead(302, { location: n > 1 ? `/redirect/${n - 1}` : '/echo?redirected=true' }); return res.end();
      }
      if (p === '/cookies/set') {
        const cookies = [...url.searchParams].map(([k, v]) => `${k}=${encodeURIComponent(v)}; Path=/`);
        res.writeHead(200, { 'set-cookie': cookies, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ set: Object.fromEntries(url.searchParams) }));
      }
      if (p === '/cookies') return send(res, 200, { cookies: parseCookies(req.headers.cookie) });
      if (p === '/headers') return send(res, 200, { headers: req.headers });
      if (p === '/gzip') {
        const zlib = require('zlib');
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(zlib.gzipSync(JSON.stringify({ gzipped: true })));
      }
      if (p === '/big') { // JSON grande para testar performance: /big?mb=20
        const mb = Math.min(200, Number(url.searchParams.get('mb') || 1)); const target = mb * 1024 * 1024; const parts = []; let size = 0; let i = 0;
        while (size < target) { const o = JSON.stringify({ id: i, nome: `Viajante ${i}`, email: `v${i}@correio.mx`, pais: 'MX', texto: 'lorem ipsum dolor sit amet '.repeat(6), valores: [i, i * 2, i * 3] }); parts.push(o); size += o.length + 1; i++; }
        const body = `{"total":${i},"items":[${parts.join(',')}]}`;
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(body);
      }
      if (p === '/bytes') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(crypto.randomBytes(256)); }
      if (p === '/html') return send(res, 200, '<!doctype html><html><body><h1>Jaiminho</h1></body></html>', { 'content-type': 'text/html; charset=utf-8' });

      // ---------- auth ----------
      if (p === '/auth/basic') {
        const h = req.headers.authorization || '';
        const ok = h === 'Basic ' + Buffer.from(USERS.basic.join(':')).toString('base64');
        return ok ? send(res, 200, { authenticated: true, user: USERS.basic[0] }) : send(res, 401, { authenticated: false }, { 'www-authenticate': 'Basic realm="jaiminho"' });
      }
      if (p === '/auth/bearer') {
        return req.headers.authorization === `Bearer ${TOKEN}` ? send(res, 200, { authenticated: true }) : send(res, 401, { authenticated: false });
      }
      if (p === '/auth/apikey') {
        const k = req.headers['x-api-key'] || url.searchParams.get('api_key');
        return k === API_KEY ? send(res, 200, { authenticated: true }) : send(res, 401, { authenticated: false });
      }
      if (p === '/auth/digest') {
        if (digestCheck(req, method)) return send(res, 200, { authenticated: true, scheme: 'digest' });
        const nonce = crypto.randomBytes(8).toString('hex');
        return send(res, 401, { authenticated: false }, { 'www-authenticate': `Digest realm="jaiminho", qop="auth", nonce="${nonce}", opaque="abc", algorithm="MD5"` });
      }
      if (p === '/oauth/token' && method === 'POST') {
        const form = /json/i.test(ct) ? (json || {}) : Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
        const basic = (req.headers.authorization || '').startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':') : [];
        const clientId = form.client_id || basic[0];
        const clientSecret = form.client_secret || basic[1];
        if (clientId !== 'jaiminho-app' || clientSecret !== 'segredo') return send(res, 401, { error: 'invalid_client' });
        if (form.grant_type === 'client_credentials' || (form.grant_type === 'password' && form.username === 'jaiminho' && form.password === 'carteiro')) {
          return send(res, 200, { access_token: TOKEN, token_type: 'Bearer', expires_in: 3600, scope: form.scope || 'api' });
        }
        return send(res, 400, { error: 'unsupported_grant_type' });
      }

      // ---------- REST /api/travellers ----------
      if (p === '/api/travellers' || p.startsWith('/api/travellers/')) {
        if (opts.requireAuth && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
        const id = p.split('/')[3];
        if (!id && method === 'GET') {
          let list = [...db.values()];
          const nat = url.searchParams.get('nationality'); if (nat) list = list.filter((t) => t.nationality === nat);
          const limit = Number(url.searchParams.get('limit') || 0); if (limit) list = list.slice(0, limit);
          return send(res, 200, list, { 'x-total-count': String(list.length) });
        }
        if (!id && method === 'POST') {
          if (!json || !json.firstName) return send(res, 400, { error: 'firstName é obrigatório' });
          const t = { id: String(++seq), documents: [], ...json, id: String(seq) };
          db.set(t.id, t);
          return send(res, 201, t, { location: `/api/travellers/${t.id}` });
        }
        const t = db.get(id);
        if (method === 'GET') return t ? send(res, 200, t) : send(res, 404, { error: 'não encontrado', id });
        if (method === 'PUT') { if (!json) return send(res, 400, { error: 'JSON inválido' }); const n = { ...json, id }; db.set(id, n); return send(res, 200, n); }
        if (method === 'PATCH') { if (!t) return send(res, 404, { error: 'não encontrado' }); Object.assign(t, json || {}); return send(res, 200, t); }
        if (method === 'DELETE') { if (!t) return send(res, 404, { error: 'não encontrado' }); db.delete(id); res.writeHead(204); return res.end(); }
        return send(res, 405, { error: 'método não suportado' });
      }

      // ---------- XML simples ----------
      if (p === '/xml/traveller') {
        const id = url.searchParams.get('id') || '1'; const t = db.get(id) || db.get('1');
        return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<traveller id="${t.id}"><firstName>${t.firstName}</firstName><lastName>${t.lastName}</lastName><nationality>${t.nationality}</nationality></traveller>`, { 'content-type': 'application/xml; charset=utf-8' });
      }
      if (p === '/xml/echo') return send(res, 200, raw.toString('utf8') || '<empty/>', { 'content-type': ct || 'application/xml' });

      // ---------- SOAP ----------
      if (p === '/soap/TravellerService') {
        if (method === 'GET' && (url.search.toLowerCase().includes('wsdl'))) return send(res, 200, soap.wsdl(base), { 'content-type': 'text/xml; charset=utf-8' });
        if (method === 'GET' && url.searchParams.has('xsd')) return send(res, 200, soap.xsd(), { 'content-type': 'text/xml; charset=utf-8' });
        if (method === 'POST') { const r = soap.handle(raw.toString('utf8'), req.headers, db); return send(res, r.status, r.body, { 'content-type': r.contentType }); }
      }

      // ---------- OpenAPI ----------
      if (p === '/v3/api-docs' || p === '/v3/api-docs.json') return send(res, 200, openapi3(base));
      if (p === '/v3/api-docs.yaml') return send(res, 200, require('yaml').stringify(openapi3(base)), { 'content-type': 'application/yaml' });
      if (p === '/v3/api-docs/swagger-config') return send(res, 200, { configUrl: '/v3/api-docs/swagger-config', url: '/v3/api-docs', urls: [{ name: 'travellers', url: '/v3/api-docs' }], validatorUrl: '' });
      if (p === '/v2/swagger.json') return send(res, 200, swagger2(req.headers.host));
      if (p === '/swagger-ui/index.html' || p === '/swagger-ui.html') return send(res, 200, '<!doctype html><html><head><title>Swagger UI</title></head><body><div id="swagger-ui"></div><script src="./swagger-initializer.js"></script></body></html>', { 'content-type': 'text/html' });

      return send(res, 404, { error: 'rota não existe no mock', path: p });
    } catch (e) {
      return send(res, 500, { error: String(e && e.stack || e) });
    }
  };
}

function listen(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); });
}

async function startHttp({ port = 0, certs, httpsPort = 0, mtlsPort = 0 } = {}) {
  const h = createHandler();
  const servers = [];
  const plain = http.createServer(h); servers.push(plain);
  const out = { http: await listen(plain, port) };
  if (certs) {
    const tlsOpts = { key: fs.readFileSync(certs.serverKey), cert: fs.readFileSync(certs.serverCert) };
    const s1 = https.createServer(tlsOpts, h); servers.push(s1);
    out.https = await listen(s1, httpsPort);
    const s2 = https.createServer({ ...tlsOpts, ca: fs.readFileSync(certs.ca), requestCert: true, rejectUnauthorized: true }, h); servers.push(s2);
    out.mtls = await listen(s2, mtlsPort);
  }
  out.close = () => Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); })));
  return out;
}

module.exports = { startHttp, createHandler, TOKEN, API_KEY, USERS };
