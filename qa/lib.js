'use strict';
// Harness mínimo de QA: cada caso devolve { pass, evidence }. Imprime PASS/FAIL e grava JSON em qa/results/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ENGINE = path.join(__dirname, '..', 'packages', 'engine', 'src');
const MOCKS = path.join(__dirname, '..', 'packages', 'mocks', 'src');
const J = require(ENGINE);

const results = [];
const uncaught = [];
process.on('uncaughtException', (e) => { uncaught.push(String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); console.log('UNCAUGHT', String(e && e.stack || e).split('\n').slice(0, 6).join(' | ')); });
let mocks;
async function getMocks() { if (!mocks) mocks = await require(MOCKS).startAll(); return mocks; }
function tmpWs(name = 'QA') { return J.Workspace.create(fs.mkdtempSync(path.join(os.tmpdir(), 'jaiminho-qa-')), name); }
const short = (v, n = 400) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

async function check(area, desc, fn, { timeoutMs = 20000 } = {}) {
  let r;
  try {
    r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT do caso (${timeoutMs}ms)`)), timeoutMs))]);
  } catch (e) { r = { pass: false, evidence: `exceção: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}` }; }
  if (typeof r === 'boolean') r = { pass: r };
  results.push({ area, desc, ...r });
  console.log(`${r.pass ? 'PASS' : 'FAIL'} [${area}] ${desc}${r.evidence ? ' :: ' + short(r.evidence, 600) : ''}`);
  return r;
}

async function finish(name) {
  fs.writeFileSync(path.join(__dirname, 'results', `${name}.json`), JSON.stringify(results, null, 2));
  if (uncaught.length) results.push({ area: 'processo', desc: 'Exceções não tratadas durante a execução', pass: false, evidence: uncaught.join(' || ') });
  const f = results.filter((r) => !r.pass).length;
  console.log(`\n== ${name}: ${results.length - f} passaram, ${f} falharam`);
  if (mocks) await mocks.close();
  setTimeout(() => process.exit(0), 200);
}

const bodyJson = (r) => { try { return JSON.parse(r.response.body); } catch { return undefined; } };
module.exports = { J, check, finish, getMocks, tmpWs, short, bodyJson, ENGINE, MOCKS };
