'use strict';
// cURL: colar → request; request → cURL (bash, cmd, PowerShell). Outras linguagens via postman-code-generators.
const codegen = require('postman-code-generators');
const sdk = require('postman-collection');
const { requestFromPostmanItem, requestToPostmanItem, newRequest } = require('../model');

/** Normaliza continuação de linha de cmd (^) e PowerShell (`) e o "curl.exe". */
function normalize(text) {
  let t = String(text || '').trim();
  t = t.replace(/^(?:\$|>|#|PS [^>]*>)\s*/, '');
  t = t.replace(/^\s*curl\.exe\b/i, 'curl');
  t = t.replace(/\s*\^\r?\n\s*/g, ' ').replace(/\s*`\r?\n\s*/g, ' ').replace(/\s*\\\r?\n\s*/g, ' ');
  // cmd escapa aspas como ^" e usa aspas duplas; PowerShell às vezes usa --%
  if (/\^"/.test(t) || /\^[{}&|<>]/.test(t)) t = t.replace(/\^(.)/g, '$1');
  t = t.replace(/\s--%\s/, ' ');
  return t;
}

function isCurl(text) { return /^\s*(?:\$|>|#|PS [^>]*>)?\s*curl(\.exe)?\s/i.test(String(text || '')); }

/** Tokeniza só para achar flags que o conversor ignora (-k, --cert, --key, --cacert, --compressed). */
function tokens(t) { return require('./grpcurl').tokenize(t); }

function nameFor(method, url) {
  try { const u = new URL(url.replace(/\{\{[^}]+\}\}/g, 'x')); return `${method} ${u.pathname}`; } catch { return `${method} ${url}`.slice(0, 80); }
}

const VALUE_FLAGS = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json', '-F', '--form', '--form-string', '-u', '--user', '-b', '--cookie', '-A', '--user-agent', '-e', '--referer', '--url', '-o', '--output', '-E', '--cert', '--key', '--cacert', '--cert-type', '--key-type', '--pass', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-w', '--write-out', '--resolve', '--max-redirs', '-T', '--upload-file', '--oauth2-bearer', '-c', '--cookie-jar', '-r', '--range', '-K', '--config', '--retry', '--limit-rate', '--interface', '--proto', '--proto-redir', '-Y', '-y', '-z', '--aws-sigv4']);

/** Expande flags curtas combinadas (-sSkL → -s -S -k -L; -XPOST → -X POST). */
function expandShort(tk) {
  const out = [];
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    if (/^-[a-zA-Z]{2,}/.test(t) && !t.startsWith('--')) {
      for (let k = 1; k < t.length; k++) {
        const f = `-${t[k]}`;
        if (VALUE_FLAGS.has(f)) { const rest = t.slice(k + 1); out.push(f); if (rest) out.push(rest); break; }
        out.push(f);
      }
    } else out.push(t);
  }
  return out;
}

/** cURL → request do Jaiminho (+ extras: certificado). Parser próprio (bash, cmd, PowerShell). */
async function importCurl(text) {
  const t = normalize(text);
  const tk = expandShort(tokens(t));
  if (!tk.length || !/^curl(\.exe)?$/i.test(tk[0])) throw new Error('cURL inválido: o texto precisa começar com "curl"');
  let method; let url; const headers = []; const data = []; const urlenc = []; const form = []; let user; let get = false; let insecure = false; let follow; let jsonFlag = false; const extras = {}; let cookie; let upload;
  for (let i = 1; i < tk.length; i++) {
    const a = tk[i]; const next = () => tk[++i];
    const eq = /^(--[a-z0-9-]+)=(.*)$/i.exec(a);
    const flagName = eq ? eq[1] : a; const val = () => (eq ? eq[2] : next());
    switch (flagName) {
      case '-X': case '--request': method = String(val()).toUpperCase(); break;
      case '-H': case '--header': { const h = val(); const k = h.indexOf(':'); if (k > 0) { const key = h.slice(0, k).trim(); const value = h.slice(k + 1).trim(); headers.push({ key, value, enabled: true }); } else if (/;$/.test(h)) headers.push({ key: h.slice(0, -1).trim(), value: '', enabled: true }); break; }
      case '-d': case '--data': case '--data-ascii': case '--data-binary': case '--data-raw': { let v = val(); if (flagName !== '--data-raw' && v.startsWith('@')) { extras.dataFile = v.slice(1); v = ''; } data.push(v); break; }
      case '--json': data.push(val()); jsonFlag = true; break;
      case '--data-urlencode': { const v = val(); const k = v.indexOf('='); if (k > 0) urlenc.push({ key: v.slice(0, k), value: v.slice(k + 1), enabled: true }); else urlenc.push({ key: v.replace(/^=/, ''), value: '', enabled: true }); break; }
      case '-F': case '--form': case '--form-string': { const v = val(); const k = v.indexOf('='); const key = v.slice(0, k); let value = v.slice(k + 1); if (flagName !== '--form-string' && value.startsWith('@')) { form.push({ key, type: 'file', src: value.slice(1).split(';')[0], enabled: true }); } else { value = value.replace(/^"(.*)"$/, '$1'); form.push({ key, value, type: 'text', enabled: true }); } break; }
      case '-u': case '--user': user = val(); break;
      case '-b': case '--cookie': cookie = val(); break;
      case '-A': case '--user-agent': headers.push({ key: 'User-Agent', value: val(), enabled: true }); break;
      case '-e': case '--referer': headers.push({ key: 'Referer', value: val(), enabled: true }); break;
      case '--oauth2-bearer': headers.push({ key: 'Authorization', value: `Bearer ${val()}`, enabled: true }); break;
      case '--url': url = val(); break;
      case '-G': case '--get': get = true; break;
      case '-k': case '--insecure': insecure = true; break;
      case '-L': case '--location': follow = true; break;
      case '-I': case '--head': method = 'HEAD'; break;
      case '-E': case '--cert': extras.certificate = { ...(extras.certificate || {}), cert: String(val()).split(':')[0] }; break;
      case '--key': extras.certificate = { ...(extras.certificate || {}), key: val() }; break;
      case '--cacert': extras.certificate = { ...(extras.certificate || {}), ca: val() }; break;
      case '-T': case '--upload-file': upload = val(); break;
      case '--compressed': headers.push({ key: 'Accept-Encoding', value: 'gzip, deflate, br', enabled: true }); break;
      default:
        if (VALUE_FLAGS.has(flagName)) { if (!eq) next(); }
        else if (!a.startsWith('-') && !url) url = a;
    }
  }
  if (!url) throw new Error('cURL inválido: não encontrei a URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^\{\{/.test(url)) url = `http://${url}`;
  const req = newRequest({ name: '', headers });
  let base = url; let params = [];
  const q = url.indexOf('?');
  if (q >= 0) { base = url.slice(0, q); params = url.slice(q + 1).split('&').filter(Boolean).map((p) => { const k = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } }; return { key: dec(k >= 0 ? p.slice(0, k) : p), value: dec(k >= 0 ? p.slice(k + 1) : ''), enabled: true }; }); }
  const ct = (headers.find((h) => /^content-type$/i.test(h.key)) || {}).value || '';
  if (get) {
    for (const d of data) for (const p of d.split('&').filter(Boolean)) { const k = p.indexOf('='); params.push({ key: k >= 0 ? p.slice(0, k) : p, value: k >= 0 ? p.slice(k + 1) : '', enabled: true }); }
    for (const u of urlenc) params.push(u);
  } else if (form.length) req.body = { mode: 'formdata', formdata: form };
  else if (urlenc.length && !data.length) req.body = { mode: 'urlencoded', urlencoded: urlenc };
  else if (data.length || urlenc.length) {
    const raw = [...data, ...urlenc.map((u) => `${encodeURIComponent(u.key)}=${encodeURIComponent(u.value)}`)].join('&');
    if (jsonFlag) { if (!ct) headers.push({ key: 'Content-Type', value: 'application/json', enabled: true }); if (!headers.some((h) => /^accept$/i.test(h.key))) headers.push({ key: 'Accept', value: 'application/json', enabled: true }); }
    const ctype = ct || (jsonFlag ? 'application/json' : '');
    if (/json/i.test(ctype) || (!ctype && /^\s*[[{]/.test(raw))) req.body = { mode: 'raw', language: 'json', raw };
    else if (/xml|soap/i.test(ctype) || /^\s*</.test(raw)) req.body = { mode: 'raw', language: 'xml', raw };
    else if (!ctype || /x-www-form-urlencoded/i.test(ctype)) {
      req.body = { mode: 'urlencoded', urlencoded: raw.split('&').filter(Boolean).map((p) => { const k = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } }; return { key: dec(k >= 0 ? p.slice(0, k) : p), value: dec(k >= 0 ? p.slice(k + 1) : ''), enabled: true }; }) };
      if (!ct) headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true });
    } else req.body = { mode: 'raw', language: 'text', raw };
  } else if (upload) req.body = { mode: 'file', file: upload };
  req.method = method || (get ? 'GET' : (req.body && req.body.mode !== 'none') ? (upload && !data.length ? 'PUT' : 'POST') : 'GET');
  req.url = base; req.params = params; req.headers = headers;
  if (cookie) headers.push({ key: 'Cookie', value: cookie, enabled: true });
  if (insecure) req.settings = { ...(req.settings || {}), verifySsl: false };
  if (follow) req.settings = { ...(req.settings || {}), followRedirects: true };
  if (user) { const [username, ...p] = user.split(':'); req.auth = { type: 'basic', basic: { username, password: p.join(':') } }; }
  const authH = headers.find((h) => /^authorization$/i.test(h.key));
  if (authH && /^Bearer\s+/i.test(authH.value)) { req.auth = { type: 'bearer', bearer: { token: authH.value.replace(/^Bearer\s+/i, '') } }; req.headers = req.headers.filter((h) => h !== authH); }
  req.name = nameFor(req.method, url);
  // SOAP?
  if (req.body && req.body.language === 'xml' && headers.some((h) => /^soapaction$/i.test(h.key) || (/^content-type$/i.test(h.key) && /soap\+xml/i.test(h.value)))) {
    const it = requestToPostmanItem(req); const soap = requestFromPostmanItem({ name: req.name, request: it.request });
    soap.id = req.id; soap.settings = req.settings; soap.params = req.params; soap.url = req.url; soap.auth = req.auth;
    return { request: soap, extras };
  }
  return { request: req, extras };
}

/** request resolvida → texto de código. flavor: bash | cmd | powershell */
function exportCurl(req, { flavor = 'bash', multiLine = true } = {}) {
  const lc = flavor === 'cmd' ? '^' : flavor === 'powershell' ? '`' : '\\';
  const quote = flavor === 'bash' ? 'single' : 'double';
  return generate(req, 'curl', 'cURL', { multiLine, longFormat: false, lineContinuationCharacter: lc, quoteType: quote, followRedirect: req.settings?.followRedirects !== false, trimRequestBody: false })
    .then((code) => {
      let c = code;
      if (req.settings && req.settings.verifySsl === false) c = c.replace(/^curl /, 'curl -k ');
      if (flavor === 'powershell') c = c.replace(/^curl /, 'curl.exe ');
      return c;
    });
}

/** Auth vira header/query (os geradores de código não aplicam auth sozinhos). */
function materializeAuth(req) {
  const a = req.auth || {}; const r = { ...req, headers: [...(req.headers || [])], params: [...(req.params || [])], auth: { type: 'none' } };
  const p = a[a.type] || {};
  const b = req.body || {};
  if (!r.headers.some((h) => h.enabled !== false && /^content-type$/i.test(h.key || ''))) {
    const ct = b.mode === 'raw' && b.language === 'json' ? 'application/json' : b.mode === 'raw' && b.language === 'xml' ? 'application/xml' : null;
    if (ct && req.kind !== 'soap') r.headers.push({ key: 'Content-Type', value: ct });
  }
  if (a.type === 'bearer' && p.token) r.headers.push({ key: 'Authorization', value: `Bearer ${p.token}` });
  else if (a.type === 'basic') r.headers.push({ key: 'Authorization', value: `Basic ${Buffer.from(`${p.username || ''}:${p.password || ''}`).toString('base64')}` });
  else if (a.type === 'apikey' && p.key) { if (p.in === 'query') r.params.push({ key: p.key, value: p.value || '' }); else r.headers.push({ key: p.key, value: p.value || '' }); }
  else if (a.type && !['none', 'inherit', 'noauth'].includes(a.type)) r.auth = a;
  return r;
}

function generate(req, language, variant, options = {}) {
  const item = requestToPostmanItem(materializeAuth(req));
  const request = new sdk.Request(item.request);
  return new Promise((resolve, reject) => codegen.convert(language, variant, request, options, (err, snippet) => (err ? reject(err) : resolve(snippet))));
}

function languages() { return codegen.getLanguageList().map((l) => ({ key: l.key, label: l.label, variants: l.variants.map((v) => v.key), syntax: l.syntax_mode })); }

module.exports = { importCurl, exportCurl, generate, languages, isCurl, normalize };
