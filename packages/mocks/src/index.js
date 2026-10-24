'use strict';
const { ensureCerts } = require('./certs');
const { startHttp, TOKEN, API_KEY, USERS } = require('./http');
const { startGrpc, PROTO_DIR, PROTO_FILE } = require('./grpc');

/**
 * Sobe todos os mocks. ports = 0 → portas livres aleatórias (testes).
 * Portas fixas padrão (npm run mocks): HTTP 4010, HTTPS 4443, HTTPS mTLS 4444, gRPC 50051, gRPC TLS 50052, gRPC mTLS 50053.
 */
async function startAll({ fixed = false, certDir } = {}) {
  const certs = ensureCerts(certDir);
  const httpS = await startHttp({ port: fixed ? 4010 : 0, httpsPort: fixed ? 4443 : 0, mtlsPort: fixed ? 4444 : 0, certs });
  const grpcS = await startGrpc({ port: fixed ? 50051 : 0, tlsPort: fixed ? 50052 : 0, mtlsPort: fixed ? 50053 : 0, certs });
  return {
    certs,
    urls: {
      http: `http://127.0.0.1:${httpS.http}`,
      https: `https://localhost:${httpS.https}`,
      mtls: `https://localhost:${httpS.mtls}`,
      grpc: `127.0.0.1:${grpcS.plain}`,
      grpcTls: `localhost:${grpcS.tls}`,
      grpcMtls: `localhost:${grpcS.mtls}`,
      grpcNoReflection: `127.0.0.1:${grpcS.noReflection}`,
    },
    secrets: { token: TOKEN, apiKey: API_KEY, basic: USERS.basic, oauth: { clientId: 'jaiminho-app', clientSecret: 'segredo' } },
    proto: { dir: PROTO_DIR, file: PROTO_FILE },
    close: async () => { grpcS.forceClose(); await httpS.close(); },
  };
}

module.exports = { startAll, ensureCerts };
