'use strict';
// Certificados: CAs extras (incl. as do sistema/Windows, para a VPN) e certificados de cliente por host (mTLS).
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

/** PEMs das CAs do sistema operacional (Windows: repositório de certificados). */
function systemCaPems() {
  try { if (typeof tls.getCACertificates === 'function') return tls.getCACertificates('system') || []; } catch { /* ignore */ }
  return [];
}

/** Arquivo PEM com as CAs extras (sistema + as do workspace). Usado pelo postman-runtime (extendedRootCA). */
function buildCaBundle(ws, warnings = []) {
  const s = ws.settings || {};
  const pems = [];
  if (s.useSystemCa !== false) pems.push(...systemCaPems());
  for (const f of s.caCertificates || []) {
    const p = ws.resolvePath(typeof f === 'string' ? f : f.path);
    if (p && fs.existsSync(p)) pems.push(fs.readFileSync(p, 'utf8'));
    else warnings.push(`CA configurada não encontrada: ${typeof f === 'string' ? f : f.path} (Configurações → Certificados)`);
  }
  if (!pems.length) return undefined;
  const text = pems.join('\n');
  const file = path.join(os.tmpdir(), `jaiminho-ca-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}.pem`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
  return file;
}

/** Todas as CAs confiáveis (Node + sistema + workspace) como um único PEM (para gRPC). */
function trustedCaPem(ws) {
  const s = ws.settings || {};
  const pems = [...tls.rootCertificates];
  if (s.useSystemCa !== false) pems.push(...systemCaPems());
  for (const f of s.caCertificates || []) {
    const p = ws.resolvePath(typeof f === 'string' ? f : f.path);
    if (p && fs.existsSync(p)) pems.push(fs.readFileSync(p, 'utf8'));
  }
  return Buffer.from(pems.join('\n'));
}

/** host:porta coincide com o padrão do certificado (aceita "*.dominio", "host", "host:porta"). */
function hostMatches(pattern, host, port) {
  if (!pattern) return false;
  const p = String(pattern).replace(/^https?:\/\//, '').replace(/^grpcs?:\/\//, '').replace(/\/.*$/, '');
  const [ph, pp] = p.split(':');
  const hostOk = ph === host || (ph.startsWith('*.') && host.endsWith(ph.slice(1))) || ph === '*';
  return hostOk && (!pp || String(pp) === String(port));
}

/** Certificado de cliente configurado para o host (ou undefined). */
function clientCertFor(ws, host, port) {
  const list = (ws.settings && ws.settings.certificates) || [];
  return list.find((c) => c.enabled !== false && hostMatches(c.host, host, port));
}

function certPassphrase(ws, cert) {
  if (!cert) return undefined;
  const idx = (ws.settings.certificates || []).indexOf(cert);
  return ws.getSecret(`cert:${cert.id || idx}:passphrase`) ?? cert.passphrase;
}

module.exports = { buildCaBundle, trustedCaPem, systemCaPems, hostMatches, clientCertFor, certPassphrase };
