'use strict';
// Processo principal: janela, menus, diálogos, chave dos segredos (safeStorage/DPAPI) e ponte com o "carteiro".
const { app, BrowserWindow, ipcMain, dialog, utilityProcess, safeStorage, session, shell, Menu, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isDev = !app.isPackaged;
if (process.env.JAIMINHO_USERDATA) app.setPath('userData', process.env.JAIMINHO_USERDATA);
let win; let carteiro; let carteiroReady; let seq = 0;
const pending = new Map();

// Offline de verdade: nada de telemetria/atualização; bloqueia navegação externa.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

function userFile(name) { return path.join(app.getPath('userData'), name); }

/** Chave AES dos segredos, protegida pelo safeStorage (DPAPI no Windows). */
function secretKey() {
  const f = userFile('secrets.key');
  try {
    if (fs.existsSync(f)) {
      const raw = fs.readFileSync(f);
      if (safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b) return Buffer.from(safeStorage.decryptString(raw), 'base64');
      const j = JSON.parse(raw.toString('utf8')); return Buffer.from(j.key, 'base64');
    }
  } catch (e) { console.error('Falha lendo chave, gerando nova', e); }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(f, safeStorage.encryptString(key.toString('base64')));
  else fs.writeFileSync(f, JSON.stringify({ key: key.toString('base64'), warning: 'safeStorage indisponível' }));
  return key;
}

function startCarteiro() {
  carteiro = utilityProcess.fork(path.join(__dirname, 'carteiro.js'), [], { serviceName: 'jaiminho-carteiro', stdio: 'pipe' });
  carteiro.stdout?.on('data', (d) => process.stdout.write(`[carteiro] ${d}`));
  carteiro.stderr?.on('data', (d) => process.stderr.write(`[carteiro] ${d}`));
  carteiroReady = new Promise((resolve) => {
    carteiro.on('message', (msg) => {
      if (msg.type === 'ready') return resolve();
      if (msg.type === 'event') { if (win && !win.isDestroyed()) win.webContents.send('event', msg.event); return; }
      if (msg.type === 'proxy-req') { session.defaultSession.resolveProxy(msg.url).then((r) => carteiro.postMessage({ type: 'proxy-res', id: msg.id, result: r })).catch(() => carteiro.postMessage({ type: 'proxy-res', id: msg.id, result: 'DIRECT' })); return; }
      const p = pending.get(msg.id); if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(Object.assign(new Error(msg.error), { stack: msg.stack })) : p.resolve(msg.result);
    });
  });
  carteiro.on('exit', (code) => {
    for (const [, p] of pending) p.reject(new Error(`O processo de envio parou (código ${code}); foi reiniciado`));
    pending.clear();
    if (!app.isQuitting) setTimeout(startCarteiro, 300);
  });
  carteiro.postMessage({ type: 'init', key: secretKey().toString('base64'), userData: app.getPath('userData'), resources: isDev ? path.join(__dirname, '..', '..', '..') : process.resourcesPath });
}

async function call(op, args) {
  await carteiroReady;
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); carteiro.postMessage({ type: 'call', id, op, args }); });
}

// ---------------- proxy do sistema (o Chromium sabe resolver PAC/WPAD do Windows) ----------------
ipcMain.handle('proxy:resolve', async (_e, url) => session.defaultSession.resolveProxy(url));

// ---------------- chamadas ao motor ----------------
ipcMain.handle('call', async (_e, op, args) => {
  try { return { ok: true, result: await call(op, args) }; } catch (e) { return { ok: false, error: e.message }; }
});

// ---------------- diálogos e sistema ----------------
ipcMain.handle('dialog:openFile', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])], filters: opts.filters, title: opts.title, defaultPath: opts.defaultPath });
  return r.canceled ? null : (opts.multi ? r.filePaths : r.filePaths[0]);
});
ipcMain.handle('dialog:openDir', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: opts.title, defaultPath: opts.defaultPath });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:save', async (_e, opts = {}) => {
  const r = await dialog.showSaveDialog(win, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:confirm', async (_e, { message, detail, buttons = ['Cancelar', 'OK'] }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: buttons.length - 1, cancelId: 0 });
  return r.response;
});
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), platform: process.platform, electron: process.versions.electron, node: process.versions.node, secretsProtection: safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'arquivo' }));
ipcMain.handle('theme:set', (_e, t) => { nativeTheme.themeSource = t === 'branco' || t === 'light' ? 'light' : 'dark'; return true; });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 620, show: false,
    title: 'Jaiminho', backgroundColor: '#09132D',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  win.on('close', (e) => {
    if (win.__canClose) return;
    e.preventDefault();
    win.__closeAcked = false;
    win.webContents.send('event', { type: 'app:before-close' });
    // só força o fechamento se a tela travou (não confirmou o pedido); se confirmou, o usuário decide no diálogo
    setTimeout(() => { if (win && !win.isDestroyed() && !win.__closeAcked) { win.__canClose = true; win.close(); } }, 2500);
  });
}
ipcMain.handle('app:close-ack', () => { if (win) win.__closeAcked = true; });
ipcMain.handle('app:close-ok', () => { if (win) { win.__canClose = true; win.close(); } });

function menu() {
  const send = (type) => () => win && win.webContents.send('event', { type: `menu:${type}` });
  const tpl = [
    { label: 'Arquivo', submenu: [
      { label: 'Nova request', accelerator: 'CmdOrCtrl+N', click: send('new-request') },
      { label: 'Abrir workspace…', accelerator: 'CmdOrCtrl+O', click: send('open-workspace') },
      { label: 'Novo workspace…', click: send('new-workspace') },
      { type: 'separator' },
      { label: 'Importar… (cURL, Postman, Swagger, WSDL, .jaiminho)', accelerator: 'CmdOrCtrl+I', click: send('import') },
      { label: 'Exportar workspace (.jaiminho)…', click: send('export-workspace') },
      { type: 'separator' },
      { label: 'Salvar', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Configurações', accelerator: 'CmdOrCtrl+,', click: send('settings') },
      { type: 'separator' },
      { role: 'quit', label: 'Sair' },
    ] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Ferramentas', submenu: [
      { label: 'Servidores mock (iniciar/parar)', click: send('mocks') },
      { label: 'Criar workspace de exemplo (usa os mocks)', click: send('example') },
      { label: 'Collection Runner', accelerator: 'CmdOrCtrl+R', click: send('runner') },
      { label: 'Cookies', click: send('cookies') },
    ] },
    { label: 'Ver', submenu: [...(app.isPackaged ? [] : [{ role: 'reload', label: 'Recarregar' }]), { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Ajuda', submenu: [{ label: 'Tutoriais e ajuda', accelerator: 'F1', click: send('help') }, { label: 'Atalhos de teclado', click: send('shortcuts') }, { label: 'Sobre o Jaiminho', click: send('about') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // CSP: nada de recursos remotos na UI
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self'"] } }));
    startCarteiro(); menu(); createWindow();
  });
  app.on('before-quit', () => { app.isQuitting = true; try { carteiro && carteiro.kill(); } catch { /* ignore */ } });
  app.on('window-all-closed', () => app.quit());
}
