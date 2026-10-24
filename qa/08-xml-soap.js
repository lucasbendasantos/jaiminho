'use strict';
// QA: XML/SOAP (pretty, XPath, SOAP 1.2, validação XSD, Fault).
const { J, check, finish, getMocks, tmpWs } = require('./lib');

(async () => {
  const m = await getMocks();
  const H = m.urls.http;
  const ws = tmpWs();
  const res = await J.importAuto(ws, { url: `${H}/soap/TravellerService?wsdl` });
  const reqs = [...ws.index].filter(([, n]) => n.type === 'request').map(([id]) => ({ id, r: ws.get(id) }));

  await check('xml', 'pretty() indenta XML e mantém texto; XML inválido volta igual', async () => {
    const p = J.xml.pretty('<a><b>1</b><c x="1"/></a>');
    return { pass: p.includes('\n  <b>1</b>') && J.xml.pretty('<a><b>') === '<a><b>', evidence: JSON.stringify(p) };
  });
  await check('xml', 'pretty() preserva CDATA e comentários', async () => {
    const src = '<a><![CDATA[<x> & y]]><!-- nota --><b>t</b></a>';
    const p = J.xml.pretty(src);
    return { pass: p.includes('<![CDATA[<x> & y]]>') && p.includes('<!-- nota -->'), evidence: JSON.stringify(p) };
  });
  await check('xml', 'pretty() preserva texto misto e espaços significativos', async () => {
    const p = J.xml.pretty('<p>Olá <b>mundo</b> !</p>');
    return { pass: /Olá/.test(p) && /mundo/.test(p) && /!/.test(p), evidence: JSON.stringify(p) };
  });
  await check('xml', 'XPath com prefixo do documento e local-name()', async () => {
    const x = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><t:r xmlns:t="urn:t"><t:n>Ana</t:n></t:r></s:Body></s:Envelope>';
    const a = J.xml.evaluate(x, '//t:n'); const b = J.xml.evaluate(x, "//*[local-name()='n']/text()"); const c = J.xml.evaluate(x, 'count(//t:n)');
    return { pass: a[0] === 'Ana' && b[0] === 'Ana' && c === 1, evidence: JSON.stringify([a, b, c]) };
  });
  await check('xml', 'XPath com namespace PADRÃO (sem prefixo) — informativo', async () => {
    const x = '<r xmlns="urn:d"><n>1</n></r>';
    let a; try { a = J.xml.evaluate(x, '//n'); } catch (e) { a = e.message; }
    const b = J.xml.evaluate(x, "//*[local-name()='n']");
    return { pass: b[0] === '1', evidence: `//n → ${JSON.stringify(a)} ; local-name → ${JSON.stringify(b)}` };
  });
  await check('soap', 'Todas as operações do WSDL respondem 200 e validam no XSD (1.1 e 1.2)', async () => {
    const out = [];
    for (const { id, r } of reqs) { const x = await J.send(ws, { requestId: id }); out.push({ n: `${r.name}@${r.soap.version}`, c: x.response && x.response.code, ct: x.request && (x.request.headers.find((h) => /content-type/i.test(h.key)) || {}).value, v: x.xsd && x.xsd.request && x.xsd.request.valid, f: !!x.soapFault }); }
    return { pass: out.every((o) => o.c === 200 && o.v && !o.f), evidence: JSON.stringify(out) };
  });
  await check('soap', 'Envelope inválido no XSD é apontado (request.valid=false com erro legível)', async () => {
    const { id, r } = reqs.find((x) => x.r.name === 'GetTraveller');
    const bad = r.body.raw.replace(/<tns:id>[^<]*<\/tns:id>/, '<tns:idErrado>1</tns:idErrado>');
    const x = await J.send(ws, { requestId: id, request: { ...r, body: { ...r.body, raw: bad } } });
    return { pass: x.xsd && x.xsd.request && x.xsd.request.valid === false && x.xsd.request.errors.length > 0, evidence: JSON.stringify(x.xsd) };
  });
  await check('soap', 'SOAP Fault detectado (código e mensagem)', async () => {
    const { id, r } = reqs.find((x) => x.r.name === 'GetTraveller');
    const x = await J.send(ws, { requestId: id, request: { ...r, body: { ...r.body, raw: r.body.raw.replace(/<tns:id>[^<]*<\/tns:id>/, '<tns:id>999999</tns:id>') } } });
    return { pass: !!x.soapFault && !!x.soapFault.message, evidence: JSON.stringify({ code: x.response && x.response.code, fault: x.soapFault }) };
  });
  await check('soap', 'SOAP 1.2: Content-Type application/soap+xml com action', async () => {
    const it = reqs.find((x) => x.r.soap.version === '1.2' && x.r.soap.action);
    if (!it) return { pass: false, evidence: 'sem operação 1.2 com action' };
    const x = await J.send(ws, { requestId: it.id });
    const ct = (x.request.headers.find((h) => /content-type/i.test(h.key)) || {}).value;
    return { pass: /application\/soap\+xml/.test(ct) && /action=/.test(ct), evidence: ct };
  });
  await check('soap', 'Request SOAP com {{variável}} no envelope', async () => {
    const env = ws.saveEnvironment({ name: 'S', vars: [{ key: 'tid', value: '2' }] });
    const { id, r } = reqs.find((x) => x.r.name === 'GetTraveller');
    const x = await J.send(ws, { requestId: id, environmentId: env, request: { ...r, body: { ...r.body, raw: r.body.raw.replace(/<tns:id>[^<]*<\/tns:id>/, '<tns:id>{{tid}}</tns:id>') } } });
    return { pass: x.response.code === 200 && /Ana/.test(x.response.body), evidence: x.response.body.slice(0, 200) };
  });
  await finish('08-xml-soap');
})();
