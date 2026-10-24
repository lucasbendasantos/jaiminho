// Envio a partir de uma aba (HTTP, SOAP, gRPC com streaming).
import { call, getState, updateTabQuiet, toast, api$ } from './store';
import { uid } from './util';

const listeners = new Map(); // execId → fn
api$.on((ev) => { if (ev.type === 'exec:event') { const f = listeners.get(ev.execId); if (f) f(ev.event); } });

export async function sendTab(key) {
  const t = getState().tabs.find((x) => x.key === key);
  if (!t || t.running) return;
  const execId = uid();
  const draft = t.draft;
  const started = Date.now();
  updateTabQuiet(key, { running: true, execId, result: null, events: [], startedAt: started });
  const buf = [];
  let flushT = null;
  const flush = () => { flushT = null; const evs = buf.splice(0); updateTabQuiet(key, (tt) => ({ events: [...(tt.events || []), ...evs].slice(-5000) })); };
  listeners.set(execId, (e) => { buf.push(e); if (!flushT) flushT = setTimeout(flush, 50); });
  try {
    const result = await call('exec:send', { execId, requestId: t.itemId || undefined, request: draft, parentId: t.parentId || undefined, environmentId: getState().activeEnvId || undefined });
    flush();
    updateTabQuiet(key, { running: false, result, execId: null });
    if (result.variablesChanged && result.variablesChanged.length) toast(`Variáveis atualizadas pelo script: ${result.variablesChanged.map((v) => v.key).join(', ')}`, 'info', 3500);
  } catch (e) {
    updateTabQuiet(key, { running: false, result: { ok: false, error: e.message }, execId: null });
  } finally { listeners.delete(execId); }
}

export async function cancelTab(key) {
  const t = getState().tabs.find((x) => x.key === key);
  if (t && t.execId) await call('exec:cancel', { execId: t.execId });
}
export async function streamWrite(key, message) {
  const t = getState().tabs.find((x) => x.key === key);
  if (!t || !t.execId) return toast('O stream não está aberto: clique em Invocar primeiro', 'err');
  try { JSON.parse(message); } catch (e) { return toast(`Mensagem JSON inválida: ${e.message}`, 'err'); }
  await call('grpc:write', { execId: t.execId, message });
}
export async function streamEnd(key) {
  const t = getState().tabs.find((x) => x.key === key);
  if (t && t.execId) await call('grpc:end', { execId: t.execId });
}
