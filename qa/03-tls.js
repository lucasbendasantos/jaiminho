'use strict';
// QA: TLS HTTP e gRPC (SSL off global/por request, CA própria, mTLS PEM/P12, senha errada, host errado, CA errada).
const fs = require('fs');
const path = require('path');
const { J, check, finish, getMocks, tmpWs, bodyJson } = require('./lib');

(async () => {
  const m = await getMocks();
  const C = m.certs;
  const httpsPort = m.urls.https.split(':').pop();
  const mtlsPort = m.urls.mtls.split(':').pop();
  const get = (ws, url, settings = {}) => J.send(ws, { request: J.model.newRequest({ url, settings }) });

  await check('tls', 'HTTPS com CA desconhecida falha com mensagem clara', async () => {
    const ws = tmpWs(); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: !r.ok && /CA|certificado|autoassinado/i.test(r.error), evidence: r.error };
  });
  await check('tls', 'SSL off global (workspace) aceita', async () => {
    const ws = tmpWs(); ws.saveSettings({ verifySsl: false }); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: r.ok && r.response.code === 200, evidence: r.error || r.response.code };
  });
  await check('tls', 'SSL off por request aceita (global ligado)', async () => {
    const ws = tmpWs(); const r = await get(ws, `${m.urls.https}/echo`, { verifySsl: false });
    return { pass: r.ok, evidence: r.error || r.response.code };
  });
  await check('tls', 'SSL ON por request vence SSL off global', async () => {
    const ws = tmpWs(); ws.saveSettings({ verifySsl: false }); const r = await get(ws, `${m.urls.https}/echo`, { verifySsl: true });
    return { pass: !r.ok, evidence: r.error || r.response.code };
  });
  await check('tls', 'CA própria do workspace (caminho absoluto)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: r.ok, evidence: r.error || r.response.code };
  });
  await check('tls', 'CA própria com caminho RELATIVO ao workspace (partilhável)', async () => {
    const ws = tmpWs(); fs.mkdirSync(path.join(ws.dir, 'certs')); fs.copyFileSync(C.ca, path.join(ws.dir, 'certs', 'ca.crt'));
    ws.saveSettings({ caCertificates: ['certs/ca.crt'] }); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: r.ok, evidence: r.error || r.response.code };
  });
  await check('tls', 'CA errada continua falhando', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.otherCa] }); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: !r.ok, evidence: r.error };
  });
  await check('tls', 'Host não bate com certificado (127.0.0.1 está no SAN; usa 127.0.0.2? informativo)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); const r = await get(ws, `https://127.0.0.1:${httpsPort}/echo`);
    return { pass: r.ok, evidence: `127.0.0.1 (no SAN) ok=${r.ok} ${r.error || ''}` };
  });
  await check('tls', 'CA do workspace com caminho inexistente: avisa (não silencia)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: ['nao/existe.crt'] }); const r = await get(ws, `${m.urls.https}/echo`);
    return { pass: !r.ok && /existe|não encontrado|nao\/existe/i.test(r.error || ''), evidence: `ok=${r.ok} error=${r.error}` };
  });
  // mTLS
  await check('mtls', 'Sem certificado de cliente → mensagem pede mTLS', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: !r.ok && /mTLS|certificado de cliente|ECONNRESET|encerrada/i.test(r.error), evidence: r.error };
  });
  await check('mtls', 'mTLS PEM com host:porta', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: `localhost:${mtlsPort}`, cert: C.clientCert, key: C.clientKey }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: r.ok && bodyJson(r).clientCert === 'jaiminho-client', evidence: r.error || bodyJson(r).clientCert };
  });
  await check('mtls', 'mTLS PEM com host SEM porta (como no Postman, vale p/ qualquer porta?)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: 'localhost', cert: C.clientCert, key: C.clientKey }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: r.ok, evidence: r.error || bodyJson(r).clientCert };
  });
  await check('mtls', 'mTLS com wildcard "*.localhost"/"*" no host', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: `*:${mtlsPort}`, cert: C.clientCert, key: C.clientKey }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: r.ok, evidence: r.error || bodyJson(r).clientCert };
  });
  await check('mtls', 'mTLS P12 com senha certa (segredo)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ id: 'c1', host: `localhost:${mtlsPort}`, pfx: C.clientP12 }] });
    ws.setSecret('cert:c1:passphrase', 'jaiminho');
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: r.ok && bodyJson(r).clientCert === 'jaiminho-client', evidence: r.error || bodyJson(r).clientCert };
  });
  await check('mtls', 'mTLS P12 com senha ERRADA → mensagem clara de senha', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ id: 'c1', host: `localhost:${mtlsPort}`, pfx: C.clientP12 }] });
    ws.setSecret('cert:c1:passphrase', 'errada');
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: !r.ok && /senha|passphrase|password|mac verify/i.test(r.error), evidence: `ok=${r.ok} error=${r.error} errors=${JSON.stringify(r.errors)}` };
  });
  await check('mtls', 'Certificado configurado para OUTRO host não é usado', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: 'outro.host:443', cert: C.clientCert, key: C.clientKey }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: !r.ok, evidence: r.error };
  });
  await check('mtls', 'Cliente assinado por CA não confiável → recusado com mensagem', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: `localhost:${mtlsPort}`, cert: C.rogueClientCert, key: C.rogueClientKey }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: !r.ok && r.error, evidence: r.error };
  });
  await check('mtls', 'mTLS com arquivo de chave inexistente → erro claro', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: `localhost:${mtlsPort}`, cert: C.clientCert, key: '/nao/existe.key' }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: !r.ok && /existe|ENOENT|não encontrado/i.test(r.error), evidence: `ok=${r.ok} error=${r.error} errors=${JSON.stringify(r.errors)}` };
  });
  await check('mtls', 'mTLS com caminhos RELATIVOS ao workspace', async () => {
    const ws = tmpWs(); fs.mkdirSync(path.join(ws.dir, 'certs'));
    for (const f of ['ca.crt', 'client.crt', 'client.key']) fs.copyFileSync(path.join(C.dir, f), path.join(ws.dir, 'certs', f));
    ws.saveSettings({ caCertificates: ['certs/ca.crt'], certificates: [{ host: `localhost:${mtlsPort}`, cert: 'certs/client.crt', key: 'certs/client.key' }] });
    const r = await get(ws, `${m.urls.mtls}/echo`);
    return { pass: r.ok, evidence: r.error || bodyJson(r).clientCert };
  });

  // ---------- gRPC TLS ----------
  const SVC = 'jaiminho.mock.v1.TravellerService';
  const g = (url, extra = {}) => ({ kind: 'grpc', name: 'g', url, grpc: { method: `${SVC}/GetTraveller`, schema: { source: 'reflection' }, metadata: [], message: '{"id":"1"}', ...extra } });
  const gtlsPort = m.urls.grpcTls.split(':').pop(); const gmtlsPort = m.urls.grpcMtls.split(':').pop();

  await check('grpc-tls', 'grpcs:// com CA desconhecida → erro claro', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`) });
    return { pass: !r.ok && /certificado|CA/i.test(r.error), evidence: r.error };
  });
  await check('grpc-tls', 'grpcs:// com SSL off (workspace)', async () => {
    const ws = tmpWs(); ws.saveSettings({ verifySsl: false }); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-tls', 'grpcs:// com SSL off por request (tls.verifySsl=false)', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`, { tls: { verifySsl: false } }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-tls', 'grpcs:// com CA própria', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-tls', 'grpcs:// para 127.0.0.1 (IP no SAN) com CA própria', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://127.0.0.1:${gtlsPort}`) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-tls', 'Plaintext contra servidor TLS → mensagem "TLS/plaintext trocados"', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpc://${m.urls.grpcTls}`, { options: { deadlineMs: 3000 } }) });
    return { pass: !r.ok && /trocados|TLS/i.test(r.error), evidence: r.error };
  });
  await check('grpc-tls', 'TLS contra servidor plaintext → mensagem "TLS/plaintext trocados"', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpc}`, { options: { deadlineMs: 3000 } }) });
    return { pass: !r.ok && /trocados|TLS/i.test(r.error), evidence: r.error };
  });
  await check('grpc-mtls', 'mTLS gRPC PEM', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ host: `localhost:${gmtlsPort}`, cert: C.clientCert, key: C.clientKey }] }); J.grpc.clearCache();
    const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`) });
    return { pass: r.ok && r.clientCert, evidence: r.error || r.clientCert };
  });
  await check('grpc-mtls', 'mTLS gRPC P12 senha certa', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ id: 'p', host: `localhost:${gmtlsPort}`, pfx: C.clientP12 }] }); ws.setSecret('cert:p:passphrase', 'jaiminho'); J.grpc.clearCache();
    const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-mtls', 'mTLS gRPC P12 senha ERRADA → erro claro de senha', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca], certificates: [{ id: 'p', host: `localhost:${gmtlsPort}`, pfx: C.clientP12 }] }); ws.setSecret('cert:p:passphrase', 'xx'); J.grpc.clearCache();
    const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`) });
    return { pass: !r.ok && /senha|password|MAC/i.test(r.error), evidence: r.error };
  });
  await check('grpc-mtls', 'mTLS gRPC sem certificado → mensagem pede mTLS', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); J.grpc.clearCache();
    const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`, { options: { deadlineMs: 4000 } }) });
    return { pass: !r.ok && /mTLS|certificado de cliente/i.test(r.error), evidence: r.error };
  });
  await check('grpc-mtls', 'mTLS gRPC: trocar o certificado do workspace (sem reiniciar) passa a valer (cache de reflection)', async () => {
    const ws = tmpWs(); ws.saveSettings({ caCertificates: [C.ca] }); J.grpc.clearCache();
    await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`, { options: { deadlineMs: 3000 } }) });
    ws.saveSettings({ certificates: [{ host: `localhost:${gmtlsPort}`, cert: C.clientCert, key: C.clientKey }] });
    const r = await J.send(ws, { request: g(`grpcs://${m.urls.grpcMtls}`, { options: { deadlineMs: 3000 } }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-tls', 'Cache de reflection: após conectar com SSL off, religar verificação deve voltar a falhar', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); ws.saveSettings({ verifySsl: false });
    const r1 = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`) });
    ws.saveSettings({ verifySsl: true });
    const r2 = await J.send(ws, { request: g(`grpcs://${m.urls.grpcTls}`) });
    return { pass: r1.ok && !r2.ok, evidence: `1º ok=${r1.ok}; 2º (verificação ligada, CA desconhecida) ok=${r2.ok} ${r2.error || ''}` };
  });

  await finish('03-tls');
})();
