'use strict';
// Gera (uma vez) uma CA de teste, certificado de servidor (localhost/127.0.0.1) e certificado de cliente (mTLS).
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const DEFAULT_DIR = path.join(__dirname, '..', 'certs');
const P12_PASSWORD = 'jaiminho';

function keyPair() { return forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 }); }

function makeCert({ subjectCN, issuer, issuerKey, keys, isCA, serial, altNames, clientAuth }) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  const subject = [{ name: 'commonName', value: subjectCN }, { name: 'organizationName', value: 'Jaiminho Mock' }];
  cert.setSubject(subject);
  cert.setIssuer(issuer || subject);
  const ext = [{ name: 'basicConstraints', cA: !!isCA }];
  if (isCA) ext.push({ name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true });
  else {
    ext.push({ name: 'keyUsage', digitalSignature: true, keyEncipherment: true });
    ext.push({ name: 'extKeyUsage', serverAuth: !clientAuth, clientAuth: !!clientAuth });
  }
  if (altNames) ext.push({ name: 'subjectAltName', altNames });
  ext.push({ name: 'subjectKeyIdentifier' });
  cert.setExtensions(ext);
  cert.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return cert;
}

function ensureCerts(dir = DEFAULT_DIR) {
  const files = {
    ca: path.join(dir, 'ca.crt'), caKey: path.join(dir, 'ca.key'),
    serverCert: path.join(dir, 'server.crt'), serverKey: path.join(dir, 'server.key'),
    clientCert: path.join(dir, 'client.crt'), clientKey: path.join(dir, 'client.key'),
    clientP12: path.join(dir, 'client.p12'), otherCa: path.join(dir, 'other-ca.crt'),
    rogueClientCert: path.join(dir, 'rogue-client.crt'), rogueClientKey: path.join(dir, 'rogue-client.key'),
  };
  if (Object.values(files).every((f) => fs.existsSync(f))) return { ...files, p12Password: P12_PASSWORD, dir };
  fs.mkdirSync(dir, { recursive: true });
  const pem = forge.pki.certificateToPem; const keyPem = forge.pki.privateKeyToPem;

  const caKeys = keyPair();
  const ca = makeCert({ subjectCN: 'Jaiminho Mock CA', keys: caKeys, isCA: true, serial: '01' });
  const srvKeys = keyPair();
  const srv = makeCert({ subjectCN: 'localhost', issuer: ca.subject.attributes, issuerKey: caKeys.privateKey, keys: srvKeys, serial: '02',
    altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] });
  const cliKeys = keyPair();
  const cli = makeCert({ subjectCN: 'jaiminho-client', issuer: ca.subject.attributes, issuerKey: caKeys.privateKey, keys: cliKeys, serial: '03', clientAuth: true });
  // CA "estranha" + cliente assinado por ela (para testar mTLS recusado)
  const otherKeys = keyPair();
  const other = makeCert({ subjectCN: 'Other CA', keys: otherKeys, isCA: true, serial: '11' });
  const rogueKeys = keyPair();
  const rogue = makeCert({ subjectCN: 'rogue-client', issuer: other.subject.attributes, issuerKey: otherKeys.privateKey, keys: rogueKeys, serial: '12', clientAuth: true });

  fs.writeFileSync(files.ca, pem(ca)); fs.writeFileSync(files.caKey, keyPem(caKeys.privateKey));
  fs.writeFileSync(files.serverCert, pem(srv)); fs.writeFileSync(files.serverKey, keyPem(srvKeys.privateKey));
  fs.writeFileSync(files.clientCert, pem(cli)); fs.writeFileSync(files.clientKey, keyPem(cliKeys.privateKey));
  fs.writeFileSync(files.otherCa, pem(other));
  fs.writeFileSync(files.rogueClientCert, pem(rogue)); fs.writeFileSync(files.rogueClientKey, keyPem(rogueKeys.privateKey));
  const p12 = forge.pkcs12.toPkcs12Asn1(cliKeys.privateKey, [cli, ca], P12_PASSWORD, { algorithm: '3des' });
  fs.writeFileSync(files.clientP12, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
  return { ...files, p12Password: P12_PASSWORD, dir };
}

module.exports = { ensureCerts, P12_PASSWORD };
