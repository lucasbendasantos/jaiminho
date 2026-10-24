import React, { useMemo, useState } from 'react';
import Editor from './Editor';
import { call, toast, api$ } from '../store';
import { EnvelopeMark } from '../icons';
import { prettyBytes, prettyMs, statusClass, tryPrettyJson, langFromContentType, jsonPath } from '../util';

function Tabs({ tabs, active, onChange }) {
  return <div className="subtabs">{tabs.filter(Boolean).map(([k, label, count]) => <button key={k} className={active === k ? 'on' : ''} onClick={() => onChange(k)} data-testid={`resp-tab-${k}`}>{label}{count !== undefined && count !== null && <span className="count">{count}</span>}</button>)}</div>;
}

function Body({ res, lang }) {
  const [mode, setMode] = useState('pretty');
  const [filter, setFilter] = useState('');
  const raw = res.response.bodyEncoding === 'base64' ? `(binário, ${prettyBytes(res.response.size)}, base64)\n${res.response.body}` : res.response.body;
  const [xpathOut, setXpathOut] = useState(null);
  const shown = useMemo(() => {
    if (mode === 'raw') return raw;
    if (lang === 'json') {
      if (filter.trim()) { try { const v = jsonPath(JSON.parse(raw), filter.trim()); return v === undefined ? '// nada encontrado' : JSON.stringify(v, null, 2); } catch (e) { return `// ${e.message}`; } }
      return tryPrettyJson(raw);
    }
    if (lang === 'xml' && xpathOut !== null) return xpathOut;
    return raw;
  }, [mode, raw, lang, filter, xpathOut]);
  const runXpath = async () => { if (!filter.trim()) { setXpathOut(null); return; } try { const r = await call('xml:xpath', { text: raw, expr: filter.trim() }); setXpathOut(Array.isArray(r) ? r.join('\n') || '(nada encontrado)' : String(r)); } catch (e) { setXpathOut(`Erro: ${e.message}`); } };
  const [pretty, setPretty] = useState(null);
  React.useEffect(() => { setPretty(null); if (lang === 'xml' && mode === 'pretty') call('xml:pretty', { text: raw }).then(setPretty).catch(() => {}); }, [raw, lang, mode]);
  const value = lang === 'xml' && mode === 'pretty' && xpathOut === null && pretty ? pretty : shown;
  return (
    <div className="subbody flush">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
        <div className="row" style={{ gap: 2 }}>
          <button className={`btn sm ${mode === 'pretty' ? '' : 'ghost'}`} onClick={() => setMode('pretty')}>Formatado</button>
          <button className={`btn sm ${mode === 'raw' ? '' : 'ghost'}`} onClick={() => setMode('raw')}>Bruto</button>
        </div>
        {(lang === 'json' || lang === 'xml') && <input className="in grow mono" style={{ height: 26 }} placeholder={lang === 'json' ? 'Filtrar JSON: $.campo.lista[0]' : 'XPath: //tns:firstName (Enter)'} value={filter} onChange={(e) => { setFilter(e.target.value); if (lang === 'xml' && !e.target.value) setXpathOut(null); }} onKeyDown={(e) => e.key === 'Enter' && lang === 'xml' && runXpath()} data-testid="resp-filter" />}
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => { api$.clipboard.write(raw); toast('Corpo copiado', 'ok', 1500); }}>Copiar</button>
      </div>
      <Editor value={value} language={mode === 'raw' ? 'text' : lang} readOnly testId="resp-body" />
    </div>
  );
}

function Headers({ list }) {
  return <div className="subbody"><table className="kv"><thead><tr><th>Header</th><th>Valor</th></tr></thead><tbody>{(list || []).map((h, i) => <tr key={i}><td className="mono" style={{ padding: '5px 6px', width: '35%' }}>{h.key}</td><td className="mono" style={{ padding: '5px 6px', wordBreak: 'break-all' }}>{h.value}</td></tr>)}</tbody></table>{!(list || []).length && <div className="empty">Nenhum header</div>}</div>;
}

function Tests({ tests }) {
  if (!tests || !tests.length) return <div className="subbody empty">Nenhum teste. Escreva <span className="mono">pm.test(...)</span> em Scripts.</div>;
  return <div className="subbody">{tests.map((t, i) => <div className="test-row" key={i}><span className={t.passed ? 'badge-ok' : 'badge-fail'}>{t.skipped ? 'PULADO' : t.passed ? 'PASSOU' : 'FALHOU'}</span><div><div>{t.name}</div>{t.error && <div className="hint mono">{t.error}</div>}</div></div>)}</div>;
}

function Console({ logs, errors }) {
  const all = [...(errors || []).map((e) => ({ level: 'error', args: [e] })), ...(logs || [])];
  if (!all.length) return <div className="subbody empty">Sem saída. Use <span className="mono">console.log()</span> nos scripts.</div>;
  return <div className="subbody mono" style={{ fontSize: 12 }}>{all.map((c, i) => <div key={i} style={{ color: c.level === 'error' ? 'var(--erro)' : c.level === 'warn' ? 'var(--dourado)' : undefined, padding: '2px 0' }}>[{c.level}] {c.args.join(' ')}</div>)}</div>;
}

function Timings({ res }) {
  const t = res.response && res.response.timings;
  return (
    <div className="subbody">
      {t ? (() => { const total = t.total || 1; return [['Espera (socket)', t.wait], ['DNS', t.dns], ['Conexão TCP', t.tcp], ['Handshake TLS', t.tls], ['Primeiro byte', t.firstByte], ['Download', t.download]].map(([l, v]) => <div className="timing-bar" key={l}><span className="muted">{l}</span><div><div className="bar" style={{ width: `${Math.max(1, ((v || 0) / total) * 100)}%` }} /></div><span className="mono">{prettyMs(v || 0)}</span></div>); })() : <div className="hint">Sem medições.</div>}
      {res.request && (<>
        <div className="section-title">Request enviada</div>
        <div className="mono" style={{ wordBreak: 'break-all' }}><b>{res.request.method}</b> {res.request.url}</div>
        <table className="kv" style={{ marginTop: 6 }}><tbody>{(res.request.headers || []).map((h, i) => <tr key={i}><td className="mono" style={{ padding: '3px 6px', width: '35%' }}>{h.key}</td><td className="mono" style={{ padding: '3px 6px', wordBreak: 'break-all' }}>{h.value}</td></tr>)}</tbody></table>
        {res.request.body && <pre className="mono card" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{res.request.body}</pre>}
      </>)}
      {res.tls && <><div className="section-title">TLS</div><div className="mono">{res.tls.protocol} · {res.tls.cipher}</div></>}
    </div>
  );
}

function GrpcTimeline({ events, result }) {
  const evs = events && events.length ? events : (result && result.events) || [];
  if (!evs.length) return <div className="subbody empty">A linha do tempo aparece ao invocar.</div>;
  const t0 = evs[0].t;
  const label = { invoke: ['→', 'Chamada'], 'sent-request-header': ['↑', 'Metadata enviada'], 'sent-request-data': ['↑', 'Mensagem enviada'], 'received-response-header': ['↓', 'Headers recebidos'], 'received-response-data': ['↓', 'Mensagem recebida'], 'half-close': ['↑', 'Fim do envio (half-close)'], status: ['■', 'Status'], error: ['!', 'Erro'], test: ['✓', 'Teste'] };
  return (
    <div className="subbody">
      {evs.map((e, i) => {
        const [arrow, l] = label[e.type] || ['·', e.type];
        const body = e.message !== undefined ? JSON.stringify(e.message, null, 2) : e.metadata ? e.metadata.map((m) => `${m.key}: ${m.value}`).join('\n') : e.status ? `${e.status.name} ${e.status.details || ''}` : e.method ? `${e.method} (${e.kind}) → ${e.target}${e.tls ? ' [TLS]' : ''}` : e.name ? `${e.passed ? 'PASSOU' : 'FALHOU'} ${e.name}` : e.message || '';
        const cls = e.type.startsWith('received') ? 'dir-in' : e.type.startsWith('sent') || e.type === 'half-close' ? 'dir-out' : 'dir-st';
        return <div className="timeline-row" key={i}><span className="faint">+{e.t - t0} ms</span><span className={cls}>{arrow}</span><div><div className={cls} style={{ fontWeight: 600 }}>{l}</div>{body && <pre>{body}</pre>}</div></div>;
      })}
    </div>
  );
}

export default function ResponseView({ tab }) {
  const [active, setActive] = useState('body');
  const res = tab.result;
  const isGrpc = tab.draft && tab.draft.kind === 'grpc';
  if (tab.running && !isGrpc) return <Sending startedAt={tab.startedAt} />;
  if (!res && !(isGrpc && tab.running)) return <div className="resp-empty"><div><EnvelopeMark /><div style={{ marginTop: 8 }}>Clique em <b>{isGrpc ? 'Invocar' : 'Enviar'}</b> ou use <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span></div><div className="hint" style={{ marginTop: 6 }}>{isGrpc ? 'Dica: cole um comando grpcurl na barra de endereço para preencher a request.' : 'Dica: cole um cURL na barra de URL para criar a request.'}</div></div></div>;

  if (isGrpc) {
    const msgs = res ? res.messages : (tab.events || []).filter((e) => e.type === 'received-response-data').map((e) => ({ data: e.message }));
    const body = msgs.length === 1 ? JSON.stringify(msgs[0].data, null, 2) : JSON.stringify(msgs.map((m) => m.data), null, 2);
    const st = res && res.status;
    return (
      <div className="box" style={{ height: '100%' }}>
        <div className="status-line" data-testid="resp-status">
          {tab.running ? <span className="pill s3">STREAM ABERTO</span> : st ? <span className={`pill ${st.code === 0 ? 's2' : 'serr'}`}>{st.name} ({st.code})</span> : <span className="pill serr">ERRO</span>}
          {res && <span className="muted">entregue em {prettyMs(res.time)}</span>}
          <span className="muted">{msgs.length} mensage{msgs.length === 1 ? 'm' : 'ns'}</span>
          {res && res.tls && <span className="muted">TLS{res.clientCert ? ` · cert cliente: ${res.clientCert}` : ''}</span>}
        </div>
        {res && !res.ok && res.error && <div className="error-box" data-testid="resp-error">{res.error}{st && st.errorDetails && st.errorDetails.details ? `\n${st.errorDetails.details.map((x) => x['@type'].split('.').pop()).join(', ')} → veja a aba "Detalhes do erro"` : ''}</div>}
        <Tabs active={active} onChange={setActive} tabs={[...(st && st.errorDetails ? [['details', 'Detalhes do erro']] : []), ['body', 'Resposta'], ['timeline', 'Linha do tempo', (tab.events || res?.events || []).length], ['headers', 'Metadata', (res?.headers || []).length], ['trailers', 'Trailers', (res?.trailers || []).length], ['tests', 'Testes', res && res.tests.length ? `${res.tests.filter((t) => t.passed).length}/${res.tests.length}` : null], ['console', 'Console']]} />
        {active === 'details' && st && st.errorDetails && <div className="subbody flush"><Editor value={JSON.stringify(st.errorDetails, null, 2)} language="json" readOnly testId="resp-error-details" /></div>}
        {active === 'body' && <div className="subbody flush"><Editor value={body} language="json" readOnly testId="resp-body" /></div>}
        {active === 'timeline' && <GrpcTimeline events={tab.events} result={res} />}
        {active === 'headers' && <Headers list={res?.headers} />}
        {active === 'trailers' && <Headers list={res?.trailers} />}
        {active === 'tests' && <Tests tests={res?.tests} />}
        {active === 'console' && <Console logs={res?.console} />}
      </div>
    );
  }

  if (!res.response) return <div className="box"><div className="status-line" data-testid="resp-status"><span className="pill serr">NÃO ENTREGUE</span><span className="muted">{prettyMs(res.time)}</span></div><div className="error-box" data-testid="resp-error">{res.error || 'Erro desconhecido'}</div>{res.console && res.console.length > 0 && <Console logs={res.console} errors={res.errors} />}</div>;
  const r = res.response;
  const lang = langFromContentType(r.contentType);
  return (
    <div className="box" style={{ height: '100%' }}>
      <div className="status-line" data-testid="resp-status">
        <span className={`pill ${statusClass(r.code)}`}>{r.code} {r.status}</span>
        <span className="muted" title="Tempo total">entregue em {prettyMs(r.time)}</span>
        <span className="muted">{prettyBytes(r.size)}</span>
        {res.tests.length > 0 && <span className={res.tests.every((t) => t.passed) ? 'badge-ok' : 'badge-fail'}>{res.tests.filter((t) => t.passed).length}/{res.tests.length} testes</span>}
        {res.soapFault && <span className="badge-fail">SOAP Fault: {res.soapFault.message}</span>}
        {res.xsd && res.xsd.request && <span className={res.xsd.request.valid ? 'badge-ok' : 'badge-fail'} title={(res.xsd.request.errors || []).join('\n')}>XSD request {res.xsd.request.valid ? 'ok' : 'inválida'}</span>}
        {res.xsd && res.xsd.response && <span className={res.xsd.response.valid ? 'badge-ok' : 'badge-fail'} title={(res.xsd.response.errors || []).join('\n')}>XSD resposta {res.xsd.response.valid ? 'ok' : 'inválida'}</span>}
      </div>
      {(res.warnings || []).map((w, i) => <div key={i} className="hint" style={{ padding: '6px 12px', color: 'var(--dourado)' }}>⚠ {w}</div>)}
      {res.xsd && ((res.xsd.request && !res.xsd.request.valid) || (res.xsd.response && !res.xsd.response.valid)) && <div className="error-box">{[...(res.xsd.request?.errors || []).map((e) => `Request: ${e}`), ...(res.xsd.response?.errors || []).map((e) => `Resposta: ${e}`)].join('\n')}</div>}
      <Tabs active={active} onChange={setActive} tabs={[['body', 'Corpo'], ['headers', 'Headers', r.headers.length], ['cookies', 'Cookies', (r.cookies || []).length], ['tests', 'Testes', res.tests.length ? `${res.tests.filter((t) => t.passed).length}/${res.tests.length}` : null], ['console', 'Console', res.console.length || null], ['timing', 'Tempos e request']]} />
      {active === 'body' && <Body res={res} lang={lang} />}
      {active === 'headers' && <Headers list={r.headers} />}
      {active === 'cookies' && <div className="subbody">{(r.cookies || []).length ? <table className="kv"><thead><tr><th>Nome</th><th>Valor</th><th>Domínio</th><th>Path</th></tr></thead><tbody>{r.cookies.map((c, i) => <tr key={i}><td className="mono" style={{ padding: 5 }}>{c.name}</td><td className="mono" style={{ padding: 5 }}>{c.value}</td><td>{c.domain}</td><td>{c.path}</td></tr>)}</tbody></table> : <div className="empty">Nenhum cookie nesta resposta</div>}</div>}
      {active === 'tests' && <Tests tests={res.tests} />}
      {active === 'console' && <Console logs={res.console} errors={res.errors} />}
      {active === 'timing' && <Timings res={res} />}
    </div>
  );
}

function Sending({ startedAt }) {
  const [now, setNow] = useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  return <div className="resp-empty"><div className="sending"><span className="env-anim"><EnvelopeMark size={56} /></span><div className="muted" style={{ fontSize: 15 }}>Entregando… {((now - (startedAt || now)) / 1000).toFixed(1)} s</div><div className="hint">Esc ou Cancelar para interromper</div></div></div>;
}
