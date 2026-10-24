'use strict';
// Cliente de server reflection (v1 com fallback para v1alpha). Devolve os FileDescriptorProto crus,
// para montar o schema e para "congelar" num protoset.
const grpc = require('@grpc/grpc-js');
const protobuf = require('protobufjs');
const descriptor = require('protobufjs/ext/descriptor');

const reflRoot = protobuf.Root.fromJSON({
  nested: { grpc: { nested: { reflection: { nested: {
    v: { nested: {
      ServerReflectionRequest: { oneofs: { message_request: { oneof: ['file_by_filename', 'file_containing_symbol', 'file_containing_extension', 'all_extension_numbers_of_type', 'list_services'] } },
        fields: { host: { type: 'string', id: 1 }, file_by_filename: { type: 'string', id: 3 }, file_containing_symbol: { type: 'string', id: 4 }, file_containing_extension: { type: 'bytes', id: 5 }, all_extension_numbers_of_type: { type: 'string', id: 6 }, list_services: { type: 'string', id: 7 } } },
      ServerReflectionResponse: { oneofs: { message_response: { oneof: ['file_descriptor_response', 'all_extension_numbers_response', 'list_services_response', 'error_response'] } },
        fields: { valid_host: { type: 'string', id: 1 }, original_request: { type: 'ServerReflectionRequest', id: 2 }, file_descriptor_response: { type: 'FileDescriptorResponse', id: 4 }, all_extension_numbers_response: { type: 'bytes', id: 5 }, list_services_response: { type: 'ListServiceResponse', id: 6 }, error_response: { type: 'ErrorResponse', id: 7 } } },
      FileDescriptorResponse: { fields: { file_descriptor_proto: { rule: 'repeated', type: 'bytes', id: 1 } } },
      ListServiceResponse: { fields: { service: { rule: 'repeated', type: 'ServiceResponse', id: 1 } } },
      ServiceResponse: { fields: { name: { type: 'string', id: 1 } } },
      ErrorResponse: { fields: { error_code: { type: 'int32', id: 1 }, error_message: { type: 'string', id: 2 } } },
    } },
  } } } } },
});
const ReqT = reflRoot.lookupType('grpc.reflection.v.ServerReflectionRequest');
const ResT = reflRoot.lookupType('grpc.reflection.v.ServerReflectionResponse');
const FileDescriptorProto = descriptor.FileDescriptorProto;

function makeClient(version, target, credentials, channelOptions) {
  const service = `grpc.reflection.${version}.ServerReflection`;
  const Ctor = grpc.makeGenericClientConstructor({
    ServerReflectionInfo: {
      path: `/${service}/ServerReflectionInfo`, requestStream: true, responseStream: true,
      requestSerialize: (o) => Buffer.from(ReqT.encode(ReqT.fromObject(o)).finish()),
      responseDeserialize: (b) => ResT.toObject(ResT.decode(b), { defaults: false, arrays: true }),
      requestDeserialize: (b) => ReqT.decode(b), responseSerialize: (o) => Buffer.from(ResT.encode(o).finish()),
    },
  }, service);
  return new Ctor(target, credentials, channelOptions);
}

/** Uma sessão de reflection: várias perguntas no mesmo stream. */
function session(client, metadata, deadlineMs) {
  const call = client.ServerReflectionInfo(metadata || new grpc.Metadata(), { deadline: Date.now() + (deadlineMs || 15000) });
  const pending = [];
  let failed = null;
  call.on('data', (res) => { const p = pending.shift(); if (p) p.resolve(res); });
  call.on('error', (e) => { failed = e; while (pending.length) pending.shift().reject(e); });
  call.on('end', () => { while (pending.length) pending.shift().reject(new Error('Reflection encerrada pelo servidor')); });
  return {
    ask(req) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => { pending.push({ resolve, reject }); call.write(req); });
    },
    end() { try { call.end(); } catch { /* ignore */ } },
  };
}

async function fetchAll(version, target, credentials, metadata, channelOptions) {
  const client = makeClient(version, target, credentials, channelOptions);
  const s = session(client, metadata);
  try {
    const ls = await s.ask({ list_services: '' });
    if (ls.error_response) throw new Error(ls.error_response.error_message);
    const services = (ls.list_services_response?.service || []).map((x) => x.name).filter((n) => !/^grpc\.reflection\./.test(n));
    const files = new Map(); // nome → bytes
    const queue = [];
    const addFiles = (resp) => {
      if (resp.error_response) throw new Error(resp.error_response.error_message);
      for (const b of resp.file_descriptor_response?.file_descriptor_proto || []) {
        const buf = Buffer.from(b);
        const fd = FileDescriptorProto.decode(buf);
        if (!files.has(fd.name)) { files.set(fd.name, buf); for (const dep of fd.dependency || []) if (!files.has(dep)) queue.push(dep); }
      }
    };
    for (const svc of services) addFiles(await s.ask({ file_containing_symbol: svc }));
    while (queue.length) {
      const dep = queue.shift(); if (files.has(dep)) continue;
      try { addFiles(await s.ask({ file_by_filename: dep })); } catch (e) {
        if (!/^google\/protobuf\//.test(dep)) throw e; // WKT o protobufjs já conhece
      }
    }
    return { services, files: [...files.entries()].map(([name, bytes]) => ({ name, bytes })), version };
  } finally { s.end(); client.close(); }
}

/** Tenta v1 e cai para v1alpha (igual Postman/Bruno). */
async function reflect(target, credentials, metadata, channelOptions) {
  try { return await fetchAll('v1', target, credentials, metadata, channelOptions); } catch (e) {
    if (e && e.code === grpc.status.UNIMPLEMENTED) return fetchAll('v1alpha', target, credentials, metadata, channelOptions);
    try { return await fetchAll('v1alpha', target, credentials, metadata, channelOptions); } catch (e2) { throw (e.code === grpc.status.UNAVAILABLE ? e : e2); }
  }
}

module.exports = { reflect, FileDescriptorProto };
