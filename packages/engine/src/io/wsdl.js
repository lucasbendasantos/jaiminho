'use strict';
// WSDL 1.1 → coleção SOAP: uma request por operação, envelope de exemplo gerado do XSD, SOAPAction e versão do binding.
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { slug } = require('../util');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, isArray: (name) => ['operation', 'port', 'binding', 'service', 'message', 'part', 'element', 'complexType', 'simpleType', 'schema', 'import', 'include', 'enumeration', 'sequence', 'choice', 'all', 'attribute'].includes(name) });

const local = (q) => String(q || '').split(':').pop();
const arr = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function buildTypeIndex(schemas) {
  const elements = new Map(); const complex = new Map(); const simple = new Map();
  for (const s of schemas) {
    const tns = s['@targetNamespace'];
    for (const e of arr(s.element)) elements.set(e['@name'], { node: e, tns, qualified: s['@elementFormDefault'] === 'qualified' });
    for (const c of arr(s.complexType)) complex.set(c['@name'], c);
    for (const c of arr(s.simpleType)) simple.set(c['@name'], c);
  }
  return { elements, complex, simple };
}

function sampleScalar(type, name, simpleNode) {
  const enums = simpleNode && arr(simpleNode.restriction?.[0]?.enumeration || simpleNode.restriction?.enumeration);
  if (enums && enums.length) return enums[0]['@value'];
  switch (local(type)) {
    case 'int': case 'integer': case 'long': case 'short': case 'decimal': case 'nonNegativeInteger': case 'positiveInteger': return '1';
    case 'double': case 'float': return '1.5';
    case 'boolean': return 'true';
    case 'date': return '2026-01-01';
    case 'dateTime': return '2026-01-01T00:00:00Z';
    case 'base64Binary': return 'AQID';
    default: return /id$/i.test(name) ? '1' : '?';
  }
}

function renderElement(el, idx, pfx, depth, lines, indent) {
  const name = el['@name'] || local(el['@ref']);
  const optional = el['@minOccurs'] === '0';
  const pad = '  '.repeat(indent);
  if (depth > 6) return;
  const comment = optional ? '<!--opcional:-->' : '';
  if (el['@ref']) { const ref = idx.elements.get(local(el['@ref'])); if (ref) return renderElement({ ...ref.node, '@minOccurs': el['@minOccurs'] }, idx, pfx, depth + 1, lines, indent); }
  const typeName = el['@type'] && local(el['@type']);
  const complex = el.complexType ? arr(el.complexType)[0] : (typeName && idx.complex.get(typeName));
  const simple = el.simpleType ? arr(el.simpleType)[0] : (typeName && idx.simple.get(typeName));
  if (complex) {
    const kids = [];
    for (const grp of ['sequence', 'all', 'choice']) for (const g of arr(complex[grp])) kids.push(...arr(g.element));
    if (complex.complexContent && complex.complexContent.extension) { const ext = complex.complexContent.extension; const base = idx.complex.get(local(ext['@base'])); if (base) for (const grp of ['sequence', 'all']) for (const g of arr(base[grp])) kids.push(...arr(g.element)); for (const grp of ['sequence', 'all']) for (const g of arr(ext[grp])) kids.push(...arr(g.element)); }
    if (comment) lines.push(pad + comment);
    lines.push(`${pad}<${pfx}:${name}>`);
    for (const k of kids) renderElement(k, idx, pfx, depth + 1, lines, indent + 1);
    lines.push(`${pad}</${pfx}:${name}>`);
  } else {
    if (comment) lines.push(pad + comment);
    lines.push(`${pad}<${pfx}:${name}>${sampleScalar(typeName || simple?.restriction?.[0]?.['@base'], name, simple)}</${pfx}:${name}>`);
  }
}

function envelopeFor(elementName, idx, version, tns) {
  const lines = [];
  const el = idx.elements.get(elementName);
  if (el) renderElement(el.node, idx, 'tns', 0, lines, 3);
  else lines.push(`      <tns:${elementName}/>`);
  const env = version === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
  return `<soapenv:Envelope xmlns:soapenv="${env}" xmlns:tns="${tns}">\n   <soapenv:Header/>\n   <soapenv:Body>\n${lines.join('\n')}\n   </soapenv:Body>\n</soapenv:Envelope>`;
}

/** Lê o WSDL (texto) e devolve { name, tns, services:[{name, ports:[{name, version, address, operations:[{name, action, request(envelope)}]}]}], schemas } */
function parseWsdl(text) {
  const doc = parser.parse(text);
  const def = doc.definitions;
  if (!def) throw new Error('Não é um WSDL 1.1 (falta <definitions>)');
  const tns = def['@targetNamespace'];
  const schemas = arr(def.types?.schema || (Array.isArray(def.types) ? def.types[0]?.schema : undefined));
  const idx = buildTypeIndex(schemas);
  const messages = new Map(arr(def.message).map((m) => [m['@name'], arr(m.part)]));
  const portTypes = new Map(arr(def.portType).map((p) => [p['@name'], arr(p.operation)]));
  const bindings = new Map(arr(def.binding).map((b) => [b['@name'], b]));
  const services = arr(def.service).map((s) => ({
    name: s['@name'],
    ports: arr(s.port).map((p) => {
      const b = bindings.get(local(p['@binding'])) || {};
      const version = isSoap12Binding(text, b['@name']) ? '1.2' : '1.1';
      const ops = arr(b.operation).map((o) => {
        const opName = o['@name'];
        const action = arr(o.operation)[0]?.['@soapAction'] || '';
        const pt = portTypes.get(local(b['@type'])) || [];
        const ptOp = pt.find((x) => x['@name'] === opName) || {};
        const inMsg = messages.get(local(ptOp.input?.['@message'])) || [];
        const elementName = local(inMsg[0]?.['@element']) || opName;
        return { name: opName, action, element: elementName, request: envelopeFor(elementName, idx, version, tns) };
      });
      const address = p.address?.['@location'] || (Array.isArray(p.address) ? p.address[0]['@location'] : '');
      return { name: p['@name'], version, address, operations: ops };
    }),
  }));
  return { name: def['@name'] || services[0]?.name || 'WSDL', tns, services, schemaCount: schemas.length };
}

function isSoap12Binding(text, bindingName) {
  const re = new RegExp(`<(?:\\w+:)?binding[^>]*name="${bindingName}"[\\s\\S]*?</(?:\\w+:)?binding>`);
  const m = re.exec(text); if (!m) return false;
  const prefixes = [...text.matchAll(/xmlns:(\w+)="http:\/\/schemas\.xmlsoap\.org\/wsdl\/soap12\/"/g)].map((x) => x[1]);
  if (/xmlns="http:\/\/schemas\.xmlsoap\.org\/wsdl\/soap12\/"/.test(m[0])) return true;
  return prefixes.some((p) => new RegExp(`<${p}:binding\\b`).test(m[0]));
}

/** Extrai o(s) xs:schema do WSDL como XSD avulso (para validação). */
function extractXsd(text) {
  const out = []; const re = /<((?:\w+:)?schema)\b[\s\S]*?<\/\1>/g; let m;
  const rootNs = {}; const defs = /<(?:\w+:)?definitions\b([^>]*)>/.exec(text);
  if (defs) for (const [, k, v] of defs[1].matchAll(/xmlns:(\w+)="([^"]+)"/g)) rootNs[k] = v;
  while ((m = re.exec(text))) {
    let s = m[0];
    for (const [k, v] of Object.entries(rootNs)) if (!new RegExp(`xmlns:${k}=`).test(s.slice(0, s.indexOf('>')))) s = s.replace(/^<((?:\w+:)?schema)\b/, `<$1 xmlns:${k}="${v}"`);
    out.push(`<?xml version="1.0" encoding="UTF-8"?>\n${s}`);
  }
  return out;
}

/** Importa: cria coleção com pasta por serviço/porta e request por operação; salva o WSDL em wsdl/. */
function importWsdl(ws, text, { name, sourceUrl, onlyVersion } = {}) {
  const info = parseWsdl(text);
  const file = path.join('wsdl', `${slug(name || info.name)}.wsdl`);
  fs.mkdirSync(path.join(ws.dir, 'wsdl'), { recursive: true });
  fs.writeFileSync(path.join(ws.dir, file), text);
  const colId = ws.createCollection(name || info.name, { description: `Importado do WSDL ${sourceUrl || ''}`.trim(), origin: { type: 'wsdl', url: sourceUrl, file } });
  let count = 0;
  for (const svc of info.services) for (const port of svc.ports) {
    if (onlyVersion && port.version !== onlyVersion) continue;
    const folder = ws.createFolder(colId, `${svc.name} (SOAP ${port.version})`);
    for (const op of port.operations) {
      ws.createRequest(folder, { kind: 'soap', name: op.name, method: 'POST', url: port.address, soap: { version: port.version, action: op.action, wsdl: file, operation: op.name }, body: { mode: 'raw', language: 'xml', raw: op.request }, settings: { validateXsd: true } });
      count++;
    }
  }
  return { collectionId: colId, operations: count, wsdlFile: file, info };
}

module.exports = { parseWsdl, importWsdl, extractXsd };
