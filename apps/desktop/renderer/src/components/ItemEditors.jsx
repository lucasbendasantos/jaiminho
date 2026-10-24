import React, { useEffect, useState } from 'react';
import Editor from './Editor';
import KVTable from './KVTable';
import AuthEditor from './AuthEditor';
import Icon from '../icons';
import { call, updateDraft, saveTab, isDirty, useStore, setActiveEnv, toast, safe, openModal, api$ } from '../store';

const SECRET = '••••••';

function VarsWithSecrets({ rows, onChange, scope, showLocal = true }) {
  const [locals, setLocals] = useState({});
  const load = () => call('locals:get').then((l) => setLocals(l[scope] || {})).catch(() => {});
  useEffect(() => { load(); }, [scope]);
  const setLocal = async (key, value) => { await call('locals:set', { scope, key, value: value === '' ? null : value }); load(); };
  return (
    <>
      <KVTable rows={(rows || []).map((r) => (r.secret && (r.value === undefined || r.value === '') ? { ...r, value: SECRET } : r))} onChange={(next) => onChange(next.map((r) => (r.secret && r.value === SECRET ? { ...r, value: undefined } : r)))} valPh="Valor partilhado"
        extraCols={[
          ...(showLocal ? [{ key: 'local', label: 'Valor local (só no seu PC)', width: '28%', render: (r) => <input className="cell" defaultValue={locals[r.key] ?? ''} placeholder="(usa o partilhado)" onBlur={(e) => setLocal(r.key, e.target.value)} key={`${r.key}:${locals[r.key] ?? ''}`} /> }] : []),
          { key: 'reveal', label: '', width: 34, render: (r) => (r.secret ? <RevealSecret scope={scope} k={r.key} /> : null) },
          { key: 'secret', label: 'Segredo', width: 70, render: (r, set) => <input type="checkbox" checked={!!r.secret} onChange={(e) => set({ secret: e.target.checked, value: e.target.checked ? r.value : (r.value === SECRET ? '' : r.value) })} title="Segredo: valor cifrado fora do workspace (não vai para git nem export)" /> },
        ]} />
      <div className="hint" style={{ marginTop: 8 }}>
        <b>Valor partilhado</b> vai no arquivo do workspace (git/.jaiminho). <b>Valor local</b> só fica no seu PC e ganha do partilhado (é o "current value" do Postman; scripts gravam aqui). <b>Segredo</b> nunca vai para arquivo partilhado: o valor fica cifrado em .jaiminho/.
      </div>
    </>
  );
}

function RevealSecret({ scope, k }) {
  const [val, setVal] = useState(null);
  const show = async () => { const v = await call('secret:get', { key: `${scope}:${k}` }); setVal(v === undefined || v === null ? '(sem valor neste PC)' : v); setTimeout(() => setVal(null), 5000); };
  return <span style={{ position: 'relative' }}><button className="icon-btn" title="Mostrar o valor do segredo por 5 s" aria-label={`Mostrar segredo ${k}`} onClick={show}><Icon name="eye" size={14} /></button>{val !== null && <span className="toast info mono" style={{ position: 'absolute', right: 30, top: -6, minWidth: 0, whiteSpace: 'nowrap', zIndex: 5 }}>{val}</span>}</span>;
}

export function CollectionEditor({ tab }) {
  const d = tab.draft;
  const [sub, setSub] = useState(tab.type === 'collection' ? 'overview' : 'auth');
  const isCol = tab.type === 'collection';
  return (
    <div className="pane">
      <div className="reqname">
        <Icon name={isCol ? 'collection' : 'folder'} className={isCol ? 'ico-col' : 'ico-folder'} />
        <input value={d.name || ''} onChange={(e) => updateDraft(tab.key, { name: e.target.value })} data-testid="item-name" />
        <span className="grow" />
        <button className="btn sm" onClick={() => openModal('runner', { id: tab.itemId, name: d.name })}><Icon name="play" size={12} /> Rodar</button>
        <button className="btn sm" onClick={() => saveTab(tab.key)} disabled={!isDirty(tab)} data-testid="btn-save">Salvar</button>
      </div>
      <div className="subtabs" style={{ marginTop: 8 }}>
        {[...(isCol ? [['overview', 'Visão geral']] : []), ['auth', 'Autorização'], ['scripts', 'Scripts'], ['vars', 'Variáveis']].map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`item-tab-${k}`}>{l}</button>)}
      </div>
      {sub === 'overview' && <div className="subbody col" style={{ maxWidth: 760 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Descrição</div>
        <textarea className="in" rows={5} value={d.description || ''} onChange={(e) => updateDraft(tab.key, { description: e.target.value })} />
        {d.origin && <><div className="section-title">Origem</div><div className="card col">
          <div className="mono">{d.origin.type === 'openapi' ? `Swagger/OpenAPI ${d.origin.version || ''}` : d.origin.type.toUpperCase()} · {d.origin.url || d.origin.file || 'texto colado'}</div>
          <div className="hint">Importado em {d.origin.importedAt ? new Date(d.origin.importedAt).toLocaleString() : '—'}{d.origin.syncedAt ? ` · sincronizado em ${new Date(d.origin.syncedAt).toLocaleString()}` : ''}</div>
          {d.origin.type === 'openapi' && <div><button className="btn sm" onClick={() => openModal('sync', { id: tab.itemId, name: d.name })}>Sincronizar com o Swagger…</button></div>}
        </div></>}
      </div>}
      {sub === 'auth' && <div className="subbody"><AuthEditor auth={d.auth} onChange={(auth) => updateDraft(tab.key, { auth })} allowInherit={!isCol} /><div className="hint" style={{ marginTop: 10 }}>Requests com "Herdar do pai" usam esta autenticação.</div></div>}
      {sub === 'scripts' && <ColScripts tab={tab} />}
      {sub === 'vars' && <div className="subbody">{isCol ? <VarsWithSecrets rows={d.vars} scope={`col:${tab.itemId}`} onChange={(vars) => updateDraft(tab.key, { vars })} /> : <><div className="hint" style={{ marginBottom: 8 }}>Variáveis da pasta (ganham do ambiente).</div><KVTable rows={d.vars || []} onChange={(vars) => updateDraft(tab.key, { vars })} /></>}</div>}
    </div>
  );
}

function ColScripts({ tab }) {
  const [which, setWhich] = useState('pre');
  const s = tab.draft.scripts || {};
  return (
    <div className="subbody flush">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
        {[['pre', 'Pre-request (HTTP)'], ['post', 'Post-response (HTTP)'], ['beforeInvoke', 'Antes de invocar (gRPC)'], ['afterResponse', 'Depois da resposta (gRPC)']].map(([k, l]) => <button key={k} className={`btn sm ${which === k ? '' : 'ghost'}`} onClick={() => setWhich(k)}>{l}{s[k] ? ' •' : ''}</button>)}
        <span className="grow" /><span className="hint">Roda antes do script de cada request desta {tab.type === 'collection' ? 'coleção' : 'pasta'}</span>
      </div>
      <Editor value={s[which] || ''} language="javascript" onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, scripts: { ...(dd.scripts || {}), [which]: v } }))} />
    </div>
  );
}

export function EnvironmentEditor({ tab }) {
  const d = tab.draft;
  const active = useStore((s) => s.activeEnvId);
  return (
    <div className="pane">
      <div className="reqname">
        <span className="row" style={{ gap: 4 }} role="radiogroup" aria-label="Cor do ambiente">{['#68A048', '#E0B050', '#E05656', '#5D96DD', '#9040D8', '#707888'].map((c) => <button key={c} role="radio" aria-checked={(d.color || '#707888') === c} title={{ '#68A048': 'verde (DEV)', '#E0B050': 'dourado (QUA)', '#E05656': 'vermelho (PRD)' }[c] || c} onClick={() => updateDraft(tab.key, { color: c })} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: (d.color || '#707888') === c ? '2px solid var(--text)' : '1px solid var(--line)', cursor: 'pointer', padding: 0 }} />)}</span>
        <input value={d.name || ''} onChange={(e) => updateDraft(tab.key, { name: e.target.value })} data-testid="env-name" />
        <span className="grow" />
        {active === tab.itemId ? <span className="scope-tag">ambiente ativo</span> : <button className="btn sm" onClick={() => setActiveEnv(tab.itemId)}>Ativar</button>}
        <button className="btn sm" onClick={() => saveTab(tab.key)} disabled={!isDirty(tab)} data-testid="btn-save">Salvar</button>
      </div>
      <div className="subbody"><VarsWithSecrets rows={d.vars} scope={`env:${tab.itemId}`} onChange={(vars) => updateDraft(tab.key, { vars })} /></div>
    </div>
  );
}

export function GlobalsEditor() {
  const [rows, setRows] = useState(null);
  useEffect(() => { call('globals:get').then(setRows); }, []);
  if (!rows) return null;
  return (
    <div className="pane">
      <div className="reqname"><b style={{ fontSize: 14 }}>Variáveis globais</b><span className="hint">(só neste PC, valem para todos os workspaces)</span><span className="grow" /><button className="btn sm" onClick={async () => { const r = await safe(() => call('globals:save', { vars: rows }), 'Globais salvas'); if (r) setRows(r); }} data-testid="btn-save">Salvar</button></div>
      <div className="subbody"><VarsWithSecrets rows={rows} scope="glo" onChange={setRows} /></div>
    </div>
  );
}
