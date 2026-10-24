import { useEffect, useState } from 'react';
import { call, useStore } from './store';

/** Variáveis efetivas para a aba (para destacar {{var}} e mostrar valores). */
export function useEffectiveVars(tab) {
  const env = useStore((s) => s.activeEnvId);
  const treeVersion = useStore((s) => s.tree);
  const [vars, setVars] = useState([]);
  const varsKey = JSON.stringify(tab && tab.draft && tab.draft.vars);
  useEffect(() => {
    if (!tab) return;
    call('vars:effective', { itemId: tab.itemId || tab.parentId, environmentId: env, draft: tab.type === 'request' ? tab.draft : undefined }).then(setVars).catch(() => setVars([]));
  }, [tab && tab.itemId, tab && tab.parentId, env, treeVersion, varsKey]);
  return vars;
}

/** Cadeia coleção → pastas → item (para auth herdada e breadcrumbs). */
export function useChain(itemId, parentId) {
  const [chain, setChain] = useState([]);
  const tree = useStore((s) => s.tree);
  useEffect(() => {
    const id = itemId || parentId;
    if (!id) { setChain([]); return; }
    call('item:chain', { id }).then((c) => setChain(itemId ? c : [...c, { id: null, type: 'request' }])).catch(() => setChain([]));
  }, [itemId, parentId, tree]);
  return chain;
}

const AUTH_LABEL = { basic: 'Basic Auth', bearer: 'Bearer Token', apikey: 'API Key', digest: 'Digest', oauth2: 'OAuth 2.0', oauth1: 'OAuth 1.0', ntlm: 'NTLM', awsv4: 'AWS Signature', hawk: 'Hawk', jwt: 'JWT', none: 'sem auth' };
export function inheritedAuth(chain) {
  const ancestors = chain.slice(0, -1).reverse();
  const a = ancestors.find((n) => n.auth && n.auth.type && n.auth.type !== 'inherit');
  if (!a) return null;
  return { id: a.id, type: a.type, auth: a.auth, label: `${AUTH_LABEL[a.auth.type] || a.auth.type} · ${a.type === 'collection' ? 'coleção' : 'pasta'} "${a.name}"` };
}
