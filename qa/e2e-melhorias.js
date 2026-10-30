// QA e2e das melhorias da v1.1 (Playwright + Electron). Uso (em apps/desktop, após o vite build):
//   xvfb-run -a -s "-screen 0 1440x900x24" node ../../qa/e2e-melhorias.js ../../qa/shots/melhorias
// Cobre: multisseleção + arrastar várias requests, Ctrl+Enter sem quebrar linha, Ctrl+F, layout lado a lado.
const path = require('path'); const fs = require('fs'); const os = require('os');
const { _electron: electron } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '..', 'apps', 'desktop')] }));
const assert = require('assert');

const SHOTS = process.argv[2] || path.join(__dirname, 'shots', 'melhorias');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'mel-jud-'));
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mel-jws-'));
  const app = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..', 'apps', 'desktop')], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = (n) => win.screenshot({ path: path.join(SHOTS, `${n}.png`) }).catch(() => {});
  async function step(name, fn) {
    const t = Date.now();
    try { const ev = await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`PASS [melhorias] ${name}${ev ? ' :: ' + ev : ''}`); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' | ') }); console.log(`FAIL [melhorias] ${name} :: ${e.message.split('\n').slice(0, 3).join(' | ')}`); await shot(`FAIL-${results.length}`); }
  }
  const stubDir = (dir) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  const node = (name) => win.locator(`[data-testid="node-${name}"]`);
  const waitDone = async (ms = 30000) => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: ms }); await win.waitForTimeout(200); };
  const bodyEditorText = () => win.evaluate(() => { const v = document.querySelector('[data-testid=body-editor] .cm-content'); return v ? v.innerText : null; });

  await win.waitForSelector('[data-testid=welcome]');
  await win.click('[data-testid=welcome-example]');
  await win.waitForSelector('[data-testid=modal-mocks]');
  await stubDir(wsDir);
  await win.click('text=Criar workspace de exemplo…');
  await win.waitForSelector('[data-testid=tree]', { timeout: 30000 });
  await win.waitForSelector('[data-testid="node-1. REST / JSON"]');

  await step('Ctrl+Enter no editor do body envia a request e NÃO quebra a linha do JSON', async () => {
    await node('Eco (vê o que foi enviado)').click().catch(async () => { await win.locator('[data-testid^="node-Eco"]').first().click(); });
    await win.click('[data-testid=req-tab-body]');
    await win.waitForSelector('[data-testid=body-editor] .cm-content');
    await win.click('[data-testid=body-editor] .cm-content');
    await win.keyboard.press('Control+A'); await win.keyboard.type('{"a":1}');
    await win.keyboard.press('ArrowLeft'); // cursor no meio da linha
    const before = await bodyEditorText();
    await win.keyboard.press('Control+Enter');
    await win.waitForSelector('[data-testid=resp-status]', { timeout: 20000 });
    await waitDone();
    const after = await bodyEditorText();
    assert.equal(after, before, `o texto mudou: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    assert.equal(after.split('\n').length, 1, 'ganhou linha');
    return `texto intacto ${JSON.stringify(after)}`;
  });

  await step('Ctrl+F abre a busca com o foco dentro do editor da resposta', async () => {
    await win.click('[data-testid=resp-body] .cm-content');
    await win.keyboard.press('Control+F');
    await win.waitForSelector('.cm-search', { timeout: 3000 });
    await shot('busca-no-editor');
    await win.keyboard.press('Escape');
  });

  await step('Ctrl+F abre a busca na resposta mesmo com o foco fora de qualquer editor', async () => {
    await win.waitForSelector('.cm-search', { state: 'detached', timeout: 3000 }).catch(() => {});
    await win.click('[data-testid=resp-status]');
    await win.keyboard.press('Control+F');
    await win.waitForSelector('.cm-search', { timeout: 3000 });
    await win.keyboard.type('Jaiminho');
    await shot('busca-foco-fora');
    await win.keyboard.press('Escape');
  });

  await step('Ctrl+F com o foco na árvore leva ao filtro', async () => {
    await node('Eco (vê o que foi enviado)').first().click().catch(() => {});
    await win.locator('[data-testid="tree"] [role=treeitem]').first().focus();
    await win.keyboard.press('Control+F');
    const focused = await win.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    assert.equal(focused, 'tree-filter');
  });

  await step('Botão alterna request/resposta lado a lado e volta', async () => {
    await win.locator('[data-testid^="node-Eco"]').first().click();
    await win.waitForSelector('[data-testid=btn-layout]');
    const box = async (sel) => (await win.locator(sel).first().boundingBox());
    assert.ok(await win.locator('.split:not(.horizontal)').count(), 'começa empilhado');
    await win.click('[data-testid=btn-layout]');
    await win.waitForSelector('.split.horizontal');
    const req = await box('.split.horizontal > .box'); const resp = await box('.split.horizontal > .box:last-child, .split.horizontal > .resp-empty');
    assert.ok(resp.x > req.x + req.width - 2, `resposta deveria estar à direita (${req.x}+${req.width} vs ${resp.x})`);
    await shot('lado-a-lado');
    const saved = await win.evaluate(() => window.jaiminho.call('app:settings'));
    assert.equal(saved.layout, 'horizontal');
    await win.click('[data-testid=btn-layout]');
    await win.waitForSelector('.split:not(.horizontal)');
  });

  await step('Multisseleção (Ctrl+clique) e arrastar várias requests para outra pasta de uma vez', async () => {
    const tree = await win.evaluate(() => window.jaiminho.call('ws:tree'));
    const find = (n, name) => (n.name === name ? n : (n.children || []).map((c) => find(c, name)).find(Boolean));
    const col = find({ children: tree.collections, name: '' }, '1. REST / JSON');
    const viajantes = find(col, 'Viajantes (CRUD)'); const util = find(col, 'Utilidades');
    const before = (viajantes.children || []).length; const utilBefore = (util.children || []).length;
    assert.ok(before >= 3);
    // garante que as pastas estão abertas
    for (const f of ['Viajantes (CRUD)', 'Utilidades']) { if (!(await node('Listar viajantes').count()) && f === 'Viajantes (CRUD)') await node(f).click(); }
    await node('Listar viajantes').first().click();
    await node('Criar viajante').first().click({ modifiers: ['Control'] });
    await node('Atualizar e-mail (PATCH)').count();
    const names = (viajantes.children || []).map((c) => c.name);
    const third = names[2];
    await win.locator(`[data-testid="node-${third}"]`).first().click({ modifiers: ['Control'] });
    const multiCount = await win.locator('.tree-row.multi').count();
    assert.ok(multiCount >= 3, `selecionadas: ${multiCount}`);
    await shot('multisselecao');
    await node('Utilidades').first().scrollIntoViewIfNeeded();
    await node('Listar viajantes').first().dragTo(node('Utilidades').first());
    await win.waitForTimeout(800);
    const t2 = await win.evaluate(() => window.jaiminho.call('ws:tree'));
    const col2 = find({ children: t2.collections, name: '' }, '1. REST / JSON');
    const v2 = find(col2, 'Viajantes (CRUD)'); const u2 = find(col2, 'Utilidades');
    assert.equal((v2.children || []).length, before - 3, `origem: ${before} → ${(v2.children || []).length}`);
    assert.equal((u2.children || []).length, utilBefore + 3, `destino: ${utilBefore} → ${(u2.children || []).length}`);
    await shot('multi-movidas');
    return `3 requests movidas de uma vez (${before} → ${(v2.children || []).length}; destino ${utilBefore} → ${(u2.children || []).length})`;
  });

  await step('Shift+clique seleciona faixa e Esc limpa a seleção', async () => {
    const tree = await win.evaluate(() => window.jaiminho.call('ws:tree'));
    const first = await win.locator('[data-testid="tree"] [role=treeitem]').nth(2);
    await first.click();
    await win.locator('[data-testid="tree"] [role=treeitem]').nth(5).click({ modifiers: ['Shift'] });
    assert.equal(await win.locator('.tree-row.multi').count(), 4);
    await win.locator('[data-testid="tree"] [role=treeitem]').nth(5).focus();
    await win.keyboard.press('Escape');
    assert.equal(await win.locator('.tree-row.multi').count(), 0);
    assert.ok(tree);
  });

  await step('Nenhum erro de página durante os fluxos', async () => { assert.deepEqual(pageErrors, []); });

  const failed = results.filter((r) => !r.ok);
  console.log(`== melhorias: ${results.length - failed.length} passaram, ${failed.length} falharam`);
  fs.writeFileSync(path.join(__dirname, 'results', 'melhorias.json'), JSON.stringify(results, null, 2));
  try { app.process().kill('SIGKILL'); } catch { /* ignore */ }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
