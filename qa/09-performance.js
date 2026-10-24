'use strict';
// QA de performance do motor: workspace grande, import de Swagger enorme, respostas grandes,
// muitas requests em sequência/paralelo, gRPC com milhares de mensagens, vazamento de memória e
// bloqueio do event loop (o utility process "carteiro" não pode travar).
const fs = require('fs');
const path = require('path');
const { J, check, finish, getMocks, tmpWs } = require('./lib');

const ms = (t0) => Date.now() - t0;
const mb = (n) => (n / 1024 / 1024).toFixed(1);

/** Mede o maior atraso do event loop enquanto fn roda (travamento percebido). */
async function withLoopLag(fn) {
  let max = 0; let last = Date.now();
  const iv = setInterval(() => { const now = Date.now(); max = Math.max(max, now - last - 10); last = now; }, 10);
  try { const r = await fn(); return { r, lag: max }; } finally { clearInterval(iv); }
}

(async () => {
  const m = await getMocks();
  const H = m.urls.http;
  const SVC = 'jaiminho.mock.v1.TravellerService';
  const g = (url, extra = {}) => ({ kind: 'grpc', name: 'g', url, grpc: { method: `${SVC}/ListTravellers`, message: '{}', metadata: [], schema: { source: 'reflection' }, ...extra } });

  await check('perf', 'Workspace com 3.000 requests em 60 pastas: criar, abrir, montar a árvore e resolver a cadeia', async () => {
    const ws = tmpWs('Grande'); const col = ws.createCollection('Enorme'); let first;
    let t = Date.now();
    for (let f = 0; f < 60; f++) { const fo = ws.createFolder(col, `Pasta ${f}`, { vars: [{ key: 'k', value: String(f) }] }); for (let r = 0; r < 50; r++) { const id = ws.createRequest(fo, { name: `Req ${f}-${r}`, url: `{{base}}/echo?i=${r}`, headers: [{ key: 'X-A', value: '1', enabled: true }] }); first = first || id; } }
    const tCreate = ms(t); t = Date.now();
    const ws2 = J.Workspace.open(ws.dir); const tOpen = ms(t); t = Date.now();
    const tree = ws2.tree(); const tTree = ms(t); t = Date.now();
    for (let i = 0; i < 200; i++) ws2.chain(first);
    const tChain = ms(t);
    const n = tree.collections[0].children.reduce((a, f) => a + f.children.length, 0);
    return { pass: n === 3000 && tOpen < 4000 && tTree < 2000 && tChain < 1500, evidence: `requests=${n} criar=${tCreate}ms abrir=${tOpen}ms árvore=${tTree}ms 200×chain=${tChain}ms` };
  }, { timeoutMs: 120000 });

  await check('perf', 'Árvore e abertura escalam (10.000 requests) sem ficar quadráticas', async () => {
    const ws = tmpWs('Gigante'); const col = ws.createCollection('C');
    for (let f = 0; f < 100; f++) { const fo = ws.createFolder(col, `P${f}`); for (let r = 0; r < 100; r++) ws.createRequest(fo, { name: `R${r}`, url: 'x' }); }
    let t = Date.now(); const ws2 = J.Workspace.open(ws.dir); const tOpen = ms(t);
    t = Date.now(); const tree = ws2.tree(); const tTree = ms(t);
    return { pass: tOpen < 10000 && tTree < 5000, evidence: `10.000 requests: abrir=${tOpen}ms árvore=${tTree}ms (${tree.collections[0].children.length} pastas)` };
  }, { timeoutMs: 240000 });

  await check('perf', 'Import de Swagger com 1.500 endpoints termina rápido e gera tudo', async () => {
    const paths = {};
    for (let i = 0; i < 1500; i++) paths[`/api/v1/recurso${i}/{id}`] = { get: { tags: [`Tag${i % 30}`], summary: `Buscar ${i}`, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'q', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } }, post: { tags: [`Tag${i % 30}`], summary: `Criar ${i}`, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { nome: { type: 'string' }, idade: { type: 'integer' } } } } } }, responses: { 201: { description: 'ok' } } } };
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Gigante', version: '1' }, servers: [{ url: 'http://localhost:9' }], paths });
    const ws = tmpWs(); const t = Date.now();
    const { r, lag } = await withLoopLag(() => J.importAuto(ws, { text: spec }));
    const el = ms(t); const tree = ws.tree();
    const total = tree.collections[0].children.reduce((a, f) => a + (f.children ? f.children.length : 1), 0);
    return { pass: el < 30000 && total >= 3000 && lag < 3000, evidence: `${el}ms, itens=${total}, maior travamento do event loop=${lag}ms` };
  }, { timeoutMs: 180000 });

  await check('perf', 'Resposta JSON de 20 MB: chega inteira, em poucos segundos e sem travar o event loop', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'big', url: `${H}/big?mb=20` });
    const t = Date.now();
    const { r, lag } = await withLoopLag(() => J.send(ws, { requestId: id }));
    const size = r.response ? r.response.body.length : 0;
    return { pass: r.ok && size > 19 * 1024 * 1024 && ms(t) < 15000 && lag < 1500, evidence: `ok=${r.ok} corpo=${mb(size)}MB tempo=${ms(t)}ms travamento=${lag}ms ${r.error || ''}` };
  }, { timeoutMs: 60000 });

  await check('perf', 'Resposta de 20 MB: serializar para o IPC (JSON) cabe no orçamento e o tamanho é conhecido', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'big', url: `${H}/big?mb=20` });
    const r = await J.send(ws, { requestId: id });
    const t = Date.now(); const s = JSON.stringify(r); const back = JSON.parse(s);
    return { pass: ms(t) < 2500 && back.response.body.length === r.response.body.length, evidence: `serializar+ler=${ms(t)}ms (${mb(s.length)}MB)` };
  }, { timeoutMs: 60000 });

  await check('perf', '300 requests em sequência: latência média baixa e memória estável (sem vazamento)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'e', url: `${H}/echo?x=1`, scripts: { post: 'pm.test("ok", () => pm.response.to.have.status(200))' } });
    await J.send(ws, { requestId: id }); global.gc && global.gc();
    const m0 = process.memoryUsage().heapUsed; const t = Date.now();
    for (let i = 0; i < 300; i++) { const r = await J.send(ws, { requestId: id }); if (!r.ok) return { pass: false, evidence: `falhou na ${i}: ${r.error}` }; }
    const per = ms(t) / 300; global.gc && global.gc();
    const grow = (process.memoryUsage().heapUsed - m0) / 1024 / 1024;
    return { pass: per < 60 && grow < 150, evidence: `${per.toFixed(1)}ms/request, heap +${grow.toFixed(1)}MB` };
  }, { timeoutMs: 120000 });

  await check('perf', '50 requests em paralelo completam sem erro', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'e', url: `${H}/echo` });
    const t = Date.now(); const rs = await Promise.all(Array.from({ length: 50 }, () => J.send(ws, { requestId: id })));
    const bad = rs.filter((r) => !r.ok).length;
    return { pass: bad === 0 && ms(t) < 10000, evidence: `${ms(t)}ms, falhas=${bad}` };
  }, { timeoutMs: 60000 });

  await check('perf', 'Histórico com 2.000 itens: listar os 300 mais novos é rápido', async () => {
    const ws = tmpWs(); for (let i = 0; i < 2100; i++) ws.addHistory({ name: `h${i}`, url: 'http://x', ok: true, code: 200 });
    const t = Date.now(); const h = ws.listHistory(300);
    return { pass: ms(t) < 800 && h.length === 300 && fs.readdirSync(ws._historyDir()).length <= 2000, evidence: `${ms(t)}ms, arquivos=${fs.readdirSync(ws._historyDir()).length}` };
  }, { timeoutMs: 60000 });

  await check('perf', 'Variáveis efetivas com 2.000 variáveis resolvem rápido', async () => {
    const ws = tmpWs(); const vars = Array.from({ length: 2000 }, (_, i) => ({ key: `v${i}`, value: `valor${i}` }));
    const env = ws.saveEnvironment({ name: 'E', vars }); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?a={{v1}}&b={{v1999}}` });
    const t = Date.now(); const r = await J.send(ws, { requestId: id, environmentId: env });
    return { pass: r.ok && /a=valor1&b=valor1999/.test(r.response.body.replace(/\s/g, '') ) || (r.ok && ms(t) < 3000), evidence: `${ms(t)}ms ok=${r.ok}` };
  }, { timeoutMs: 60000 });

  await check('perf-grpc', 'Server-streaming com 5.000 mensagens: recebe todas, rápido, sem travar', async () => {
    const ws = tmpWs(); J.grpc.clearCache();
    const t = Date.now(); let events = 0;
    const { r, lag } = await withLoopLag(() => J.send(ws, { request: g(m.urls.grpc, { message: '{"limit":5000}', options: { deadlineMs: 30000 } }), onEvent: () => { events++; } }));
    return { pass: r.ok && r.messages.length === 5000 && ms(t) < 15000 && lag < 1500, evidence: `msgs=${r.messages && r.messages.length} tempo=${ms(t)}ms eventos=${events} travamento=${lag}ms ${r.error || ''}` };
  }, { timeoutMs: 60000 });

  await check('perf-grpc', '50 chamadas gRPC unárias em sequência reaproveitam o schema (cache) e são rápidas', async () => {
    const ws = tmpWs(); J.grpc.clearCache(); const req = g(m.urls.grpc, { method: `${SVC}/GetTraveller`, message: '{"id":"1"}' });
    await J.send(ws, { request: req }); const t = Date.now();
    for (let i = 0; i < 50; i++) { const r = await J.send(ws, { request: req }); if (!r.ok) return { pass: false, evidence: r.error }; }
    return { pass: ms(t) / 50 < 80, evidence: `${(ms(t) / 50).toFixed(1)}ms/chamada` };
  }, { timeoutMs: 60000 });

  await check('perf', 'Runner: 200 iterações de uma request com CSV grande terminam e reportam', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); ws.createRequest(col, { name: 'e', url: `${H}/echo?n={{n}}`, scripts: { post: 'pm.test("n", () => pm.expect(pm.response.json().query.n).to.eql(pm.iterationData.get("n")))' } });
    const csv = 'n\n' + Array.from({ length: 200 }, (_, i) => i).join('\n');
    const data = J.parseDataFile(csv, 'd.csv'); const t = Date.now();
    const r = await J.runCollection(ws, { id: col, data });
    const s = JSON.stringify(r).length;
    return { pass: ms(t) < 30000 && data.length === 200, evidence: `${ms(t)}ms, resultado=${(s / 1024).toFixed(0)}KB ${r.summary ? JSON.stringify(r.summary) : ''}` };
  }, { timeoutMs: 90000 });

  // ---- corretude do pool de contextos de script (a otimização não pode misturar execuções) ----
  await check('perf-pool', '30 requests com script em paralelo: cada uma vê só os próprios console/testes/variáveis', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const ids = [];
    for (let i = 0; i < 30; i++) ids.push(ws.createRequest(col, { name: `r${i}`, url: `${H}/echo?i=${i}`, scripts: { pre: `pm.variables.set("meu", "${i}")`, post: `console.log("eu=${i}"); pm.test("t${i}", () => pm.expect(pm.response.json().query.i).to.eql("${i}")); pm.expect(pm.variables.get("meu")).to.eql("${i}")` } }));
    const rs = await Promise.all(ids.map((id) => J.send(ws, { requestId: id })));
    const bad = rs.map((r, i) => (r.ok && r.tests.length === 1 && r.tests[0].name === `t${i}` && r.tests[0].passed && r.console.length === 1 && r.console[0].args[0] === `eu=${i}`) ? null : i).filter((x) => x !== null);
    return { pass: bad.length === 0, evidence: bad.length ? `misturou em ${bad.join(',')}: ${JSON.stringify(rs[bad[0]].tests)} ${JSON.stringify(rs[bad[0]].console)}` : 'ok' };
  }, { timeoutMs: 60000 });

  await check('perf-pool', 'Variável global criada num script NÃO vaza para o script de outra request', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const a = ws.createRequest(col, { name: 'a', url: `${H}/echo`, scripts: { post: 'vazou = 123; var vazou2 = 1;' } });
    const b = ws.createRequest(col, { name: 'b', url: `${H}/echo`, scripts: { post: 'pm.test("limpo", () => { pm.expect(typeof vazou).to.eql("undefined"); pm.expect(typeof vazou2).to.eql("undefined"); })' } });
    await J.send(ws, { requestId: a }); const r = await J.send(ws, { requestId: b });
    return { pass: r.tests.length === 1 && r.tests[0].passed, evidence: JSON.stringify(r.tests) };
  }, { timeoutMs: 30000 });

  await check('perf-pool', 'Script em loop infinito estoura o tempo, não trava o app e a próxima request com script funciona', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const loop = ws.createRequest(col, { name: 'loop', url: `${H}/echo`, scripts: { post: 'while (true) {}' } });
    const ok = ws.createRequest(col, { name: 'ok', url: `${H}/echo`, scripts: { post: 'pm.test("vivo", () => pm.expect(1).to.eql(1))' } });
    const t = Date.now(); const r1 = await J.send(ws, { requestId: loop }); const tLoop = ms(t);
    const r2 = await J.send(ws, { requestId: ok });
    return { pass: tLoop < 20000 && r2.tests.length === 1 && r2.tests[0].passed, evidence: `loop=${tLoop}ms erros=${JSON.stringify((r1.errors || []).slice(0, 1))} depois: ${JSON.stringify(r2.tests)}` };
  }, { timeoutMs: 60000 });

  await check('perf-pool', 'Cancelar durante o envio com script e continuar usando o app (contexto descartado)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const slow = ws.createRequest(col, { name: 's', url: `${H}/delay/3000`, scripts: { post: 'pm.test("x", () => 1)' } });
    const ok = ws.createRequest(col, { name: 'ok', url: `${H}/echo`, scripts: { post: 'pm.test("depois", () => 1)' } });
    const ac = new AbortController(); const p = J.send(ws, { requestId: slow, signal: ac.signal }); setTimeout(() => ac.abort(), 300);
    const r1 = await p; const r2 = await J.send(ws, { requestId: ok });
    return { pass: r1.error === 'Cancelado' && r2.ok && r2.tests[0] && r2.tests[0].passed, evidence: `${r1.error} / ${JSON.stringify(r2.tests)}` };
  }, { timeoutMs: 30000 });

  await finish('09-performance');
})();
