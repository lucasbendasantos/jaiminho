'use strict';
// (1) codegen de body JSON leva Content-Type? (2) zip slip com "..\\" (separador do Windows) no bundle.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const JSZip = require(require.resolve('jszip', { paths: [path.join(__dirname, '..', 'packages', 'engine')] }));
const { J, check, finish, tmpWs } = require('./lib');
(async () => {
  await check('curl', 'Codegen (Python/Node/cURL) de body JSON inclui Content-Type: application/json', async () => {
    const req = J.model.newRequest({ method: 'POST', url: 'http://h/echo', body: { mode: 'raw', language: 'json', raw: '{"a":1}' } });
    const out = {};
    for (const [l, v] of [['curl', 'cURL'], ['python', 'Requests'], ['nodejs', 'Axios']]) out[l] = /content-type['"]?\s*[:=,]\s*['"]?application\/json/i.test(await J.curl.generate(req, l, v));
    return { pass: Object.values(out).every(Boolean), evidence: JSON.stringify(out) };
  });
  await check('bundle', 'SEGURANÇA (Windows): entrada de zip com "..\\\\..\\\\" passa pelo JSZip e o destino resolvido sai do workspace', async () => {
    const ws = tmpWs(); const rel = '..\\..\\..\\Users\\Public\\pwned.txt'; const content = Buffer.from('x');
    const zip = new JSZip(); zip.file(rel, content);
    zip.file('manifest.json', JSON.stringify({ format: 'jaiminho-bundle', version: 1, contents: [{ path: rel, sha256: crypto.createHash('sha256').update(content).digest('hex'), size: 1 }] }));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const pv = await J.bundle.previewBundle(buf);
    let err; try { await J.bundle.importBundle(ws, buf); } catch (e) { err = e.message; }
    const winWs = 'C:\\Users\\user\\Jaiminho\\meu-ws';
    const winDest = path.win32.resolve(path.win32.join(winWs, rel));
    const written = fs.readdirSync(ws.dir).filter((f) => f.includes('pwned'));
    return { pass: pv.problems.length > 0 || !!err, evidence: `preview.problems=${JSON.stringify(pv.problems)} import erro=${err}; no Linux gravou arquivo literal ${JSON.stringify(written)}; no Windows path.join(ws, entrada) = ${winDest} (fora do workspace ${winWs})` };
  });
  await finish('zz-codegen-zipslip');
})();
