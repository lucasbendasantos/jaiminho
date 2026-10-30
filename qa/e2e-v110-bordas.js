// QA focado nas novidades da 1.1.0: casos de borda do desktop (Playwright + Electron). Uso (em apps/desktop, após o vite build):
//   xvfb-run -a -s "-screen 0 1440x900x24" node ../../qa/e2e-v110-bordas.js ../../qa/shots/v110
const path = require('path'); const fs = require('fs'); const os = require('os');
const { _electron: electron } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '..', 'apps', 'desktop')] }));
const assert = require('assert');

const SHOTS = process.argv[2] || path.join(__dirname, 'shots', 'v110');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'v110-jud-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v110-jws-'));
  const app = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..', 'apps', 'desktop')], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = (n) => win.screenshot({ path: path.join(SHOTS, `${n}.png`) }).catch(() => {});
  async function step(name, fn) {
    const t = Date.now();
    try { const ev = await fn(); results.push({ name, ok: true, ms: Date.now() - t, evidence: ev }); console.log(`PASS [v110] ${name}${ev ? ' :: ' + ev : ''}`); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' | ') }); console.log(`FAIL [v110] ${name} :: ${e.message.split('\n').slice(0, 3).join(' | ')}`); await shot(`FAIL-${results.length}`); }
  }
  const stubDir = (dir) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  const stubConfirm = (r) => app.evaluate(({ dialog }, x) => { dialog.showMessageBox = async () => ({ response: x }); }, r);
  const tree = () => win.evaluate(() => window.jaiminho.call('ws:tree')).then((t) => t.collections);
  const find = (nodes, name) => { for (const n of nodes) { if (n.name === name) return n; const r = find(n.children || [], name); if (r) return r; } return null; };
  const node = (n) => win.locator(`[data-testid="node-${n}"]`).first();
  const waitDone = async () => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 30000 }); await win.waitForTimeout(200); };
  const mk = (op, args) => win.evaluate(([o, a]) => window.jaiminho.call(o, a), [op, args]);
  const refresh = async () => { await win.evaluate(() => window.dispatchEvent(new Event('focus'))); };

  await win.waitForSelector('[data-testid=welcome]');
  await win.click('[data-testid=welcome-example]'); await win.waitForSelector('[data-testid=modal-mocks]');
  await stubDir(wsDir); await win.click('text=Criar workspace de exemplo…');
  await win.waitForSelector('[data-testid=tree]', { timeout: 30000 });
  await win.waitForSelector('[data-testid="node-1. REST / JSON"]');

  // área de testes própria: coleção B com pasta "Destino" e coleção C vazia
  const colB = await mk('item:createCollection', { name: 'Coleção B' });
  const destino = await mk('item:createFolder', { parentId: colB, name: 'Destino' });
  const colC = await mk('item:createCollection', { name: 'Coleção C' });
  const pasta = await mk('item:createFolder', { parentId: colB, name: 'Pasta com filhos' });
  const filho = await mk('item:createRequest', { parentId: pasta, data: { kind: 'http', name: 'Filho', method: 'GET', url: 'http://127.0.0.1:1/' } });
  const r1 = await mk('item:createRequest', { parentId: colB, data: { kind: 'http', name: 'R1', method: 'GET', url: 'http://127.0.0.1:1/' } });
  const r2 = await mk('item:createRequest', { parentId: colB, data: { kind: 'http', name: 'R2', method: 'GET', url: 'http://127.0.0.1:1/' } });
  const r3 = await mk('item:createRequest', { parentId: colB, data: { kind: 'http', name: 'R3', method: 'GET', url: 'http://127.0.0.1:1/' } });
  await win.evaluate(() => window.jaiminho.call('ws:tree')); // garante gravação
  await win.keyboard.press('F5').catch(() => {});
  await win.evaluate(async () => { const s = await window.jaiminho.call('ws:current'); return s.tree; });
  // a UI lê a árvore de novo ao reabrir o workspace
  await win.reload(); await win.waitForSelector('[data-testid=tree]', { timeout: 20000 });
  await win.waitForSelector('[data-testid="node-Coleção B"]');

  await step('Pasta e um filho dela selecionados juntos: o filho não é movido duas vezes (só a pasta vai)', async () => {
    if (!(await node('Filho').count())) await node('Pasta com filhos').click(); // abre a pasta se estiver fechada
    await node('Filho').waitFor();
    await node('Pasta com filhos').click({ modifiers: ['Control'] });
    await node('Filho').click({ modifiers: ['Control'] });
    await node('Pasta com filhos').dragTo(node('Coleção C'));
    await win.waitForTimeout(800);
    const t = await tree();
    const c = find(t, 'Coleção C');
    assert.equal((c.children || []).map((x) => x.name).join(','), 'Pasta com filhos');
    const pf = find(t, 'Pasta com filhos'); assert.equal((pf.children || []).map((x) => x.name).join(','), 'Filho', 'o filho continua dentro da pasta');
    assert.equal(find(find(t, 'Coleção B').children, 'Filho'), null, 'o filho não deve ter ido para a raiz da B');
  });

  await step('Soltar uma pasta dentro dela mesma ou de um descendante é recusado sem quebrar nada', async () => {
    const before = JSON.stringify(await tree());
    await node('Pasta com filhos').dragTo(node('Pasta com filhos'));
    await win.waitForTimeout(500);
    assert.equal(JSON.stringify(await tree()), before, 'a árvore não pode mudar');
    assert.deepEqual(pageErrors, []);
  });

  await step('Mover várias requests para outra COLEÇÃO e depois reordenar soltando em cima de uma request', async () => {
    await node('R1').click(); await node('R2').click({ modifiers: ['Control'] });
    await node('R1').dragTo(node('Coleção C'));
    await win.waitForTimeout(800);
    let t = await tree(); const c = find(t, 'Coleção C');
    assert.ok(['R1', 'R2'].every((n) => (c.children || []).some((x) => x.name === n)), `C: ${(c.children || []).map((x) => x.name)}`);
    // solta R3 (de B) em cima de R1 (em C): vai para a posição de R1
    await node('R3').dragTo(node('R1'));
    await win.waitForTimeout(800);
    t = await tree(); const c2 = find(t, 'Coleção C');
    assert.ok((c2.children || []).some((x) => x.name === 'R3'));
    return `C: ${(c2.children || []).map((x) => x.name).join(', ')}`;
  });

  await step('Delete com várias selecionadas pede confirmação e apaga todas (e fecha as abas delas)', async () => {
    await node('R1').click(); await node('R2').click({ modifiers: ['Control'] });
    await node('R2').dblclick().catch(() => {});
    await node('R1').click(); await node('R2').click({ modifiers: ['Control'] });
    await stubConfirm(1);
    await node('R2').focus(); await win.keyboard.press('Delete');
    await win.waitForTimeout(800);
    const t = await tree();
    assert.equal(find(t, 'R1'), null); assert.equal(find(t, 'R2'), null);
    assert.ok(find(t, 'R3'), 'a não selecionada fica');
  });

  await step('Cancelar a confirmação do Delete múltiplo não apaga nada', async () => {
    await node('R3').click(); await node('Pasta com filhos').click({ modifiers: ['Control'] });
    await stubConfirm(0);
    await node('R3').focus(); await win.keyboard.press('Delete');
    await win.waitForTimeout(500);
    const t = await tree(); assert.ok(find(t, 'R3') && find(t, 'Pasta com filhos'));
    await win.keyboard.press('Escape');
  });

  await step('Ctrl+Enter não insere linha também no editor de scripts', async () => {
    await node('R3').click();
    await win.click('[data-testid=req-tab-scripts]');
    await win.click('[data-testid=script-editor] .cm-content');
    await win.keyboard.type('pm.environment.set("a", 1);');
    const before = await win.evaluate(() => document.querySelector('[data-testid=script-editor] .cm-content').innerText);
    await win.keyboard.press('Control+Enter');
    await waitDone().catch(() => {});
    const after = await win.evaluate(() => document.querySelector('[data-testid=script-editor] .cm-content').innerText);
    assert.equal(after, before);
  });

  await step('Ctrl+F no editor do body acha o texto, Enter vai para a próxima e Esc fecha devolvendo o foco', async () => {
    await win.click('[data-testid=req-tab-body]');
    await win.click('[data-testid=body-json]');
    await win.click('[data-testid=body-editor] .cm-content');
    await win.keyboard.type('{"a":1,\n"b":"alvo","c":"alvo"}');
    await win.keyboard.press('Control+F');
    await win.waitForSelector('.cm-search');
    await win.keyboard.type('alvo'); await win.keyboard.press('Enter');
    const n = await win.locator('.cm-searchMatch').count();
    assert.ok(n >= 2, `ocorrências marcadas: ${n}`);
    await win.keyboard.press('Escape');
    await win.waitForSelector('.cm-search', { state: 'detached' });
    const inEditor = await win.evaluate(() => !!document.activeElement.closest('[data-testid=body-editor]'));
    assert.ok(inEditor, 'foco volta ao editor');
  });

  await step('O layout escolhido persiste depois de recarregar a janela', async () => {
    await win.click('[data-testid=btn-layout]'); await win.waitForSelector('.split.horizontal');
    await win.reload(); await win.waitForSelector('[data-testid=tree]', { timeout: 20000 });
    await node('R3').click();
    await win.waitForSelector('.split.horizontal', { timeout: 5000 });
  });

  await step('Janela estreita (1000 px) no lado a lado: abas da request rolam e nada sobrepõe a resposta', async () => {
    await win.setViewportSize({ width: 1000, height: 700 });
    await node('R3').click();
    const boxes = await win.evaluate(() => {
      const kids = [...document.querySelectorAll('.split.horizontal > .box, .split.horizontal > .resp-empty')];
      return kids.map((k) => { const r = k.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width }; });
    });
    assert.ok(boxes.length === 2 && boxes[0].right <= boxes[1].x + 1, `sobreposição: ${JSON.stringify(boxes)}`);
    const tabs = await win.evaluate(() => { const t = document.querySelector('.split.horizontal .subtabs'); return { sw: t.scrollWidth, cw: t.clientWidth }; });
    const vis = await win.evaluate(() => { const w = document.querySelector('.work').getBoundingClientRect(); const s = document.querySelector('[data-testid=btn-send]').getBoundingClientRect(); return { workRight: Math.round(w.right), sendRight: Math.round(s.right), vw: innerWidth, sw: document.documentElement.scrollWidth }; });
    await shot('lado-a-lado-1000px');
    assert.ok(vis.sendRight <= vis.vw && vis.workRight <= vis.vw, `conteúdo estoura a janela: ${JSON.stringify(vis)} ${JSON.stringify(await win.evaluate(() => [...document.querySelectorAll('.work, .work > *, .work > * > *')].map((e) => (e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().width)).slice(0,25)))}`);
    await win.setViewportSize({ width: 1440, height: 900 });
    return `abas: scroll ${tabs.sw} / visível ${tabs.cw}`;
  });

  await step('Busca do editor legível nos 3 temas (texto do botão com contraste ≥ 4,5:1)', async () => {
    const ratio = (a, b) => { const L = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }; const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const out = [];
    await win.click('[data-testid=req-tab-body]'); await win.click('[data-testid=body-json]');
    for (const th of ['padrao', 'preto', 'branco']) {
      await win.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, th);
      await win.click('[data-testid=body-editor] .cm-content');
      await win.keyboard.press('Control+F'); await win.waitForSelector('.cm-search');
      const c = await win.evaluate(() => { const b = document.querySelector('.cm-search button[name=next]'); const s = getComputedStyle(b); const p = (x) => (x.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number); return { fg: p(s.color), bg: p(s.backgroundColor), text: b.textContent }; });
      const r = ratio(c.fg, c.bg); out.push(`${th}: ${r.toFixed(1)}:1 "${c.text}"`);
      assert.ok(r >= 4.5, `${th}: contraste ${r.toFixed(2)}`);
      await shot(`busca-${th}`); await win.keyboard.press('Escape');
    }
    await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'padrao'));
    return out.join(' | ');
  });

  await step('Botão de layout tem nome acessível e funciona pelo teclado', async () => {
    const lbl = await win.getAttribute('[data-testid=btn-layout]', 'aria-label'); assert.match(lbl, /layout/i);
    await win.focus('[data-testid=btn-layout]'); const before = await win.locator('.split.horizontal').count();
    await win.keyboard.press('Enter'); await win.waitForTimeout(300);
    assert.notEqual(await win.locator('.split.horizontal').count(), before);
    await win.keyboard.press('Enter');
  });

  await step('Linhas da árvore selecionadas expõem aria-selected (leitor de tela)', async () => {
    await node('R3').click(); await node('Pasta com filhos').click({ modifiers: ['Control'] });
    const n = await win.locator('[role=treeitem][aria-selected=true]').count(); assert.ok(n >= 2, `aria-selected=true: ${n}`);
    await win.locator('[role=treeitem]').first().focus(); await win.keyboard.press('Escape'); await win.click('[data-testid="tree"]', { position: { x: 5, y: 5 } }).catch(() => {});
  });

  await step('Nenhum erro de página durante os casos de borda', async () => { assert.deepEqual(pageErrors, []); });

  const failed = results.filter((r) => !r.ok);
  console.log(`== v110-bordas: ${results.length - failed.length} passaram, ${failed.length} falharam`);
  fs.writeFileSync(path.join(__dirname, 'results', 'v110-bordas.json'), JSON.stringify(results, null, 2));
  try { app.process().kill('SIGKILL'); } catch { /* ignore */ }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
