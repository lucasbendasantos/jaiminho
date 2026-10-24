import React, { useEffect, useMemo, useRef, useState } from 'react';
import Editor from './Editor';
import KVTable from './KVTable';
import ResponseView from './ResponseView';
import { Splitter, NameBar } from './Common';
import { UrlInput } from './UrlInput';
import Icon from '../icons';
import { call, updateDraft, toast, useStore, safe, getState } from '../store';
import { sendTab, cancelTab, streamWrite, streamEnd } from '../send';

function MethodPicker({ tab, services, onPick, loading, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const filtered = (services || []).map((s) => ({ ...s, methods: s.methods.filter((m) => `${s.name}/${m.name}`.toLowerCase().includes(q.toLowerCase())) })).filter((s) => s.methods.length);
  const cur = tab.draft.grpc?.method || '';
  return (
    <div ref={ref} style={{ position: 'relative', width: 380 }}>
      <button className="in" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, height: 34 }} onClick={() => { setOpen(!open); if (!services) onRefresh(); }} data-testid="grpc-method">
        <span className="grow mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur ? cur.split('/').pop() : 'Selecionar método…'}</span>
        <span className="faint" style={{ fontSize: 11 }}>{cur ? cur.split('/')[0].split('.').pop() : ''}</span>▾
      </button>
      {open && <div className="method-picker">
        <div className="row" style={{ padding: 6 }}><input autoFocus className="in grow" style={{ flex: 1, minWidth: 0 }} placeholder="Buscar método" value={q} onChange={(e) => setQ(e.target.value)} data-testid="grpc-method-search" /><button className="icon-btn" onClick={onRefresh} disabled={loading} title="Recarregar schema" aria-label="Recarregar schema"><Icon name="refresh" /></button></div>
        {loading && <div className="empty">Carregando schema…</div>}
        {!loading && services && !filtered.length && <div className="empty">Nenhum método</div>}
        {filtered.map((s) => <div key={s.name}><div className="svc">{s.name}</div>{s.methods.map((m) => <button key={m.fullName} className={m.fullName === cur ? 'on' : ''} onClick={() => { onPick(m); setOpen(false); }} data-testid={`grpc-m-${m.name}`}><span className="mono">{m.name}</span><span className="kind-tag">{m.kind}</span><span className="grow" /><span className="faint mono" style={{ fontSize: 11 }}>{m.inputType.split('.').pop()} → {m.outputType.split('.').pop()}</span></button>)}</div>)}
      </div>}
    </div>
  );
}

function SchemaTab({ tab, reload }) {
  const g = tab.draft.grpc || {}; const s = g.schema || { source: 'reflection' };
  const [protos, setProtos] = useState([]);
  useEffect(() => { call('grpc:listProtos').then(setProtos).catch(() => {}); }, []);
  const set = (patch) => updateDraft(tab.key, (d) => ({ ...d, grpc: { ...d.grpc, schema: { ...(d.grpc.schema || {}), ...patch } } }));
  const addFile = async () => {
    const files = await window.jaiminho.dialog.openFile({ multi: true, filters: [{ name: 'Protobuf', extensions: ['proto', 'protoset', 'pb'] }] });
    if (!files) return;
    const rels = []; const mains = []; for (const f of files) { const r = await call('grpc:addProto', { file: f }); mains.push(r[0]); rels.push(...r); }
    setProtos(await call('grpc:listProtos'));
    if (mains[0].endsWith('.proto')) set({ source: 'proto', files: [...new Set([...(s.files || []), ...mains.filter((r) => r.endsWith('.proto'))])] });
    else set({ source: 'protoset', protoset: mains[0] });
    toast(`${rels.length} arquivo(s) copiado(s) para protos/ do workspace (com os imports; vão junto ao partilhar)`, 'ok');
  };
  const freeze = async () => {
    const rel = await safe(() => call('grpc:freeze', { request: tab.draft, requestId: tab.itemId, environmentId: getState().activeEnvId, name: (tab.draft.url || 'schema').replace(/^grpcs?:\/\//, '') }));
    if (rel) { setProtos(await call('grpc:listProtos')); set({ fallbackProtoset: rel }); toast(`Schema congelado em ${rel} e usado como reserva se a reflection falhar`, 'ok', 6000); }
  };
  return (
    <div className="subbody col" style={{ maxWidth: 760 }}>
      <div className="row"><span style={{ width: 160 }}>Fonte do schema</span>
        <select className="in" value={s.source} onChange={(e) => { set({ source: e.target.value }); reload(); }} data-testid="grpc-source"><option value="reflection">Server reflection (v1 → v1alpha)</option><option value="proto">Arquivos .proto</option><option value="protoset">Protoset (.protoset/.pb)</option></select>
        <button className="btn sm" onClick={addFile}>+ Adicionar .proto/.protoset</button>
      </div>
      {s.source === 'reflection' && <div className="card col"><div className="hint">Busca o schema direto do servidor (a metadata da request também vai na reflection).</div><div className="row"><button className="btn sm" onClick={freeze} data-testid="grpc-freeze">Congelar schema (salvar protoset no workspace)</button>{s.fallbackProtoset && <span className="hint">Reserva: <span className="mono">{s.fallbackProtoset}</span></span>}</div></div>}
      {s.source === 'proto' && <div className="card col">
        <div className="hint">Arquivos .proto do workspace (pasta protos/). Imports são procurados na pasta do arquivo, nos import paths e nos google/protobuf embutidos.</div>
        {protos.filter((p) => p.endsWith('.proto')).map((p) => <label key={p} className="chk mono"><input type="checkbox" checked={(s.files || []).includes(p)} onChange={(e) => { set({ files: e.target.checked ? [...(s.files || []), p] : (s.files || []).filter((x) => x !== p) }); reload(); }} />{p}</label>)}
        {!protos.some((p) => p.endsWith('.proto')) && <div className="hint">Nenhum .proto no workspace ainda.</div>}
        <div className="section-title">Import paths</div>
        <KVTable rows={(s.importPaths || []).map((p) => ({ key: p, value: '' }))} keyPh="pasta (relativa ao workspace)" valPh="" noToggle onChange={(rows) => set({ importPaths: rows.map((r) => r.key).filter(Boolean) })} />
      </div>}
      {s.source === 'protoset' && <div className="card col"><select className="in" value={s.protoset || ''} onChange={(e) => { set({ protoset: e.target.value }); reload(); }}><option value="">Escolha…</option>{protos.filter((p) => /\.(protoset|pb)$/.test(p)).map((p) => <option key={p}>{p}</option>)}</select></div>}
    </div>
  );
}

export default function GrpcPanel({ tab }) {
  const d = tab.draft; const g = d.grpc || {};
  const layout = useStore((s) => s.layout);
  const envId = useStore((s) => s.activeEnvId);
  const [sub, setSub] = useState('message');
  const [services, setServices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamMsg, setStreamMsg] = useState(null);
  const method = useMemo(() => (services || []).flatMap((s) => s.methods).find((m) => m.fullName === g.method), [services, g.method]);
  const kind = method ? method.kind : null;
  const streaming = kind === 'client-stream' || kind === 'bidi';
  const set = (patch) => updateDraft(tab.key, (dd) => ({ ...dd, grpc: { ...dd.grpc, ...patch } }));
  const load = async (refresh = true) => {
    if (!d.url) return toast('Preencha o endereço do servidor (ex.: grpc://localhost:50051)', 'err');
    setLoading(true);
    try { const r = await call('grpc:describe', { request: tab.draft, requestId: tab.itemId, environmentId: envId, refresh }); setServices(r.services); if (refresh && r.source === 'reflection') toast(`Reflection ${r.reflectionVersion}: ${r.services.length} serviço(s)`, 'ok', 2000); }
    catch (e) { setServices([]); toast(`Não consegui carregar o schema: ${e.message}`, 'err', 9000); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (d.url && g.method) load(false); /* carrega para saber o tipo */ }, []); // eslint-disable-line
  const example = async () => {
    if (!g.method) return toast('Escolha um método', 'err');
    const r = await safe(() => call('grpc:sample', { request: tab.draft, requestId: tab.itemId, environmentId: envId, method: g.method }));
    if (r) set({ message: r });
  };
  const tlsMode = g.tls?.mode || 'auto';
  const isTls = tlsMode === 'tls' || (tlsMode === 'auto' && (/^grpcs:\/\//i.test(d.url || '') || /:443$/.test(d.url || '')));
  return (
    <div className="pane">
      <NameBar tab={tab} kindLabel={`gRPC${kind ? ` · ${kind}` : ''}`} />
      <div className="reqbar">
        <button className="icon-btn" title={isTls ? 'TLS ligado (grpcs://)' : 'Sem TLS (plaintext)'} onClick={() => set({ tls: { ...(g.tls || {}), mode: isTls ? 'plaintext' : 'tls' } })} data-testid="grpc-tls" style={{ color: isTls ? 'var(--verde)' : 'var(--faint)' }} aria-label={isTls ? 'TLS ligado' : 'Sem TLS'}><Icon name={isTls ? 'lock' : 'unlock'} /></button>
        <UrlInput tab={tab} value={d.url || ''} placeholder="grpc://localhost:50051 ou grpcs://host:443 (ou cole um grpcurl)" onChange={(v) => updateDraft(tab.key, { url: v })} onEnter={() => g.method && sendTab(tab.key)}
          onPaste={async (e) => { const t = e.clipboardData.getData('text'); if (/^\s*grpcurl/i.test(t)) { e.preventDefault(); const r = await safe(() => call('io:parseCurl', { text: t })); if (r) { updateDraft(tab.key, (dd) => ({ ...r.request, id: dd.id })); toast('grpcurl importado', 'ok'); } } }} />
        <MethodPicker tab={tab} services={services} loading={loading} onRefresh={() => load(true)} onPick={(m) => { set({ method: m.fullName }); if (!g.message || /^\{\s*\}$/.test(g.message.trim())) setTimeout(example, 0); }} />
        {tab.running ? <button className="btn danger send" onClick={() => cancelTab(tab.key)} data-testid="btn-cancel">Cancelar</button>
          : <button className="btn primary send" onClick={() => { if (!g.method) return toast('Escolha um método', 'err'); sendTab(tab.key); if (streaming) setStreamMsg(g.message); }} data-testid="btn-send">Invocar</button>}
      </div>
      <Splitter storageKey="split-grpc" horizontal={layout === 'horizontal'}>
        <div className="box">
          <div className="subtabs">
            {[['message', 'Mensagem'], ['metadata', 'Metadata', (g.metadata || []).filter((m) => m.enabled !== false).length], ['schema', 'Schema'], ['scripts', 'Scripts'], ['vars', 'Variáveis'], ['settings', 'Configurações']].map(([k, l, c]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`req-tab-${k}`}>{l}{c ? <span className="count">{c}</span> : null}</button>)}
            <span className="grow" />
            {sub === 'message' && <button className="btn sm ghost" onClick={example} data-testid="grpc-example">Gerar exemplo</button>}
          </div>
          {sub === 'message' && <div className="subbody flush">
            <Editor value={g.message || ''} language="json" onChange={(v) => set({ message: v })} testId="grpc-message" />
            {streaming && tab.running && <div className="stream-bar">
              <span className="hint">Stream aberto ({kind}). Edite a mensagem e envie quantas quiser.</span><span className="grow" />
              <button className="btn" onClick={() => streamWrite(tab.key, g.message)} data-testid="grpc-write">↑ Enviar mensagem</button>
              <button className="btn" onClick={() => streamEnd(tab.key)} data-testid="grpc-end">Finalizar envio</button>
            </div>}
            {streaming && !tab.running && <div className="stream-bar"><span className="hint">Método de streaming ({kind}): clique em Invocar para abrir o stream; depois envie mensagens e finalize.</span></div>}
          </div>}
          {sub === 'metadata' && <div className="subbody"><KVTable rows={g.metadata || []} onChange={(metadata) => set({ metadata })} keyPh="chave (minúsculas)" testId="kv-metadata" /><div className="hint" style={{ marginTop: 8 }}>Chaves terminadas em -bin são enviadas como binário (valor em base64).</div></div>}
          {sub === 'schema' && <SchemaTab tab={tab} reload={() => setServices(null)} />}
          {sub === 'scripts' && <GrpcScripts tab={tab} />}
          {sub === 'vars' && <div className="subbody"><KVTable rows={d.vars || []} onChange={(vars) => updateDraft(tab.key, { vars })} /></div>}
          {sub === 'settings' && <div className="subbody col" style={{ maxWidth: 640 }}>
            <div className="row"><span style={{ width: 220 }}>Transporte</span><select className="in" value={tlsMode} onChange={(e) => set({ tls: { ...(g.tls || {}), mode: e.target.value } })}><option value="auto">Automático (grpcs:// ou :443 = TLS)</option><option value="plaintext">Plaintext</option><option value="tls">TLS</option></select></div>
            <div className="row"><span style={{ width: 220 }}>Verificar certificado SSL</span><select className="in" value={g.tls?.verifySsl === undefined ? 'padrao' : g.tls.verifySsl ? 'sim' : 'nao'} onChange={(e) => set({ tls: { ...(g.tls || {}), verifySsl: e.target.value === 'padrao' ? undefined : e.target.value === 'sim' } })} data-testid="grpc-verify"><option value="padrao">Padrão do workspace</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
            <div className="row"><span style={{ width: 220 }}>Deadline (ms)</span><input className="in" type="number" placeholder="30000 (unário) / sem limite (stream)" value={g.options?.deadlineMs ?? ''} onChange={(e) => set({ options: { ...(g.options || {}), deadlineMs: e.target.value === '' ? undefined : Number(e.target.value) } })} /></div>
            <div className="row"><span style={{ width: 220 }}>Authority / SNI</span><input className="in grow mono" placeholder="(opcional) nome do servidor no certificado" value={g.options?.authority || ''} onChange={(e) => set({ options: { ...(g.options || {}), authority: e.target.value || undefined } })} /></div>
            <div className="row"><span style={{ width: 220 }}>Compressão</span><select className="in" value={g.options?.compression || ''} onChange={(e) => set({ options: { ...(g.options || {}), compression: e.target.value || undefined } })}><option value="">Nenhuma</option><option value="gzip">gzip</option></select></div>
            <label className="chk"><input type="checkbox" checked={!!g.options?.showDefaults} onChange={(e) => set({ options: { ...(g.options || {}), showDefaults: e.target.checked || undefined } })} /> Mostrar campos com valor padrão na resposta (o gRPC omite zeros)</label>
            <div className="hint">mTLS e CAs: Configurações do workspace → Certificados (por host:porta).</div>
          </div>}
        </div>
        <ResponseView tab={tab} />
      </Splitter>
    </div>
  );
}

function GrpcScripts({ tab }) {
  const [which, setWhich] = useState('beforeInvoke');
  const s = tab.draft.scripts || {};
  return (
    <div className="subbody flush">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
        {[['beforeInvoke', 'Antes de invocar'], ['onIncomingMessage', 'A cada mensagem'], ['afterResponse', 'Depois da resposta']].map(([k, l]) => <button key={k} className={`btn sm ${which === k ? '' : 'ghost'}`} onClick={() => setWhich(k)}>{l}{s[k] ? ' •' : ''}</button>)}
      </div>
      <Editor value={s[which] || ''} language="javascript" onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, scripts: { ...(dd.scripts || {}), [which]: v } }))} placeholder={which === 'afterResponse' ? 'pm.test("OK", () => pm.expect(pm.response.statusCode).to.eql(0));' : which === 'onIncomingMessage' ? 'pm.test("tem id", () => pm.expect(pm.message.data.id).to.exist);' : 'pm.variables.set("trace", Date.now().toString());'} />
    </div>
  );
}
