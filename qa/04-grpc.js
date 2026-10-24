'use strict';
// QA: gRPC (reflection, .proto com import, protoset, 4 tipos, cancelamento, deadline, metadata, mensagens inválidas, scripts, runner).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { J, check, finish, getMocks, tmpWs, MOCKS } = require('./lib');

const SVC = 'jaiminho.mock.v1.TravellerService';
const req = (url, method, message = '{}', extra = {}) => ({ kind: 'grpc', name: method, url, grpc: { method: `${SVC}/${method}`, schema: { source: 'reflection' }, metadata: [], message, ...extra } });

(async () => {
  const m = await getMocks();
  const G = m.urls.grpc; const port = G.split(':').pop();
  const PROTO_DIR = m.proto.dir;

  await check('grpc', 'Unário via reflection', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}') });
    return { pass: r.ok && r.messages[0].data.first_name === 'Jaime', evidence: r.error || JSON.stringify(r.messages[0].data).slice(0, 150) };
  });
  await check('grpc', 'URL sem esquema (127.0.0.1:porta) = plaintext', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(G, 'GetTraveller', '{"id":"1"}') });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', 'URL "localhost:porta" sem esquema', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`localhost:${port}`, 'GetTraveller', '{"id":"1"}') });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', 'URL com barra final "grpc://host:porta/"', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}/`, 'GetTraveller', '{"id":"1"}') });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', 'URL no formato "dns:///host:porta" (documentado em parseTarget)', async () => {
    const t = J.grpc.parseTarget(`dns:///localhost:${port}`);
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`dns:///localhost:${port}`, 'GetTraveller', '{"id":"1"}', { options: { deadlineMs: 3000 } }) });
    return { pass: r.ok, evidence: `parseTarget=${JSON.stringify(t)} error=${r.error}` };
  });
  await check('grpc', 'URL IPv6 "[::1]:porta"', async () => {
    const t = J.grpc.parseTarget(`[::1]:${port}`);
    return { pass: t.host === '[::1]' || t.host === '::1', evidence: `parseTarget=${JSON.stringify(t)}` };
  });
  await check('grpc', 'URL com espaço sobrando e {{var}} de ambiente', async () => {
    const ws = tmpWs(); const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'g', value: G }] });
    const r = await J.send(ws, { request: req('  grpc://{{g}}  ', 'GetTraveller', '{"id":"1"}'), environmentId: env });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', '.proto com import (pasta do proto como import path)', async () => {
    const ws = tmpWs();
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"2"}', { schema: { source: 'proto', files: [path.join(PROTO_DIR, m.proto.file)], importPaths: [PROTO_DIR] } }) });
    return { pass: r.ok && r.messages[0].data.first_name === 'Ana', evidence: r.error };
  });
  await check('grpc', '.proto com import SEM import path explícito (import relativo à raiz)', async () => {
    const ws = tmpWs();
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"2"}', { schema: { source: 'proto', files: [path.join(PROTO_DIR, m.proto.file)] } }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', '.proto copiado sozinho (sem os imports): erro CLARO que aponta o arquivo faltante e o caminho de correção', async () => {
    const ws = tmpWs();
    fs.copyFileSync(path.join(PROTO_DIR, m.proto.file), path.join(ws.dir, 'protos', 'traveller.proto'));
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"2"}', { schema: { source: 'proto', files: ['protos/traveller.proto'] } }) });
    return { pass: !r.ok && /Import não encontrado/.test(r.error) && /Adicionar \.proto/.test(r.error), evidence: r.error };
  });
  await check('grpc', '"+ Adicionar .proto" (addProtoToWorkspace) copia o arquivo COM os imports e a chamada funciona', async () => {
    const ws = tmpWs();
    const copied = J.grpc.addProtoToWorkspace(ws.dir, path.join(PROTO_DIR, m.proto.file));
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"2"}', { schema: { source: 'proto', files: [copied.find((c) => c.endsWith(path.basename(m.proto.file)))] } }) });
    return { pass: r.ok && copied.length >= 2, evidence: `${copied.join(', ')} :: ${r.error || 'ok'}` };
  });
  await check('grpc', '.proto com caminho relativo ao workspace + import path relativo', async () => {
    const ws = tmpWs();
    fs.cpSync(PROTO_DIR, path.join(ws.dir, 'protos'), { recursive: true });
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"2"}', { schema: { source: 'proto', files: [`protos/${m.proto.file}`] } }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', 'Protoset congelado a partir da reflection e usado contra servidor sem reflection', async () => {
    const ws = tmpWs();
    const d = await J.grpc.describe(ws, { request: req(`grpc://${G}`, 'GetTraveller'), refresh: true });
    const f = path.join(ws.dir, 'protos', 'frozen.protoset'); fs.writeFileSync(f, J.grpc.toProtoset(d.schema));
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"3"}', { schema: { source: 'protoset', protoset: 'protos/frozen.protoset' } }) });
    return { pass: r.ok && r.messages[0].data.first_name === 'Lucas', evidence: r.error };
  });
  await check('grpc', 'Protoset a partir de .proto (toProtoset de schema root) funciona', async () => {
    const ws = tmpWs();
    const d = await J.grpc.describe(ws, { request: req(`grpc://${G}`, 'GetTraveller', '{}', { schema: { source: 'proto', files: [path.join(PROTO_DIR, m.proto.file)], importPaths: [PROTO_DIR] } }) });
    const f = path.join(ws.dir, 'protos', 'fromproto.protoset'); fs.writeFileSync(f, J.grpc.toProtoset(d.schema));
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"3"}', { schema: { source: 'protoset', protoset: 'protos/fromproto.protoset' } }) });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc', 'Servidor sem reflection → erro claro sugerindo .proto/protoset', async () => {
    const ws = tmpWs(); J.grpc.clearCache();
    const r = await J.send(ws, { request: req(`grpc://${m.urls.grpcNoReflection}`, 'GetTraveller', '{"id":"1"}') });
    return { pass: !r.ok && /reflection|proto/i.test(r.error), evidence: r.error };
  });
  await check('grpc', 'Servidor desligado → UNAVAILABLE conexão recusada (rápido)', async () => {
    const ws = tmpWs(); const t0 = Date.now();
    const r = await J.send(ws, { request: req('grpc://127.0.0.1:1', 'GetTraveller', '{"id":"1"}') });
    return { pass: !r.ok && /recusada|UNAVAILABLE/.test(r.error) && Date.now() - t0 < 20000, evidence: `${Date.now() - t0}ms ${r.error}` };
  }, { timeoutMs: 40000 });
  await check('grpc', 'Server streaming completo e ordem', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'ListTravellers', '{"nationality":"PT"}') });
    return { pass: r.ok && r.messages.length === 2 && r.kind === 'server-stream', evidence: `${r.messages.length} msgs ${r.error || ''}` };
  });
  await check('grpc', 'Client streaming com escrita via handle e end()', async () => {
    const ws = tmpWs(); const inv = J.grpc.invoke(ws, { request: req(`grpc://${G}`, 'UploadTravellers') });
    inv.handle.write('{"id":"x1"}'); inv.handle.write({ id: 'x2' }); setTimeout(() => inv.handle.end(), 100);
    const r = await inv.done;
    return { pass: r.ok && r.messages[0].data.received === 2, evidence: JSON.stringify(r.messages.map((x) => x.data)) };
  });
  await check('grpc', 'Bidi: cancelar no meio', async () => {
    const ws = tmpWs(); const inv = J.grpc.invoke(ws, { request: req(`grpc://${G}`, 'Chat') });
    inv.handle.write('{"text":"a"}'); setTimeout(() => inv.handle.cancel(), 150);
    const r = await inv.done;
    return { pass: r.status && r.status.name === 'CANCELLED' && r.messages.length >= 1, evidence: `${r.status && r.status.name} msgs=${r.messages.length}` };
  });
  await check('grpc', 'Unário: cancelar antes da resposta (Slow)', async () => {
    const ws = tmpWs(); const inv = J.grpc.invoke(ws, { request: req(`grpc://${G}`, 'Slow', '{"delay_ms":3000}'), autoEnd: true });
    setTimeout(() => inv.handle.cancel(), 300); const t0 = Date.now();
    const r = await inv.done;
    return { pass: r.status && r.status.name === 'CANCELLED' && Date.now() - t0 < 2000, evidence: `${Date.now() - t0}ms ${r.status && r.status.name}` };
  });
  await check('grpc', 'Cancelar IMEDIATAMENTE (antes da reflection terminar)', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const inv = J.grpc.invoke(ws, { request: req(`grpc://${G}`, 'Slow', '{"delay_ms":3000}'), autoEnd: true });
    inv.handle.cancel(); const t0 = Date.now();
    const r = await inv.done;
    return { pass: !r.ok && Date.now() - t0 < 2000, evidence: `${Date.now() - t0}ms status=${r.status && r.status.name} error=${r.error}` };
  });
  await check('grpc', 'Deadline padrão de streaming = sem deadline; deadline unário custom', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'Slow', '{"delay_ms":500}', { options: { deadlineMs: 100 } }) });
    return { pass: r.status.name === 'DEADLINE_EXCEEDED', evidence: r.error };
  });
  await check('grpc', 'Metadata -bin (base64) chega como binário no servidor', async () => {
    const ws = tmpWs(); const val = Buffer.from([1, 2, 3, 250]).toString('base64');
    const r = await J.send(ws, { request: req(`grpc://${G}`, 'Whoami', '{}', { metadata: [{ key: 'authorization', value: 'Bearer jaiminho-token' }, { key: 'x-dado-bin', value: val }, { key: 'X-Maiusc', value: 'v' }] }) });
    const md = r.ok ? r.messages[0].data.metadata : {};
    return { pass: r.ok && md['x-dado-bin'] === val && md['x-maiusc'] === 'v', evidence: r.error || JSON.stringify(md) };
  });
  await check('grpc', 'Metadata com valor não-ASCII (acento) → erro claro em vez de crash', async () => {
    const ws = tmpWs();
    const r = await J.send(ws, { request: req(`grpc://${G}`, 'Whoami', '{}', { metadata: [{ key: 'authorization', value: 'Bearer jaiminho-token' }, { key: 'x-nome', value: 'João' }] }) });
    return { pass: r.ok || /metadata|ASCII|inválid/i.test(r.error || ''), evidence: `ok=${r.ok} ${r.error || JSON.stringify(r.messages[0] && r.messages[0].data.metadata['x-nome'])}` };
  });
  await check('grpc', 'Whoami sem token → UNAUTHENTICATED', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'Whoami') });
    return { pass: r.status.name === 'UNAUTHENTICATED', evidence: r.error };
  });
  // ---- mensagens inválidas ----
  const bad = async (desc, msg, rx, method = 'GetTraveller', expectOk = false) => check('grpc-msg', desc, async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, method, msg) });
    const sent = (r.events || []).find((e) => e.type === 'sent-request-data');
    return { pass: expectOk ? r.ok : (!r.ok && rx.test(r.error || '')), evidence: `ok=${r.ok} error=${r.error} enviado=${sent ? JSON.stringify(sent.message) : '-'}` };
  });
  await bad('JSON malformado → erro claro', '{"id": ', /JSON|Unexpected|inválid/i);
  await bad('Campo inexistente', '{"nope":1}', /não existe/);
  await bad('Tipo errado: string "abc" em campo int32 (limit) deve ser rejeitado', '{"limit":"abc"}', /limit|inteiro|int32|inválid|número/i, 'ListTravellers');
  await bad('Tipo errado: objeto em campo string (id) deve ser rejeitado', '{"id":{"a":1}}', /id|string|inválid/i);
  await bad('Tipo errado: número em campo string (id) (proto3 JSON rejeita)', '{"id":123}', /id|string|inválid/i);
  await bad('Lista em campo não repetido', '{"id":["1"]}', /id|lista|inválid|string/i);
  await bad('Enum inválido em documents[].type', '{"documents":[{"type":"XPTO"}]}', /enum/i, 'UploadTravellers');
  await bad('Timestamp inválido', '{"created_at":"ontem"}', /Timestamp/i, 'UploadTravellers');
  await bad('oneof com 2 campos (email e phone) deve ser rejeitado', '{"email":"a@b","phone":"1"}', /oneof|contact|ambos|mais de um/i, 'UploadTravellers');
  await bad('int32 fora do intervalo (limit=99999999999) deve ser rejeitado', '{"limit":99999999999}', /limit|intervalo|range|int32/i, 'ListTravellers');
  await check('grpc-msg', 'Mensagem vazia "" vira {} e é ENVIADA (o servidor decide: NOT_FOUND por id vazio)', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'GetTraveller', '') });
    const sent = (r.events || []).find((e) => e.type === 'sent-request-data');
    return { pass: sent && JSON.stringify(sent.message) === '{}' && /NOT_FOUND/.test(r.error || ''), evidence: `enviado=${JSON.stringify(sent && sent.message)} erro=${r.error}` };
  });
  await check('grpc-msg', 'Map, repeated e Timestamp com offset/frações enviados corretamente (Upload ecoa ids)', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'UploadTravellers', JSON.stringify({ id: 'm1', tags: { a: '1', 'chave com espaço': 'ç' }, documents: [{ type: 'PASSPORT', number: 'N' }], created_at: '2026-01-01T10:00:00.123456789+02:00' })) });
    const sent = r.events.find((e) => e.type === 'sent-request-data');
    return { pass: r.ok && sent.message.created_at === '2026-01-01T08:00:00.123456789Z' && sent.message.tags['chave com espaço'] === 'ç', evidence: JSON.stringify(sent && sent.message) };
  });
  await check('grpc-msg', 'Nomes camelCase (firstName) aceitos como no JSON do proto3', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'UploadTravellers', '{"firstName":"A","createdAt":"2026-01-01T00:00:00Z"}') });
    return { pass: r.ok, evidence: r.error };
  });
  await check('grpc-msg', '{{$randomInt}} na mensagem: o que é mostrado como enviado == o que o servidor recebeu', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'GetTraveller', '{"id":"{{$randomInt}}"}') });
    const sent = r.events.find((e) => e.type === 'sent-request-data');
    const echo = (r.headers || []).find((h) => h.key === 'x-request-echo');
    return { pass: sent && echo && sent.message.id === echo.value, evidence: `mostrado=${sent && sent.message.id} servidor recebeu=${echo && echo.value}` };
  });
  await check('grpc-msg', 'Resposta de erro com status details decodificado', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: req(`grpc://${G}`, 'Fail', '{"code":9,"message":"pré-condição"}') });
    return { pass: r.status.name === 'FAILED_PRECONDITION' && r.status.errorDetails && r.status.errorDetails.details.length === 2 && r.status.details === 'pré-condição', evidence: JSON.stringify(r.status) };
  });
  await check('grpc-msg', 'Exemplo gerado (sample) é aceito pelo próprio método', async () => {
    const ws = tmpWs(); const d = await J.grpc.describe(ws, { request: req(`grpc://${G}`, 'UploadTravellers') });
    const mth = J.grpc.findMethod(d.schema.root, `${SVC}/UploadTravellers`);
    const s = JSON.stringify(J.grpc.sample(mth.resolvedRequestType));
    const r = await J.send(ws, { request: req(`grpc://${G}`, 'UploadTravellers', s) });
    return { pass: r.ok, evidence: `${s} :: ${r.error || 'ok'}` };
  });
  // ---- scripts ----
  await check('grpc-script', 'beforeInvoke altera variável usada na mensagem e onIncomingMessage roda por mensagem', async () => {
    const ws = tmpWs(); const col = ws.createCollection('G');
    const id = ws.createRequest(col, { ...req(`grpc://${G}`, 'ListTravellers', '{"limit":{{lim}}}'), scripts: { beforeInvoke: 'pm.variables.set("lim","3")', onIncomingMessage: 'pm.test("tem id", () => pm.expect(pm.message.data.id).to.be.a("string"))' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: r.ok && r.messages.length === 3 && r.tests.length === 3 && r.tests.every((t) => t.passed), evidence: `${r.error || ''} msgs=${r.messages.length} tests=${r.tests.length}` };
  });
  await check('grpc-script', 'Erro de sintaxe no beforeInvoke → erro claro, sem crash', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { beforeInvoke: 'pm.variables.set(' } } });
    return { pass: !r.ok && /beforeInvoke/.test(r.error), evidence: r.error };
  });
  await check('grpc-script', 'Loop infinito no afterResponse é interrompido (timeout)', async () => {
    const ws = tmpWs(); const t0 = Date.now();
    const r = await J.send(ws, { request: { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { afterResponse: 'while(true){}' } } });
    return { pass: Date.now() - t0 < 15000 && r.console.some((c) => /Erro no script/.test(c.args[0])), evidence: `${Date.now() - t0}ms console=${JSON.stringify(r.console)}` };
  }, { timeoutMs: 40000 });
  await check('grpc-script', 'pm.environment.set no afterResponse de variável NOVA disponível na próxima request', async () => {
    const ws = tmpWs(); const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'x', value: '1' }] }); const col = ws.createCollection('G');
    const a = ws.createRequest(col, { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { afterResponse: 'pm.environment.set("nomeGrpc", pm.response.json().first_name)' } });
    const b = ws.createRequest(col, { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"{{nomeGrpc}}"}') });
    await J.send(ws, { requestId: a, environmentId: env }); const r = await J.send(ws, { requestId: b, environmentId: env });
    const sent = r.events.find((e) => e.type === 'sent-request-data');
    return { pass: sent && sent.message.id === 'Jaime', evidence: `id enviado=${sent && sent.message.id}` };
  });
  await check('grpc-script', 'pm.sendRequest disponível em script gRPC (Postman tem)', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { afterResponse: 'pm.test("sendRequest existe", () => pm.expect(typeof pm.sendRequest).to.eql("function"))' } } });
    return { pass: r.tests[0] && r.tests[0].passed, evidence: JSON.stringify(r.tests) };
  });
  await check('grpc-script', 'pm.test assíncrono que FALHA não pode aparecer como aprovado', async () => {
    const ws = tmpWs(); const r = await J.send(ws, { request: { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { afterResponse: 'pm.test("async falha", async () => { throw new Error("falhou") })' } } });
    return { pass: r.tests[0] && r.tests[0].passed === false, evidence: JSON.stringify(r.tests) };
  });
  await check('grpc-script', 'SEGURANÇA: script gRPC de coleção partilhada não escapa do sandbox (acesso a process/require)', async () => {
    const ws = tmpWs(); const marker = path.join(require('os').tmpdir(), `qa-escape-${Date.now()}.txt`);
    const code = `const P = pm.test.constructor('return process')(); P.mainModule ? P.mainModule.require('fs').writeFileSync(${JSON.stringify(marker)}, 'pwned') : P.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)}, 'pwned');`;
    const r = await J.send(ws, { request: { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"1"}'), scripts: { afterResponse: code } } });
    const escaped = fs.existsSync(marker);
    return { pass: !escaped, evidence: escaped ? `ESCAPOU: o script escreveu ${marker} no disco (process e fs acessíveis)` : `bloqueado: ${JSON.stringify(r.console)}` };
  });
  await check('scripts', 'SEGURANÇA (comparação): script HTTP (postman-sandbox) também não escapa', async () => {
    const ws = tmpWs(); const marker = path.join(require('os').tmpdir(), `qa-escape-http-${Date.now()}.txt`);
    const code = `try { const P = pm.test.constructor('return process')(); P.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); } catch (e) { console.log('bloqueado', e.message) }`;
    const r = await J.send(ws, { request: J.model.newRequest({ url: `${m.urls.http}/echo`, scripts: { pre: code } }) });
    return { pass: !fs.existsSync(marker), evidence: JSON.stringify(r.console) };
  });
  await check('grpc-runner', 'Runner com requests gRPC + HTTP', async () => {
    const ws = tmpWs(); const col = ws.createCollection('Mix');
    ws.createRequest(col, { ...req(`grpc://${G}`, 'GetTraveller', '{"id":"{{id}}"}'), scripts: { afterResponse: 'pm.test("ok", () => pm.expect(pm.response.statusCode).to.eql(0))' } });
    ws.createRequest(col, { ...req(`grpc://${G}`, 'ListTravellers', '{"limit":2}') });
    ws.createRequest(col, { ...req(`grpc://${G}`, 'UploadTravellers', '{"id":"u"}') });
    ws.createRequest(col, { name: 'http', url: `${m.urls.http}/echo` });
    const rep = await J.runCollection(ws, { id: col, data: [{ id: '1' }, { id: '2' }] });
    return { pass: rep.totals.requests === 8 && rep.totals.failed === 0, evidence: JSON.stringify(rep.totals) + ' ' + rep.results.map((x) => `${x.name}:${x.code}`).join(',') };
  });
  await check('grpc', 'describe com {{var}} na URL sem ambiente → erro claro (não "NaN")', async () => {
    const ws = tmpWs();
    try { await J.grpc.describe(ws, { request: req('grpc://{{host}}', 'GetTraveller') }); return { pass: false, evidence: 'não falhou' }; } catch (e) { return { pass: /host|variável|\{\{/i.test(e.message), evidence: e.message }; }
  });
  await check('grpcurl', 'Export grpcurl → import grpcurl preserva método, metadata, mensagem e TLS', async () => {
    const r0 = J.model.newRequest(req(`grpcs://localhost:${port}`, 'GetTraveller', '{"id":"1","nome":"it\'s"}', { metadata: [{ key: 'authorization', value: 'Bearer x' }], tls: { verifySsl: false } }));
    const outs = {};
    for (const flavor of ['bash', 'cmd', 'powershell']) {
      const cmd = J.grpcurl.exportGrpcurl(r0, { flavor, multiLine: true });
      const back = J.grpcurl.importGrpcurl(cmd);
      outs[flavor] = { cmd, ok: back.grpc.method === r0.grpc.method && JSON.parse(back.grpc.message).nome === "it's" && back.grpc.metadata[0].value === 'Bearer x' && back.url === r0.url && back.grpc.tls.verifySsl === false };
    }
    return { pass: Object.values(outs).every((o) => o.ok), evidence: JSON.stringify(outs) };
  });
  await check('grpcurl', 'Import grpcurl real com -d @ (stdin) e -H múltiplos e método com ponto', async () => {
    const r = J.grpcurl.importGrpcurl(`grpcurl -plaintext -H 'a: 1' -H "b: 2" -d '{"id":"1"}' localhost:${port} ${SVC}.GetTraveller`);
    return { pass: r.grpc.method === `${SVC}/GetTraveller` && r.grpc.metadata.length === 2 && r.url === `grpc://localhost:${port}`, evidence: JSON.stringify({ m: r.grpc.method, url: r.url, md: r.grpc.metadata }) };
  });
  await check('grpcurl', 'importAuto com grpcurl cria request e ela funciona', async () => {
    const ws = tmpWs(); const res = await J.importAuto(ws, { text: `grpcurl -plaintext -d '{"id":"2"}' ${G} ${SVC}/GetTraveller` });
    const r = await J.send(ws, { requestId: res.requestId });
    return { pass: r.ok && r.messages[0].data.first_name === 'Ana', evidence: r.error };
  });

  await finish('04-grpc');
})();
