'use strict';
// Mock gRPC: 4 tipos de chamada, reflection (v1 e v1alpha), erros com grpc-status-details-bin, deadline, metadata/auth, TLS e mTLS.
const path = require('path');
const fs = require('fs');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { ReflectionService } = require('@grpc/reflection');
const protobuf = require('protobufjs');

const PROTO_DIR = path.join(__dirname, '..', 'protos');
const PROTO_FILE = 'jaiminho/mock/v1/traveller.proto';
const TOKEN = 'jaiminho-token';

// google.rpc.Status + BadRequest para grpc-status-details-bin
const rpcRoot = protobuf.Root.fromJSON({
  nested: {
    google: { nested: {
      protobuf: { nested: { Any: { fields: { type_url: { type: 'string', id: 1 }, value: { type: 'bytes', id: 2 } } } } },
      rpc: { nested: {
        Status: { fields: { code: { type: 'int32', id: 1 }, message: { type: 'string', id: 2 }, details: { rule: 'repeated', type: 'google.protobuf.Any', id: 3 } } },
        BadRequest: { fields: { field_violations: { rule: 'repeated', type: 'FieldViolation', id: 1 } }, nested: { FieldViolation: { fields: { field: { type: 'string', id: 1 }, description: { type: 'string', id: 2 } } } } },
        ErrorInfo: { fields: { reason: { type: 'string', id: 1 }, domain: { type: 'string', id: 2 }, metadata: { keyType: 'string', type: 'string', id: 3 } } },
      } },
    } },
  },
});

function statusDetails(code, message) {
  const BadRequest = rpcRoot.lookupType('google.rpc.BadRequest');
  const ErrorInfo = rpcRoot.lookupType('google.rpc.ErrorInfo');
  const Status = rpcRoot.lookupType('google.rpc.Status');
  const br = BadRequest.encode(BadRequest.create({ field_violations: [{ field: 'id', description: 'id precisa ser numérico' }] })).finish();
  const ei = ErrorInfo.encode(ErrorInfo.create({ reason: 'MOCK_FAILURE', domain: 'jaiminho.local', metadata: { tentativa: '1' } })).finish();
  return Buffer.from(Status.encode(Status.create({
    code, message,
    details: [{ type_url: 'type.googleapis.com/google.rpc.BadRequest', value: br }, { type_url: 'type.googleapis.com/google.rpc.ErrorInfo', value: ei }],
  })).finish());
}

const now = () => ({ seconds: Math.floor(Date.now() / 1000), nanos: 0 });
const DATA = [
  { id: '1', first_name: 'Jaime', last_name: 'Palillo', nationality: 'MX', email: 'jaime@correio.mx', tags: { vip: 'sim' }, documents: [{ type: 'PASSPORT', number: 'P123', issuing_country: 'MX', expires_at: now() }], created_at: now() },
  { id: '2', first_name: 'Ana', last_name: 'Silva', nationality: 'PT', phone: '+351900000000', tags: {}, documents: [], created_at: now() },
  { id: '3', first_name: 'Lucas', last_name: 'Santos', nationality: 'BR', email: 'lucas@exemplo.br', tags: {}, documents: [], created_at: now() },
];

function loadDefinition() {
  return protoLoader.loadSync(PROTO_FILE, { includeDirs: [PROTO_DIR], keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
}

function echoMetadata(call) {
  const md = {};
  for (const [k, v] of Object.entries(call.metadata.getMap())) md[k] = Buffer.isBuffer(v) ? v.toString('base64') : String(v);
  return md;
}

function impl() {
  return {
    GetTraveller(call, cb) {
      const t = DATA.find((d) => d.id === call.request.id);
      const trailer = new grpc.Metadata(); trailer.set('x-mock', 'jaiminho');
      call.sendMetadata(Object.assign(new grpc.Metadata(), (() => { const m = new grpc.Metadata(); m.set('x-request-echo', call.request.id || ''); return m; })()));
      if (!t) return cb({ code: grpc.status.NOT_FOUND, details: `viajante ${call.request.id} não encontrado` }, null, trailer);
      cb(null, t, trailer);
    },
    ListTravellers(call) {
      const { limit, nationality } = call.request;
      let list = DATA.flatMap((d, i) => [d, { ...d, id: `${d.id}-${i}b` }]);
      if (nationality) list = list.filter((d) => d.nationality === nationality);
      if (limit && limit > list.length && list.length) list = Array.from({ length: limit }, (_, k) => ({ ...list[k % list.length], id: `${list[k % list.length].id}#${k}` })); // rajada p/ teste de performance
      else if (limit) list = list.slice(0, limit);
      const burst = list.length > 100;
      let i = 0;
      const tick = () => {
        if (call.cancelled) return;
        if (i >= list.length) return call.end();
        if (burst) { for (let n = 0; n < 200 && i < list.length; n++) call.write(list[i++]); setImmediate(tick); return; }
        call.write(list[i++]); setTimeout(tick, 20);
      };
      tick();
    },
    UploadTravellers(call, cb) {
      const ids = [];
      call.on('data', (t) => ids.push(t.id || `novo-${ids.length + 1}`));
      call.on('end', () => cb(null, { received: ids.length, ids }));
      call.on('error', () => {});
    },
    Chat(call) {
      let seq = 0;
      call.on('data', (m) => call.write({ from: 'jaiminho', text: `recebi: ${m.text}`, seq: ++seq }));
      call.on('end', () => { call.write({ from: 'jaiminho', text: 'tchau', seq: ++seq }); call.end(); });
      call.on('error', () => {});
    },
    Fail(call, cb) {
      const code = call.request.code || grpc.status.INVALID_ARGUMENT;
      const message = call.request.message || 'falha simulada';
      const md = new grpc.Metadata();
      md.set('grpc-status-details-bin', statusDetails(code, message));
      cb({ code, details: message, metadata: md });
    },
    Slow(call, cb) { const t = setTimeout(() => cb(null, DATA[0]), call.request.delay_ms || 2000); call.on('cancelled', () => clearTimeout(t)); },
    Whoami(call, cb) {
      const auth = call.metadata.get('authorization')[0];
      if (auth !== `Bearer ${TOKEN}`) return cb({ code: grpc.status.UNAUTHENTICATED, details: 'token ausente ou inválido' });
      const peer = call.getPeer();
      cb(null, { user: 'jaiminho', metadata: { ...echoMetadata(call), peer } });
    },
  };
}

function bind(server, port, creds) {
  return new Promise((resolve, reject) => server.bindAsync(`127.0.0.1:${port}`, creds, (err, p) => (err ? reject(err) : resolve(p))));
}

async function startGrpc({ port = 0, certs, tlsPort = 0, mtlsPort = 0, reflection = true } = {}) {
  const def = loadDefinition();
  const proto = grpc.loadPackageDefinition(def);
  const svc = proto.jaiminho.mock.v1.TravellerService.service;
  const make = () => {
    const s = new grpc.Server();
    s.addService(svc, impl());
    if (reflection) new ReflectionService(def).addToServer(s);
    return s;
  };
  const servers = [];
  const out = {};
  const s1 = make(); servers.push(s1); out.plain = await bind(s1, port, grpc.ServerCredentials.createInsecure());
  if (certs) {
    const key = fs.readFileSync(certs.serverKey); const cert = fs.readFileSync(certs.serverCert);
    const s2 = make(); servers.push(s2); out.tls = await bind(s2, tlsPort, grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false));
    const s3 = make(); servers.push(s3); out.mtls = await bind(s3, mtlsPort, grpc.ServerCredentials.createSsl(fs.readFileSync(certs.ca), [{ private_key: key, cert_chain: cert }], true));
  }
  // servidor sem reflection (para testar .proto/protoset)
  const def2 = def; const s4 = new grpc.Server(); s4.addService(grpc.loadPackageDefinition(def2).jaiminho.mock.v1.TravellerService.service, impl());
  servers.push(s4); out.noReflection = await bind(s4, 0, grpc.ServerCredentials.createInsecure());
  out.close = () => Promise.all(servers.map((s) => new Promise((r) => s.tryShutdown(() => r()))));
  out.forceClose = () => servers.forEach((s) => s.forceShutdown());
  return out;
}

module.exports = { startGrpc, PROTO_DIR, PROTO_FILE, TOKEN };
