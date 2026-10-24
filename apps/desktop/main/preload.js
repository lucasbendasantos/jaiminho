'use strict';
// Ponte segura renderer ⇄ main. O renderer não tem Node nem acesso à rede: tudo passa por aqui.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('event', (_e, ev) => { for (const l of listeners) { try { l(ev); } catch (err) { console.error(err); } } });

contextBridge.exposeInMainWorld('jaiminho', {
  call: async (op, args) => {
    const r = await ipcRenderer.invoke('call', op, args);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  },
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  dialog: {
    openFile: (o) => ipcRenderer.invoke('dialog:openFile', o),
    openDir: (o) => ipcRenderer.invoke('dialog:openDir', o),
    save: (o) => ipcRenderer.invoke('dialog:save', o),
    confirm: (o) => ipcRenderer.invoke('dialog:confirm', o),
  },
  clipboard: { write: (t) => ipcRenderer.invoke('clipboard:write', t), read: () => ipcRenderer.invoke('clipboard:read') },
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  info: () => ipcRenderer.invoke('app:info'),
  setTheme: (t) => ipcRenderer.invoke('theme:set', t),
  closeOk: () => ipcRenderer.invoke('app:close-ok'),
  closeAck: () => ipcRenderer.invoke('app:close-ack'),
  resolveProxy: (u) => ipcRenderer.invoke('proxy:resolve', u),
});
