// QA e2e extra do app desktop (Playwright + Electron). Uso (em apps/desktop, após o vite build):
//   xvfb-run -a -s "-screen 0 1440x900x24" node ../../qa/e2e-extra.js ../../qa/shots/extra
// Fluxos: workspace novo vazio, coleção/pasta/request pela UI, ambiente com segredo, revelar segredo,
// importar Postman por arquivo, exportar Postman, runner com CSV, cancelar request lenta, fechar com aba suja.
const path = require('path'); const fs = require('fs'); const os = require('os');
const { _electron: electron } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '..', 'apps', 'desktop')] }));
const assert = require('assert');
const { startAll } = require('../packages/mocks/src');

const SHOTS = process.argv[2] || path.join(__dirname, 'shots', 'extra');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];

(async () => {
  const mocks = await startAll();
  const H = mocks.urls.http;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-jud-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-jparent-'));
  const app = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..', 'apps', 'desktop')], env: { ...process.env, JAIMINHO_USERDATA: ud } });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = (n) => win.screenshot({ path: path.join(SHOTS, `${n}.png`) }).catch(() => {});
  async function step(name, fn) {
    const t = Date.now();
    try { const ev = await fn(); results.push({ name, ok: true, ms: Date.now() - t, evidence: ev }); console.log(`PASS [e2e] ${name}${ev ? ' :: ' + ev : ''}`); }
    catch (e) { results.push({ name, ok: false, error: e.message.split('\n').slice(0, 3).join(' | ') }); console.log(`FAIL [e2e] ${name} :: ${e.message.split('\n').slice(0, 3).join(' | ')}`); await shot(`FAIL-${results.length}`); }
  }
  const stubDir = (dir) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  const stubFile = (f) => app.evaluate(({ dialog }, x) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [x] }); }, f);
  const stubSave = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
  const stubConfirm = (resp, delayMs = 0) => app.evaluate(({ dialog }, [r, d]) => { dialog.showMessageBox = async () => { await new Promise((ok) => setTimeout(ok, d)); return { response: r }; }; }, [resp, delayMs]);
  const promptAnswer = async (text) => { await win.waitForSelector('[data-testid=prompt-input]'); await win.fill('[data-testid=prompt-input]', text); await win.click('[data-testid=prompt-ok]'); };
  const waitDone = async (ms = 30000) => { await win.waitForTimeout(150); await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: ms }); await win.waitForTimeout(200); };
  const wsDir = path.join(parent, 'Area de Testes');

  await win.waitForSelector('[data-testid=welcome]');

  await step('Criar workspace novo VAZIO pela tela inicial (nome com acento)', async () => {
    await win.click('[data-testid=welcome-new]');
    await stubDir(parent);
    await promptAnswer('Área de Testes');
    await win.waitForSelector('[data-testid=tree]', { timeout: 20000 });
    const dirs = fs.readdirSync(parent);
    assert.ok(fs.existsSync(path.join(parent, dirs[0], 'jaiminho.yaml')), `pasta criada: ${dirs}`);
    await shot('01-ws-vazio');
    return `pasta=${dirs[0]}`;
  });

  await step('Criar coleção, renomear, criar pasta e request HTTP pela UI e salvar', async () => {
    await win.click('[data-testid=btn-new-collection]');
    await win.waitForSelector('[data-testid=rename-input]');
    await win.fill('[data-testid=rename-input]', 'Minha Coleção');
    await win.press('[data-testid=rename-input]', 'Enter');
    await win.waitForSelector('[data-testid="node-Minha Coleção"]');
    await win.click('[data-testid="node-Minha Coleção"]', { button: 'right' });
    await win.click('[data-testid=ctx-new-folder]');
    await promptAnswer('Pasta Um');
    await win.waitForSelector('[data-testid="node-Pasta Um"]');
    await win.click('[data-testid="node-Pasta Um"]', { button: 'right' });
    await win.click('[data-testid=ctx-new-http]');
    await win.waitForSelector('[data-testid=req-url]');
    await win.fill('[data-testid=req-url]', `${H}/echo?x={{minhaVar}}`);
    await win.click('[data-testid=btn-save]');
    await win.waitForTimeout(800);
    if (await win.locator('[data-testid=modal-saveas]').count()) { await win.click('[data-testid=saveas-ok]'); await win.waitForTimeout(500); }
    const reqs = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.req.yaml')) reqs.push(p); } };
    walk(path.join(parent, fs.readdirSync(parent)[0], 'collections'));
    assert.equal(reqs.length, 1, `requests no disco: ${reqs}`);
    assert.match(fs.readFileSync(reqs[0], 'utf8'), /minhaVar/);
    await shot('02-request-salva');
    return path.relative(parent, reqs[0]);
  });

  await step('Ambiente novo com variável marcada como SEGREDO: valor fora do YAML; request usa o valor', async () => {
    await win.click('[data-testid=side-envs]');
    await win.click('[data-testid=btn-new-env]');
    await promptAnswer('QA');
    await win.waitForSelector('[data-testid=env-name]');
    const cells = win.locator('table.kv tbody tr').last().locator('input.cell');
    await cells.nth(0).fill('minhaVar');
    await win.locator('table.kv tbody tr').first().locator('input.cell').nth(1).fill('valor-secreto-123');
    await win.locator('table.kv tbody tr').first().locator('input[type=checkbox]').last().check();
    await win.click('[data-testid=btn-save]');
    await win.waitForTimeout(600);
    const root = path.join(parent, fs.readdirSync(parent)[0]);
    const envFile = fs.readdirSync(path.join(root, 'environments')).map((f) => path.join(root, 'environments', f))[0];
    const y = fs.readFileSync(envFile, 'utf8');
    assert.ok(!y.includes('valor-secreto-123'), `segredo no YAML:\n${y}`);
    assert.ok(fs.existsSync(path.join(root, '.jaiminho', 'secrets.enc')), 'secrets.enc não existe');
    await shot('03-env-segredo');
    // ativar e enviar
    await win.click('text=Ativar').catch(() => {});
    await win.click('[data-testid=side-collections]');
    await win.click('[data-testid="node-Nova request"]').catch(() => {});
    await win.waitForTimeout(400);
    await win.click('[data-testid=btn-send]'); await waitDone();
    const body = await win.textContent('[data-testid=resp-body]').catch(() => '');
    assert.match(body || '', /valor-secreto-123/, `resposta: ${String(body).slice(0, 200)}`);
    return 'segredo cifrado e resolvido no envio';
  });

  await step('Botão "olho" revela o valor do segredo no editor de ambiente', async () => {
    await win.click('[data-testid=side-envs]');
    await win.click('[data-testid="env-QA"]');
    await win.waitForSelector('[data-testid=env-name]');
    await win.click('button[aria-label="Mostrar segredo minhaVar"]');
    await win.waitForTimeout(500);
    const txt = await win.textContent('.pane');
    await shot('04-revelar-segredo');
    assert.match(txt, /valor-secreto-123/, 'valor não apareceu');
    await win.click('[data-testid=side-collections]');
  });

  await step('Importar coleção Postman por ARQUIVO (modal Importar → Arquivo)', async () => {
    const f = path.join(os.tmpdir(), 'qa-import.postman_collection.json');
    fs.writeFileSync(f, JSON.stringify({ info: { name: 'Do Postman', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: [{ key: 'base', value: H }], item: [{ name: 'Pasta P', item: [{ name: 'Echo P', request: { method: 'GET', url: '{{base}}/echo?p=1' } }] }] }));
    await win.click('[data-testid=btn-import]');
    await win.click('[data-testid=import-file]');
    await stubFile(f);
    await win.click('text=Escolher arquivo').catch(async () => { await win.click('.modal button.btn.primary'); });
    await win.waitForSelector('[data-testid=import-result]', { timeout: 15000 });
    const t = await win.textContent('[data-testid=import-result]');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-testid="node-Do Postman"]');
    await win.click('[data-testid="node-Echo P"]');
    await win.click('[data-testid=btn-send]'); await waitDone();
    assert.match(await win.textContent('[data-testid=resp-status]'), /200/);
    return t;
  });

  await step('Exportar coleção para Postman (menu de contexto) gera JSON v2.1 válido', async () => {
    const out = path.join(os.tmpdir(), `qa-export-${Date.now()}.json`);
    await stubSave(out);
    await win.click('[data-testid="node-Do Postman"]', { button: 'right' });
    await win.click('[data-testid=ctx-export-postman]');
    await win.waitForTimeout(800);
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(j.info.name, 'Do Postman'); assert.ok(/v2\.1/.test(j.info.schema));
    return `${j.item.length} item(ns)`;
  });

  await step('Runner com arquivo de dados CSV', async () => {
    const csv = path.join(os.tmpdir(), 'qa-dados.csv'); fs.writeFileSync(csv, 'p\nA\nB\nC\n');
    await win.click('[data-testid="node-Do Postman"]', { button: 'right' });
    await win.click('[data-testid=ctx-run]');
    await win.waitForSelector('[data-testid=modal-runner]');
    await stubFile(csv);
    await win.click('text=Arquivo de dados (CSV/JSON)…');
    await win.waitForTimeout(300);
    await win.click('[data-testid=runner-start]');
    await win.waitForSelector('[data-testid=runner-summary]', { timeout: 30000 });
    const s = await win.textContent('[data-testid=runner-summary]');
    await shot('07-runner-csv');
    await win.keyboard.press('Escape');
    assert.match(s, /3 iteração/);
    return s;
  });

  await step('Cancelar request lenta (/delay/8000) pelo botão Cancelar', async () => {
    await win.click('[data-testid="node-Echo P"]');
    await win.fill('[data-testid=req-url]', `${H}/delay/8000`);
    const t0 = Date.now();
    await win.click('[data-testid=btn-send]');
    await win.waitForSelector('[data-testid=btn-cancel]');
    await win.waitForTimeout(400);
    await win.click('[data-testid=btn-cancel]');
    await win.locator('[data-testid=btn-cancel]').waitFor({ state: 'detached', timeout: 5000 });
    const ms = Date.now() - t0;
    const txt = (await win.textContent('[data-testid=resp-error]').catch(() => '')) || (await win.textContent('[data-testid=resp-status]').catch(() => ''));
    await shot('08-cancelado');
    assert.ok(ms < 4000, `demorou ${ms}ms`);
    return `${ms}ms: ${String(txt).slice(0, 80)}`;
  });


  // ---------- temas e ajuda ----------
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const pickTheme = async (id) => { await win.click('[data-testid=btn-settings]'); await win.click('[data-testid=settings-app]'); await win.click(`[data-testid=theme-${id}]`); await win.keyboard.press('Escape'); await win.locator('[data-testid=modal-settings]').waitFor({ state: 'detached' }); };
  const themeInfo = () => win.evaluate(() => {
    const cs = (v, bg) => { const e = document.createElement('div'); e.style.cssText = `color:var(${v});background:var(${bg});position:absolute;opacity:1`; document.body.appendChild(e); const c = getComputedStyle(e); const r = [c.color, c.backgroundColor]; e.remove(); return r; };
    return { theme: document.documentElement.dataset.theme, body: getComputedStyle(document.body).backgroundColor, text: cs('--text', '--bg1'), muted: cs('--muted', '--bg1'), faint: cs('--faint', '--bg1'), accent: cs('--accent', '--bg1'), erro: cs('--erro', '--bg1'), verde: cs('--verde', '--bg1'), dourado: cs('--dourado', '--bg1') };
  });
  await step('Temas Padrão / Preto / Branco: aplicam, persistem após recarregar e têm contraste WCAG AA', async () => {
    const seen = {};
    for (const id of ['preto', 'branco', 'padrao']) {
      await pickTheme(id);
      const i = await themeInfo();
      assert.equal(i.theme, id);
      seen[id] = i.body;
      for (const k of ['text', 'muted', 'accent', 'erro', 'verde', 'dourado']) { const r = ratio(i[k][0], i[k][1]); assert.ok(r >= 4.5, `${id}: contraste de ${k} = ${r.toFixed(2)} (< 4.5)`); }
      const rf = ratio(i.faint[0], i.faint[1]); assert.ok(rf >= 3, `${id}: contraste do texto discreto = ${rf.toFixed(2)} (< 3)`);
      await shot(`10-tema-${id}`);
    }
    assert.equal(seen.preto, 'rgb(0, 0, 0)', 'fundo do tema Preto deve ser preto puro');
    assert.notEqual(seen.padrao, seen.preto); assert.notEqual(seen.padrao, seen.branco);
    await pickTheme('preto'); await win.reload(); await win.waitForSelector('[data-testid=btn-settings]');
    assert.equal((await themeInfo()).theme, 'preto', 'o tema não persistiu após recarregar');
    await pickTheme('padrao');
    return `fundos ${JSON.stringify(seen)}`;
  });
  await step('Botão da paleta no topo troca de tema em ciclo (padrão → preto → branco → padrão)', async () => {
    const t0 = (await themeInfo()).theme; const order = [];
    for (let i = 0; i < 3; i++) { await win.click('[data-testid=btn-theme]'); order.push((await themeInfo()).theme); }
    assert.equal(order[2], t0); assert.equal(new Set(order).size, 3);
    return `${t0} → ${order.join(' → ')}`;
  });
  await step('Ajuda (F1 e botão ?): todos os tópicos abrem com conteúdo, busca filtra e Esc fecha', async () => {
    await win.keyboard.press('F1'); await win.waitForSelector('[data-testid=modal-help]');
    const ids = await win.$$eval('.help-nav button', (bs) => bs.map((b) => b.dataset.testid));
    assert.ok(ids.length >= 12, `só ${ids.length} tópicos`);
    for (const id of ids) { await win.click(`[data-testid=${id}]`); const txt = (await win.textContent('[data-testid=help-body]')).trim(); assert.ok(txt.length > 150, `tópico ${id} quase vazio (${txt.length} chars)`); }
    await win.fill('[data-testid=help-search]', 'mtls');
    const f = await win.$$eval('.help-nav button', (bs) => bs.map((b) => b.textContent));
    assert.ok(f.length >= 1 && f.length < ids.length && f.some((x) => /mTLS/.test(x)), `busca por mtls: ${JSON.stringify(f)}`);
    for (const termo of ['variável', 'variavel', 'histórico', 'collection', 'cookie']) {
      await win.fill('[data-testid=help-search]', termo);
      assert.ok((await win.$$('.help-nav button')).length >= 1, `busca "${termo}" sem resultado`);
    }
    await win.fill('[data-testid=help-search]', 'zzzxxqq'); assert.equal((await win.$$('.help-nav button')).length, 0);
    await shot('11-ajuda');
    await win.keyboard.press('Escape'); await win.locator('[data-testid=modal-help]').waitFor({ state: 'detached' });
    await win.click('[data-testid=btn-help]'); await win.waitForSelector('[data-testid=modal-help]'); await win.keyboard.press('Escape');
    return `${ids.length} tópicos`;
  });
  await step('Link "Ver tutorial" do importador abre o tópico certo', async () => {
    await win.keyboard.press('Control+i'); await win.waitForSelector('[data-testid=modal-import]');
    await win.click('[data-testid=helplink-importar]'); await win.waitForSelector('[data-testid=modal-help]');
    const t = await win.textContent('[data-testid=help-body] h3'); assert.match(t, /Importar/);
    await win.keyboard.press('Escape'); await win.keyboard.press('Escape');
    return t;
  });

  await step('Fechar a janela com aba suja: diálogo "Cancelar" (usuário demora 3 s para responder) mantém a janela aberta', async () => {
    // deixa uma aba suja (o reload do passo de temas descartou a anterior)
    await win.click('[data-testid="node-Echo P"]'); await win.fill('[data-testid=req-url]', `${H}/echo?suja=1`);
    await stubConfirm(0, 3000);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await new Promise((r) => setTimeout(r, 4500));
    const n = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length).catch(() => 0);
    assert.equal(n, 1, 'a janela FECHOU sozinha enquanto o diálogo de "alterações não salvas" ainda estava aberto (alterações perdidas)');
    return 'janela continua aberta';
  });

  await step('Sem erros de JavaScript na página durante os fluxos', async () => {
    assert.equal(pageErrors.length, 0, pageErrors.join(' | '));
  });

  fs.writeFileSync(path.join(__dirname, 'results', 'e2e-extra.json'), JSON.stringify(results, null, 2));
  const f = results.filter((r) => !r.ok).length;
  console.log(`\n== e2e-extra: ${results.length - f} passaram, ${f} falharam`);
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  await mocks.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
