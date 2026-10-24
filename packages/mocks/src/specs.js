'use strict';
// Contratos OpenAPI 3.0 e Swagger 2.0 do mock REST.

const travellerSchema = {
  type: 'object',
  required: ['firstName', 'lastName'],
  properties: {
    id: { type: 'string', readOnly: true, example: '1' },
    firstName: { type: 'string', example: 'Jaime' },
    lastName: { type: 'string', example: 'Palillo' },
    nationality: { type: 'string', enum: ['MX', 'PT', 'BR'], example: 'MX' },
    email: { type: 'string', format: 'email' },
    birthDate: { type: 'string', format: 'date' },
    documents: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
  },
};

function openapi3(base) {
  return {
    openapi: '3.0.3',
    info: { title: 'Jaiminho Mock - Travellers API', version: '1.0.0', description: 'API de viajantes do mock do Jaiminho' },
    servers: [{ url: base, description: 'mock local' }, { url: '{scheme}://{host}:{port}', variables: { scheme: { default: 'http', enum: ['http', 'https'] }, host: { default: 'localhost' }, port: { default: '4010' } } }],
    tags: [{ name: 'travellers', description: 'Viajantes' }, { name: 'auth', description: 'Autenticação' }, { name: 'util', description: 'Utilidades' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/travellers': {
        get: {
          tags: ['travellers'], operationId: 'listTravellers', summary: 'Listar viajantes',
          parameters: [
            { name: 'nationality', in: 'query', schema: { type: 'string', enum: ['MX', 'PT', 'BR'] } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
            { name: 'X-Request-Id', in: 'header', required: false, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Traveller' } } } } } },
        },
        post: {
          tags: ['travellers'], operationId: 'createTraveller', summary: 'Criar viajante',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Traveller' }, example: { firstName: 'Jaime', lastName: 'Palillo', nationality: 'MX', email: 'jaime@correio.mx' } } } },
          responses: { 201: { description: 'Criado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Traveller' } } } }, 400: { description: 'Inválido' } },
        },
      },
      '/api/travellers/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: '1' }],
        get: { tags: ['travellers'], operationId: 'getTraveller', summary: 'Buscar viajante por id', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Traveller' } } } }, 404: { description: 'Não encontrado' } } },
        put: { tags: ['travellers'], operationId: 'replaceTraveller', summary: 'Substituir viajante', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Traveller' } } } }, responses: { 200: { description: 'OK' } } },
        patch: { tags: ['travellers'], operationId: 'updateTraveller', summary: 'Atualizar parte do viajante', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } },
        delete: { tags: ['travellers'], operationId: 'deleteTraveller', summary: 'Apagar viajante', responses: { 204: { description: 'Apagado' } } },
      },
      '/oauth/token': {
        post: {
          tags: ['auth'], operationId: 'token', summary: 'Obter token', security: [],
          requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { grant_type: { type: 'string', example: 'client_credentials' }, client_id: { type: 'string', example: 'jaiminho-app' }, client_secret: { type: 'string', example: 'segredo' } } } } } },
          responses: { 200: { description: 'Token' } },
        },
      },
      '/xml/traveller': {
        get: { tags: ['util'], operationId: 'travellerXml', summary: 'Viajante em XML', parameters: [{ name: 'id', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'XML', content: { 'application/xml': { schema: { type: 'object' } } } } } },
      },
      '/echo': {
        post: { tags: ['util'], operationId: 'echo', summary: 'Eco', deprecated: true, requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { nome: { type: 'string' }, arquivo: { type: 'string', format: 'binary' } } } } } }, responses: { 200: { description: 'OK' } } },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      schemas: {
        Document: { type: 'object', properties: { type: { type: 'string', enum: ['PASSPORT', 'ID_CARD'] }, number: { type: 'string' } } },
        Traveller: travellerSchema,
      },
    },
  };
}

function swagger2(host) {
  return {
    swagger: '2.0',
    info: { title: 'Jaiminho Mock - Swagger 2', version: '1.0.0' },
    host, basePath: '/', schemes: ['http'],
    consumes: ['application/json'], produces: ['application/json'],
    securityDefinitions: { basicAuth: { type: 'basic' } },
    paths: {
      '/api/travellers/{id}': {
        get: { tags: ['travellers'], operationId: 'getTraveller', summary: 'Buscar viajante', parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }], responses: { 200: { description: 'OK', schema: { $ref: '#/definitions/Traveller' } } } },
      },
      '/api/travellers': {
        post: { tags: ['travellers'], operationId: 'createTraveller', summary: 'Criar viajante', parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Traveller' } }], responses: { 201: { description: 'Criado' } } },
      },
    },
    definitions: { Traveller: { type: 'object', properties: { firstName: { type: 'string', example: 'Ana' }, lastName: { type: 'string', example: 'Silva' } } } },
  };
}

module.exports = { openapi3, swagger2 };
