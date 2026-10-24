'use strict';
// Modelo do Jaiminho ⇄ Postman Collection v2.1.
//
// Request do Jaiminho (o que vai no *.req.yaml):
// { id, kind: 'http'|'soap'|'grpc', name, description, method, url,
//   params:[{key,value,enabled,description}], headers:[...], auth:{type,...}, body:{mode,raw,language,urlencoded,formdata,file,graphql},
//   scripts:{pre,post}, vars:[{key,value}], settings:{verifySsl,followRedirects,timeoutMs,disableCookies},
//   soap:{version,action}, grpc:{method,schema,metadata,message,options}, examples:[] }
const { uuidv7, clone } = require('./util');

const AUTH_TYPES = ['inherit', 'none', 'basic', 'bearer', 'apikey', 'digest', 'oauth1', 'oauth2', 'ntlm', 'awsv4', 'hawk', 'jwt', 'edgegrid', 'asap', 'akamai'];

function newRequest(partial = {}) {
  const kind = partial.kind || 'http';
  const base = { id: uuidv7(), kind, name: partial.name || 'Nova request', method: kind === 'grpc' ? undefined : 'GET', url: '', params: [], headers: [], auth: { type: 'inherit' }, body: { mode: 'none' }, scripts: {}, vars: [], settings: {} };
  if (kind === 'soap') Object.assign(base, { method: 'POST', soap: { version: '1.1', action: '' }, body: { mode: 'raw', language: 'xml', raw: '' } });
  if (kind === 'grpc') Object.assign(base, { grpc: { method: '', schema: { source: 'reflection' }, metadata: [], message: '{}', options: {} } });
  return { ...base, ...clone(partial), id: partial.id || base.id };
}

// ---------- auth ----------
function authToPostman(auth) {
  if (!auth || !auth.type || auth.type === 'inherit') return undefined;
  if (auth.type === 'none') return { type: 'noauth' };
  const params = auth[auth.type] || {};
  return { type: auth.type, [auth.type]: Object.entries(params).map(([key, value]) => ({ key, value, type: typeof value === 'boolean' ? 'boolean' : 'string' })) };
}
function authFromPostman(a) {
  if (!a) return { type: 'inherit' };
  if (a.type === 'noauth') return { type: 'none' };
  const list = a[a.type];
  const params = {};
  if (Array.isArray(list)) for (const p of list) params[p.key] = p.value;
  else if (list && typeof list === 'object') Object.assign(params, list);
  return { type: a.type, [a.type]: params };
}

// ---------- scripts ----------
function scriptsToEvents(scripts = {}) {
  const ev = [];
  if (scripts.pre) ev.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: String(scripts.pre).split('\n') } });
  if (scripts.post) ev.push({ listen: 'test', script: { type: 'text/javascript', exec: String(scripts.post).split('\n') } });
  return ev;
}
function scriptsFromEvents(events = []) {
  const out = {};
  for (const e of events || []) {
    const exec = e.script && e.script.exec; const code = Array.isArray(exec) ? exec.join('\n') : exec || '';
    if (!code.trim()) continue;
    if (e.listen === 'prerequest') out.pre = code;
    if (e.listen === 'test') out.post = code;
  }
  return out;
}

const kv = (list = []) => list.map((p) => ({ key: p.key, value: p.value ?? '', disabled: p.enabled === false ? true : undefined, description: p.description || undefined }));
const kvBack = (list = []) => (list || []).map((p) => ({ key: p.key, value: p.value == null ? '' : String(p.value), enabled: p.disabled ? false : true, ...(p.description ? { description: typeof p.description === 'string' ? p.description : p.description.content } : {}) }));

// ---------- body ----------
function bodyToPostman(req) {
  const b = req.body || { mode: 'none' };
  switch (b.mode) {
    case 'raw': case 'json': case 'xml': case 'text': {
      const language = b.mode === 'raw' ? (b.language || 'text') : b.mode;
      return { mode: 'raw', raw: b.raw || '', options: { raw: { language } } };
    }
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kv(b.urlencoded) };
    case 'formdata': return { mode: 'formdata', formdata: (b.formdata || []).map((f) => (f.type === 'file' ? { key: f.key, type: 'file', src: f.src, disabled: f.enabled === false || undefined } : { key: f.key, value: f.value ?? '', type: 'text', disabled: f.enabled === false || undefined })) };
    case 'file': return { mode: 'file', file: { src: b.file } };
    case 'graphql': return { mode: 'graphql', graphql: { query: b.graphql?.query || '', variables: b.graphql?.variables || '' } };
    default: return undefined;
  }
}
function bodyFromPostman(body) {
  if (!body || !body.mode) return { mode: 'none' };
  switch (body.mode) {
    case 'raw': {
      const language = body.options?.raw?.language || guessLanguage(body.raw);
      return { mode: 'raw', language, raw: body.raw || '' };
    }
    case 'urlencoded': return { mode: 'urlencoded', urlencoded: kvBack(body.urlencoded) };
    case 'formdata': return { mode: 'formdata', formdata: (body.formdata || []).map((f) => (f.type === 'file' ? { key: f.key, type: 'file', src: Array.isArray(f.src) ? f.src[0] : f.src, enabled: !f.disabled } : { key: f.key, value: f.value ?? '', type: 'text', enabled: !f.disabled })) };
    case 'file': return { mode: 'file', file: body.file?.src };
    case 'graphql': return { mode: 'graphql', graphql: { query: body.graphql?.query || '', variables: typeof body.graphql?.variables === 'string' ? body.graphql.variables : JSON.stringify(body.graphql?.variables || {}) } };
    default: return { mode: 'none' };
  }
}
function guessLanguage(raw = '') {
  const t = String(raw).trim();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.startsWith('<')) return 'xml';
  return 'text';
}

// ---------- URL ----------
const sdk = require('postman-collection');

/** Substitui variáveis de caminho (:id) pelos valores da aba Params (como o Postman). */
function applyPathVars(raw, pathVars = []) {
  let out = raw;
  for (const v of pathVars || []) if (v.key && v.value !== undefined && v.value !== '') out = out.replace(new RegExp(`(/):${v.key}(?=/|\\?|#|$)`, 'g'), `$1${v.value}`);
  return out;
}

function urlToPostman(req, { forExport = false } = {}) {
  const raw0 = req.url || '';
  const qIndex = raw0.indexOf('?');
  const baseUrl = qIndex >= 0 ? raw0.slice(0, qIndex) : raw0;
  const fromUrl = qIndex >= 0 ? raw0.slice(qIndex + 1) : '';
  const params = req.params || [];
  const enabled = params.filter((p) => p.enabled !== false && p.key);
  let query = '';
  if (fromUrl && !params.length) query = fromUrl;
  else if (enabled.length) query = enabled.map((p) => `${p.key}=${p.value ?? ''}`).join('&');
  if (!forExport) return applyPathVars(query ? `${baseUrl}?${query}` : baseUrl, req.pathVars);
  const u = new sdk.Url(query ? `${baseUrl}?${query}` : baseUrl).toJSON();
  u.raw = query ? `${baseUrl}?${query}` : baseUrl;
  if (params.length) u.query = params.map((p) => ({ key: p.key, value: p.value ?? '', disabled: p.enabled === false || undefined, description: p.description }));
  if ((req.pathVars || []).length) u.variable = req.pathVars.map((v) => ({ key: v.key, value: v.value ?? '', description: v.description }));
  return u;
}

/** Nomes de variáveis de caminho presentes na URL (:id). */
function pathVarNames(url) { return [...String(url || '').replace(/\?.*$/, '').matchAll(/\/:([A-Za-z0-9_]+)/g)].map((m) => m[1]); }

// ---------- request ----------
function soapHeaders(req) {
  const h = [...(req.headers || [])];
  const has = (k) => h.some((x) => x.key && x.key.toLowerCase() === k && x.enabled !== false);
  const v12 = req.soap?.version === '1.2';
  if (!has('content-type')) h.push({ key: 'Content-Type', value: v12 ? `application/soap+xml; charset=utf-8${req.soap?.action ? `; action="${req.soap.action}"` : ''}` : 'text/xml; charset=utf-8' });
  if (!v12 && !has('soapaction')) h.push({ key: 'SOAPAction', value: `"${req.soap?.action || ''}"` });
  return h;
}

function requestToPostmanItem(req, opts = {}) {
  const headers = req.kind === 'soap' ? soapHeaders(req) : req.headers;
  const item = {
    id: req.id,
    name: req.name,
    request: {
      method: req.kind === 'soap' ? 'POST' : (req.method || 'GET'),
      url: urlToPostman(req, opts),
      header: kv(headers),
      body: req.kind === 'soap' ? { mode: 'raw', raw: req.body?.raw || '', options: { raw: { language: 'xml' } } } : bodyToPostman(req),
      auth: authToPostman(req.auth),
      description: req.description || undefined,
    },
    event: scriptsToEvents(req.scripts),
    response: (req.examples || []).map((e) => ({ name: e.name, code: e.status, status: e.statusText, header: kv(e.headers), body: e.body, originalRequest: undefined })),
  };
  const s = req.settings || {};
  const ppb = { disableBodyPruning: true };
  if (s.verifySsl === false) ppb.strictSSL = false;
  if (s.verifySsl === true) ppb.strictSSL = true;
  if (s.followRedirects === false) ppb.followRedirects = false;
  if (s.disableCookies) ppb.disableCookies = true;
  if (s.maxRedirects) ppb.maxRedirects = s.maxRedirects;
  if (Object.keys(ppb).length) item.protocolProfileBehavior = ppb;
  return item;
}

function requestFromPostmanItem(item) {
  const r = item.request || {};
  const urlObj = typeof r.url === 'string' ? { raw: r.url } : (r.url || {});
  let raw = urlObj.raw || '';
  if (!raw && urlObj.host) raw = `${urlObj.protocol ? urlObj.protocol + '://' : ''}${[].concat(urlObj.host).join('.')}${urlObj.port ? ':' + urlObj.port : ''}/${[].concat(urlObj.path || []).join('/')}`;
  const qIndex = raw.indexOf('?');
  const params = urlObj.query ? kvBack(urlObj.query) : (qIndex >= 0 ? raw.slice(qIndex + 1).split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return { key: i >= 0 ? p.slice(0, i) : p, value: i >= 0 ? p.slice(i + 1) : '', enabled: true }; }) : []);
  const headers = kvBack(r.header);
  const pathVars = (urlObj.variable || []).filter((v) => v && v.key).map((v) => ({ key: v.key, value: v.value == null ? '' : String(v.value), ...(v.description ? { description: typeof v.description === 'string' ? v.description : v.description.content } : {}) }));
  const isSoap = headers.some((h) => /^soapaction$/i.test(h.key)) || headers.some((h) => /^content-type$/i.test(h.key) && /soap\+xml/i.test(h.value));
  const ppb = item.protocolProfileBehavior || {};
  const settings = {};
  if (ppb.strictSSL === false) settings.verifySsl = false;
  if (ppb.followRedirects === false) settings.followRedirects = false;
  if (ppb.disableCookies) settings.disableCookies = true;
  const req = newRequest({
    id: undefined,
    kind: isSoap ? 'soap' : 'http',
    name: item.name || 'request',
    description: typeof r.description === 'string' ? r.description : r.description?.content,
    method: (r.method || 'GET').toUpperCase(),
    url: qIndex >= 0 ? raw.slice(0, qIndex) : raw,
    params,
    pathVars,
    headers,
    auth: authFromPostman(r.auth),
    body: bodyFromPostman(r.body),
    scripts: scriptsFromEvents(item.event),
    settings,
    examples: (item.response || []).map((e) => ({ name: e.name, status: e.code, statusText: e.status, headers: kvBack(e.header), body: e.body })),
  });
  if (isSoap) {
    const action = headers.find((h) => /^soapaction$/i.test(h.key));
    const ct = headers.find((h) => /^content-type$/i.test(h.key));
    req.soap = { version: ct && /soap\+xml/i.test(ct.value) ? '1.2' : '1.1', action: action ? String(action.value).replace(/"/g, '') : '' };
    req.headers = headers.filter((h) => !/^soapaction$/i.test(h.key) && !/^content-type$/i.test(h.key));
    req.body = { mode: 'raw', language: 'xml', raw: r.body?.raw || '' };
  }
  return req;
}

module.exports = { applyPathVars, pathVarNames, urlToPostman, newRequest, requestToPostmanItem, requestFromPostmanItem, authToPostman, authFromPostman, scriptsToEvents, scriptsFromEvents, kv, kvBack, AUTH_TYPES, guessLanguage };
