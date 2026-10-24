import React, { useEffect, useRef, useState } from 'react';
import Editor from './Editor';
import KVTable from './KVTable';
import AuthEditor from './AuthEditor';
import ResponseView from './ResponseView';
import GrpcPanel from './GrpcPanel';
import { Splitter, NameBar } from './Common';
import { UrlInput, AutoHeaders } from './UrlInput';
import { useChain, inheritedAuth } from '../hooks';
import { openItem } from '../store';
import { call, updateDraft, saveTab, openModal, toast, useStore, safe, refreshTree, setState, isDirty } from '../store';
import { sendTab, cancelTab } from '../send';
import { METHODS, parseUrlParams, buildUrl, syncPathVars } from '../util';

const BODY_MODES = [['none', 'Nenhum'], ['json', 'JSON'], ['xml', 'XML'], ['text', 'Texto'], ['urlencoded', 'x-www-form-urlencoded'], ['formdata', 'form-data'], ['file', 'Binário (arquivo)'], ['graphql', 'GraphQL']];

function bodyModeOf(b = {}) { if (b.mode === 'raw') return b.language === 'json' ? 'json' : b.language === 'xml' ? 'xml' : 'text'; return b.mode || 'none'; }

function ScriptsTab({ tab, hooks }) {
  const [which, setWhich] = useState(hooks[0][0]);
  const d = tab.draft;
  return (
    <div className="subbody flush">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
        {hooks.map(([k, l]) => <button key={k} className={`btn sm ${which === k ? '' : 'ghost'}`} onClick={() => setWhich(k)} data-testid={`script-${k}`}>{l}{(d.scripts || {})[k] ? ' •' : ''}</button>)}
        <span className="grow" />
        <span className="hint">API do Postman: pm.test, pm.expect, pm.environment, pm.response…</span>
      </div>
      <Editor value={(d.scripts || {})[which] || ''} language="javascript" onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, scripts: { ...(dd.scripts || {}), [which]: v } }))} testId="script-editor"
        placeholder={which === 'post' || which === 'afterResponse' ? 'pm.test("status 200", () => pm.response.to.have.status(200));' : 'pm.environment.set("ts", Date.now());'} />
    </div>
  );
}

function SettingsTab({ tab, grpc }) {
  const d = tab.draft; const s = d.settings || {};
  const set = (patch) => updateDraft(tab.key, (dd) => ({ ...dd, settings: { ...(dd.settings || {}), ...patch } }));
  const tri = (v) => (v === undefined ? 'padrao' : v ? 'sim' : 'nao');
  const fromTri = (v) => (v === 'padrao' ? undefined : v === 'sim');
  return (
    <div className="subbody col" style={{ maxWidth: 640 }}>
      <div className="row"><span style={{ width: 260 }}>Verificar certificado SSL</span><select className="in" value={tri(s.verifySsl)} onChange={(e) => set({ verifySsl: fromTri(e.target.value) })} data-testid="set-verifySsl"><option value="padrao">Padrão do workspace</option><option value="sim">Sim</option><option value="nao">Não (aceita qualquer certificado)</option></select></div>
      {!grpc && <div className="row"><span style={{ width: 260 }}>Seguir redirects</span><select className="in" value={tri(s.followRedirects)} onChange={(e) => set({ followRedirects: fromTri(e.target.value) })}><option value="padrao">Padrão do workspace</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>}
      {!grpc && <div className="row"><span style={{ width: 260 }}>Timeout (ms)</span><input className="in" type="number" placeholder="padrão do workspace" value={s.timeoutMs || ''} onChange={(e) => set({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })} /></div>}
      {!grpc && <label className="chk"><input type="checkbox" checked={!!s.disableCookies} onChange={(e) => set({ disableCookies: e.target.checked || undefined })} /> Não usar o pote de cookies nesta request</label>}
      {d.kind === 'soap' && <label className="chk"><input type="checkbox" checked={!!s.validateXsd} onChange={(e) => set({ validateXsd: e.target.checked || undefined })} /> Validar request e resposta contra o XSD do WSDL</label>}
      <div className="hint">Certificados de cliente (mTLS), CAs e proxy ficam em Configurações do workspace (Ctrl+,).</div>
    </div>
  );
}

function VarsTab({ tab }) {
  return <div className="subbody"><div className="hint" style={{ marginBottom: 8 }}>Variáveis só desta request (ganham do ambiente, perdem para as de script/data).</div><KVTable rows={tab.draft.vars || []} onChange={(vars) => updateDraft(tab.key, { vars })} /></div>;
}

export default function RequestEditor({ tab }) {
  const d = tab.draft;
  const layout = useStore((s) => s.layout);
  const [sub, setSub] = useState(d.kind === 'soap' ? 'body' : 'params');
  const urlRef = useRef(null);
  const chain = useChain(tab.itemId, tab.parentId);
  const inh = inheritedAuth(chain);
  useEffect(() => { const f = () => urlRef.current && urlRef.current.focus(); window.addEventListener('jaiminho:focus-url', f); return () => window.removeEventListener('jaiminho:focus-url', f); }, []);
  if (d.kind === 'grpc') return <GrpcPanel tab={tab} />;

  const onUrl = (url) => updateDraft(tab.key, (dd) => {
    const { base, params } = parseUrlParams(url);
    const next = { ...dd, url: base, pathVars: syncPathVars(base, dd.pathVars) };
    if (params) { const disabled = (dd.params || []).filter((p) => p.enabled === false); next.params = [...params, ...disabled]; } else next.params = (dd.params || []).filter((p) => p.enabled === false);
    return next;
  });
  const fullUrl = buildUrl(d.url || '', d.params);
  const onPaste = async (e) => {
    const text = e.clipboardData.getData('text');
    if (!/^\s*(curl|grpcurl)(\.exe)?\s/i.test(text)) return;
    e.preventDefault();
    const r = await safe(() => call('io:parseCurl', { text }));
    if (!r) return;
    updateDraft(tab.key, (dd) => ({ ...r.request, id: dd.id, name: dd.name && !/^Nova request/.test(dd.name) ? dd.name : r.request.name }));
    if (r.extras && r.extras.certificate) toast('O cURL tinha certificado de cliente/CA: configure em Configurações → Certificados', 'info', 7000);
    toast('cURL importado nesta request', 'ok', 2500);
  };
  const setBodyMode = (mode) => updateDraft(tab.key, (dd) => {
    const b = dd.body || {};
    if (['json', 'xml', 'text'].includes(mode)) {
      const headers = [...(dd.headers || [])];
      const ct = { json: 'application/json', xml: 'application/xml', text: 'text/plain' }[mode];
      const i = headers.findIndex((h) => /^content-type$/i.test(h.key));
      if (dd.kind !== 'soap') { if (i < 0) headers.push({ key: 'Content-Type', value: ct, enabled: true }); else if (!/\{\{/.test(headers[i].value)) headers[i] = { ...headers[i], value: ct }; }
      return { ...dd, headers, body: { ...b, mode: 'raw', language: mode, raw: b.raw || '' } };
    }
    return { ...dd, body: { ...b, mode } };
  });
  const mode = bodyModeOf(d.body);
  const isSoap = d.kind === 'soap';
  const counts = { params: (d.params || []).filter((p) => p.enabled !== false).length + (d.pathVars || []).length, headers: (d.headers || []).filter((p) => p.enabled !== false).length };

  return (
    <div className="pane">
      <NameBar tab={tab} kindLabel={isSoap ? `SOAP ${d.soap?.version || '1.1'}` : null} />
      <div className="reqbar">
        {isSoap ? <span className="method m-SOAP" style={{ width: 64, textAlign: 'center' }}>POST</span> :
          <select className={`in method-sel m-${d.method}`} value={d.method || 'GET'} onChange={(e) => updateDraft(tab.key, { method: e.target.value })} data-testid="req-method">{METHODS.map((m) => <option key={m} className={`m-${m}`}>{m}</option>)}</select>}
        <UrlInput inputRef={urlRef} tab={tab} value={fullUrl} onChange={onUrl} onPaste={onPaste} placeholder="https://… ou cole um cURL aqui" onEnter={() => sendTab(tab.key)} />
        {tab.running ? <button className="btn danger send" onClick={() => cancelTab(tab.key)} data-testid="btn-cancel">Cancelar</button>
          : <button className="btn primary send" onClick={() => sendTab(tab.key)} data-testid="btn-send">Enviar</button>}
      </div>
      <Splitter storageKey="split-req" horizontal={layout === 'horizontal'}>
        <div className="box">
          <div className="subtabs">
            {[['params', 'Params', counts.params], ['auth', 'Autorização'], ['headers', 'Headers', counts.headers], ['body', 'Body'], ['scripts', 'Scripts'], ['vars', 'Variáveis'], ['settings', 'Configurações'], ...(isSoap ? [['soap', 'SOAP']] : [])].map(([k, l, c]) => (
              <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`req-tab-${k}`}>{l}{c ? <span className="count">{c}</span> : null}</button>))}
          </div>
          {sub === 'params' && <div className="subbody">
            <div className="section-title" style={{ marginTop: 0 }}>Query params</div>
            <KVTable rows={d.params || []} onChange={(params) => updateDraft(tab.key, { params })} testId="kv-params" />
            {(d.pathVars || []).length > 0 && <><div className="section-title">Variáveis de caminho</div><KVTable rows={d.pathVars} noToggle readOnlyKeys onChange={(pathVars) => updateDraft(tab.key, { pathVars })} /></>}
          </div>}
          {sub === 'auth' && <div className="subbody"><AuthEditor auth={d.auth} onChange={(auth) => updateDraft(tab.key, { auth })} inheritedFrom={inh && inh.label} onOpenInherited={inh ? () => openItem(inh.id, inh.type) : undefined} /></div>}
          {sub === 'headers' && <div className="subbody"><KVTable rows={d.headers || []} onChange={(headers) => updateDraft(tab.key, { headers })} testId="kv-headers" /><AutoHeaders draft={d} inherited={inh} /></div>}
          {sub === 'body' && <div className="subbody flush">
            {!isSoap && <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
              {BODY_MODES.map(([k, l]) => <label key={k} className="chk"><input type="radio" name={`bm-${tab.key}`} checked={mode === k} onChange={() => setBodyMode(k)} data-testid={`body-${k}`} />{l}</label>)}
              {mode === 'json' && <button className="btn sm ghost" onClick={() => { try { updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, raw: JSON.stringify(JSON.parse(dd.body.raw), null, 2) } })); } catch (e) { toast(`JSON inválido: ${e.message}`, 'err'); } }}>Formatar</button>}
            </div>}
            {isSoap && <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}><span className="hint">Envelope SOAP {d.soap?.version}</span><span className="grow" /><button className="btn sm ghost" onClick={async () => { const p = await call('xml:pretty', { text: d.body.raw }); updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, raw: p } })); }}>Formatar XML</button></div>}
            {(['json', 'xml', 'text'].includes(mode) || isSoap) && <Editor value={d.body?.raw || ''} language={isSoap ? 'xml' : mode} onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, raw: v } }))} testId="body-editor" />}
            {mode === 'none' && !isSoap && <div className="empty">Esta request não tem corpo.</div>}
            {mode === 'urlencoded' && <div className="subbody"><KVTable rows={d.body.urlencoded || []} onChange={(urlencoded) => updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, urlencoded } }))} /></div>}
            {mode === 'formdata' && <div className="subbody"><KVTable rows={d.body.formdata || []} onChange={(formdata) => updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, formdata } }))}
              extraCols={[{ key: 'type', label: 'Tipo', width: 160, render: (r, set) => (<div className="row" style={{ gap: 4 }}><select className="in" style={{ height: 26 }} value={r.type || 'text'} onChange={(e) => set({ type: e.target.value })}><option value="text">Texto</option><option value="file">Arquivo</option></select>{r.type === 'file' && <button className="btn sm" title={r.src || ''} onClick={async () => { const f = await window.jaiminho.dialog.openFile({}); if (f) set({ src: f, value: f.split(/[\\/]/).pop() }); }}>…</button>}</div>) }]} /></div>}
            {mode === 'file' && <div className="subbody row"><button className="btn" onClick={async () => { const f = await window.jaiminho.dialog.openFile({}); if (f) updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, mode: 'file', file: f } })); }}>Escolher arquivo</button><span className="mono">{d.body.file || 'nenhum arquivo'}</span></div>}
            {mode === 'graphql' && <div className="box" style={{ flex: 1 }}><div className="hint" style={{ padding: '6px 10px' }}>Query</div><Editor value={d.body.graphql?.query || ''} language="text" onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, graphql: { ...(dd.body.graphql || {}), query: v } } }))} /><div className="hint" style={{ padding: '6px 10px' }}>Variáveis (JSON)</div><Editor value={d.body.graphql?.variables || ''} language="json" onChange={(v) => updateDraft(tab.key, (dd) => ({ ...dd, body: { ...dd.body, graphql: { ...(dd.body.graphql || {}), variables: v } } }))} /></div>}
          </div>}
          {sub === 'scripts' && <ScriptsTab tab={tab} hooks={[['pre', 'Antes da request'], ['post', 'Depois da resposta (testes)']]} />}
          {sub === 'vars' && <VarsTab tab={tab} />}
          {sub === 'settings' && <SettingsTab tab={tab} />}
          {sub === 'soap' && <div className="subbody col" style={{ maxWidth: 640 }}>
            <div className="row"><span style={{ width: 140 }}>Versão SOAP</span><select className="in" value={d.soap?.version || '1.1'} onChange={(e) => updateDraft(tab.key, (dd) => ({ ...dd, soap: { ...(dd.soap || {}), version: e.target.value }, body: { ...dd.body, raw: (dd.body.raw || '').replace(/http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/|http:\/\/www\.w3\.org\/2003\/05\/soap-envelope/, e.target.value === '1.2' ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/') } }))}><option value="1.1">1.1 (text/xml + SOAPAction)</option><option value="1.2">1.2 (application/soap+xml)</option></select></div>
            <div className="row"><span style={{ width: 140 }}>SOAPAction</span><input className="in grow mono" value={d.soap?.action || ''} onChange={(e) => updateDraft(tab.key, (dd) => ({ ...dd, soap: { ...(dd.soap || {}), action: e.target.value } }))} /></div>
            <div className="row"><span style={{ width: 140 }}>WSDL</span><span className="mono">{d.soap?.wsdl || '— (importe um WSDL para validar contra o XSD)'}</span></div>
            <label className="chk"><input type="checkbox" checked={!!(d.settings || {}).validateXsd} onChange={(e) => updateDraft(tab.key, (dd) => ({ ...dd, settings: { ...(dd.settings || {}), validateXsd: e.target.checked || undefined } }))} /> Validar contra o XSD do WSDL</label>
          </div>}
        </div>
        <ResponseView tab={tab} />
      </Splitter>
    </div>
  );
}
