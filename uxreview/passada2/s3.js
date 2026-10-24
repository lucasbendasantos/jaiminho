const { launch, fs, os, path } = require('./lib');
(async () => {
  const H = await launch(); const { win, app, shot, step, open, log } = H;
  const R = (k, v) => log('R', k, JSON.stringify(v));
  const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'ux2-ws-'));
  await win.waitForSelector('[data-testid=welcome]');
  await step('help-welcome', async () => { await win.keyboard.press('F1'); await win.waitForTimeout(400); R('f1-welcome', await win.locator('[data-testid=modal-help]').count()); await win.keyboard.press('Escape'); });
  await step('ws-vazio', async () => {
    await H.stubDir(emptyWs); await win.click('[data-testid=welcome-new]'); await win.waitForSelector('[data-testid=modal-prompt]'); await win.click('[data-testid=prompt-ok]'); await win.waitForSelector('[data-testid=sidebar]');
    await shot('ux19-ws-vazio'); R('ux17-vazio-sidebar', await win.$eval('[data-testid=sidebar]', (e) => e.innerText));
    await win.click('[data-testid=empty-new-http]'); await win.waitForSelector('[data-testid=req-url]');
    await win.fill('[data-testid=req-url]', 'http://127.0.0.1:1/x'); await win.keyboard.press('Control+s'); await win.waitForTimeout(500);
    R('ux19-saveas', await win.evaluate(() => { const m = document.querySelector('[data-testid=modal-saveas]'); return m && { txt: m.innerText.slice(0, 300), ok: (() => { const b = document.querySelector('[data-testid=saveas-ok]'); return b && [b.disabled, getComputedStyle(b).backgroundColor, getComputedStyle(b).color]; })() }; }));
    await shot('ux19-saveas'); await win.keyboard.press('Escape');
  });
  await step('hist-vazio', async () => { await win.click('[data-testid=side-history]'); R('ux15-vazio', await win.$eval('[data-testid=sidebar]', (e) => e.innerText)); await win.click('[data-testid=side-collections]'); });
  await step('colecao-vazia', async () => { await win.click('[data-testid=btn-new-collection]'); await win.waitForSelector('[data-testid=modal-prompt]'); await win.click('[data-testid=prompt-ok]'); await win.waitForTimeout(500); R('ux18-apos-criar-colecao', await win.evaluate(() => ({ rename: !!document.querySelector('[data-testid=rename-input]'), tree: document.querySelector('[data-testid=tree]')?.innerText, tabs: document.querySelector('[data-testid=tabs]')?.innerText }))); await shot('ux17-colecao-vazia'); });
  await step('atalhos', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event', { type: 'menu:shortcuts' })); await win.waitForTimeout(300);
    R('ux19-atalhos', await win.$eval('[role=dialog]', (e) => e.innerText)); await shot('ux19-atalhos'); await win.keyboard.press('Escape');
  });
  await step('settings', async () => {
    await win.keyboard.press('Control+,'); await win.waitForTimeout(300);
    await win.click('[data-testid=settings-certs]'); await win.waitForTimeout(200); R('ux14-certs-txt', await win.$eval('[role=dialog]', (e) => e.innerText.slice(0, 800)));
    await win.click('[data-testid=add-cert]').catch(() => {}); await win.waitForTimeout(200); R('ux14-cert-format', await win.locator('[data-testid=cert-format]').count()); await shot('ux14-mtls');
    await win.click('[data-testid=settings-app]'); await win.waitForTimeout(200); R('este-pc', await win.$eval('[role=dialog]', (e) => e.innerText.slice(0, 900))); await shot('ux14-este-pc'); await win.keyboard.press('Escape');
  });
  await step('mocks', async () => {
    await win.click('[data-testid=mocks-toggle]').catch(async () => { await win.click('button[title="Servidores mock locais"]'); }); await win.waitForTimeout(500);
    R('mocks-modal', await win.evaluate(() => { const m = document.querySelector('[role=dialog]'); return m && { role: m.getAttribute('role'), txt: m.innerText.slice(0, 700), focus: document.activeElement?.tagName }; })); await shot('mocks-modal'); await win.keyboard.press('Escape');
  });
  await step('import-colar', async () => {
    await win.click('[data-testid=btn-import]'); await win.waitForTimeout(300);
    R('import-tabs', await win.$$eval('[role=dialog] .tabs button, [role=dialog] [data-testid^=import-]', (b) => b.map((x) => x.textContent.trim()).slice(0, 12)));
    await win.click('[data-testid=import-text]'); await win.click('.cm-content'); await win.keyboard.type("curl -X POST 'https://api.x/v1/a' -H 'Content-Type: application/json' -d '{\"a\":1}'"); await win.waitForTimeout(300);
    await win.click('[data-testid=import-go]'); await win.waitForTimeout(1200); R('import-resultado', await win.locator('[data-testid=import-result]').allTextContents()); R('toasts', await win.$$eval('[data-testid=toasts] > *', (t) => t.map((x) => x.innerText)));
    R('toast-vs-botoes', await win.evaluate(() => { const t = document.querySelector('[data-testid=toasts]')?.getBoundingClientRect(); const b = [...document.querySelectorAll('[role=dialog] footer button')].map((x) => { const r = x.getBoundingClientRect(); return [x.innerText, r.left, r.top, r.right, r.bottom]; }); return { t: t && [t.left, t.top, t.right, t.bottom], b }; }));
    await shot('ux06-import-toast'); await win.keyboard.press('Escape'); await win.waitForTimeout(300);
    R('curl-aberto-aba', await win.$eval('[data-testid=tabs]', (e) => e.innerText));
  });
  await step('stream-hint', async () => {});
  // atalhos reais
  await step('atalhos-reais', async () => {
    const cnt = () => win.locator('[data-testid=tabs] .tab').count();
    const a = await cnt(); await win.keyboard.press('Control+n'); await win.waitForTimeout(300); const b = await cnt(); R('ctrl+n', [a, b]);
    await win.keyboard.press('Control+Shift+s'); await win.waitForTimeout(300); R('ctrl+shift+s', await win.locator('[data-testid=modal-saveas]').count()); await win.keyboard.press('Escape');
    await win.keyboard.press('Control+r'); await win.waitForTimeout(300); R('ctrl+r', await win.evaluate(() => document.querySelector('[role=dialog]')?.innerText.slice(0, 80))); await win.keyboard.press('Escape');
    await win.keyboard.press('Control+e'); await win.waitForTimeout(300); R('ctrl+e', await win.locator('[data-testid=vars-panel]').count()); await win.keyboard.press('Control+e');
    await win.keyboard.press('Control+w'); await win.waitForTimeout(300); R('ctrl+w', await cnt());
    await win.keyboard.press('Control+i'); await win.waitForTimeout(300); R('ctrl+i', await win.locator('[data-testid=btn-import]').count() && await win.locator('[role=dialog]').count()); await win.keyboard.press('Escape');
    await win.keyboard.press('Control+l'); R('ctrl+l', await win.evaluate(() => document.activeElement?.getAttribute('data-testid')));
  });
  // abas internas da request / resposta
  await step('request-labels', async () => {
    await win.click('[data-testid=side-collections]');
    R('req-subtabs', await win.$$eval('[data-testid^=req-tab-]', (t) => t.map((x) => x.textContent.trim())));
    await win.click('[data-testid=req-tab-scripts]'); R('scripts-labels', await win.$$eval('[data-testid^=script-]', (t) => t.map((x) => x.textContent.trim())));
    await win.click('[data-testid=req-tab-auth]'); R('auth-opts', await win.$$eval('[data-testid=auth-type] option', (o) => o.map((x) => x.textContent)));
    await win.click('[data-testid=req-tab-body]'); R('body-modes', await win.$$eval('[data-testid^=body-]', (t) => t.map((x) => x.textContent.trim())));
    await win.click('[data-testid=btn-send]'); await H.waitDone(); R('resp-tabs', await win.$$eval('[data-testid^=resp-tab-]', (t) => t.map((x) => x.textContent.trim())));
    await shot('resp-erro-rede');
  });
  await step('hist-limpar', async () => {
    await win.click('[data-testid=side-history]'); await app.evaluate(({ dialog }) => { global.__c = 0; dialog.showMessageBox = async () => { global.__c++; return { response: 1 }; }; });
    await win.click('text=Limpar'); await win.waitForTimeout(400); R('ux15-limpar-confirm', [await app.evaluate(() => global.__c), await win.locator('.modal, [role=dialog]').count(), await win.$eval('[data-testid=sidebar]', (e) => e.innerText.slice(0, 120))]);
  });
  R('erros', H.errs); await H.quit();
})().catch((e) => { console.error(e); process.exit(2); });
