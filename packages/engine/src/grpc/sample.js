'use strict';
// Gera uma mensagem JSON de exemplo a partir do tipo protobuf (para o editor da request gRPC).
const protobuf = require('protobufjs');
const { isMapEntry } = require('./json');

const SCALAR = {
  double: 1.5, float: 1.5, int32: 1, int64: '1', uint32: 1, uint64: '1', sint32: 1, sint64: '1',
  fixed32: 1, fixed64: '1', sfixed32: 1, sfixed64: '1', bool: true, string: 'texto', bytes: 'AQID',
};

function byName(name, type) {
  const n = name.toLowerCase();
  if (type !== 'string') return undefined;
  if (n === 'id' || n.endsWith('_id') || n.endsWith('id')) return '1';
  if (n.includes('email')) return 'jaiminho@correio.mx';
  if (n.includes('phone') || n.includes('telefone')) return '+351900000000';
  if (n.includes('first_name') || n === 'name' || n.includes('nome')) return 'Jaime';
  if (n.includes('last_name')) return 'Palillo';
  if (n.includes('country') || n.includes('nationality')) return 'PT';
  if (n.includes('url')) return 'https://exemplo.local';
  if (n.includes('date')) return '2026-01-01';
  return 'texto';
}

function wkt(name) {
  switch (name) {
    case '.google.protobuf.Timestamp': return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    case '.google.protobuf.Duration': return '1s';
    case '.google.protobuf.Struct': return { chave: 'valor' };
    case '.google.protobuf.Value': return 'valor';
    case '.google.protobuf.ListValue': return ['valor'];
    case '.google.protobuf.Empty': return {};
    case '.google.protobuf.FieldMask': return 'campo';
    case '.google.protobuf.Any': return { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: 'texto' };
    case '.google.protobuf.StringValue': return 'texto';
    case '.google.protobuf.BoolValue': return true;
    case '.google.protobuf.Int32Value': case '.google.protobuf.UInt32Value': return 1;
    case '.google.protobuf.Int64Value': case '.google.protobuf.UInt64Value': return '1';
    case '.google.protobuf.DoubleValue': case '.google.protobuf.FloatValue': return 1.5;
    case '.google.protobuf.BytesValue': return 'AQID';
    default: return undefined;
  }
}

function sample(type, depth = 0, seen = new Set()) {
  const w = wkt(type.fullName); if (w !== undefined) return w;
  if (depth > 3 || seen.has(type.fullName)) return {};
  const s2 = new Set(seen); s2.add(type.fullName);
  const out = {};
  const usedOneofs = new Set();
  for (const f of type.fieldsArray) {
    f.resolve();
    if (f.partOf) { if (usedOneofs.has(f.partOf.name)) continue; usedOneofs.add(f.partOf.name); }
    let v;
    const rt = f.resolvedType;
    if (rt instanceof protobuf.Enum) { const names = Object.keys(rt.values); v = names.find((n) => rt.values[n] !== 0) || names[0]; }
    else if (rt instanceof protobuf.Type) v = sample(rt, depth + 1, s2);
    else v = byName(f.name, f.type) ?? SCALAR[f.type];
    if (f.map) out[f.name] = { chave: v };
    else if (isMapEntry(f)) { const vf = rt.fields.value; vf.resolve(); const vt = vf.resolvedType; out[f.name] = { chave: vt instanceof protobuf.Type ? sample(vt, depth + 1, s2) : (byName('value', vf.type) ?? SCALAR[vf.type]) }; }
    else if (f.repeated) out[f.name] = [v];
    else out[f.name] = v;
  }
  return out;
}

module.exports = { sample };
