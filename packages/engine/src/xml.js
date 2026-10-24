'use strict';
// XML: formatar, XPath, validar contra XSD (xmllint em WASM, sem binário nativo).
const { DOMParser } = require('@xmldom/xmldom');
const xpath = require('xpath');

function pretty(xml, indent = '  ') {
  const src = String(xml || '').trim();
  if (!src) return src;
  try { new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') throw new Error(msg); } }).parseFromString(src, 'text/xml'); } catch { return src; }
  let out = ''; let depth = 0;
  const keep = []; // CDATA e comentários ficam intactos
  const masked = src.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (m) => `<__jx${keep.push(m) - 1}/>`);
  const tokens = masked.replace(/>\s*</g, '><').split(/(<[^>]+>)/).filter((t) => t !== '');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^<\?/.test(t) || /^<!/.test(t)) { out += t + '\n'; continue; }
    if (/^<\//.test(t)) { depth--; out += indent.repeat(Math.max(depth, 0)) + t + '\n'; continue; }
    if (/^<[^>]+\/>$/.test(t)) { out += indent.repeat(depth) + t + '\n'; continue; }
    if (/^</.test(t)) {
      const next = tokens[i + 1]; const close = tokens[i + 2];
      if (next !== undefined && !/^</.test(next) && close && /^<\//.test(close)) { out += indent.repeat(depth) + t + next + close + '\n'; i += 2; continue; }
      out += indent.repeat(depth) + t + '\n'; depth++; continue;
    }
    out += indent.repeat(depth) + t.trim() + '\n';
  }
  return out.trim().replace(/<__jx(\d+)\/>/g, (m, i) => keep[Number(i)]);
}

function parse(xml) {
  const errors = [];
  const doc = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') errors.push(msg); } }).parseFromString(String(xml || ''), 'text/xml');
  if (errors.length) throw new Error(`XML inválido: ${errors[0]}`);
  return doc;
}

/** Avalia XPath. Prefixos de namespace do documento ficam disponíveis automaticamente; local-name() sempre funciona. */
function evaluate(xml, expr, extraNs = {}) {
  const doc = parse(xml);
  const ns = { ...extraNs };
  const walk = (n) => { if (n.attributes) for (let i = 0; i < n.attributes.length; i++) { const a = n.attributes[i]; if (a.name.startsWith('xmlns:')) ns[a.name.slice(6)] = ns[a.name.slice(6)] || a.value; } for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) walk(c); };
  walk(doc.documentElement);
  const select = xpath.useNamespaces(ns);
  const res = select(expr, doc);
  if (Array.isArray(res)) return res.map((n) => (n.nodeType === 2 ? n.value : n.nodeType === 3 ? n.data : n.textContent));
  return res;
}

/** Valida XML contra XSD. schemas: [{fileName, contents}] (o primeiro é o principal). */
async function validateXsd(xml, schemas) {
  const { validateXML } = require('xmllint-wasm');
  const r = await validateXML({ xml: [{ fileName: 'request.xml', contents: String(xml) }], schema: schemas.slice(0, 1), preload: schemas.slice(1) });
  return { valid: r.valid, errors: (r.errors || []).map((e) => (typeof e === 'string' ? e : (e.message || e.rawMessage || JSON.stringify(e)))) };
}

/** Tira o conteúdo do Body de um envelope SOAP (para validar o payload contra o XSD do WSDL). */
function soapBody(xml) {
  const doc = parse(xml);
  const body = xpath.select("//*[local-name()='Envelope']/*[local-name()='Body']/*[1]", doc)[0];
  if (!body) return null;
  return body.toString();
}

function soapFault(xml) {
  try {
    const doc = parse(xml);
    const f = xpath.select("//*[local-name()='Fault']", doc)[0];
    if (!f) return null;
    const text = (q) => { const n = xpath.select(q, f)[0]; return n ? n.textContent.trim() : undefined; };
    return { code: text("*[local-name()='faultcode']") || text(".//*[local-name()='Value']"), message: text("*[local-name()='faultstring']") || text(".//*[local-name()='Text']") };
  } catch { return null; }
}

module.exports = { pretty, evaluate, validateXsd, soapBody, soapFault, parse };
