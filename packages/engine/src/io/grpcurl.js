'use strict';
// grpcurl: exportar request gRPC como comando e importar um comando grpcurl.
const { newRequest } = require('../model');

const q = (s, flavor) => (flavor === 'powershell' || flavor === 'cmd' ? `"${String(s).replace(/"/g, flavor === 'cmd' ? '\\"' : '`"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`);

/** req já com variáveis resolvidas. */
function exportGrpcurl(req, { flavor = 'bash', multiLine = false } = {}) {
  const g = req.grpc || {};
  const url = String(req.url || '');
  const tls = /^grpcs:\/\//i.test(url) || (g.tls && g.tls.mode === 'tls') || /:443$/.test(url);
  const target = url.replace(/^grpcs?:\/\//i, '').replace(/\/.*$/, '');
  const parts = ['grpcurl'];
  if (!tls) parts.push('-plaintext');
  if (tls && g.tls && g.tls.verifySsl === false) parts.push('-insecure');
  if (g.options && g.options.authority) parts.push('-authority', q(g.options.authority, flavor));
  if (g.options && g.options.deadlineMs) parts.push('-max-time', String(Math.ceil(g.options.deadlineMs / 1000)));
  const s = g.schema || {};
  if (s.source === 'proto') { for (const ip of s.importPaths || []) parts.push('-import-path', q(ip, flavor)); for (const f of s.files || []) parts.push('-proto', q(f, flavor)); }
  if (s.source === 'protoset') parts.push('-protoset', q(s.protoset, flavor));
  for (const h of g.metadata || []) if (h.enabled !== false && h.key) parts.push('-H', q(`${h.key}: ${h.value}`, flavor));
  let msg = String(g.message || '').trim();
  try { msg = JSON.stringify(JSON.parse(msg)); } catch { /* mantém */ }
  if (msg && msg !== '{}') parts.push('-d', q(msg, flavor));
  parts.push(target, String(g.method || '').replace(/^\//, ''));
  const sep = flavor === 'cmd' ? ' ^\n  ' : flavor === 'powershell' ? ' `\n  ' : ' \\\n  ';
  parts[0] = flavor === 'powershell' ? 'grpcurl.exe' : 'grpcurl';
  return multiLine ? parts.join(' ').replace(/ (?=-[a-zA-Z])/g, sep) : parts.join(' ');
}

/** Tokenizador estilo shell: aspas simples (bash), duplas com \" (bash/cmd) ou `" (PowerShell), continuação de linha \ ^ `. */
function tokenize(t) {
  const s = String(t).replace(/[ \t]*(\\|\^|`)\r?\n[ \t]*/g, ' ');
  const out = []; let cur = null; let i = 0;
  const push = () => { if (cur !== null) out.push(cur); cur = null; };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { push(); i++; continue; }
    if (cur === null) cur = '';
    if (c === '$' && s[i + 1] === "'") {
      // ANSI-C quoting do bash: $'...\n...'
      i += 2;
      const map = { n: '\n', t: '\t', r: '\r', "'": "'", '"': '"', '\\': '\\', '0': '\0', e: '\x1b' };
      while (i < s.length && s[i] !== "'") { if (s[i] === '\\' && i + 1 < s.length) { const nx = s[i + 1]; if (nx === 'u' || nx === 'x') { const len = nx === 'u' ? 4 : 2; cur += String.fromCharCode(parseInt(s.substr(i + 2, len), 16)); i += 2 + len; } else { cur += map[nx] !== undefined ? map[nx] : nx; i += 2; } } else { cur += s[i]; i++; } }
      i++; continue;
    }
    if (c === "'") { const j = s.indexOf("'", i + 1); cur += s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') { if ((s[i] === '\\' || s[i] === '`') && (s[i + 1] === '"' || s[i + 1] === '\\' || s[i + 1] === '`')) { cur += s[i + 1]; i += 2; } else { cur += s[i]; i++; } }
      i++; continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
    cur += c; i++;
  }
  push();
  return out;
}

function isGrpcurl(text) { return /^\s*grpcurl(\.exe)?\s/i.test(String(text || '')); }

function importGrpcurl(text) {
  const tk = tokenize(text); tk.shift();
  const g = { method: '', schema: { source: 'reflection' }, metadata: [], message: '{}', options: {}, tls: {} };
  let plaintext = false; const positional = [];
  for (let i = 0; i < tk.length; i++) {
    const a = tk[i];
    if (a === '-plaintext') plaintext = true;
    else if (a === '-insecure') g.tls.verifySsl = false;
    else if (a === '-H' || a === '-rpc-header' || a === '-reflect-header') { const [k, ...v] = tk[++i].split(':'); g.metadata.push({ key: k.trim(), value: v.join(':').trim() }); }
    else if (a === '-d') { const d = tk[++i]; if (d !== '@') { try { g.message = JSON.stringify(JSON.parse(d), null, 2); } catch { g.message = d; } } }
    else if (a === '-proto') { g.schema.source = 'proto'; (g.schema.files = g.schema.files || []).push(tk[++i]); }
    else if (a === '-import-path') { (g.schema.importPaths = g.schema.importPaths || []).push(tk[++i]); }
    else if (a === '-protoset') { g.schema = { source: 'protoset', protoset: tk[++i] }; }
    else if (a === '-authority') g.options.authority = tk[++i];
    else if (a === '-max-time') g.options.deadlineMs = Number(tk[++i]) * 1000;
    else if (a.startsWith('-')) { if (['-cacert', '-cert', '-key', '-servername', '-connect-timeout', '-format', '-user-agent'].includes(a)) i++; }
    else positional.push(a);
  }
  const [target, method] = positional;
  if (!target || !method) throw new Error('Comando grpcurl incompleto: falta endereço ou método');
  g.method = method.replace(/\./g, (m, off) => (off === method.lastIndexOf('.') && !method.includes('/') ? '/' : m));
  if (!g.tls.verifySsl && g.tls.verifySsl !== false) delete g.tls.verifySsl;
  return newRequest({ kind: 'grpc', name: g.method.split('/').pop() || 'gRPC', url: `${plaintext ? 'grpc' : 'grpcs'}://${target}`, grpc: g });
}

module.exports = { exportGrpcurl, importGrpcurl, isGrpcurl, tokenize };
