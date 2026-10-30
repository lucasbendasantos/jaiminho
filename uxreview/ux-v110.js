// Revisão de UX das novidades da 1.1 na versão web: diálogos (foco, Esc, Tab, aria), seletor de pasta, janela estreita, 3 temas.
// Uso (a partir de apps/desktop, após o vite build): node ../../uxreview/ux-v110.js
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { spawn } = require('child_process');
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '..', 'apps', 'desktop')] }));
function chromiumPath() { if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH; try { if (fs.existsSync(chromium.executablePath())) return undefined; } catch {} const b = '/opt/pw-browsers'; if (!fs.existsSync(b)) return undefined; for (const d of fs.readdirSync(b).filter((x) => /^chromium-/.test(x)).sort().reverse()) { const p = path.join(b, d, 'chrome-linux64', 'chrome'); if (fs.existsSync(p)) return p; } }
const OUT = path.join(__dirname, 'shots', 'v110'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 18110, BASE = `http://127.0.0.1:${PORT}`, out = [];
const rec = (id, ok, ev) => { out.push({ id, ok, ev }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} :: ${ev}`); };
const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uxw-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'apps', 'web', 'server.js')], { env: { ...process.env, JAIMINHO_ROOT: root, JAIMINHO_PORT: String(PORT), JAIMINHO_AUTH: 'none' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await new Promise((r, j) => http.get(BASE + '/healthz', (x) => (x.statusCode === 200 ? r() : j())).on('error', j)); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const br = await chromium.launch({ args: ['--no-sandbox'], executablePath: chromiumPath() });
  const page = await (await br.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE); await page.waitForSelector('[data-testid=welcome]');
  await page.click('[data-testid=welcome-example]'); await page.waitForSelector('[data-testid=modal-mocks]');
  const trigger = page.locator('text=Criar workspace de exemplo…'); await trigger.focus();
  await trigger.press('Enter'); await page.waitForSelector('[role=dialog][aria-label*="Pasta para o workspace"]');
  // 1. aria
  const d = await page.evaluate(() => { const e = document.querySelector('[role=dialog][aria-label*="Pasta"]'); return { modal: e.getAttribute('aria-modal'), label: e.getAttribute('aria-label'), focusInside: e.contains(document.activeElement), ae: document.activeElement.textContent }; });
  rec('WEB-01 diálogo tem role=dialog, aria-modal e nome', d.modal === 'true' && !!d.label, JSON.stringify(d));
  rec('WEB-02 foco entra no diálogo ao abrir', d.focusInside, `foco em "${d.ae}"`);
  // 2. Tab não escapa
  let escaped = false; for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => document.querySelector('[role=dialog][aria-label*="Pasta"]').contains(document.activeElement)))) { escaped = true; break; } }
  rec('WEB-03 Tab fica preso dentro do diálogo (25 Tabs)', !escaped, escaped ? 'foco saiu' : 'ok');
  let escapedS = false; for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => document.querySelector('[role=dialog][aria-label*="Pasta"]').contains(document.activeElement)))) { escapedS = true; break; } }
  rec('WEB-04 Shift+Tab também fica preso', !escapedS, escapedS ? 'foco saiu' : 'ok');
  // 3. botões do seletor com nome acessível
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('[role=dialog][aria-label*="Pasta"] button')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length);
  rec('WEB-05 todos os botões do seletor têm nome', unnamed === 0, `${unnamed} sem nome`);
  await page.screenshot({ path: path.join(OUT, 'web-seletor-1280.png') });
  // 4. Esc fecha e devolve o foco
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const closed = (await page.locator('[role=dialog][aria-label*="Pasta"]').count()) === 0; const back = await page.evaluate(() => document.activeElement && document.activeElement.textContent.includes('Criar workspace de exemplo'));
  rec('WEB-06 Esc fecha o diálogo', closed, closed ? 'fechou' : 'ainda aberto');
  rec('WEB-07 foco volta ao botão que abriu', back, back ? 'sim' : 'não');
  // 5. celular 390 px
  await page.setViewportSize({ width: 390, height: 780 }); await trigger.click(); await page.waitForSelector('[role=dialog][aria-label*="Pasta para o workspace"]');
  const m = await page.evaluate(() => { const r = document.querySelector('[role=dialog][aria-label*="Pasta"]').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth, btns: [...document.querySelectorAll('[role=dialog][aria-label*="Pasta"] button')].map((b) => { const q = b.getBoundingClientRect(); return [q.width, q.height]; }) }; });
  rec('WEB-08 diálogo cabe em 390 px (a página em si exige ~800 px: limitação conhecida)', m.l >= 0 && m.r <= m.w, `dialog ${Math.round(m.l)}–${Math.round(m.r)} de ${m.w}; scrollWidth ${m.sw}`);
  const small = m.btns.filter(([w, h]) => h < 28).length; rec('WEB-09 alvos de toque com altura ≥ 28 px no seletor', small === 0, `${small} menores (alturas: ${[...new Set(m.btns.map(([, h]) => Math.round(h)))].join(',')})`);
  await page.screenshot({ path: path.join(OUT, 'web-seletor-390px.png') }); await page.keyboard.press('Escape');
  // 6. temas: contraste do diálogo
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const t of ['padrao', 'preto', 'branco']) {
    await page.evaluate((x) => { document.documentElement.dataset.theme = x === 'padrao' ? '' : x; if (x === 'padrao') delete document.documentElement.dataset.theme; }, t);
    await trigger.click(); await page.waitForSelector('[role=dialog][aria-label*="Pasta para o workspace"]');
    const c = await page.evaluate(() => { const b = document.querySelector('[role=dialog][aria-label*="Pasta"]'); const cs = getComputedStyle(b); const p = b.querySelector('.btn.primary'); const pc = p && getComputedStyle(p); return { fg: cs.color, bg: cs.backgroundColor, pfg: pc && pc.color, pbg: pc && pc.backgroundColor }; });
    const r1 = cr(c.fg, c.bg), r2 = c.pfg ? cr(c.pfg, c.pbg) : 99; rec(`WEB-10 tema ${t}: contraste do diálogo`, r1 >= 4.5 && r2 >= 3, `texto ${r1.toFixed(1)}:1 · botão primário ${r2.toFixed(1)}:1`);
    await page.screenshot({ path: path.join(OUT, `web-seletor-${t}.png`) }); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  }
  rec('WEB-11 sem erros de página', errs.length === 0, errs.join(' | ') || 'nenhum');
  await br.close(); srv.kill();
  fs.writeFileSync(path.join(__dirname, 'ux-v110.json'), JSON.stringify(out, null, 2));
  process.exit(out.some((x) => !x.ok) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
