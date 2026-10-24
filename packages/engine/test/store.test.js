'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpWorkspace } = require('./helpers');
const { Workspace } = require('../src');

test('Workspace em arquivos: estrutura, ordem, renomear, mover, duplicar, apagar para lixeira, reabrir', () => {
  const ws = tmpWorkspace('Meu');
  assert.ok(fs.existsSync(path.join(ws.dir, 'jaiminho.yaml')));
  assert.match(fs.readFileSync(path.join(ws.dir, '.gitignore'), 'utf8'), /\.jaiminho\//);
  const col = ws.createCollection('Orders API');
  const f1 = ws.createFolder(col, 'Viajante');
  const a = ws.createRequest(f1, { name: 'Criar', method: 'POST', url: 'http://x' });
  const b = ws.createRequest(f1, { name: 'Buscar', url: 'http://x' });
  const c = ws.createRequest(col, { name: 'Saúde', url: 'http://x' });
  assert.ok(fs.existsSync(path.join(ws.info(a).file)) && /010-criar\.req\.yaml$/.test(ws.info(a).file));
  assert.ok(/010-viajante$/.test(ws.info(f1).dir));
  assert.deepEqual(ws.children(f1), [a, b]);
  ws.move(b, f1, 0);
  assert.deepEqual(ws.children(f1), [b, a]);
  ws.move(c, f1, 1);
  assert.deepEqual(ws.children(f1), [b, c, a]);
  ws.save(c, { ...ws.get(c), name: 'Saúde do serviço' });
  assert.ok(/saude-do-servico\.req\.yaml$/.test(ws.info(c).file));
  const dup = ws.duplicate(f1);
  assert.equal(ws.get(dup).name, 'Viajante (cópia)'); assert.equal(ws.children(dup).length, 3);
  ws.remove(dup);
  assert.equal(ws.info(dup), undefined);
  assert.ok(fs.readdirSync(path.join(ws.dir, '.jaiminho', 'lixeira')).length === 1);
  assert.throws(() => ws.move(f1, f1));
  const again = Workspace.open(ws.dir);
  assert.deepEqual(again.tree().collections[0].children[0].children.map((x) => x.name), ['Buscar', 'Saúde do serviço', 'Criar']);
});

test('Body grande vai para arquivo irmão; YAML sem caminho absoluto', () => {
  const ws = tmpWorkspace();
  const col = ws.createCollection('C');
  const big = `<x>${'a'.repeat(6000)}</x>`;
  const id = ws.createRequest(col, { kind: 'soap', name: 'Grande', url: 'http://x', body: { mode: 'raw', language: 'xml', raw: big } });
  const y = fs.readFileSync(ws.info(id).file, 'utf8');
  assert.match(y, /bodyFile: 010-grande\.body\.xml/);
  assert.equal(ws.get(id).body.raw, big);
  ws.save(id, { ...ws.get(id), name: 'Grande renomeada' });
  assert.equal(ws.get(id).body.raw, big);
  assert.ok(!y.includes(ws.dir));
});

test('Valores locais sobrepõem os partilhados; não vão para o YAML', () => {
  const ws = tmpWorkspace();
  const env = ws.saveEnvironment({ name: 'DEV', vars: [{ key: 'url', value: 'http://partilhado' }] });
  ws.setLocalValue(`env:${env}`, 'url', 'http://meu-pc');
  assert.equal(ws.effectiveVars(`env:${env}`, ws.getEnvironment(env).vars)[0].value, 'http://meu-pc');
  assert.ok(!fs.readFileSync(ws.info(env).file, 'utf8').includes('meu-pc'));
});

test('Cifra plugável para segredos (o app usa safeStorage)', () => {
  const calls = [];
  const cipher = { encrypt: (s) => { calls.push('e'); return Buffer.from(s).reverse().toString('base64'); }, decrypt: (b) => { calls.push('d'); return Buffer.from(String(b), 'base64').reverse().toString(); } };
  const base = tmpWorkspace();
  const ws = Workspace.open(base.dir, { cipher });
  ws.setSecret('env:x:token', 'abc');
  assert.equal(ws.getSecret('env:x:token'), 'abc');
  assert.ok(!fs.readFileSync(path.join(ws.dir, '.jaiminho', 'secrets.enc'), 'utf8').includes('abc'));
  assert.ok(calls.includes('e') && calls.includes('d'));
});
