'use strict';
const crypto = require('crypto');

/** UUIDv7 (ordenável por tempo). */
function uuidv7() {
  const b = crypto.randomBytes(16);
  const ts = BigInt(Date.now());
  b[0] = Number((ts >> 40n) & 0xffn); b[1] = Number((ts >> 32n) & 0xffn); b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn); b[4] = Number((ts >> 8n) & 0xffn); b[5] = Number(ts & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Nome → trecho seguro para arquivo (sem acento/espaço). */
function slug(name, max = 48) {
  const s = String(name || 'sem-nome').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  const out = s || 'sem-nome';
  // nomes reservados do Windows (CON, NUL, COM1...) não podem ser arquivo/pasta
  return /^(con|prn|aux|nul|com\d|lpt\d)$/.test(out) ? `${out}-` + '_' : out;
}

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** Remove chaves vazias para YAML limpo. */
function prune(o) {
  if (Array.isArray(o)) return o.map(prune);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      if (v === '' && k !== 'value') continue;
      out[k] = prune(v);
    }
    return out;
  }
  return o;
}

module.exports = { uuidv7, slug, clone, prune };
