#!/usr/bin/env node
'use strict';
// npm run mocks → sobe todos os servidores mock em portas fixas.
const { startAll } = require('./index');

startAll({ fixed: true }).then((m) => {
  const u = m.urls;
  console.log(`
  ✉  Jaiminho — servidores mock
  ───────────────────────────────────────────────────────────
  REST/JSON, XML, SOAP, OpenAPI   ${u.http}
     Swagger (OpenAPI 3)          ${u.http}/v3/api-docs
     Swagger UI (springdoc)       ${u.http}/swagger-ui/index.html
     Swagger 2.0                  ${u.http}/v2/swagger.json
     WSDL                         ${u.http}/soap/TravellerService?wsdl
  HTTPS (certificado de CA própria) ${u.https}
  HTTPS mTLS (exige cert cliente) ${u.mtls}
  gRPC (reflection)               ${u.grpc}
  gRPC TLS                        ${u.grpcTls}
  gRPC mTLS                       ${u.grpcMtls}
  gRPC sem reflection             ${u.grpcNoReflection}
  ───────────────────────────────────────────────────────────
  Certificados (CA, cliente PEM e .p12 senha "${m.certs.p12Password}"): ${m.certs.dir}
  Protos: ${m.proto.dir}
  Token: ${m.secrets.token} · API key: ${m.secrets.apiKey} · Basic/Digest: ${m.secrets.basic.join(' / ')}
  OAuth2: client_id=jaiminho-app client_secret=segredo (token em /oauth/token)
`);
}).catch((e) => { console.error(e); process.exit(1); });
