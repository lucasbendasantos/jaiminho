'use strict';
// QA: workspace em disco (renomear/mover/duplicar/apagar, nomes, reabrir, body grande, YAML legível e portável).
const fs = require('fs');
const path = require('path');
const { J, check, finish, tmpWs } = require('./lib');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const snapshot = (ws) => { const out = {}; for (const [id, n] of ws.index) { const d = ws.get(id); out[id] = { type: n.type, name: d.name, url: d.url, raw: d.body && d.body.raw, parent: n.parentId }; } return out; };

(async () => {
  await check('workspace', 'Nomes com acento e caracteres proibidos no Windows (: * ? " < > |) geram arquivos válidos e o nome original é preservado', async () => {
    const ws = tmpWs(); const names = ['Ação: teste*?', 'a"b<c>d|e', 'CON', 'nul', 'aux.txt', 'pasta.', 'trailing space ', '日本語', '..'];
    const col = ws.createCollection('Coleção'); const ids = names.map((n) => ws.createRequest(col, { name: n, url: 'u' }));
    const files = walk(ws.dir).map((f) => path.relative(ws.dir, f));
    const bad = files.filter((f) => f.split(path.sep).some((seg) => /[:*?"<>|]/.test(seg) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(seg.replace(/^\d+-/, '').replace(/\.req\.yaml$/, '')) || /[ .]$/.test(seg)));
    const ws2 = J.Workspace.open(ws.dir); const back = ids.map((id) => ws2.get(id).name);
    return { pass: bad.length === 0 && JSON.stringify(back) === JSON.stringify(names), evidence: `inválidos no Windows: ${JSON.stringify(bad)}; nomes relidos ok=${JSON.stringify(back) === JSON.stringify(names)}; arquivos=${files.filter((f) => f.endsWith('.req.yaml')).map((f) => path.basename(f)).join(', ')}` };
  });
  await check('workspace', 'Coleção com nome reservado do Windows ("CON", "Aux") vira pasta válida', async () => {
    const ws = tmpWs(); const id = ws.createCollection('CON'); const id2 = ws.createCollection('Aux');
    const dirs = [ws.info(id).dir, ws.info(id2).dir].map((d) => path.basename(d));
    return { pass: dirs.every((d) => !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(d)), evidence: JSON.stringify(dirs) };
  });
  await check('workspace', 'Nomes iguais na mesma pasta não se sobrescrevem', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const a = ws.createRequest(col, { name: 'Igual', url: 'a' }); const b = ws.createRequest(col, { name: 'Igual', url: 'b' });
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.get(a).url === 'a' && ws2.get(b).url === 'b', evidence: ws2.children(col).map((i) => ws2.get(i).url).join(',') };
  });
  await check('workspace', 'Renomear request para o MESMO nome de uma irmã (colisão) mantém as duas', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const a = ws.createRequest(col, { name: 'A', url: 'a' }); const b = ws.createRequest(col, { name: 'B', url: 'b' });
    ws.save(b, { ...ws.get(b), name: 'A' });
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.get(a).url === 'a' && ws2.get(b).name === 'A' && ws2.get(b).url === 'b', evidence: walk(ws.dir).filter((f) => f.endsWith('.yaml')).map((f) => path.basename(f)).join(',') };
  });
  await check('workspace', 'Renomear pasta e request: arquivos acompanham e nada se perde ao reabrir', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const f = ws.createFolder(col, 'Pasta'); const r = ws.createRequest(f, { name: 'Req', url: 'x' });
    ws.save(f, { ...ws.get(f), name: 'Pasta Nova' }); ws.save(r, { ...ws.get(r), name: 'Req Nova' });
    const before = snapshot(ws); const ws2 = J.Workspace.open(ws.dir); const after = snapshot(ws2);
    return { pass: JSON.stringify(before) === JSON.stringify(after) && ws2.get(r).name === 'Req Nova', evidence: walk(ws.dir).map((p) => path.relative(ws.dir, p)).filter((p) => p.startsWith('collections')).join(', ') };
  });
  await check('workspace', 'Request com body grande (>4KB) vai para arquivo irmão e volta ao ler', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const big = '<a>' + 'x'.repeat(5000) + '</a>';
    const id = ws.createRequest(col, { name: 'Grande', kind: 'soap', url: 'u', body: { mode: 'raw', language: 'xml', raw: big } });
    const files = fs.readdirSync(ws.info(col).dir);
    const yaml = fs.readFileSync(ws.info(id).file, 'utf8');
    return { pass: files.some((f) => f.endsWith('.body.xml')) && !yaml.includes('xxxxx') && ws.get(id).body.raw === big, evidence: files.join(',') };
  });
  await check('workspace', 'Renomear request com body grande leva o arquivo do body junto', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const big = '{"a":"' + 'y'.repeat(5000) + '"}';
    const id = ws.createRequest(col, { name: 'Um', url: 'u', body: { mode: 'raw', language: 'json', raw: big } });
    ws.save(id, { ...ws.get(id), name: 'Dois' });
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.get(id).body.raw === big, evidence: fs.readdirSync(ws.info(col).dir).join(',') };
  });
  await check('workspace', 'Body grande que encolhe (<4KB) remove o arquivo irmão', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'X', url: 'u', body: { mode: 'raw', language: 'json', raw: 'z'.repeat(5000) } });
    ws.save(id, { ...ws.get(id), body: { mode: 'raw', language: 'json', raw: 'pequeno' } });
    return { pass: !fs.readdirSync(ws.info(col).dir).some((f) => f.includes('.body.')) && ws.get(id).body.raw === 'pequeno', evidence: fs.readdirSync(ws.info(col).dir).join(',') };
  });
  await check('workspace', 'Trocar a linguagem do body grande (json→xml) não deixa arquivo órfão nem body errado', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const id = ws.createRequest(col, { name: 'X', url: 'u', body: { mode: 'raw', language: 'json', raw: 'j'.repeat(5000) } });
    const xmlBig = '<x>' + 'k'.repeat(5000) + '</x>';
    ws.save(id, { ...ws.get(id), body: { mode: 'raw', language: 'xml', raw: xmlBig } });
    const files = fs.readdirSync(ws.info(col).dir);
    return { pass: ws.get(id).body.raw === xmlBig && files.filter((f) => f.includes('.body.')).length === 1, evidence: files.join(',') };
  });
  await check('workspace', 'Mover request para outra pasta e reordenar (inclui request com body grande)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const f1 = ws.createFolder(col, 'F1'); const f2 = ws.createFolder(col, 'F2');
    const big = 'B'.repeat(6000);
    const a = ws.createRequest(f1, { name: 'a', url: 'a', body: { mode: 'raw', language: 'json', raw: big } }); const b = ws.createRequest(f1, { name: 'b', url: 'b' }); const c = ws.createRequest(f2, { name: 'c', url: 'c' });
    ws.move(a, f2, 0);
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: JSON.stringify(ws2.children(f2)) === JSON.stringify([a, c]) && ws2.get(a).body.raw === big && JSON.stringify(ws2.children(f1)) === JSON.stringify([b]), evidence: walk(ws.dir).map((p) => path.relative(ws.dir, p)).filter((p) => p.startsWith('collections')).join(', ') };
  });
  await check('workspace', 'Reordenar dentro da MESMA pasta: trocar posições de requests com body grande (renumeração com colisão)', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const bodies = ['1', '2', '3'].map((d) => d.repeat(5000));
    const ids = ['um', 'dois', 'tres'].map((n, i) => ws.createRequest(col, { name: n, url: n, body: { mode: 'raw', language: 'json', raw: bodies[i] } }));
    ws.move(ids[2], col, 0); // tres, um, dois
    ws.move(ids[0], col, 2); // tres, dois, um
    const ws2 = J.Workspace.open(ws.dir);
    const order = ws2.children(col).map((i) => ws2.get(i).name);
    const okBodies = ids.every((id, i) => ws2.index.has(id) && ws2.get(id).body.raw === bodies[i]);
    return { pass: JSON.stringify(order) === '["tres","dois","um"]' && okBodies, evidence: `ordem=${JSON.stringify(order)} bodies ok=${okBodies} arquivos=${fs.readdirSync(ws.info(col).dir).join(',')}` };
  });
  await check('workspace', 'Reordenar pastas irmãs com nomes iguais', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C');
    const f = [ws.createFolder(col, 'Mesma'), ws.createFolder(col, 'Mesma'), ws.createFolder(col, 'Mesma')];
    f.forEach((id, i) => ws.createRequest(id, { name: `r${i}`, url: String(i) }));
    ws.move(f[2], col, 0);
    const ws2 = J.Workspace.open(ws.dir);
    const order = ws2.children(col).map((id) => ws2.get(ws2.children(id)[0]).name);
    return { pass: JSON.stringify(order) === '["r2","r0","r1"]', evidence: `${JSON.stringify(order)} ${fs.readdirSync(ws.info(col).dir).join(',')}` };
  });
  await check('workspace', 'Mover pasta para dentro dela mesma é recusado', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const f = ws.createFolder(col, 'F'); const g = ws.createFolder(f, 'G');
    try { ws.move(f, g); return { pass: false, evidence: 'aceitou' }; } catch (e) { return { pass: /dentro dela mesma/.test(e.message), evidence: e.message }; }
  });
  await check('workspace', 'Mover request para outra COLEÇÃO', async () => {
    const ws = tmpWs(); const c1 = ws.createCollection('C1'); const c2 = ws.createCollection('C2'); const r = ws.createRequest(c1, { name: 'r', url: 'x' });
    ws.move(r, c2);
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.info(r).collectionId === c2 && ws2.children(c2).includes(r) && ws2.children(c1).length === 0, evidence: JSON.stringify(ws2.info(r)) };
  });
  await check('workspace', 'Duplicar request, pasta (com filhos) e coleção', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C', { auth: { type: 'bearer', bearer: { token: 't' } } }); const f = ws.createFolder(col, 'F', { vars: [{ key: 'v', value: '1' }] }); ws.createRequest(f, { name: 'r', url: 'x' });
    const dr = ws.duplicate(ws.children(f)[0]); const df = ws.duplicate(f); const dc = ws.duplicate(col);
    const ws2 = J.Workspace.open(ws.dir);
    const ok = ws2.get(dr).name === 'r (cópia)' && ws2.children(df).length === 2 && ws2.get(df).vars[0].key === 'v' && ws2.get(dc).auth.type === 'bearer' && ws2.children(dc).length === 2 && ws2.children(ws2.children(dc)[0]).length === 2;
    const fyaml = fs.readFileSync(ws2.info(df).file, 'utf8');
    return { pass: ok && !/type: folder/.test(fyaml), evidence: `ok=${ok} _folder.yaml duplicado:\n${fyaml}` };
  });
  await check('workspace', 'Duplicar coleção com variável SEGREDO mantém o segredo na cópia', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); ws.saveCollectionVars(col, [{ key: 's', value: 'S1', secret: true }]);
    const dc = ws.duplicate(col);
    const v = ws.effectiveVars(`col:${dc}`, ws.get(dc).vars);
    return { pass: v[0] && v[0].value === 'S1', evidence: `cópia: ${JSON.stringify(v)} missingSecrets=${JSON.stringify(ws.missingSecrets())}` };
  });
  await check('workspace', 'Duplicar ambiente com segredo mantém o segredo na cópia', async () => {
    const ws = tmpWs(); const e = ws.saveEnvironment({ name: 'E', vars: [{ key: 's', value: 'S1', secret: true }] });
    const d = ws.duplicate(e);
    const v = ws.effectiveVars(`env:${d}`, ws.getEnvironment(d).vars);
    return { pass: v[0] && v[0].value === 'S1', evidence: JSON.stringify(v) };
  });
  await check('workspace', 'Apagar vai para lixeira (.jaiminho/lixeira) e some da árvore; body grande também vai', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const r = ws.createRequest(col, { name: 'r', url: 'x', body: { mode: 'raw', language: 'json', raw: 'q'.repeat(5000) } });
    ws.remove(r);
    const trash = walk(path.join(ws.dir, '.jaiminho', 'lixeira')).map((f) => path.basename(f));
    return { pass: !ws.index.has(r) && trash.some((f) => f.endsWith('.req.yaml')) && trash.some((f) => f.includes('.body.')) && fs.readdirSync(ws.info(col).dir).length === 1, evidence: trash.join(',') };
  });
  await check('workspace', 'Apagar duas coisas no mesmo milissegundo com mesmo nome de arquivo não perde a primeira na lixeira', async () => {
    const ws = tmpWs(); const c1 = ws.createCollection('C1'); const c2 = ws.createCollection('C2');
    const a = ws.createRequest(c1, { name: 'r', url: 'a' }); const b = ws.createRequest(c2, { name: 'r', url: 'b' });
    const realNow = Date.now; Date.now = () => 1234567890000; try { ws.remove(a); ws.remove(b); } finally { Date.now = realNow; }
    const trash = walk(path.join(ws.dir, '.jaiminho', 'lixeira'));
    return { pass: trash.length === 2, evidence: `${trash.length} arquivo(s) na lixeira: ${trash.map((f) => path.relative(ws.dir, f)).join(', ')}` };
  });
  await check('workspace', 'Apagar ambiente', async () => {
    const ws = tmpWs(); const e = ws.saveEnvironment({ name: 'E' }); ws.remove(e);
    return { pass: ws.listEnvironments().length === 0, evidence: '' };
  });
  await check('workspace', 'Dois ambientes com o mesmo nome não se sobrescrevem', async () => {
    const ws = tmpWs(); ws.saveEnvironment({ name: 'Prod', vars: [{ key: 'a', value: '1' }] }); ws.saveEnvironment({ name: 'Prod', vars: [{ key: 'a', value: '2' }] });
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.listEnvironments().length === 2, evidence: fs.readdirSync(path.join(ws.dir, 'environments')).join(',') };
  });
  await check('workspace', 'Renomear ambiente renomeia/preserva arquivo (sem duplicar)', async () => {
    const ws = tmpWs(); const e = ws.saveEnvironment({ name: 'Dev' }); ws.saveEnvironment({ ...ws.getEnvironment(e), name: 'Desenvolvimento' });
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.listEnvironments().length === 1 && ws2.listEnvironments()[0].name === 'Desenvolvimento', evidence: fs.readdirSync(path.join(ws.dir, 'environments')).join(',') };
  });
  await check('workspace', 'YAML legível (sem caminhos absolutos do PC) em todo o workspace partilhado', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C', { description: 'linha1\nlinha2' });
    ws.createRequest(col, { name: 'r', url: 'http://x', body: { mode: 'raw', language: 'json', raw: '{\n  "a": 1\n}' }, scripts: { post: 'pm.test("a", () => {\n})' } });
    const files = walk(ws.dir).filter((f) => !f.includes(`${path.sep}.jaiminho${path.sep}`));
    const abs = files.filter((f) => fs.readFileSync(f, 'utf8').includes(ws.dir) || fs.readFileSync(f, 'utf8').includes('/tmp/'));
    const sample = fs.readFileSync(files.find((f) => f.endsWith('.req.yaml')), 'utf8');
    return { pass: abs.length === 0 && /raw: \|/.test(sample), evidence: `com caminho absoluto: ${JSON.stringify(abs)}\n${sample}` };
  });
  await check('workspace', 'Request salva com chaves "type"/"id" corretas e sem campos de UI', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const id = ws.createRequest(col, { name: 'r', url: 'u' });
    ws.save(id, { ...ws.get(id), url: 'v' });
    const y = fs.readFileSync(ws.info(id).file, 'utf8');
    return { pass: !/^type:/m.test(y) && /^id:/m.test(y), evidence: y };
  });
  await check('workspace', 'Arquivo YAML corrompido (editado à mão / conflito de git) não impede de abrir o workspace', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const a = ws.createRequest(col, { name: 'ok', url: 'a' }); const b = ws.createRequest(col, { name: 'ruim', url: 'b' });
    fs.writeFileSync(ws.info(b).file, 'id: x\nname: "sem fechar\n<<<<<<< HEAD\nurl: [\n');
    try { const ws2 = J.Workspace.open(ws.dir); return { pass: ws2.index.has(a), evidence: `abriu; itens=${ws2.index.size}` }; } catch (e) { return { pass: false, evidence: `workspace inteiro não abre: ${e.message.split('\n')[0]}` }; }
  });
  await check('workspace', 'Dois arquivos com o MESMO id (cópia manual de arquivo / merge git) não somem silenciosamente', async () => {
    const ws = tmpWs(); const col = ws.createCollection('C'); const a = ws.createRequest(col, { name: 'orig', url: 'a' });
    fs.copyFileSync(ws.info(a).file, path.join(ws.info(col).dir, '020-copia-manual.req.yaml'));
    const ws2 = J.Workspace.open(ws.dir);
    return { pass: ws2.children(col).length === 2, evidence: `requests visíveis=${ws2.children(col).length} arquivos=${fs.readdirSync(ws.info(col).dir).join(',')}` };
  });
  await check('workspace', 'Abrir pasta que não é workspace → erro claro', async () => {
    try { J.Workspace.open(require('os').tmpdir()); return { pass: false }; } catch (e) { return { pass: /jaiminho\.yaml/.test(e.message), evidence: e.message }; }
  });
  await check('workspace', 'Renomear workspace persiste', async () => {
    const ws = tmpWs(); ws.rename('Novo Nome ç'); return { pass: J.Workspace.open(ws.dir).name === 'Novo Nome ç', evidence: '' };
  });
  await check('workspace', '.gitignore inclui .jaiminho/ e .tmp de escrita atômica não sobra', async () => {
    const ws = tmpWs(); ws.createCollection('C');
    const tmp = walk(ws.dir).filter((f) => f.endsWith('.tmp'));
    return { pass: fs.readFileSync(path.join(ws.dir, '.gitignore'), 'utf8').includes('.jaiminho/') && tmp.length === 0, evidence: JSON.stringify(tmp) };
  });
  await check('workspace', 'Histórico: grava e lista (limite 2000)', async () => {
    const ws = tmpWs(); ws.addHistory({ name: 'a' }); ws.addHistory({ name: 'b' });
    const h = ws.listHistory(); return { pass: h.length === 2 && h[0].name === 'b', evidence: JSON.stringify(h.map((x) => x.name)) };
  });
  await check('workspace', 'Segredos com cipher errado (outro PC/usuário) → missingSecrets lista em vez de quebrar', async () => {
    const ws = tmpWs(); ws.saveEnvironment({ name: 'E', vars: [{ key: 's', value: 'v', secret: true }] });
    const other = { encrypt: (s) => s, decrypt: () => { throw new Error('chave errada'); } };
    const ws2 = J.Workspace.open(ws.dir, { cipher: other });
    return { pass: ws2.missingSecrets().length === 1, evidence: JSON.stringify(ws2.missingSecrets()) };
  });

  await finish('06-workspace');
})();
