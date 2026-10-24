import React from 'react';

const TYPES = [
  ['inherit', 'Herdar do pai'], ['none', 'Sem auth'], ['basic', 'Basic Auth'], ['bearer', 'Bearer Token'], ['apikey', 'API Key'],
  ['digest', 'Digest Auth'], ['oauth2', 'OAuth 2.0 (token pronto)'], ['oauth1', 'OAuth 1.0'], ['ntlm', 'NTLM'], ['awsv4', 'AWS Signature'], ['hawk', 'Hawk'], ['jwt', 'JWT Bearer'],
];
const FIELDS = {
  basic: [['username', 'Usuário'], ['password', 'Senha', 'password']],
  bearer: [['token', 'Token']],
  apikey: [['key', 'Nome (header/param)'], ['value', 'Valor'], ['in', 'Onde', 'select', [['header', 'Header'], ['query', 'Query param']]]],
  digest: [['username', 'Usuário'], ['password', 'Senha', 'password'], ['realm', 'Realm (opcional)'], ['algorithm', 'Algoritmo', 'select', [['MD5', 'MD5'], ['MD5-sess', 'MD5-sess'], ['SHA-256', 'SHA-256']]]],
  oauth2: [['accessToken', 'Access token'], ['headerPrefix', 'Prefixo do header (Bearer)'], ['addTokenTo', 'Enviar em', 'select', [['header', 'Header'], ['queryParams', 'Query']]]],
  oauth1: [['consumerKey', 'Consumer key'], ['consumerSecret', 'Consumer secret', 'password'], ['token', 'Token'], ['tokenSecret', 'Token secret', 'password'], ['signatureMethod', 'Método', 'select', [['HMAC-SHA1', 'HMAC-SHA1'], ['HMAC-SHA256', 'HMAC-SHA256'], ['PLAINTEXT', 'PLAINTEXT']]]],
  ntlm: [['username', 'Usuário'], ['password', 'Senha', 'password'], ['domain', 'Domínio'], ['workstation', 'Estação']],
  awsv4: [['accessKey', 'Access key'], ['secretKey', 'Secret key', 'password'], ['region', 'Região'], ['service', 'Serviço'], ['sessionToken', 'Session token']],
  hawk: [['authId', 'Hawk Auth ID'], ['authKey', 'Hawk Auth Key', 'password'], ['algorithm', 'Algoritmo', 'select', [['sha256', 'sha256'], ['sha1', 'sha1']]]],
  jwt: [['algorithm', 'Algoritmo', 'select', [['HS256', 'HS256'], ['HS384', 'HS384'], ['HS512', 'HS512']]], ['secret', 'Segredo', 'password'], ['payload', 'Payload (JSON)'], ['addTokenTo', 'Enviar em', 'select', [['header', 'Header'], ['query', 'Query']]], ['headerPrefix', 'Prefixo']],
};

export default function AuthEditor({ auth = { type: 'inherit' }, onChange, inheritedFrom, onOpenInherited, allowInherit = true }) {
  const type = auth.type || 'inherit';
  const params = auth[type] || {};
  const setParam = (k, v) => onChange({ ...auth, [type]: { ...params, [k]: v } });
  return (
    <div className="col" style={{ maxWidth: 620 }}>
      <div className="row">
        <span className="muted" style={{ width: 120 }}>Tipo</span>
        <select className="in grow" value={type} data-testid="auth-type" onChange={(e) => onChange({ type: e.target.value, [e.target.value]: auth[e.target.value] || (e.target.value === 'apikey' ? { in: 'header' } : e.target.value === 'oauth2' ? { headerPrefix: 'Bearer', addTokenTo: 'header' } : {}) })}>
          {TYPES.filter(([k]) => allowInherit || k !== 'inherit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {type === 'inherit' && <div className="hint" data-testid="auth-inherited">{inheritedFrom ? <>Esta request usa <b>{inheritedFrom}</b>. {onOpenInherited && <button className="btn sm ghost" onClick={onOpenInherited}>Editar lá</button>}</> : 'Nenhuma pasta ou coleção acima define autenticação: a request vai sem auth.'}</div>}
      {type === 'none' && <div className="hint">Esta request não envia autenticação.</div>}
      {(FIELDS[type] || []).map(([k, label, kind, opts]) => (
        <div className="row" key={k}>
          <span className="muted" style={{ width: 120 }}>{label}</span>
          {kind === 'select'
            ? <select className="in grow" value={params[k] ?? opts[0][0]} onChange={(e) => setParam(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : <input className="in grow mono" type={kind === 'password' ? 'password' : 'text'} value={params[k] ?? ''} onChange={(e) => setParam(k, e.target.value)} placeholder={kind === 'password' ? 'aceita {{variável}}' : ''} data-testid={`auth-${k}`} />}
        </div>
      ))}
      {['basic', 'bearer', 'apikey', 'digest', 'oauth2'].includes(type) && <div className="hint">Dica: use <span className="mono">{'{{variável}}'}</span> marcada como segredo no ambiente para não gravar senha/token no arquivo partilhado.</div>}
    </div>
  );
}
