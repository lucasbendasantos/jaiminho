'use strict';
// Pool de contextos do postman-sandbox. Criar um contexto custa ~250 ms (compila o bootcode e sobe a VM);
// o runtime faz isso a cada envio. Aqui:
//  - sem nenhum script na cadeia (coleção/pasta/request): usa um "host" vazio (custo zero);
//  - com scripts: pega um contexto do pool (cria se não houver), liga os eventos desta execução, e devolve ao pool
//    no fim (como o Postman faz dentro de um run: o contexto é partilhado entre requests, cada script roda numa
//    execução isolada). Contextos que estouraram o tempo, foram cancelados ou já rodaram muito são descartados.
const sandbox = require('postman-sandbox');

const MAX_IDLE = 3;
const MAX_USES = 200;
let IDLE_MS = 8000; // contexto parado há mais que isso é descartado (a thread da VM também segura o processo vivo)
const idle = [];

function park(ctx) {
  idle.push(ctx);
  ctx.__t = setTimeout(() => { const i = idle.indexOf(ctx); if (i >= 0) idle.splice(i, 1); try { ctx.dispose(); } catch { /* ignore */ } }, IDLE_MS);
  ctx.__t.unref();
}
function unpark() { const ctx = idle.pop(); if (ctx) clearTimeout(ctx.__t); return ctx; }

const NOOP_HOST = {
  external: true,
  instance: {
    on() { return this; }, once() { return this; }, off() { return this; }, removeListener() { return this; }, removeAllListeners() { return this; },
    emit() { return false; }, dispatch() {}, dispose(cb) { if (typeof cb === 'function') cb(); },
    execute(target, options, cb) { (typeof options === 'function' ? options : cb)(new Error('scripts desativados')); },
  },
};

function hasEvents(group) {
  if (group.events && group.events.count && group.events.count() > 0) return true;
  let found = false;
  if (group.items && group.items.each) group.items.each((it) => { if (!found && hasEvents(it)) found = true; });
  return found;
}

// Sonda: lista os nomes do escopo global REAL do sandbox (uma função solta em modo sloppy enxerga o global).
// Se um script criou variável global sem declarar (`x = 1`), o nome novo aparece e o contexto é descartado,
// para uma request nunca enxergar o lixo de outra (cada envio continua isolado, como antes do pool).
const PROBE = 'console.log(JSON.stringify(Object.getOwnPropertyNames((function(){return this})())))';
function globals(ctx) {
  return new Promise((resolve) => {
    let out = null;
    const h = (cursor, level, ...args) => { try { out = JSON.parse(args.join(' ')); } catch { /* ignore */ } };
    ctx.on('console', h);
    const done = (ok) => { try { ctx.removeListener('console', h); } catch { /* ignore */ } resolve(ok ? out : null); };
    try { ctx.execute({ listen: 'execution.**', script: { exec: PROBE } }, { timeout: 3000, cursor: {} }, (err) => done(!err)); } catch { done(false); }
  });
}

function create() {
  return new Promise((resolve, reject) => {
    sandbox.createContext({ timeout: 10000 }, (err, ctx) => {
      if (err) return reject(err);
      ctx.__uses = 0;
      globals(ctx).then((base) => { ctx.__base = new Set(base || []); resolve(ctx); });
    });
  });
}

/** O contexto continua limpo? (nenhum global novo desde que foi criado) */
async function clean(ctx) { const now = await globals(ctx); return !!now && ctx.__base.size > 0 && now.every((n) => ctx.__base.has(n)); }

/** Devolve { option, attach(run), release(discard) } para passar em `host` do runner.run. */
async function acquire(collection) {
  if (!hasEvents(collection)) return { option: NOOP_HOST, attach() {}, release() {} };
  let ctx = unpark();
  if (!ctx) ctx = await create();
  ctx.__uses = (ctx.__uses || 0) + 1;
  const wired = [];
  let released = false;
  const instance = new Proxy(ctx, {
    get(t, k) {
      if (k === 'dispose') return (cb) => { if (typeof cb === 'function') cb(); }; // o runtime chama no fim do run; quem decide somos nós
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return {
    option: { external: true, instance },
    attach(run) {
      const hook = (name) => (...args) => { try { run.triggers[name](...args); } catch { /* run já terminou */ } };
      for (const [ev, trig] of [['console', 'console'], ['error', 'error'], ['execution.error', 'exception'], ['execution.assertion', 'assertion']]) {
        const h = hook(trig); ctx.on(ev, h); wired.push([ev, h]);
      }
    },
    release(discard) {
      if (released) return; released = true;
      for (const [ev, h] of wired) { try { ctx.removeListener(ev, h); } catch { /* ignore */ } }
      const kill = () => { try { ctx.dispose(); } catch { /* ignore */ } };
      if (discard || ctx.hasTimedOut || !ctx.isReady || ctx.__uses >= MAX_USES || idle.length >= MAX_IDLE) return kill();
      clean(ctx).then((ok) => { if (ok && idle.length < MAX_IDLE) park(ctx); else kill(); }, kill);
    },
  };
}

/** Aquece um contexto em segundo plano (chamado ao abrir o workspace) para a 1ª request com script não esperar. */
function warmUp() { if (idle.length) return Promise.resolve(); return create().then((c) => { park(c); }).catch(() => {}); }

function disposeAll() { let c; while ((c = unpark())) { try { c.dispose(); } catch { /* ignore */ } } }

/** O app (processo longo) mantém contextos por mais tempo; testes/CLI usam o padrão curto para o processo poder sair. */
function configure({ idleMs } = {}) { if (idleMs) IDLE_MS = idleMs; }

module.exports = { acquire, warmUp, disposeAll, configure };
