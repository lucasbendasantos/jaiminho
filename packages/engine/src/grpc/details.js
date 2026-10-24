'use strict';
// Decodifica grpc-status-details-bin (google.rpc.Status) com os tipos padrão de erro do Google.
const protobuf = require('protobufjs');
const { messageToJson, lookupType } = require('./json');

const root = protobuf.Root.fromJSON({
  nested: { google: { nested: {
    protobuf: { nested: { Any: { fields: { type_url: { type: 'string', id: 1 }, value: { type: 'bytes', id: 2 } } }, Duration: { fields: { seconds: { type: 'int64', id: 1 }, nanos: { type: 'int32', id: 2 } } } } },
    rpc: { nested: {
      Status: { fields: { code: { type: 'int32', id: 1 }, message: { type: 'string', id: 2 }, details: { rule: 'repeated', type: 'google.protobuf.Any', id: 3 } } },
      ErrorInfo: { fields: { reason: { type: 'string', id: 1 }, domain: { type: 'string', id: 2 }, metadata: { keyType: 'string', type: 'string', id: 3 } } },
      RetryInfo: { fields: { retry_delay: { type: 'google.protobuf.Duration', id: 1 } } },
      DebugInfo: { fields: { stack_entries: { rule: 'repeated', type: 'string', id: 1 }, detail: { type: 'string', id: 2 } } },
      QuotaFailure: { fields: { violations: { rule: 'repeated', type: 'Violation', id: 1 } }, nested: { Violation: { fields: { subject: { type: 'string', id: 1 }, description: { type: 'string', id: 2 } } } } },
      PreconditionFailure: { fields: { violations: { rule: 'repeated', type: 'Violation', id: 1 } }, nested: { Violation: { fields: { type: { type: 'string', id: 1 }, subject: { type: 'string', id: 2 }, description: { type: 'string', id: 3 } } } } },
      BadRequest: { fields: { field_violations: { rule: 'repeated', type: 'FieldViolation', id: 1 } }, nested: { FieldViolation: { fields: { field: { type: 'string', id: 1 }, description: { type: 'string', id: 2 } } } } },
      RequestInfo: { fields: { request_id: { type: 'string', id: 1 }, serving_data: { type: 'string', id: 2 } } },
      ResourceInfo: { fields: { resource_type: { type: 'string', id: 1 }, resource_name: { type: 'string', id: 2 }, owner: { type: 'string', id: 3 }, description: { type: 'string', id: 4 } } },
      Help: { fields: { links: { rule: 'repeated', type: 'Link', id: 1 } }, nested: { Link: { fields: { description: { type: 'string', id: 1 }, url: { type: 'string', id: 2 } } } } },
      LocalizedMessage: { fields: { locale: { type: 'string', id: 1 }, message: { type: 'string', id: 2 } } },
    } },
  } } },
});

function decodeStatusDetails(buf, extraRoot) {
  try {
    const Status = root.lookupType('google.rpc.Status');
    const st = Status.decode(buf);
    return {
      code: st.code, message: st.message,
      details: (st.details || []).map((d) => {
        const typeName = String(d.type_url).split('/').pop();
        const t = lookupType(root, '.' + typeName) || lookupType(extraRoot, '.' + typeName);
        if (!t) return { '@type': d.type_url, value: Buffer.from(d.value).toString('base64') };
        return { '@type': d.type_url, ...messageToJson(t, t.decode(d.value), root) };
      }),
    };
  } catch (e) { return { error: `não foi possível decodificar: ${e.message}` }; }
}

module.exports = { decodeStatusDetails };
