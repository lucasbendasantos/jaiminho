import React, { useEffect, useMemo, useState } from 'react';
import Editor from './Editor';
import HelpModal, { HelpLink, SHORTCUTS } from './HelpModal';
import KVTable from './KVTable';
import { useStore, closeModal, openModal, call, toast, safe, refreshTree, applySummary, openItem, getState, setState, api$, THEMES, setTheme } from '../store';

let modalSeq = 0;
export function Modal({ title, children, footer, wide, onClose = closeModal, testId }) {
  const ref = React.useRef(null);
  const [id] = useState(() => `mt${++modalSeq}`);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) { const first = el.querySelector('.mbody input, .mbody select, .mbody textarea, .mbody [contenteditable=true], .mbody button, footer button'); if (first) first.focus(); }
    const f = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('button, input, select, textarea, [tabindex="0"], [contenteditable=true]')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { items[items.length - 1].focus(); e.preventDefault(); }
        else if (!e.shiftKey && i === items.length - 1) { items[0].focus(); e.preventDefault(); }
      }
    };
    window.addEventListener('keydown', f);
    return () => { window.removeEventListener('keydown', f); if (prev && prev.focus) try { prev.focus(); } catch { /* ignore */ } };
  }, []); // eslint-disable-line
  return <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} data-testid={testId} role="dialog" aria-modal="true" aria-labelledby={id}><header id={id}>{title}<span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button></header><div className="mbody">{children}</div>{footer && <footer>{footer}</footer>}</div></div>;
}

// ---------------- prompt ----------------
export function prompt(title, value = '', hint) { return new Promise((resolve) => openModal('prompt', { title, value, hint, resolve })); }
function PromptModal({ title, value, hint, resolve }) {
  const [v, setV] = useState(value);
  const done = (r) => { closeModal(); resolve(r); };
  return <Modal title={title} onClose={() => done(null)} testId="modal-prompt" footer={<><button className="btn" onClick={() => done(null)}>Cancelar</button><button className="btn primary" onClick={() => done(v.trim() || null)} data-testid="prompt-ok">OK</button></>}>
    <input autoFocus className="in" style={{ width: '100%' }} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && done(v.trim() || null)} data-testid="prompt-input" />
    {hint && <div className="hint" style={{ marginTop: 8 }}>{hint}</div>}
  </Modal>;
}

// ---------------- salvar como ----------------
function SaveAsModal({ name, resolve }) {
  const tree = useStore((s) => s.tree);
  const [n, setN] = useState(name || 'Nova request');
  const [parent, setParent] = useState(null);
  const done = (r) => { closeModal(); resolve(r); };
  const flat = []; const walk = (node, depth) => { if (node.type === 'request') return; flat.push({ ...node, depth }); (node.children || []).forEach((c) => walk(c, depth + 1)); };
  (tree?.collections || []).forEach((c) => walk(c, 0));
  useEffect(() => { if (!flat.length) { call('item:createCollection', { name: 'Minhas requests' }).then(async (cid) => { await refreshTree(); setParent(cid); }).catch(() => {}); } else if (flat.length === 1) setParent(flat[0].id); }, []); // eslint-disable-line
  const newCol = async () => { const cn = await prompt('Nome da coleção', 'Minhas requests'); if (cn) { const id = await call('item:createCollection', { name: cn }); await refreshTree(); openModal('saveAs', { name: n, resolve }); setTimeout(() => setParent(id), 0); } };
  return <Modal title="Salvar request" onClose={() => done(null)} testId="modal-saveas" footer={<><button className="btn" onClick={newCol}>＋ Nova coleção</button><span className="grow" /><button className="btn" onClick={() => done(null)}>Cancelar</button><button className="btn primary" disabled={!parent} onClick={() => done({ name: n, parentId: parent })} data-testid="saveas-ok">Salvar</button></>}>
    <div className="row"><span style={{ width: 80 }}>Nome</span><input className="in grow" value={n} onChange={(e) => setN(e.target.value)} data-testid="saveas-name" /></div>
    <div className="section-title">Onde salvar</div>
    <div className="card" style={{ maxHeight: 340, overflow: 'auto', padding: 4 }}>
      {flat.map((f) => <div key={f.id} className={`tree-row ${parent === f.id ? 'sel' : ''}`} style={{ paddingLeft: 8 + f.depth * 14 }} onClick={() => setParent(f.id)} data-testid={`saveas-${f.name}`}>{f.type === 'collection' ? '📮' : '📁'} <span className="name">{f.name}</span></div>)}
      {!flat.length && <div className="empty">Crie uma coleção primeiro.</div>}
    </div>
  </Modal>;
}

// ---------------- importar ----------------
function ImportModal({ initialMode }) {
  const [mode, setMode] = useState(initialMode || 'text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [envs, setEnvs] = useState(true);
  const [result, setResult] = useState(null);
  const run = async (args) => {
    setBusy(true); setResult(null);
    try {
      const r = await call('io:import', { ...args, environmentId: getState().activeEnvId, createEnvironments: envs });
      await refreshTree(); setResult(r);
      if (r.requestId) { await openItem(r.requestId, 'request'); }
      if (r.missingSecrets && r.missingSecrets.length) toast(`Faltam ${r.missingSecrets.length} segredo(s) para preencher nos ambientes/coleções`, 'info', 6000);
    } catch (e) { toast(e.message, 'err', 9000); } finally { setBusy(false); }
  };
  const pickFile = async () => { const f = await api$.dialog.openFile({ filters: [{ name: 'Importáveis', extensions: ['json', 'yaml', 'yml', 'wsdl', 'xml', 'jaiminho', 'txt', 'sh'] }, { name: 'Todos', extensions: ['*'] }] }); if (f) run({ file: f }); };
  return <Modal title="Importar" wide testId="modal-import" footer={<button className="btn" onClick={closeModal}>Fechar</button>}>
    <div className="subtabs" style={{ padding: 0, marginBottom: 12 }}>{[['text', 'Colar texto'], ['file', 'Arquivo'], ['url', 'URL (Swagger / WSDL)']].map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)} data-testid={`import-${k}`}>{l}</button>)}</div>
    {mode === 'text' && <div className="col">
      <div className="hint">Cole um <b>cURL</b> (bash, cmd ou PowerShell), <b>grpcurl</b>, coleção/ambiente/backup do <b>Postman</b>, <b>Swagger/OpenAPI</b> (JSON ou YAML) ou um <b>WSDL</b>. O tipo é detectado sozinho. <HelpLink section="importar" />
      </div>
      <div style={{ height: 280, display: 'flex', border: '1px solid var(--line)', borderRadius: 8 }}><Editor value={text} onChange={setText} language="text" testId="import-text" placeholder={"curl -X POST 'https://api.interna/v1/viajantes' -H 'Content-Type: application/json' -d '{\"nome\":\"Ana\"}'"} /></div>
      <div className="row"><label className="chk"><input type="checkbox" checked={envs} onChange={(e) => setEnvs(e.target.checked)} />Swagger: criar um ambiente por servidor</label><span className="grow" /><button className="btn primary" disabled={!text.trim() || busy} onClick={() => run({ text })} data-testid="import-go">{busy ? 'Importando…' : 'Importar'}</button></div>
    </div>}
    {mode === 'file' && <div className="col"><div className="drop-hint">Postman (.json), Swagger (.json/.yaml), WSDL (.wsdl/.xml), bundle do Jaiminho (.jaiminho) ou arquivo com cURL<br /><br /><button className="btn primary" onClick={pickFile} disabled={busy}>{busy ? 'Importando…' : 'Escolher arquivo…'}</button></div></div>}
    {mode === 'url' && <div className="col">
      <div className="hint">URL do Swagger (JSON/YAML), da página do Swagger UI/springdoc (ex.: …/swagger-ui/index.html) ou do WSDL (…?wsdl). O download passa pelo proxy, CAs e certificados do workspace (funciona na VPN). <HelpLink section="importar" /></div>
      <div className="row"><input className="in grow mono" placeholder="http://servico.interno:8080/v3/api-docs" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="import-url-input" onKeyDown={(e) => e.key === 'Enter' && url && run({ url })} /><button className="btn primary" disabled={!url || busy} onClick={() => run({ url })} data-testid="import-url-go">{busy ? 'Importando…' : 'Importar'}</button></div>
      <label className="chk"><input type="checkbox" checked={envs} onChange={(e) => setEnvs(e.target.checked)} />Criar um ambiente por servidor declarado no Swagger</label>
    </div>}
    {result && <div className="card" style={{ marginTop: 12 }} data-testid="import-result"><b>{describe(result)}</b>{result.report && result.report.warnings && result.report.warnings.length > 0 && <ul>{result.report.warnings.map((w, i) => <li key={i} className="hint">{w}</li>)}</ul>}</div>}
  </Modal>;
}
function describe(r) {
  switch (r.type) {
    case 'curl': return 'cURL importado (coleção "Rascunhos" ou a pasta escolhida)';
    case 'grpcurl': return 'grpcurl importado';
    case 'openapi': return `Swagger importado: ${r.spec?.title || ''} ${r.spec?.version || ''} (${r.report?.requests ?? '?'} requests${r.environments?.length ? `, ${r.environments.length} ambiente(s)` : ''})`;
    case 'wsdl': return `WSDL importado: ${r.operations} operação(ões) SOAP`;
    case 'collection': return `Coleção do Postman importada (${r.report?.requests} requests, ${r.report?.folders} pastas)`;
    case 'environment': return 'Ambiente do Postman importado';
    case 'globals': return 'Globais do Postman importadas';
    case 'dump': return `Backup do Postman: ${r.collections.length} coleções, ${r.environments.length} ambientes`;
    case 'bundle': return `Bundle importado: ${r.collections.join(', ') || 'nenhuma coleção'}${r.environments.length ? ` · ambientes: ${r.environments.join(', ')}` : ''}`;
    default: return 'Importado';
  }
}

// ---------------- código (cURL, grpcurl, linguagens) ----------------
function CodeModal({ tabKey }) {
  const tab = useStore((s) => s.tabs.find((t) => t.key === tabKey));
  const env = useStore((s) => s.activeEnvId);
  const isGrpc = tab && tab.draft.kind === 'grpc';
  const [langs, setLangs] = useState([]);
  const [target, setTarget] = useState('curl:bash');
  const [resolve, setResolve] = useState(true);
  const [code, setCode] = useState('');
  useEffect(() => { call('io:languages').then(setLangs).catch(() => {}); }, []);
  useEffect(() => {
    if (!tab) return;
    const [kind, a, b] = target.split(':');
    const args = { request: tab.draft, requestId: tab.itemId, parentId: tab.parentId, environmentId: env };
    const p = kind === 'curl' ? call('io:curl', { ...args, flavor: a, resolve }) : call('io:codegen', { ...args, language: a, variant: b });
    p.then(setCode).catch((e) => setCode(`// ${e.message}`));
  }, [target, resolve, tab && tab.draft, env]);
  if (!tab) return null;
  const options = isGrpc ? [['curl:bash', 'grpcurl (bash)'], ['curl:cmd', 'grpcurl (cmd)'], ['curl:powershell', 'grpcurl (PowerShell)']] : [['curl:bash', 'cURL (bash/Git Bash)'], ['curl:cmd', 'cURL (cmd do Windows)'], ['curl:powershell', 'cURL (PowerShell)'], ...langs.filter((l) => l.key !== 'curl').flatMap((l) => l.variants.map((v) => [`gen:${l.key}:${v}`, `${l.label} — ${v}`]))];
  return <Modal title="Código da request" wide testId="modal-code" footer={<><label className="chk"><input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />Resolver variáveis (ambiente ativo)</label><span className="grow" /><button className="btn primary" onClick={() => { api$.clipboard.write(code); toast('Copiado', 'ok', 1500); }} data-testid="code-copy">Copiar</button></>}>
    <div className="row" style={{ marginBottom: 10 }}><select className="in grow" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="code-target">{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
    <div style={{ height: 380, display: 'flex', border: '1px solid var(--line)', borderRadius: 8 }}><Editor value={code} readOnly language={target.includes('java') ? 'javascript' : 'text'} testId="code-out" /></div>
    <div className="hint" style={{ marginTop: 8 }}>Segredos saem resolvidos só se "Resolver variáveis" estiver ligado; desligue para partilhar sem expor tokens.</div>
  </Modal>;
}

// ---------------- configurações do workspace ----------------
function SettingsModal() {
  const ws = useStore((s) => s.ws);
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(ws.settings)));
  const [sub, setSub] = useState('geral');
  const [name, setName] = useState(ws.name);
  const theme = useStore((st) => st.theme);
  const layout = useStore((st) => st.layout);
  const [info, setInfo] = useState(null);
  useEffect(() => { api$.info().then(setInfo); }, []);
  const save = async () => {
    const certs = [];
    for (const c of s.certificates || []) { const cc = { ...c }; if (cc.passphrase) { await call('secret:set', { key: `cert:${cc.id}:passphrase`, value: cc.passphrase }); delete cc.passphrase; } certs.push(cc); }
    if (s.proxy && s.proxy.password) { await call('secret:set', { key: 'proxy:password', value: s.proxy.password }); delete s.proxy.password; }
    const settings = await safe(() => call('ws:saveSettings', { ...s, certificates: certs }));
    if (name !== ws.name) await call('ws:rename', { name });
    if (settings) { setState((st) => ({ ws: { ...st.ws, settings, name } })); toast('Configurações salvas', 'ok', 2000); closeModal(); }
  };
  const pick = async (filters) => api$.dialog.openFile({ filters });
  const rel = (p) => (p && p.startsWith(ws.dir) ? p.slice(ws.dir.length + 1).replace(/\\/g, '/') : p);
  return <Modal title="Configurações" wide testId="modal-settings" footer={<><button className="btn" onClick={closeModal}>Cancelar</button><button className="btn primary" onClick={save} data-testid="settings-save">Salvar</button></>}>
    <div className="subtabs" style={{ padding: 0, marginBottom: 12 }}>{[['geral', 'Workspace (partilhado)'], ['certs', 'Certificados SSL/mTLS (partilhado)'], ['proxy', 'Proxy'], ['grpc', 'gRPC'], ['app', 'Este PC']].map(([k, l]) => <button key={k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`settings-${k}`}>{l}</button>)}</div>
    {['geral', 'certs', 'grpc', 'proxy'].includes(sub) && <div className="hint" style={{ marginBottom: 10 }}>{sub === 'proxy' ? 'O modo de proxy vai no workspace; usuário e senha ficam só neste PC (cifrados).' : 'Estas opções ficam no jaiminho.yaml e vão para quem receber o workspace (git/.jaiminho). Senhas ficam só neste PC.'}</div>}
    {sub === 'geral' && <div className="col" style={{ maxWidth: 640 }}>
      <div className="row"><span style={{ width: 240 }}>Nome do workspace</span><input className="in grow" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row"><span style={{ width: 240 }}>Pasta</span><span className="mono grow" style={{ wordBreak: 'break-all' }}>{ws.dir}</span><button className="btn sm" onClick={() => api$.showItem(`${ws.dir}/jaiminho.yaml`)}>Abrir pasta</button></div>
      <label className="chk" data-testid="settings-verifySsl"><input type="checkbox" checked={s.verifySsl !== false} onChange={(e) => setS({ ...s, verifySsl: e.target.checked })} /> Verificar certificados SSL (desligar = aceitar qualquer certificado, como o "SSL certificate verification: OFF" do Postman)</label>
      <label className="chk"><input type="checkbox" checked={s.followRedirects !== false} onChange={(e) => setS({ ...s, followRedirects: e.target.checked })} /> Seguir redirects</label>
      <div className="row"><span style={{ width: 240 }}>Timeout padrão (ms)</span><input className="in" type="number" value={s.timeoutMs || 30000} onChange={(e) => setS({ ...s, timeoutMs: Number(e.target.value) })} /></div>
      <div className="row"><span style={{ width: 240 }}>Máximo de redirects</span><input className="in" type="number" value={s.maxRedirects || 10} onChange={(e) => setS({ ...s, maxRedirects: Number(e.target.value) })} /></div>
      <div className="row"><span style={{ width: 240 }}>Versão HTTP</span><select className="in" value={s.httpVersion || 'auto'} onChange={(e) => setS({ ...s, httpVersion: e.target.value })}><option value="auto">Automática</option><option value="http1">HTTP/1.1</option><option value="http2">HTTP/2</option></select></div>
      <label className="chk"><input type="checkbox" checked={!!s.insecureHTTPParser} onChange={(e) => setS({ ...s, insecureHTTPParser: e.target.checked })} /> Aceitar headers HTTP inválidos (parser permissivo)</label>
    </div>}
    {sub === 'certs' && <div className="col">
      <div className="section-title" style={{ marginTop: 0 }}>Autoridades certificadoras (CA)</div>
      <label className="chk"><input type="checkbox" checked={s.useSystemCa !== false} onChange={(e) => setS({ ...s, useSystemCa: e.target.checked })} /> {info && info.platform === 'win32' ? 'Confiar nas CAs do Windows (recomendado na VPN: CAs internas da empresa)' : 'Confiar nas CAs do sistema operacional (recomendado na VPN)'}</label>
      {(s.caCertificates || []).map((c, i) => <div className="row" key={i}><span className="mono grow">{c}</span><button className="btn sm danger" onClick={() => setS({ ...s, caCertificates: s.caCertificates.filter((_, j) => j !== i) })}>Remover</button></div>)}
      <div><button className="btn sm" onClick={async () => { const f = await pick([{ name: 'Certificados', extensions: ['pem', 'crt', 'cer'] }]); if (f) setS({ ...s, caCertificates: [...(s.caCertificates || []), rel(f)] }); }} data-testid="add-ca">＋ Adicionar CA (.pem/.crt)</button></div>
      <div className="section-title">Certificados de cliente (mTLS) por host</div>
      <div className="hint">Valem para HTTP e gRPC. Host no formato <span className="mono">servidor:porta</span> (aceita <span className="mono">*.dominio</span>). Use PEM (cert + chave) ou PFX/P12 com senha (a senha é guardada cifrada, fora do workspace).</div>
      {(s.certificates || []).map((c, i) => {
        const set = (patch) => setS({ ...s, certificates: s.certificates.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return <div className="card col" key={c.id || i} data-testid={`cert-${i}`}>
          <div className="row"><label className="chk"><input type="checkbox" checked={c.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />Ativo</label><span style={{ width: 60 }}>Host</span><input className="in grow mono" value={c.host || ''} placeholder="api.interna:8443" onChange={(e) => set({ host: e.target.value })} data-testid="cert-host" /><button className="btn sm danger" onClick={() => setS({ ...s, certificates: s.certificates.filter((_, j) => j !== i) })}>Remover</button></div>
          <div className="row"><span style={{ width: 90 }}>Formato</span><select className="in" value={c.pfx !== undefined && c.pfx !== null ? 'pfx' : (c.format || (c.cert ? 'pem' : 'pem'))} onChange={(e) => set(e.target.value === 'pfx' ? { format: 'pfx', cert: undefined, key: undefined, pfx: c.pfx || '' } : { format: 'pem', pfx: undefined })} data-testid="cert-format"><option value="pem">PEM (certificado + chave)</option><option value="pfx">PFX / P12 (com senha)</option></select></div>
          {!(c.pfx !== undefined && c.pfx !== null) && <>
            <div className="row"><span style={{ width: 90 }}>Certificado</span><span className="mono grow">{c.cert || '—'}</span><button className="btn sm" onClick={async () => { const f = await pick([{ name: 'Certificado', extensions: ['pem', 'crt', 'cer'] }]); if (f) set({ cert: rel(f) }); }}>Escolher</button></div>
            <div className="row"><span style={{ width: 90 }}>Chave</span><span className="mono grow">{c.key || '—'}</span><button className="btn sm" onClick={async () => { const f = await pick([{ name: 'Chave', extensions: ['key', 'pem'] }]); if (f) set({ key: rel(f) }); }}>Escolher</button></div>
          </>}
          {c.pfx !== undefined && c.pfx !== null && <div className="row"><span style={{ width: 90 }}>PFX/P12</span><span className="mono grow">{c.pfx || '—'}</span><button className="btn sm" onClick={async () => { const f = await pick([{ name: 'PFX', extensions: ['pfx', 'p12'] }]); if (f) set({ pfx: rel(f) }); }}>Escolher</button></div>}
          <div className="row"><span style={{ width: 90 }}>Senha</span><input className="in grow" type="password" placeholder="(deixe vazio para manter a atual)" value={c.passphrase || ''} onChange={(e) => set({ passphrase: e.target.value })} /></div>
        </div>;
      })}
      <div><button className="btn sm" onClick={() => setS({ ...s, certificates: [...(s.certificates || []), { id: Math.random().toString(36).slice(2, 10), host: '' }] })} data-testid="add-cert">＋ Adicionar certificado de cliente</button></div>
      <div className="hint">Caminhos dentro da pasta do workspace ficam relativos (vão junto ao partilhar). Não partilhe chaves privadas se não quiser: deixe-as fora da pasta.</div>
    </div>}
    {sub === 'proxy' && <div className="col" style={{ maxWidth: 640 }}>
      <label className="chk"><input type="radio" checked={(s.proxy || {}).mode === 'system' || !(s.proxy || {}).mode} onChange={() => setS({ ...s, proxy: { ...(s.proxy || {}), mode: 'system' } })} />Proxy do sistema (Windows/PAC, igual ao navegador)</label>
      <label className="chk"><input type="radio" checked={(s.proxy || {}).mode === 'none'} onChange={() => setS({ ...s, proxy: { ...(s.proxy || {}), mode: 'none' } })} />Sem proxy</label>
      <label className="chk"><input type="radio" checked={(s.proxy || {}).mode === 'manual'} onChange={() => setS({ ...s, proxy: { ...(s.proxy || {}), mode: 'manual' } })} />Manual</label>
      {(s.proxy || {}).mode === 'manual' && <div className="card col">
        <div className="row"><span style={{ width: 120 }}>Host</span><input className="in grow" value={s.proxy.host || ''} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, host: e.target.value } })} /><span>Porta</span><input className="in" style={{ width: 90 }} value={s.proxy.port || ''} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, port: e.target.value } })} /></div>
        <div className="row"><span style={{ width: 120 }}>Ignorar para</span><input className="in grow mono" placeholder="localhost, *.interno" value={s.proxy.bypass || ''} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, bypass: e.target.value } })} /></div>
        <div className="row"><span style={{ width: 120 }}>Usuário</span><input className="in grow" value={s.proxy.username || ''} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, username: e.target.value } })} /><span>Senha</span><input className="in" type="password" value={s.proxy.password || ''} onChange={(e) => setS({ ...s, proxy: { ...s.proxy, password: e.target.value } })} /></div>
      </div>}
    </div>}
    {sub === 'grpc' && <div className="col" style={{ maxWidth: 640 }}>
      <div className="hint">Import paths globais para .proto (relativos ao workspace). A pasta protos/ já é incluída.</div>
      <KVTable rows={((s.grpc || {}).importPaths || []).map((p) => ({ key: p, value: '' }))} noToggle keyPh="pasta" valPh="" onChange={(rows) => setS({ ...s, grpc: { ...(s.grpc || {}), importPaths: rows.map((r) => r.key).filter(Boolean) } })} />
    </div>}
    {sub === 'app' && <div className="col" style={{ maxWidth: 640 }}>
      <div className="col" style={{ gap: 6 }}><span>Tema</span>
        <div className="theme-cards" role="radiogroup" aria-label="Tema">{THEMES.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={`theme-card ${theme === t.id ? 'on' : ''}`} onClick={() => setTheme(t.id)} data-testid={`theme-${t.id}`}>
          <span className="sw" style={{ background: t.cores[0], borderColor: t.cores[2] }}><i style={{ background: t.cores[1] }} /><b style={{ background: t.cores[2] }} /></span><b>{t.nome}</b><small>{t.desc}</small></button>)}</div></div>
      <div className="row"><span style={{ width: 200 }}>Resposta</span><select className="in" value={layout} onChange={(e) => { setState({ layout: e.target.value }); call('app:saveSettings', { layout: e.target.value }); }}><option value="vertical">Embaixo da request</option><option value="horizontal">Ao lado da request</option></select></div>
      {info && <div className="card hint">Jaiminho {info.version} · Electron {info.electron} · Node {info.node}<br />Dados locais: <span className="mono">{info.userData}</span><br />Proteção dos segredos: {info.secretsProtection === 'safeStorage' ? 'cofre do sistema (DPAPI no Windows)' : 'arquivo (sistema sem cofre)'}</div>}
    </div>}
  </Modal>;
}

// ---------------- runner ----------------
function RunnerModal({ id, name }) {
  const envs = useStore((s) => s.envs); const active = useStore((s) => s.activeEnvId);
  const [env, setEnv] = useState(active || '');
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [dataFile, setDataFile] = useState(null);
  const [stopOnFailure, setStop] = useState(false);
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const runId = useMemo(() => Math.random().toString(36).slice(2), []);
  useEffect(() => api$.on((e) => { if (e.type === 'runner:event' && e.runId === runId && e.event.type === 'item-done') setRows((r) => [...r, e.event]); }), [runId]);
  const start = async () => { setRows([]); setReport(null); setRunning(true); try { setReport(await call('runner:start', { runId, id, environmentId: env || undefined, iterations: Number(iterations) || 1, dataFile, delayMs: Number(delay) || 0, stopOnFailure })); } catch (e) { toast(e.message, 'err'); } finally { setRunning(false); } };
  return <Modal title={`Runner de coleções — ${name}`} wide testId="modal-runner" footer={<>{report && <button className="btn" onClick={async () => { const f = await api$.dialog.save({ defaultPath: `${name}-junit.xml` }); if (f) await safe(() => call('runner:junit', { report, file: f, name }), `Relatório salvo: ${f}`); }}>Exportar JUnit</button>}<span className="grow" /><button className="btn" onClick={closeModal}>Fechar</button><button className="btn primary" onClick={start} disabled={running} data-testid="runner-start">{running ? 'Rodando…' : '▶ Rodar'}</button></>}>
    <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
      <label className="row">Ambiente <select className="in" value={env} onChange={(e) => setEnv(e.target.value)}><option value="">(nenhum)</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="row">Iterações <input className="in" type="number" min={1} style={{ width: 80 }} value={iterations} onChange={(e) => setIterations(e.target.value)} disabled={!!dataFile} /></label>
      <label className="row">Atraso (ms) <input className="in" type="number" min={0} style={{ width: 90 }} value={delay} onChange={(e) => setDelay(e.target.value)} /></label>
      <button className="btn sm" onClick={async () => { const f = await api$.dialog.openFile({ filters: [{ name: 'Dados', extensions: ['csv', 'json'] }] }); setDataFile(f || null); }}>{dataFile ? `Dados: ${dataFile.split(/[\\/]/).pop()}` : 'Arquivo de dados (CSV/JSON)…'}</button>
      {dataFile && <button className="btn sm ghost" onClick={() => setDataFile(null)}>✕</button>}
      <label className="chk"><input type="checkbox" checked={stopOnFailure} onChange={(e) => setStop(e.target.checked)} />Parar na primeira falha</label>
    </div>
    {report && <div className="card row" style={{ marginTop: 12, gap: 20 }} data-testid="runner-summary"><b>{report.totals.requests} requests</b><span className={report.totals.failed ? 'badge-fail' : 'badge-ok'}>{report.totals.failed} com falha</span><span>{report.totals.tests - report.totals.testsFailed}/{report.totals.tests} testes passaram</span><span className="muted">{report.iterations} iteração(ões)</span></div>}
    <table className="kv" style={{ marginTop: 12 }}><thead><tr><th>#</th><th>Request</th><th>Resultado</th><th>Tempo</th><th>Testes</th></tr></thead><tbody>
      {rows.map((r, i) => <tr key={i}><td style={{ padding: 5 }}>{r.iteration + 1}</td><td style={{ padding: 5 }}>{r.name}</td><td style={{ padding: 5 }} className={r.ok ? 'badge-ok' : 'badge-fail'}>{r.code || r.error || (r.ok ? 'ok' : 'erro')}</td><td style={{ padding: 5 }}>{r.time} ms</td><td style={{ padding: 5 }}>{r.tests.map((t, j) => <div key={j} className={t.passed ? 'badge-ok' : 'badge-fail'} style={{ fontWeight: 400 }}>{t.passed ? '✓' : '✕'} {t.name}{t.error ? ` — ${t.error}` : ''}</div>)}</td></tr>)}
    </tbody></table>
  </Modal>;
}

// ---------------- sincronizar Swagger ----------------
function SyncModal({ id, name }) {
  const [diff, setDiff] = useState(null); const [busy, setBusy] = useState(true);
  useEffect(() => { call('io:syncOpenApi', { id, apply: false }).then(setDiff).catch((e) => { toast(e.message, 'err', 8000); closeModal(); }).finally(() => setBusy(false)); }, [id]);
  const apply = async () => { setBusy(true); const r = await safe(() => call('io:syncOpenApi', { id, apply: true }), 'Coleção atualizada a partir do Swagger'); setBusy(false); if (r) { await refreshTree(); closeModal(); } };
  return <Modal title={`Sincronizar com o Swagger — ${name}`} testId="modal-sync" footer={<><button className="btn" onClick={closeModal}>Cancelar</button><button className="btn primary" onClick={apply} disabled={busy || !diff || (!diff.added.length && !diff.changed.length && !diff.removed.length)}>Aplicar</button></>}>
    {busy && !diff && <div className="empty">Baixando o Swagger e comparando…</div>}
    {diff && <div className="col">
      <div><b>{diff.added.length}</b> novas · <b>{diff.changed.length}</b> alteradas · <b>{diff.removed.length}</b> removidas · {diff.unchanged} iguais</div>
      {diff.added.length > 0 && <div><div className="section-title">Novas (serão criadas)</div>{diff.added.map((a) => <div key={a.key} className="mono badge-ok" style={{ fontWeight: 400 }}>+ {a.key} — {a.name}</div>)}</div>}
      {diff.changed.length > 0 && <div><div className="section-title">Alteradas (contrato atualizado; scripts, auth e valores mantidos)</div>{diff.changed.map((a) => <div key={a.key} className="mono" style={{ color: 'var(--dourado)' }}>~ {a.key} — {a.name}</div>)}</div>}
      {diff.removed.length > 0 && <div><div className="section-title">Removidas do Swagger (vão para a pasta "_removidas no Swagger")</div>{diff.removed.map((a) => <div key={a.key} className="mono badge-fail" style={{ fontWeight: 400 }}>− {a.key} — {a.name}</div>)}</div>}
    </div>}
  </Modal>;
}

// ---------------- cookies ----------------
function CookiesModal() {
  const [list, setList] = useState([]);
  const load = () => call('cookies:list').then(setList);
  useEffect(() => { load(); }, []);
  const domains = [...new Set(list.map((c) => c.domain))];
  return <Modal title="Cookies do workspace" testId="modal-cookies" footer={<><button className="btn danger" onClick={async () => { await call('cookies:clear'); load(); }}>Limpar todos</button><span className="grow" /><button className="btn" onClick={closeModal}>Fechar</button></>}>
    {!list.length && <div className="empty">Nenhum cookie guardado.</div>}
    {domains.map((d) => <div key={d} className="card" style={{ marginBottom: 8 }}><div className="row"><b className="grow">{d}</b><button className="btn sm" onClick={async () => { await call('cookies:clear', { domain: d }); load(); }}>Limpar domínio</button></div>{list.filter((c) => c.domain === d).map((c, i) => <div key={i} className="mono" style={{ fontSize: 12 }}>{c.name}={c.value} <span className="faint">path={c.path}{c.expires && c.expires !== 'Infinity' ? ` expira=${c.expires}` : ''}</span></div>)}</div>)}
  </Modal>;
}

// ---------------- mocks ----------------
function MocksModal() {
  const st = useStore((s) => s.mocks);
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); const r = await safe(() => call(st.running ? 'mocks:stop' : 'mocks:start')); if (r) setState({ mocks: r }); setBusy(false); };
  const example = async () => {
    const dir = await api$.dialog.openDir({ title: 'Pasta para o workspace de exemplo (vazia)' });
    if (!dir) return;
    setBusy(true);
    const sum = await safe(() => call('example:create', { dir }), 'Workspace de exemplo criado');
    setBusy(false);
    if (sum) { await applySummary(sum); setState({ tabs: [], activeTab: null, mocks: await call('mocks:status') }); const envs = await call('env:list'); if (envs[0]) { const { setActiveEnv } = await import('../store'); setActiveEnv(envs[0].id); } closeModal(); }
  };
  const u = st.urls || {};
  return <Modal title="Servidores mock" testId="modal-mocks" footer={<><button className="btn" onClick={example} disabled={busy}>Criar workspace de exemplo…</button><span className="grow" /><button className="btn" onClick={closeModal}>Fechar</button><button className={`btn ${st.running ? 'danger' : 'primary'}`} onClick={toggle} disabled={busy} data-testid="mocks-toggle">{st.running ? 'Parar' : 'Iniciar'}</button></>}>
    <div className="hint">Servidores locais para testar tudo sem depender de ninguém: REST/JSON, XML, SOAP (WSDL), Swagger, HTTPS com CA própria, mTLS e gRPC (reflection, 4 tipos de chamada, TLS e mTLS).</div>
    {st.running ? <table className="kv" style={{ marginTop: 10 }}><tbody>
      {[['REST/JSON, XML, SOAP', u.http], ['Swagger (OpenAPI 3)', `${u.http}/v3/api-docs`], ['Swagger UI', `${u.http}/swagger-ui/index.html`], ['WSDL', `${u.http}/soap/TravellerService?wsdl`], ['HTTPS (CA própria)', u.https], ['HTTPS mTLS', u.mtls], ['gRPC (reflection)', `grpc://${u.grpc}`], ['gRPC TLS', `grpcs://${u.grpcTls}`], ['gRPC mTLS', `grpcs://${u.grpcMtls}`], ['gRPC sem reflection', `grpc://${u.grpcNoReflection}`]].map(([l, v]) => <tr key={l}><td style={{ padding: 5, width: 200 }}>{l}</td><td className="mono" style={{ padding: 5 }}>{v}</td><td><button className="btn sm ghost" onClick={() => { api$.clipboard.write(v); toast('Copiado', 'ok', 1200); }}>Copiar</button></td></tr>)}
      <tr><td style={{ padding: 5 }}>Certificados</td><td className="mono" style={{ padding: 5, wordBreak: 'break-all' }}>{st.certs.dir} (p12: senha "{st.certs.p12Password}")</td><td /></tr>
      <tr><td style={{ padding: 5 }}>Credenciais</td><td className="mono" style={{ padding: 5 }}>token {st.secrets.token} · api key {st.secrets.apiKey} · basic/digest {st.secrets.basic.join('/')}</td><td /></tr>
    </tbody></table> : <div className="empty">Parados.</div>}
  </Modal>;
}

function ShortcutsModal() {
  const list = SHORTCUTS;
  return <Modal title="Atalhos de teclado">{list.map(([k, l]) => <div key={k} className="row" style={{ padding: '4px 0' }}><span className="kbd" style={{ minWidth: 150, textAlign: 'center' }}>{k}</span><span>{l}</span></div>)}</Modal>;
}
function AboutModal() {
  return <Modal title="Sobre o Jaiminho"><div className="row" style={{ gap: 18, alignItems: 'flex-start' }}><img src="./splash.png" alt="" style={{ width: 200, borderRadius: 16 }} /><div className="col"><h2 style={{ margin: 0 }}>Jaiminho</h2><div className="muted">Cliente de API local e offline: HTTP/JSON, XML/SOAP e gRPC.</div><div className="hint">Motor HTTP, variáveis e scripts: bibliotecas open source do Postman (Apache-2.0). gRPC: grpc-js + protobufjs. Nenhum dado sai do seu PC além das requests que você envia.</div><div className="hint">"Entregue em 143 ms" — e sem fadiga.</div></div></div></Modal>;
}

// ---------------- variáveis efetivas (👁) ----------------
const SCOPE_PT = { global: 'global', collection: 'coleção', environment: 'ambiente', 'folder/request': 'pasta/request', data: 'dados', local: 'local' };
export function VarsPanel({ onClose }) {
  const tab = useStore((s) => s.tabs.find((t) => t.key === s.activeTab));
  const env = useStore((s) => s.activeEnvId); const envs = useStore((s) => s.envs);
  const [list, setList] = useState([]);
  const isReq = tab && tab.type === 'request';
  useEffect(() => { call('vars:effective', { itemId: isReq ? (tab.itemId || tab.parentId) : (tab && (tab.type === 'collection' || tab.type === 'folder') ? tab.itemId : undefined), environmentId: env, draft: isReq ? tab.draft : undefined }).then(setList).catch(() => setList([])); }, [tab && tab.itemId, env]);
  useEffect(() => { const f = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onClose]);
  const envName = (envs.find((e) => e.id === env) || {}).name;
  return <div className="vars-panel" data-testid="vars-panel" role="dialog" aria-label="Variáveis efetivas">
    <div className="row"><b className="grow">Variáveis efetivas</b><button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button></div>
    <div className="hint" style={{ margin: '4px 0 8px' }}>Ambiente: <b>{envName || 'nenhum'}</b>{isReq ? ` · request: ${tab.draft.name}` : ''}<br />Precedência: global &lt; coleção &lt; ambiente &lt; pasta/request &lt; dados &lt; local</div>
    <table className="kv"><tbody>{list.map((v) => <tr key={v.key}><td className="mono" style={{ padding: 4 }}>{v.key}</td><td className="mono" style={{ padding: 4, wordBreak: 'break-all' }}>{v.secret ? <span style={{ color: 'var(--dourado)' }}>{v.value ? 'segredo (definido)' : 'segredo (sem valor neste PC)'}</span> : v.value}</td><td style={{ padding: 4 }}><span className="scope-tag">{SCOPE_PT[v.scope] || v.scope}{v.source === 'local' ? ' · valor local' : ''}</span></td></tr>)}</tbody></table>
    {!list.length && <div className="empty">Nenhuma variável.</div>}
  </div>;
}

export default function Modals() {
  const m = useStore((s) => s.modal);
  if (!m) return null;
  const C = { help: HelpModal, prompt: PromptModal, saveAs: SaveAsModal, import: ImportModal, code: CodeModal, settings: SettingsModal, runner: RunnerModal, sync: SyncModal, cookies: CookiesModal, mocks: MocksModal, shortcuts: ShortcutsModal, about: AboutModal }[m.name];
  return C ? <C {...m.props} /> : null;
}
