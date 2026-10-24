'use strict';
// Workspace de exemplo: tudo apontando para os servidores mock (REST, SOAP, gRPC, TLS, mTLS, Swagger).
const fs = require('fs');
const path = require('path');

async function createExample(E, dir, mocks, opts = {}) {
  const ws = E.Workspace.create(dir, 'Exemplo — mocks do Jaiminho', opts);
  const u = mocks.urls;
  const port = (x) => x.split(':').pop();
  // certificados para HTTPS e gRPC TLS/mTLS
  const certDir = path.join(ws.dir, 'certs'); fs.mkdirSync(certDir, { recursive: true });
  for (const k of ['ca', 'clientCert', 'clientKey', 'clientP12']) fs.copyFileSync(mocks.certs[k], path.join(certDir, path.basename(mocks.certs[k])));
  ws.saveSettings({
    caCertificates: ['certs/ca.crt'],
    certificates: [
      { id: 'mtls-http', name: 'Mock HTTPS mTLS (PEM)', host: `localhost:${port(u.mtls)}`, cert: 'certs/client.crt', key: 'certs/client.key' },
      { id: 'mtls-grpc', name: 'Mock gRPC mTLS (.p12)', host: `localhost:${port(u.grpcMtls)}`, pfx: 'certs/client.p12' },
    ],
  });
  ws.setSecret('cert:mtls-grpc:passphrase', mocks.certs.p12Password);
  // proto do mock no workspace
  const protoDest = path.join(ws.dir, 'protos');
  const copyDir = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) { const s = path.join(src, f); const d = path.join(dst, f); if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d); } };
  copyDir(mocks.proto.dir, protoDest);

  const env = ws.saveEnvironment({ name: 'Mocks locais', color: '#68A048', vars: [
    { key: 'baseUrl', value: u.http }, { key: 'httpsUrl', value: u.https }, { key: 'mtlsUrl', value: u.mtls },
    { key: 'grpcHost', value: u.grpc }, { key: 'grpcTlsHost', value: u.grpcTls }, { key: 'grpcMtlsHost', value: u.grpcMtls }, { key: 'grpcNoReflection', value: u.grpcNoReflection },
    { key: 'id', value: '1' }, { key: 'grpcId', value: '1' }, { key: 'token', value: mocks.secrets.token, secret: true }, { key: 'apiKey', value: mocks.secrets.apiKey, secret: true },
  ] });
  ws.saveGlobals([{ key: 'usuario', value: 'jaiminho' }]);

  // ---------------- REST ----------------
  const rest = ws.createCollection('1. REST / JSON', { description: 'CRUD, auth, cookies, redirects, upload. Use o ambiente "Mocks locais".', auth: { type: 'bearer', bearer: { token: '{{token}}' } } });
  const crud = ws.createFolder(rest, 'Viajantes (CRUD)');
  ws.createRequest(crud, { name: 'Listar viajantes', url: '{{baseUrl}}/api/travellers', params: [{ key: 'nationality', value: 'PT', enabled: false }, { key: 'limit', value: '10' }], scripts: { post: 'pm.test("200 OK", () => pm.response.to.have.status(200));\npm.test("é uma lista", () => pm.expect(pm.response.json()).to.be.an("array"));' } });
  ws.createRequest(crud, { name: 'Criar viajante', method: 'POST', url: '{{baseUrl}}/api/travellers', headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', language: 'json', raw: '{\n  "firstName": "Ana",\n  "lastName": "Lima",\n  "nationality": "PT",\n  "email": "{{$randomEmail}}"\n}' }, scripts: { post: 'pm.test("201 criado", () => pm.response.to.have.status(201));\npm.environment.set("id", pm.response.json().id);' } });
  ws.createRequest(crud, { name: 'Buscar viajante por id', url: '{{baseUrl}}/api/travellers/:id', pathVars: [{ key: 'id', value: '{{id}}' }], scripts: { post: 'pm.test("200", () => pm.response.to.have.status(200));' } });
  ws.createRequest(crud, { name: 'Atualizar e-mail (PATCH)', method: 'PATCH', url: '{{baseUrl}}/api/travellers/{{id}}', headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', language: 'json', raw: '{ "email": "novo@exemplo.pt" }' } });
  ws.createRequest(crud, { name: 'Apagar viajante', method: 'DELETE', url: '{{baseUrl}}/api/travellers/{{id}}' });
  const auth = ws.createFolder(rest, 'Autenticação');
  ws.createRequest(auth, { name: 'Basic', url: '{{baseUrl}}/auth/basic', auth: { type: 'basic', basic: { username: 'jaiminho', password: 'carteiro' } } });
  ws.createRequest(auth, { name: 'Bearer (herdado da coleção)', url: '{{baseUrl}}/auth/bearer' });
  ws.createRequest(auth, { name: 'API Key', url: '{{baseUrl}}/auth/apikey', auth: { type: 'apikey', apikey: { key: 'x-api-key', value: '{{apiKey}}', in: 'header' } } });
  ws.createRequest(auth, { name: 'Digest', url: '{{baseUrl}}/auth/digest', auth: { type: 'digest', digest: { username: 'jaiminho', password: 'carteiro', algorithm: 'MD5' } } });
  ws.createRequest(auth, { name: 'OAuth2 token (client credentials)', method: 'POST', url: '{{baseUrl}}/oauth/token', auth: { type: 'none' }, body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client_credentials' }, { key: 'client_id', value: 'jaiminho-app' }, { key: 'client_secret', value: 'segredo' }] }, scripts: { post: 'pm.environment.set("token", pm.response.json().access_token);' } });
  const util = ws.createFolder(rest, 'Utilidades');
  ws.createRequest(util, { name: 'Eco (vê o que foi enviado)', method: 'POST', url: '{{baseUrl}}/echo', params: [{ key: 'usuario', value: '{{usuario}}' }, { key: 'uuid', value: '{{$guid}}' }], headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', language: 'json', raw: '{ "ts": "{{$isoTimestamp}}" }' } });
  ws.createRequest(util, { name: 'Form-data', method: 'POST', url: '{{baseUrl}}/echo', body: { mode: 'formdata', formdata: [{ key: 'nome', value: 'Jaiminho', type: 'text' }] } });
  ws.createRequest(util, { name: 'Gravar cookie', url: '{{baseUrl}}/cookies/set', params: [{ key: 'sessao', value: 'abc123' }] });
  ws.createRequest(util, { name: 'Ler cookies', url: '{{baseUrl}}/cookies' });
  ws.createRequest(util, { name: 'Redirect (2 saltos)', url: '{{baseUrl}}/redirect/2' });
  ws.createRequest(util, { name: 'Lento (2 s)', url: '{{baseUrl}}/delay/2000' });
  ws.createRequest(util, { name: 'Erro 500', url: '{{baseUrl}}/status/500' });
  ws.createRequest(util, { name: 'XML simples', url: '{{baseUrl}}/xml/traveller', params: [{ key: 'id', value: '1' }] });

  // ---------------- TLS ----------------
  const tls = ws.createCollection('2. HTTPS, SSL e mTLS', { description: 'A CA do mock está em Configurações → Certificados. Tire-a para ver o erro; ou desligue a verificação SSL.' });
  ws.createRequest(tls, { name: 'HTTPS com CA própria', url: '{{httpsUrl}}/api/health' });
  ws.createRequest(tls, { name: 'HTTPS com verificação SSL desligada', url: '{{httpsUrl}}/api/health', settings: { verifySsl: false } });
  ws.createRequest(tls, { name: 'mTLS (certificado de cliente PEM)', url: '{{mtlsUrl}}/api/health' });

  // ---------------- SOAP ----------------
  const soapMod = require('@jaiminho/mocks/src/soap');
  E.wsdl.importWsdl(ws, soapMod.wsdl(u.http), { name: '3. SOAP / XML (WSDL)', sourceUrl: `${u.http}/soap/TravellerService?wsdl` });

  // ---------------- gRPC ----------------
  const g = ws.createCollection('4. gRPC', { description: 'Reflection, .proto, streaming, erros, TLS e mTLS.' });
  const SVC = 'jaiminho.mock.v1.TravellerService';
  const grpcReq = (name, method, message, extra = {}) => ({ kind: 'grpc', name, url: `grpc://{{grpcHost}}`, grpc: { method: `${SVC}/${method}`, schema: { source: 'reflection' }, metadata: [{ key: 'authorization', value: 'Bearer {{token}}' }], message, options: {}, ...extra.grpc }, scripts: extra.scripts, ...(extra.url ? { url: extra.url } : {}) });
  const gr = ws.createFolder(g, 'Reflection (4 tipos)');
  ws.createRequest(gr, grpcReq('GetTraveller (unário)', 'GetTraveller', '{\n  "id": "{{grpcId}}"\n}', { scripts: { afterResponse: 'pm.test("OK", () => pm.expect(pm.response.statusCode).to.eql(0));\npm.environment.set("nome", pm.response.messages.all()[0].data.first_name);' } }));
  ws.createRequest(gr, grpcReq('ListTravellers (server streaming)', 'ListTravellers', '{\n  "limit": 5\n}'));
  ws.createRequest(gr, grpcReq('UploadTravellers (client streaming)', 'UploadTravellers', '{\n  "id": "novo-1",\n  "first_name": "Ana"\n}'));
  ws.createRequest(gr, grpcReq('Chat (bidi)', 'Chat', '{\n  "text": "olá, Jaiminho"\n}'));
  ws.createRequest(gr, grpcReq('Fail (erro com detalhes)', 'Fail', '{\n  "code": 3,\n  "message": "id inválido"\n}'));
  ws.createRequest(gr, grpcReq('Slow (deadline 500 ms)', 'Slow', '{\n  "delay_ms": 2000\n}', { grpc: { options: { deadlineMs: 500 } } }));
  ws.createRequest(gr, grpcReq('Whoami (metadata com token)', 'Whoami', '{}'));
  const gp = ws.createFolder(g, 'Sem reflection (.proto)');
  ws.createRequest(gp, grpcReq('GetTraveller via .proto', 'GetTraveller', '{ "id": "2" }', { url: 'grpc://{{grpcNoReflection}}', grpc: { schema: { source: 'proto', files: ['protos/jaiminho/mock/v1/traveller.proto'], importPaths: ['protos'] } } }));
  const gt = ws.createFolder(g, 'TLS e mTLS');
  ws.createRequest(gt, grpcReq('TLS com CA própria', 'GetTraveller', '{ "id": "1" }', { url: 'grpcs://{{grpcTlsHost}}' }));
  ws.createRequest(gt, grpcReq('TLS com verificação desligada', 'GetTraveller', '{ "id": "1" }', { url: 'grpcs://{{grpcTlsHost}}', grpc: { tls: { verifySsl: false } } }));
  ws.createRequest(gt, grpcReq('mTLS (.p12 com senha)', 'Whoami', '{}', { url: 'grpcs://{{grpcMtlsHost}}' }));

  // ---------------- Swagger ----------------
  const specs = require('@jaiminho/mocks/src/specs');
  await E.openapi.importOpenApi(ws, { text: JSON.stringify(specs.openapi3(u.http)) }, { name: '5. Importado do Swagger' });
  const sw = [...ws.index].find(([id, n]) => n.type === 'collection' && ws.get(id).name === '5. Importado do Swagger');
  if (sw) ws.save(sw[0], { ...ws.get(sw[0]), origin: { ...ws.get(sw[0]).origin, url: `${u.http}/v3/api-docs` } });
  return { dir: ws.dir, environmentId: env };
}

module.exports = { createExample };
