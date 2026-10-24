'use strict';
// JSON ⇄ protobuf com o mapeamento canônico do proto3 para os well-known types
// (Timestamp, Duration, wrappers, Struct/Value/ListValue, Any, FieldMask, Empty).
const protobuf = require('protobufjs');

const WRAPPERS = new Set(['DoubleValue', 'FloatValue', 'Int64Value', 'UInt64Value', 'Int32Value', 'UInt32Value', 'BoolValue', 'StringValue', 'BytesValue'].map((n) => `.google.protobuf.${n}`));
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function lookupType(root, name) {
  if (!root) return null;
  try { return root.lookupType(name); } catch { return null; }
}
/** Campo repeated de MapEntry (schemas vindos de descriptor/reflection) tratado como map. */
function isMapEntry(f) {
  const rt = f.resolvedType;
  return !!(f.repeated && rt instanceof protobuf.Type && ((rt.options && (rt.options.map_entry || rt.options.mapEntry)) || (/Entry$/.test(rt.name) && rt.fieldsArray.length === 2 && rt.fields.key && rt.fields.value)));
}

class FieldError extends Error { constructor(path, msg) { super(`${path}: ${msg}`); this.path = path; } }

function findField(type, key) {
  if (type.fields[key]) return type.fields[key];
  for (const f of type.fieldsArray) if (camel(f.name) === key || f.options?.json_name === key) return f;
  return null;
}

// ---------------- JSON → objeto protobufjs ----------------
function wktFromJson(name, v, path, registry) {
  switch (name) {
    case '.google.protobuf.Timestamp': {
      if (v && typeof v === 'object') return v;
      if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/.test(v)) throw new FieldError(path, `Timestamp inválido (use RFC 3339, ex.: 2026-01-01T10:00:00Z): ${JSON.stringify(v)}`);
      const d = new Date(v); if (isNaN(d)) throw new FieldError(path, `Timestamp inválido: ${v}`);
      const ms = d.getTime(); const frac = /\.(\d+)Z?$/i.exec(String(v).replace(/[+-]\d\d:\d\d$/, ''));
      return { seconds: Math.floor(ms / 1000), nanos: frac ? Number(frac[1].padEnd(9, '0').slice(0, 9)) : (ms % 1000) * 1e6 };
    }
    case '.google.protobuf.Duration': {
      if (v && typeof v === 'object') return v;
      const m = /^(-)?(\d+)(?:\.(\d{1,9}))?s$/.exec(String(v)); if (!m) throw new FieldError(path, `Duration inválida (use "1.5s"): ${v}`);
      const sign = m[1] ? -1 : 1; return { seconds: sign * Number(m[2]), nanos: sign * Number((m[3] || '').padEnd(9, '0')) };
    }
    case '.google.protobuf.FieldMask': return typeof v === 'string' ? { paths: v.split(',').filter(Boolean).map((p) => p.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())) } : v;
    case '.google.protobuf.Struct': return structFromJson(v);
    case '.google.protobuf.Value': return valueFromJson(v);
    case '.google.protobuf.ListValue': return { values: (v || []).map(valueFromJson) };
    case '.google.protobuf.Empty': return {};
    case '.google.protobuf.Any': {
      if (!v || typeof v !== 'object' || !v['@type']) throw new FieldError(path, 'Any precisa de "@type"');
      const typeName = v['@type'].split('/').pop();
      const t = lookupType(registry, '.' + typeName);
      if (!t) throw new FieldError(path, `Tipo do Any desconhecido: ${typeName}`);
      const inner = WRAPPERS.has(t.fullName) || ['.google.protobuf.Timestamp', '.google.protobuf.Duration', '.google.protobuf.Struct', '.google.protobuf.Value', '.google.protobuf.FieldMask'].includes(t.fullName)
        ? wktFromJson(t.fullName, v.value, path, registry) : (() => { const o = { ...v }; delete o['@type']; return o; })();
      const msg = jsonToMessage(t, inner, registry, path);
      return { type_url: v['@type'], value: t.encode(msg).finish() };
    }
    default:
      if (WRAPPERS.has(name)) return v && typeof v === 'object' && 'value' in v ? v : { value: v };
      return undefined;
  }
}
function valueFromJson(v) {
  if (v === null || v === undefined) return { nullValue: 0, null_value: 0 };
  if (typeof v === 'number') return { numberValue: v, number_value: v };
  if (typeof v === 'string') return { stringValue: v, string_value: v };
  if (typeof v === 'boolean') return { boolValue: v, bool_value: v };
  if (Array.isArray(v)) return { listValue: { values: v.map(valueFromJson) }, list_value: { values: v.map(valueFromJson) } };
  return { structValue: structFromJson(v), struct_value: structFromJson(v) };
}
function structFromJson(o) { const fields = {}; for (const [k, v] of Object.entries(o || {})) fields[k] = valueFromJson(v); return { fields }; }

const INT_RANGES = { int32: [-2147483648, 2147483647], sint32: [-2147483648, 2147483647], sfixed32: [-2147483648, 2147483647], uint32: [0, 4294967295], fixed32: [0, 4294967295] };
const INT64 = new Set(['int64', 'sint64', 'sfixed64', 'uint64', 'fixed64']);
function checkScalar(f, v, path) {
  const t = f.type;
  if (v === null) return v;
  if (t === 'string') { if (typeof v !== 'string') throw new FieldError(path, `esperado texto (string), veio ${typeof v === 'object' ? (Array.isArray(v) ? 'lista' : 'objeto') : typeof v} ${JSON.stringify(v)}`); return v; }
  if (t === 'bool') { if (typeof v !== 'boolean') throw new FieldError(path, `esperado true/false, veio ${JSON.stringify(v)}`); return v; }
  if (t === 'bytes') { if (typeof v !== 'string' || !/^[A-Za-z0-9+/_-]*=*$/.test(v)) throw new FieldError(path, 'esperado base64'); return v; }
  if (t === 'double' || t === 'float') { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; if (typeof n !== 'number' || (Number.isNaN(n) && v !== 'NaN')) throw new FieldError(path, `esperado número, veio ${JSON.stringify(v)}`); return n; }
  if (INT_RANGES[t]) {
    const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new FieldError(path, `esperado inteiro (${t}), veio ${JSON.stringify(v)}`);
    const [lo, hi] = INT_RANGES[t]; if (n < lo || n > hi) throw new FieldError(path, `${n} fora do intervalo de ${t} (${lo}..${hi})`);
    return n;
  }
  if (INT64.has(t)) {
    const sv = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : null) : typeof v === 'string' ? v.trim() : null;
    if (sv === null || !/^-?\d+$/.test(sv)) throw new FieldError(path, `esperado inteiro de 64 bits (${t}), veio ${JSON.stringify(v)}`);
    if (t.startsWith('u') || t === 'fixed64') { if (sv.startsWith('-') || BigInt(sv) > 18446744073709551615n) throw new FieldError(path, `fora do intervalo de ${t}`); }
    else if (BigInt(sv) > 9223372036854775807n || BigInt(sv) < -9223372036854775808n) throw new FieldError(path, `fora do intervalo de ${t}`);
    return sv;
  }
  return v;
}

function prepare(type, json, registry, path) {
  if (json === null || json === undefined) return json;
  const w = wktFromJson(type.fullName, json, path, registry);
  if (w !== undefined) return w;
  if (typeof json !== 'object' || Array.isArray(json)) throw new FieldError(path, `esperado objeto ${type.name}, veio ${Array.isArray(json) ? 'lista' : typeof json}`);
  const out = {};
  for (const [k, v] of Object.entries(json)) {
    const f = findField(type, k);
    if (!f) throw new FieldError(`${path}.${k}`, `campo não existe em ${type.name}. Campos válidos: ${type.fieldsArray.map((x) => x.name).join(', ')}`);
    f.resolve();
    const rt = f.resolvedType;
    const conv = (val, p) => {
      if (rt instanceof protobuf.Type) return prepare(rt, val, registry, p);
      if (rt instanceof protobuf.Enum) {
        if (typeof val === 'string' && !(val in rt.values)) throw new FieldError(p, `valor de enum inválido "${val}". Válidos: ${Object.keys(rt.values).join(', ')}`);
        if (typeof val === 'number' && !Object.values(rt.values).includes(val) && rt.syntaxType !== 'open') return val;
        if (typeof val !== 'string' && typeof val !== 'number') throw new FieldError(p, `esperado nome do enum (${Object.keys(rt.values).join(', ')})`);
        return val;
      }
      return checkScalar(f, val, p);
    };
    if (f.partOf && v !== null && v !== undefined) {
      const other = f.partOf.oneof.find((n) => n !== f.name && json[n] !== undefined && json[n] !== null) || f.partOf.oneof.map((n) => [n, type.fields[n]]).find(([n, ff]) => n !== f.name && ff && Object.keys(json).some((jk) => jk !== k && findField(type, jk) === ff))?.[0];
      if (other) throw new FieldError(`${path}.${k}`, `"${f.name}" e "${other}" fazem parte do mesmo oneof "${f.partOf.name}": envie só um`);
    }
    if (f.map) { const m = {}; for (const [mk, mv] of Object.entries(v || {})) m[mk] = conv(mv, `${path}.${k}["${mk}"]`); out[f.name] = m; }
    else if (isMapEntry(f)) {
      const vf = rt.fields.value; vf.resolve(); const vt = vf.resolvedType;
      const list = Array.isArray(v) ? v : Object.entries(v || {}).map(([key, value]) => ({ key, value }));
      out[f.name] = list.map((e) => ({ key: e.key, value: vt instanceof protobuf.Type ? prepare(vt, e.value, registry, `${path}.${k}["${e.key}"]`) : e.value }));
    }
    else if (f.repeated) { if (!Array.isArray(v)) throw new FieldError(`${path}.${k}`, 'esperada uma lista'); out[f.name] = v.map((x, i) => conv(x, `${path}.${k}[${i}]`)); }
    else { if (Array.isArray(v) && !(rt && ['.google.protobuf.ListValue', '.google.protobuf.Value'].includes(rt.fullName))) throw new FieldError(`${path}.${k}`, 'campo não é repeated: não aceita lista'); out[f.name] = conv(v, `${path}.${k}`); }
  }
  return out;
}

/** JSON (objeto ou texto) → mensagem protobufjs, com erro claro se um campo não existir. */
function jsonToMessage(type, json, registry, path = '$') {
  let obj = json;
  if (typeof json === 'string') { const t = json.trim(); obj = t ? JSON.parse(t) : {}; }
  const prepared = prepare(type, obj || {}, registry, path);
  const err = type.verify(prepared);
  const msg = type.fromObject(prepared);
  if (err && !/(nanos|seconds|value)/.test(err)) { /* verify é estrito com longs em string; fromObject converte */ }
  return msg;
}

// ---------------- mensagem → JSON ----------------
function wktToJson(name, o, registry) {
  switch (name) {
    case '.google.protobuf.Timestamp': {
      const s = Number(o.seconds || 0); const n = Number(o.nanos || 0);
      const iso = new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, '');
      return n ? `${iso}.${String(n).padStart(9, '0').replace(/0+$/, '')}Z` : `${iso}Z`;
    }
    case '.google.protobuf.Duration': { const s = Number(o.seconds || 0); const n = Number(o.nanos || 0); return n ? `${s + n / 1e9}s` : `${s}s`; }
    case '.google.protobuf.FieldMask': return (o.paths || []).map(camel).join(',');
    case '.google.protobuf.Struct': return structToJson(o);
    case '.google.protobuf.Value': return valueToJson(o);
    case '.google.protobuf.ListValue': return (o.values || []).map(valueToJson);
    case '.google.protobuf.Empty': return {};
    case '.google.protobuf.Any': {
      const typeName = String(o.type_url || o.typeUrl || '').split('/').pop();
      const t = lookupType(registry, '.' + typeName);
      if (!t) return { '@type': o.type_url || o.typeUrl, value: Buffer.from(o.value || []).toString('base64') };
      const inner = messageToJson(t, t.decode(o.value), registry);
      return (WRAPPERS.has(t.fullName) || ['.google.protobuf.Timestamp', '.google.protobuf.Duration', '.google.protobuf.Struct', '.google.protobuf.Value', '.google.protobuf.FieldMask'].includes(t.fullName))
        ? { '@type': o.type_url || o.typeUrl, value: inner } : { '@type': o.type_url || o.typeUrl, ...inner };
    }
    default:
      if (WRAPPERS.has(name)) return o.value === undefined ? null : o.value;
      return undefined;
  }
}
function valueToJson(v) {
  if (!v) return null;
  const g = (a, b) => (v[a] !== undefined ? v[a] : v[b]);
  if (g('structValue', 'struct_value')) return structToJson(g('structValue', 'struct_value'));
  if (g('listValue', 'list_value')) return (g('listValue', 'list_value').values || []).map(valueToJson);
  if (g('stringValue', 'string_value') !== undefined) return g('stringValue', 'string_value');
  if (g('numberValue', 'number_value') !== undefined) return g('numberValue', 'number_value');
  if (g('boolValue', 'bool_value') !== undefined) return g('boolValue', 'bool_value');
  return null;
}
function structToJson(s) { const o = {}; for (const [k, v] of Object.entries((s && s.fields) || {})) o[k] = valueToJson(v); return o; }

function post(type, obj, registry) {
  if (obj === null || obj === undefined) return obj;
  const w = wktToJson(type.fullName, obj, registry);
  if (w !== undefined) return w;
  const out = {};
  for (const f of type.fieldsArray) {
    if (!(f.name in obj)) continue;
    f.resolve(); const rt = f.resolvedType; const v = obj[f.name];
    const conv = (x) => (rt instanceof protobuf.Type ? post(rt, x, registry) : x);
    if (f.map) { const m = {}; for (const [k, x] of Object.entries(v || {})) m[k] = conv(x); out[f.name] = m; }
    else if (isMapEntry(f)) { const vf = rt.fields.value; vf.resolve(); const vt = vf.resolvedType; const m = {}; for (const e of v || []) m[e.key] = vt instanceof protobuf.Type ? post(vt, e.value, registry) : e.value; out[f.name] = m; }
    else if (f.repeated) out[f.name] = (v || []).map(conv);
    else out[f.name] = conv(v);
  }
  // oneof virtual (protobufjs põe o nome do caso escolhido)
  for (const o of type.oneofsArray || []) if (obj[o.name] !== undefined && !(o.name in out) && type.fields[o.name] === undefined) { /* não expor */ }
  return out;
}

/** mensagem protobufjs → JSON (int64 como texto, enums por nome, bytes em base64). */
function messageToJson(type, msg, registry, { defaults = false } = {}) {
  const obj = type.toObject(msg, { longs: String, enums: String, bytes: String, defaults, arrays: defaults, objects: defaults, oneofs: false });
  return post(type, obj, registry);
}

module.exports = { jsonToMessage, messageToJson, FieldError, WRAPPERS, lookupType, isMapEntry };
