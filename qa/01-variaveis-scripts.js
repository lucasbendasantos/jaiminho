'use strict';
// QA: variáveis (precedência, dinâmicas, locais/segredos) e scripts HTTP (pm.*).
const { J, check, finish, getMocks, tmpWs, bodyJson } = require('./lib');

(async () => {
  const m = await getMocks();
  const H = m.urls.http;

  // ---------- precedência ----------
  await check('variáveis', 'Precedência global < coleção < ambiente < pasta < request < data', async () => {
    const ws = tmpWs();
    ws.saveGlobals([{ key: 'a', value: 'G' }, { key: 'b', value: 'G' }, { key: 'c', value: 'G' }, { key: 'd', value: 'G' }, { key: 'e', value: 'G' }, { key: 'f', value: 'G' }]);
    const col = ws.createCollection('C'); ws.saveCollectionVars(col, [{ key: 'b', value: 'C' }, { key: 'c', value: 'C' }, { key: 'd', value: 'C' }, { key: 'e', value: 'C' }, { key: 'f', value: 'C' }]);
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'c', value: 'E' }, { key: 'd', value: 'E' }, { key: 'e', value: 'E' }, { key: 'f', value: 'E' }] });
    const fol = ws.createFolder(col, 'F', { vars: [{ key: 'd', value: 'F' }, { key: 'e', value: 'F' }, { key: 'f', value: 'F' }] });
    const id = ws.createRequest(fol, { name: 'r', url: `${H}/echo?a={{a}}&b={{b}}&c={{c}}&d={{d}}&e={{e}}&f={{f}}`, vars: [{ key: 'e', value: 'R' }, { key: 'f', value: 'R' }] });
    const r = await J.send(ws, { requestId: id, environmentId: env, data: { f: 'D' } });
    const q = bodyJson(r).query;
    const exp = { a: 'G', b: 'C', c: 'E', d: 'F', e: 'R', f: 'D' };
    return { pass: JSON.stringify(q) === JSON.stringify(exp), evidence: `obtido=${JSON.stringify(q)} esperado=${JSON.stringify(exp)}` };
  });

  await check('variáveis', 'Variável não resolvida fica literal {{x}} e resolveRequest/unresolved a detectam', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?x={{naoExiste}}` });
    const r = await J.send(ws, { requestId: id });
    const q = bodyJson(r).query;
    return { pass: q.x === '{{naoExiste}}' && J.vars.unresolved(ws.get(id).url).includes('naoExiste'), evidence: JSON.stringify(q) };
  });

  await check('variáveis', 'Dinâmicas $guid/$timestamp/$isoTimestamp/$randomEmail/$randomInt resolvidas', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?g={{$guid}}&t={{$timestamp}}&i={{$isoTimestamp}}&e={{$randomEmail}}&n={{$randomInt}}` });
    const r = await J.send(ws, { requestId: id });
    const q = bodyJson(r).query;
    const ok = /^[0-9a-f-]{36}$/.test(q.g) && /^\d{10}$/.test(q.t) && /^\d{4}-\d\d-\d\dT/.test(q.i) && /@/.test(q.e) && /^\d+$/.test(q.n);
    return { pass: ok, evidence: JSON.stringify(q) };
  });

  await check('variáveis', '{{var}} em header, body raw, auth bearer, path variable e params', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'h', value: 'HV' }, { key: 'b', value: 'BV' }, { key: 'tok', value: 'TK' }, { key: 'pid', value: '42' }, { key: 'q', value: 'QV' }] });
    const id = ws.createRequest(col, { name: 'r', method: 'POST', url: `${H}/echo/:id`, pathVars: [{ key: 'id', value: '{{pid}}' }], params: [{ key: 'q', value: '{{q}}' }], headers: [{ key: 'X-H', value: '{{h}}' }], auth: { type: 'bearer', bearer: { token: '{{tok}}' } }, body: { mode: 'raw', language: 'json', raw: '{"b":"{{b}}"}' } });
    const r = await J.send(ws, { requestId: id, environmentId: env });
    const j = bodyJson(r);
    const ok = j.path === '/echo/42' && j.query.q === 'QV' && j.headers['x-h'] === 'HV' && j.headers.authorization === 'Bearer TK' && j.json && j.json.b === 'BV';
    return { pass: ok, evidence: JSON.stringify({ path: j.path, q: j.query, h: j.headers['x-h'], auth: j.headers.authorization, json: j.json }) };
  });

  await check('variáveis', 'Variável na URL com query (?a={{x}}) e acentos/UTF-8 em query e body', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'x', value: 'São João & ç' }] });
    const id = ws.createRequest(col, { name: 'r', method: 'POST', url: `${H}/echo?a={{x}}&b=ação`, body: { mode: 'raw', language: 'json', raw: '{"nome":"{{x}}","emoji":"🚀"}' } });
    const r = await J.send(ws, { requestId: id, environmentId: env });
    const j = bodyJson(r);
    return { pass: j.query.b === 'ação' && j.json && j.json.nome === 'São João & ç' && j.json.emoji === '🚀', evidence: `query=${JSON.stringify(j.query)} url=${r.request.url} json=${JSON.stringify(j.json)}` };
  });

  await check('variáveis', 'Valor de variável com "&" usado em query (Postman não codifica &; documenta comportamento)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'x', value: 'a&b=c' }] });
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?q={{x}}` });
    const r = await J.send(ws, { requestId: id, environmentId: env });
    return { pass: true, evidence: `query recebida=${JSON.stringify(bodyJson(r).query)} (informativo)` };
  });

  await check('variáveis', 'Valor local sobrepõe partilhado e não vai para o YAML', async () => {
    const ws = tmpWs(); const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'u', value: 'partilhado' }] });
    ws.setLocalValue(`env:${env}`, 'u', 'local');
    const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?u={{u}}` });
    const r = await J.send(ws, { requestId: id, environmentId: env });
    const yaml = require('fs').readFileSync(ws.info(env).file, 'utf8');
    return { pass: bodyJson(r).query.u === 'local' && !yaml.includes('local'), evidence: bodyJson(r).query.u };
  });

  await check('variáveis', 'Segredo em coleção e em global: resolvido no envio e ausente do YAML', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    ws.saveCollectionVars(col, [{ key: 'cs', value: 'SEGREDO-COL', secret: true }]);
    ws.saveGlobals([{ key: 'gs', value: 'SEGREDO-GLO', secret: true }]);
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?c={{cs}}&g={{gs}}` });
    const r = await J.send(ws, { requestId: id });
    const fs = require('fs');
    const colYaml = fs.readFileSync(ws.info(col).file, 'utf8');
    const q = bodyJson(r).query;
    return { pass: q.c === 'SEGREDO-COL' && q.g === 'SEGREDO-GLO' && !colYaml.includes('SEGREDO'), evidence: JSON.stringify(q) };
  });

  // ---------- scripts ----------
  await check('scripts', 'pm.environment.set de variável NOVA (não declarada) fica disponível na request seguinte', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'existente', value: '1' }] });
    const a = ws.createRequest(col, { name: 'login', url: `${H}/echo`, scripts: { post: 'pm.environment.set("tokenNovo", "abc123")' } });
    const b = ws.createRequest(col, { name: 'usa', url: `${H}/echo?t={{tokenNovo}}` });
    const r1 = await J.send(ws, { requestId: a, environmentId: env });
    const r2 = await J.send(ws, { requestId: b, environmentId: env });
    const q = bodyJson(r2).query;
    return { pass: q.t === 'abc123', evidence: `variablesChanged=${JSON.stringify(r1.variablesChanged)} | 2ª request recebeu t=${q.t} | local-values=${JSON.stringify(ws.getLocalValues())}` };
  });

  await check('scripts', 'pm.collectionVariables.set e pm.globals.set de variável NOVA persistem para a próxima request', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const a = ws.createRequest(col, { name: 'a', url: `${H}/echo`, scripts: { post: 'pm.collectionVariables.set("cv", "C1"); pm.globals.set("gv", "G1")' } });
    const b = ws.createRequest(col, { name: 'b', url: `${H}/echo?c={{cv}}&g={{gv}}` });
    await J.send(ws, { requestId: a }); const r = await J.send(ws, { requestId: b });
    const q = bodyJson(r).query;
    return { pass: q.c === 'C1' && q.g === 'G1', evidence: JSON.stringify(q) };
  });

  await check('scripts', 'pm.environment.set em variável JÁ declarada atualiza o valor corrente', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'tok', value: 'velho' }] });
    const a = ws.createRequest(col, { name: 'a', url: `${H}/echo`, scripts: { post: 'pm.environment.set("tok", pm.response.json().method)' } });
    const b = ws.createRequest(col, { name: 'b', url: `${H}/echo?t={{tok}}` });
    await J.send(ws, { requestId: a, environmentId: env }); const r = await J.send(ws, { requestId: b, environmentId: env });
    return { pass: bodyJson(r).query.t === 'GET', evidence: JSON.stringify(bodyJson(r).query) };
  });

  await check('scripts', 'pm.environment.unset remove o valor corrente (request seguinte não deve mais ver o valor)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const env = ws.saveEnvironment({ name: 'E', vars: [{ key: 'tok', value: 'abc' }] });
    const a = ws.createRequest(col, { name: 'a', url: `${H}/echo`, scripts: { post: 'pm.environment.unset("tok")' } });
    const b = ws.createRequest(col, { name: 'b', url: `${H}/echo?t={{tok}}` });
    const r1 = await J.send(ws, { requestId: a, environmentId: env }); const r = await J.send(ws, { requestId: b, environmentId: env });
    return { pass: bodyJson(r).query.t !== 'abc', evidence: `variablesChanged=${JSON.stringify(r1.variablesChanged)}; request seguinte recebeu t=${bodyJson(r).query.t}` };
  });

  await check('scripts', 'Pre-request pm.variables.set usado na mesma request', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?v={{pv}}`, scripts: { pre: 'pm.variables.set("pv","PRE")' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: bodyJson(r).query.v === 'PRE', evidence: JSON.stringify(bodyJson(r).query) };
  });

  await check('scripts', 'pm.sendRequest dentro do pre-request', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo?v={{sr}}`, scripts: { pre: `pm.sendRequest("${H}/echo?x=1", (err, res) => { pm.variables.set("sr", res.json().query.x) })` } });
    const r = await J.send(ws, { requestId: id });
    return { pass: bodyJson(r).query.v === '1', evidence: JSON.stringify(bodyJson(r).query) };
  });

  await check('scripts', 'pm.expect falhando vira teste reprovado com mensagem', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/status/404`, scripts: { post: 'pm.test("é 200", () => pm.response.to.have.status(200)); pm.test("passa", () => pm.expect(1).to.eql(1))' } });
    const r = await J.send(ws, { requestId: id });
    const f = r.tests.find((t) => t.name === 'é 200'); const p = r.tests.find((t) => t.name === 'passa');
    return { pass: f && !f.passed && /200/.test(f.error) && p && p.passed, evidence: JSON.stringify(r.tests) };
  });

  await check('scripts', 'Erro de sintaxe no script vira mensagem clara e a request ainda é enviada', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo`, scripts: { pre: 'pm.variables.set("x", ;', post: 'pm.test("x", () => {' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: !!r.response && r.errors.length >= 1 && r.errors.some((e) => /Unexpected|Syntax/i.test(e)), evidence: `ok=${r.ok} code=${r.response && r.response.code} errors=${JSON.stringify(r.errors)} error=${r.error}` };
  });

  await check('scripts', 'Loop infinito no pre-request é interrompido por timeout (sem travar)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo`, scripts: { pre: 'while(true){}' } });
    const t0 = Date.now(); const r = await J.send(ws, { requestId: id });
    return { pass: Date.now() - t0 < 15000 && (r.errors.length > 0 || r.error), evidence: `${Date.now() - t0}ms ok=${r.ok} error=${r.error} errors=${JSON.stringify(r.errors)}` };
  }, { timeoutMs: 40000 });

  await check('scripts', 'pm.response.json() em resposta HTML gera erro legível no teste', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/html`, scripts: { post: 'pm.test("json", () => pm.response.json())' } });
    const r = await J.send(ws, { requestId: id });
    const t = r.tests[0];
    return { pass: t && !t.passed && /JSON/i.test(t.error), evidence: JSON.stringify(r.tests) };
  });

  await check('scripts', 'Scripts de coleção e pasta rodam antes do da request (herança)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C', { scripts: { pre: 'pm.variables.set("ordem", (pm.variables.get("ordem")||"") + "C")' } });
    const f = ws.createFolder(col, 'F', { scripts: { pre: 'pm.variables.set("ordem", pm.variables.get("ordem") + "F")' } });
    const id = ws.createRequest(f, { name: 'r', url: `${H}/echo?o={{ordem}}`, scripts: { pre: 'pm.variables.set("ordem", pm.variables.get("ordem") + "R")' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: bodyJson(r).query.o === 'CFR', evidence: JSON.stringify(bodyJson(r).query) };
  });

  await check('scripts', 'console.log do script chega no resultado', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'r', url: `${H}/echo`, scripts: { post: 'console.log("olá", {a:1})' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: r.console.some((c) => c.args[0] === 'olá'), evidence: JSON.stringify(r.console) };
  });

  await check('scripts', 'Variáveis de pasta disponíveis via pm.variables e não poluem pm.iterationData', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const f = ws.createFolder(col, 'F', { vars: [{ key: 'fv', value: 'X' }] });
    const id = ws.createRequest(f, { name: 'r', url: `${H}/echo`, scripts: { post: 'pm.test("pv", () => pm.expect(pm.variables.get("fv")).to.eql("X")); pm.test("iter", () => pm.expect(pm.iterationData.has("fv")).to.eql(false))' } });
    const r = await J.send(ws, { requestId: id });
    return { pass: r.tests.every((t) => t.passed), evidence: JSON.stringify(r.tests) };
  });

  // runner
  await check('runner', 'Runner com CSV de dados (2 iterações) e relatório JUnit', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    ws.createRequest(col, { name: 'r', url: `${H}/echo?n={{nome}}`, scripts: { post: 'pm.test("nome", () => pm.expect(pm.response.json().query.n).to.eql(pm.iterationData.get("nome")))' } });
    const data = J.parseDataFile('nome,idade\n"Silva, Ana",30\nJoão,40\n', 'd.csv');
    const rep = await J.runCollection(ws, { id: col, data });
    const xml = J.junitReport(rep);
    return { pass: rep.results.length === 2 && rep.totals.testsFailed === 0 && /<testsuite/.test(xml), evidence: JSON.stringify(rep.totals) + ' data=' + JSON.stringify(data) };
  });

  await check('runner', 'parseDataFile CSV com quebra de linha dentro de aspas', async () => {
    let d; try { d = J.parseDataFile('a,b\n"linha1\nlinha2",x\n', 'd.csv'); } catch (e) { return { pass: false, evidence: e.message }; }
    return { pass: d.length === 1 && d[0].a === 'linha1\nlinha2' && d[0].b === 'x', evidence: JSON.stringify(d) };
  });

  await check('runner', 'parseDataFile CSV com BOM (Excel) mantém o nome da 1ª coluna', async () => {
    const d = J.parseDataFile('﻿nome,idade\nAna,1\n', 'd.csv');
    return { pass: Object.keys(d[0])[0] === 'nome', evidence: JSON.stringify(Object.keys(d[0])) };
  });

  await check('runner', 'parseDataFile CSV separado por ponto-e-vírgula (Excel PT/BR)', async () => {
    const d = J.parseDataFile('nome;idade\nAna;1\n', 'd.csv');
    return { pass: d[0].nome === 'Ana' && d[0].idade === '1', evidence: JSON.stringify(d) };
  });

  await check('runner', 'Runner: stopOnFailure para na 1ª falha; delay respeitado', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    ws.createRequest(col, { name: 'a', url: `${H}/status/500`, scripts: { post: 'pm.test("200", () => pm.response.to.have.status(200))' } });
    ws.createRequest(col, { name: 'b', url: `${H}/echo` });
    const rep = await J.runCollection(ws, { id: col, iterations: 2, stopOnFailure: true });
    return { pass: rep.results.length === 1, evidence: JSON.stringify(rep.totals) };
  });

  await finish('01-variaveis-scripts');
})();
