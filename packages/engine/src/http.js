'use strict';
// Executor HTTP/SOAP sobre o motor open source do Postman (postman-runtime + postman-collection).
const fs = require('fs');
const path = require('path');
const sdk = require('postman-collection');
const runtime = require('postman-runtime');
const { CookieJar } = require('@postman/tough-cookie');
const { requestToPostmanItem, authToPostman, scriptsToEvents } = require('./model');
const { buildScopes } = require('./vars');
const { buildCaBundle, certPassphrase, hostMatches } = require('./tls');
const { UNSET } = require('./store');
const pool = require('./sandbox-pool');
const { makeResolver } = require('./vars');

const USER_AGENT = 'Jaiminho/0.1 (+carteiro)';

// ---------- cookies por workspace (persistidos em .jaiminho/cookies.json) ----------
const jars = new Map();
function cookieJarFor(ws) {
  if (jars.has(ws.dir)) return jars.get(ws.dir);
  const file = path.join(ws.dir, '.jaiminho', 'cookies.json');
  let jar;
  try { jar = fs.existsSync(file) ? CookieJar.deserializeSync(JSON.parse(fs.readFileSync(file, 'utf8'))) : new CookieJar(); } catch { jar = new CookieJar(); }
  jar.__file = file;
  jars.set(ws.dir, jar);
  return jar;
}
function persistJar(jar) {
  try { fs.mkdirSync(path.dirname(jar.__file), { recursive: true }); fs.writeFileSync(jar.__file, JSON.stringify(jar.serializeSync())); } catch { /* ignore */ }
}
function listCookies(ws) {
  const jar = cookieJarFor(ws);
  return (jar.serializeSync().cookies || []).map((c) => ({ domain: c.domain, path: c.path, name: c.key, value: c.value, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure }));
}
function clearCookies(ws, domain) {
  const jar = cookieJarFor(ws);
  if (!domain) jar.removeAllCookiesSync(); else {
    for (const c of jar.serializeSync().cookies || []) if (c.domain === domain || c.domain === domain.replace(/^\./, '')) jar.store.removeCookie(c.domain, c.path, c.key, () => {});
  }
  persistJar(jar);
}

// ---------- coleção mínima com a cadeia coleção → pastas → request ----------
function buildCollection(chain, reqData) {
  const [col, ...rest] = chain;
  const folders = rest.slice(0, -1);
  const reqItem = requestToPostmanItem(reqData);
  let items = [reqItem];
  for (let i = folders.length - 1; i >= 0; i--) {
    const f = folders[i];
    items = [{ id: f.id, name: f.name, item: items, auth: authToPostman(f.auth), event: scriptsToEvents(f.scripts) }];
  }
  return {
    info: { _postman_id: col.id, name: col.name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: authToPostman(col.auth), event: scriptsToEvents(col.scripts), item: items,
  };
}

function toScope(list, name) {
  return new sdk.VariableScope({ name, values: (list || []).map((v) => ({ key: v.key, value: String(v.value ?? ''), type: 'any' })) });
}

function proxyOptions(ws) {
  const p = (ws.settings && ws.settings.proxy) || { mode: 'system' };
  if (p.mode === 'none') return { ignoreProxyEnvironmentVariables: true };
  if (p.mode === 'manual' && p.host) {
    return {
      ignoreProxyEnvironmentVariables: true,
      proxies: new sdk.ProxyConfigList({}, [{
        match: 'http+https://*/*', host: p.host, port: Number(p.port) || 8080, tunnel: p.tunnel !== false,
        bypass: (p.bypass || '').split(',').map((s) => s.trim()).filter(Boolean).map((h) => (h.includes('://') ? h : `http+https://${h}/*`)),
        authenticate: !!p.username, username: p.username, password: ws.getSecret('proxy:password') || p.password,
      }]),
    };
  }
  return {};
}

function checkCertFiles(ws, url) {
  let host; let port;
  try { const u = new URL(url); host = u.hostname; port = u.port || (u.protocol === 'https:' ? 443 : 80); } catch { return null; }
  for (const c of (ws.settings && ws.settings.certificates) || []) {
    if (c.enabled === false || !hostMatches(c.host, host, port)) continue;
    for (const k of ['cert', 'key', 'pfx']) if (c[k] && !fs.existsSync(ws.resolvePath(c[k]))) return `Arquivo do certificado de cliente não encontrado (${k}): ${c[k]}. Verifique em Configurações → Certificados.`;
  }
  return null;
}

function certificateList(ws) {
  const list = (ws.settings && ws.settings.certificates) || [];
  const items = list.filter((c) => c.enabled !== false && c.host).map((c, i) => {
    const hostPort = String(c.host).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const e = { name: c.name || hostPort, matches: [hostPort.includes(':') ? `https://${hostPort}/*` : `https://${hostPort}:*/*`] };
    if (c.pfx) e.pfx = { src: ws.resolvePath(c.pfx) };
    if (c.cert) e.cert = { src: ws.resolvePath(c.cert) };
    if (c.key) e.key = { src: ws.resolvePath(c.key) };
    const pass = certPassphrase(ws, c);
    if (pass) e.passphrase = pass;
    return e;
  });
  return new sdk.CertificateList({}, items);
}

const tokenCache = new Map();
/** OAuth 2.0 client credentials / password: busca o token sozinho (como o "Get New Access Token" do Postman). */
async function ensureOAuth2Token(ws, auth, resolve) {
  if (!auth || auth.type !== 'oauth2') return auth;
  const p = auth.oauth2 || {};
  const r = (v) => (typeof v === 'string' ? resolve(v) : v);
  const grant = r(p.grant_type || p.grantType || '');
  const tokenUrl = r(p.accessTokenUrl || '');
  if (r(p.accessToken) || !tokenUrl || !['client_credentials', 'password'].includes(grant)) return auth;
  const key = JSON.stringify([tokenUrl, grant, r(p.clientId), r(p.username), r(p.scope)]);
  const cached = tokenCache.get(key);
  if (cached && cached.exp > Date.now()) return { type: 'oauth2', oauth2: { ...p, accessToken: cached.token, addTokenTo: p.addTokenTo || 'header', headerPrefix: p.headerPrefix || 'Bearer' } };
  const form = [{ key: 'grant_type', value: grant }];
  if (r(p.scope)) form.push({ key: 'scope', value: r(p.scope) });
  if (grant === 'password') form.push({ key: 'username', value: r(p.username) || '' }, { key: 'password', value: r(p.password) || '' });
  const basicHeader = (p.client_authentication || p.clientAuth) === 'header';
  if (!basicHeader) form.push({ key: 'client_id', value: r(p.clientId) || '' }, { key: 'client_secret', value: r(p.clientSecret) || '' });
  const tokReq = { kind: 'http', name: 'oauth2-token', method: 'POST', url: tokenUrl, body: { mode: 'urlencoded', urlencoded: form }, auth: basicHeader ? { type: 'basic', basic: { username: r(p.clientId), password: r(p.clientSecret) } } : { type: 'none' }, headers: [{ key: 'Accept', value: 'application/json' }] };
  const res = await sendHttp(ws, { request: tokReq });
  let token;
  try { const j = JSON.parse(res.response.body); token = j.access_token; if (token) tokenCache.set(key, { token, exp: Date.now() + Math.max(30, (Number(j.expires_in) || 300) - 30) * 1000 }); } catch { /* ignore */ }
  if (!token) throw new Error(`OAuth 2.0: não consegui obter o token em ${tokenUrl} (${res.response ? `HTTP ${res.response.code}: ${String(res.response.body).slice(0, 200)}` : res.error})`);
  return { type: 'oauth2', oauth2: { ...p, accessToken: token, addTokenTo: p.addTokenTo || 'header', headerPrefix: p.headerPrefix || 'Bearer' } };
}

function isTextual(contentType = '') {
  return /json|xml|text|javascript|html|csv|yaml|x-www-form-urlencoded|graphql/i.test(contentType) || contentType === '';
}

function headersOf(h) { return h ? h.all().map((x) => ({ key: x.key, value: x.value })) : []; }

/**
 * Envia uma request HTTP/SOAP.
 * @param ws Workspace
 * @param opts { requestId?, request? (dados não salvos), parentId?, environmentId?, data?, onEvent?, systemProxy?, iterationData? }
 */
/** Prepara a auth OAuth 2.0 (busca token se preciso) antes do envio. */
function jsonErr(m) { return /^Unexpected token .* at \d+:\d+/.test(m) ? `JSONError: resposta não é JSON válido — ${m}` : m; }

async function sendHttp(ws, opts = {}) {
  try {
    const reqId = opts.requestId;
    const chain = reqId && ws.index.has(reqId) ? ws.chain(reqId) : (opts.parentId && ws.index.has(opts.parentId) ? ws.chain(opts.parentId) : []);
    const reqData = opts.request || (reqId && ws.index.has(reqId) ? ws.get(reqId) : null);
    if (reqData) {
      let eff = reqData.auth && reqData.auth.type !== 'inherit' ? reqData.auth : null;
      if (!eff) { const anc = (reqId ? chain.slice(0, -1) : chain).reverse().find((n) => n.auth && n.auth.type && n.auth.type !== 'inherit'); eff = anc && anc.auth; }
      if (eff && eff.type === 'oauth2' && !(eff.oauth2 || {}).accessToken && (eff.oauth2 || {}).accessTokenUrl) {
        const scopes = buildScopes(ws, reqId && ws.index.has(reqId) ? reqId : opts.parentId, { environmentId: opts.environmentId });
        const auth = await ensureOAuth2Token(ws, eff, makeResolver(scopes));
        opts = { ...opts, request: { ...reqData, auth } };
      }
    }
  } catch (e) { return { ok: false, error: e.message, tests: [], console: [], errors: [] }; }
  return sendHttpCore(ws, opts);
}

function sendHttpCore(ws, opts = {}) {
  return new Promise((resolveRaw) => {
    let hostSel = null;
    const resolve = (v) => { if (hostSel) hostSel.release(!!(v && v.aborted)); resolveRaw(v); };
    const started = Date.now();
    const reqId = opts.requestId;
    let chain = reqId && ws.index.has(reqId) ? ws.chain(reqId) : [];
    let reqData = opts.request || (chain.length ? chain[chain.length - 1] : null);
    if (!reqData) return resolve({ ok: false, error: 'Request não informada' });
    if (opts.request && reqId && chain.length) chain = [...chain.slice(0, -1), opts.request];
    if (!chain.length) {
      const parentChain = opts.parentId && ws.index.has(opts.parentId) ? ws.chain(opts.parentId) : [];
      chain = parentChain.length ? [...parentChain, reqData] : [{ id: 'scratch', name: 'Rascunho' }, reqData];
    }
    const scopeItemId = reqId && ws.index.has(reqId) ? reqId : (opts.parentId && ws.index.has(opts.parentId) ? opts.parentId : undefined);
    const scopes = buildScopes(ws, scopeItemId, { environmentId: opts.environmentId });
    // vars de pasta/request entram como variáveis locais da execução (acima do ambiente; não poluem pm.iterationData)
    const localVars = {}; const dataKeys = new Set(Object.keys(opts.data || {}));
    for (const node of chain.slice(1)) for (const v of node.vars || []) if (v.enabled !== false && v.key && !dataKeys.has(v.key)) localVars[v.key] = v.value ?? '';
    const data = { ...(opts.data || {}) };

    const envSub = (o) => (typeof o === 'string' ? o.replace(/\{\{\$env\.([A-Za-z0-9_]+)\}\}/g, (mm, k) => (process.env[k] !== undefined ? process.env[k] : mm)) : Array.isArray(o) ? o.map(envSub) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, envSub(v)])) : o);
    chain = chain.map(envSub); reqData = chain[chain.length - 1];
    // caminhos relativos ao workspace (arquivos partilhados em data/) e User-Agent padrão que o usuário pode trocar
    reqData = { ...reqData, headers: [...(reqData.headers || [])] };
    if (reqData.body && reqData.body.mode === 'file' && reqData.body.file) reqData.body = { ...reqData.body, file: ws.resolvePath(reqData.body.file) };
    if (reqData.body && reqData.body.mode === 'formdata') reqData.body = { ...reqData.body, formdata: (reqData.body.formdata || []).map((f) => (f.type === 'file' && f.src ? { ...f, src: ws.resolvePath(f.src) } : f)) };
    if (!reqData.headers.some((h) => h.enabled !== false && /^user-agent$/i.test(h.key || ''))) reqData.headers.push({ key: 'User-Agent', value: USER_AGENT });
    chain = [...chain.slice(0, -1), reqData];
    const colJson = buildCollection(chain, reqData);
    const collection = new sdk.Collection(colJson);
    const colVarsBefore = Object.fromEntries(scopes.collection.map((v) => [v.key, String(v.value)]));
    scopes.collection.forEach((v) => collection.variables.add(new sdk.Variable({ key: v.key, value: String(v.value ?? ''), type: 'any' })));
    const environment = toScope(scopes.environment, scopes.environmentName || 'env');
    const globals = toScope(scopes.globals, 'globals');
    const envBefore = Object.fromEntries(scopes.environment.map((v) => [v.key, String(v.value)]));
    const gloBefore = Object.fromEntries(scopes.globals.map((v) => [v.key, String(v.value)]));

    const s = ws.settings || {};
    const req = reqData.settings || {};
    const jar = cookieJarFor(ws);
    const warnings = [];
    const extendedRootCA = buildCaBundle(ws, warnings);
    const certErr = checkCertFiles(ws, String(reqData.url || '').replace(/\{\{[^}]+\}\}/g, 'x'));
    if (certErr) return resolve({ ok: false, error: certErr, tests: [], console: [], errors: [], time: 0 });
    const result = { ok: true, tests: [], console: [], errors: [], warnings };
    let lastScopes = null;
    const grab = (results) => { for (const r of results || []) if (r && r.result) lastScopes = { environment: r.result.environment, globals: r.result.globals, collectionVariables: r.result.collectionVariables }; };
    const emit = (type, payload) => { try { opts.onEvent && opts.onEvent({ type, ...payload }); } catch { /* ignore */ } };

    const runner = new runtime.Runner();
    pool.acquire(collection).then((sel) => { hostSel = sel; return runner.run(collection, {
      host: sel.option,
      data: [data],
      environment, globals,
      localVariables: new sdk.VariableScope({ values: Object.entries(localVars).map(([key, value]) => ({ key, value: String(value), type: 'any' })) }),
      timeout: { request: req.timeoutMs || s.timeoutMs || 30000, script: 10000 },
      fileResolver: fs,
      requester: {
        cookieJar: jar,
        disableCookies: !!req.disableCookies,
        strictSSL: req.verifySsl !== undefined ? req.verifySsl !== false : s.verifySsl !== false,
        followRedirects: req.followRedirects !== undefined ? req.followRedirects !== false : s.followRedirects !== false,
        maxRedirects: req.maxRedirects || s.maxRedirects || 10,
        maxResponseSize: 200 * 1024 * 1024,
        timings: true, verbose: false,
        implicitCacheControl: true, implicitTraceHeader: false,
        extendedRootCA,
        insecureHTTPParser: !!s.insecureHTTPParser,
        protocolVersion: s.httpVersion || 'auto',
        useWhatWGUrlParser: true,
      },
      certificates: certificateList(ws),
      ...proxyOptions(ws),
      ...(opts.systemProxy && (s.proxy || {}).mode !== 'none' && (s.proxy || {}).mode !== 'manual' ? { systemProxy: opts.systemProxy } : {}),
    }, (err, run) => {
      if (err) return resolve({ ok: false, error: String(err.message || err), time: Date.now() - started });
      hostSel.attach(run);
      if (opts.signal) opts.signal.addEventListener('abort', () => {
        try { run.abort(); } catch { /* ignore */ }
        result.aborted = true;
        // não espera o servidor responder: devolve "Cancelado" na hora
        resolve({ ...result, ok: false, aborted: true, error: 'Cancelado', response: undefined, time: Date.now() - started });
      });
      run.start({
        console: (cursor, level, ...args) => { const e = { level, args: args.map((a) => (typeof a === 'string' ? a : safeJson(a))) }; result.console.push(e); emit('console', e); },
        exception: (cursor, e) => { result.errors.push(String(e && e.message || e)); },
        prerequest: (e, cursor, results) => { grab(results); for (const r of results || []) if (r.error) result.errors.push(`Pre-request: ${r.error.message || r.error}`); },
        beforeRequest: (e, cursor, request) => { emit('request-sent', { method: request.method, url: request.url.toString() }); },
        request: (e, cursor, response, request, item, cookies, history) => {
          if (e) { result.ok = false; result.error = humanError(e) + (warnings.length ? ` — ${warnings.join("; ")}` : ""); }
          result.request = request ? { method: request.method, url: request.url.toString(), headers: headersOf(request.headers), body: request.body ? String(request.body.toString() || '') : '' } : undefined;
          if (response) {
            const buf = response.stream || Buffer.from(response.text ? response.text() : '');
            const ct = (response.headers.get('Content-Type') || '');
            const exec = history && history.execution && history.execution.data && history.execution.data[history.execution.data.length - 1];
            result.response = {
              code: response.code, status: response.status, headers: headersOf(response.headers),
              contentType: ct, size: buf.length, time: response.responseTime,
              body: isTextual(ct) ? buf.toString('utf8') : buf.toString('base64'), bodyEncoding: isTextual(ct) ? 'utf8' : 'base64',
              timings: exec && exec.timings ? phases(exec.timings) : undefined,
              cookies: (cookies || []).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })),
            };
            if (exec && exec.request) result.request.headers = (exec.request.headers || []).map((h) => ({ key: h.key, value: h.value }));
            if (exec && exec.session) result.tls = exec.session.tls ? { protocol: exec.session.tls.protocol, cipher: exec.session.tls.cipherName, certificate: exec.session.tls.certificate } : undefined;
            emit('response', { code: response.code, status: response.status });
          }
        },
        assertion: (cursor, assertions) => { for (const a of assertions || []) { const t = { name: a.name, passed: a.passed !== false && !a.error, skipped: !!a.skipped, error: a.error ? jsonErr(String(a.error.message || a.error)) : undefined }; result.tests.push(t); emit('test', t); } },
        test: (e, cursor, results) => { grab(results); for (const r of results || []) if (r.error) result.errors.push(`Script de teste: ${r.error.message || r.error}`); },
        done: (e) => {
          if (e) { result.ok = false; result.error = result.error || (humanError(e) + (warnings.length ? ` — ${warnings.join("; ")}` : "")); }
          persistJar(jar);
          // variáveis alteradas pelos scripts → valores locais (como o "current value" do Postman)
          const changed = [];
          const sync = (scopeKey, before, after, label) => {
            if (!after) return;
            for (const [k, v0] of Object.entries(after)) { const v = typeof v0 === 'string' ? v0 : JSON.stringify(v0); if (before[k] !== v) { ws.setLocalValue(scopeKey, k, v); changed.push({ scope: label, key: k, value: v }); } }
            for (const k of Object.keys(before)) if (!(k in after)) { ws.setLocalValue(scopeKey, k, UNSET); changed.push({ scope: label, key: k, removed: true }); }
          };
          const obj = (sc, fallback) => (sc && typeof sc.toObject === 'function' ? sc.toObject() : sc && sc.values ? new sdk.VariableScope(sc).toObject() : fallback);
          if (opts.environmentId) sync(`env:${opts.environmentId}`, envBefore, obj(lastScopes && lastScopes.environment, environment.toObject()), 'environment');
          sync('glo', gloBefore, obj(lastScopes && lastScopes.globals, globals.toObject()), 'global');
          if (scopes.collectionId && chain[0].id !== 'scratch') sync(`col:${scopes.collectionId}`, colVarsBefore, obj(lastScopes && lastScopes.collectionVariables, collection.variables.toObject()), 'collection');
          result.variablesChanged = changed;
          result.time = result.response ? result.response.time : Date.now() - started;
          if (result.aborted) { result.ok = false; result.error = 'Cancelado'; }
          if (!result.response && !result.error) { result.ok = false; result.error = result.errors[0] || 'Sem resposta'; }
          resolve(result);
        },
      });
    }); }).catch((e) => resolve({ ok: false, error: `Falha ao preparar o motor de scripts: ${e && e.message || e}`, tests: [], console: [], errors: [], time: Date.now() - started }));
  });
}

function phases(t) {
  // timings do postman-request: offsets em ms
  const o = t.offset || {};
  if (o.end === undefined) return undefined;
  const socket = o.socket || 0; const lookup = o.lookup ?? socket; const connect = o.connect ?? lookup; const secure = o.secureConnect ?? connect;
  return { wait: r(socket), dns: r(lookup - socket), tcp: r(connect - lookup), tls: o.secureConnect !== undefined ? r(secure - connect) : 0, firstByte: r(o.response - secure), download: r(o.end - o.response), total: r(o.done ?? o.end) };
}
const r = (n) => (n === undefined ? undefined : Math.round(n * 100) / 100);

function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }

function humanError(e) {
  const code = e && (e.code || (e.cause && e.cause.code));
  const msg = String(e && e.message || e);
  const map = {
    ECONNREFUSED: 'Conexão recusada (o servidor não está escutando nessa porta)',
    ENOTFOUND: 'Host não encontrado (DNS)',
    ETIMEDOUT: 'Tempo esgotado',
    ESOCKETTIMEDOUT: 'Tempo esgotado esperando resposta',
    ECONNRESET: 'Conexão encerrada pelo servidor',
    SELF_SIGNED_CERT_IN_CHAIN: 'Certificado autoassinado na cadeia: adicione a CA em Configurações → Certificados ou desligue a verificação SSL',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificado autoassinado: adicione a CA ou desligue a verificação SSL',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Não foi possível verificar o certificado do servidor (CA desconhecida): adicione a CA ou desligue a verificação SSL',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'CA do certificado do servidor não é confiável: adicione a CA ou desligue a verificação SSL',
    CERT_HAS_EXPIRED: 'Certificado do servidor expirado',
    ERR_TLS_CERT_ALTNAME_INVALID: 'O nome do host não bate com o certificado do servidor',
    EPROTO: 'Erro de protocolo TLS (o servidor pode exigir certificado de cliente)',
  };
  if (code && map[code]) return `${map[code]} [${code}]`;
  if (/certificate required|alert number 116|handshake failure/i.test(msg)) return `O servidor exige certificado de cliente (mTLS): configure em Configurações → Certificados [${code || 'TLS'}]`;
  return msg;
}

module.exports = { sendHttp, listCookies, clearCookies, cookieJarFor, buildCollection, humanError, USER_AGENT };
