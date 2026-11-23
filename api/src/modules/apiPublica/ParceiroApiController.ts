import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { EscopoApi } from '@/generated/prisma/enums.js';
import type { ApiKeyService } from './ApiKeyService.js';

export async function ParceiroApiController(
  app: FastifyInstance,
  exigirAdmin: preHandlerHookHandler,
  service: ApiKeyService,
): Promise<void> {
  app.post<{
    Body: { nome: string; emailContato: string; organizacaoId: string };
  }>(
    '/parceiros-api',
    {
      preHandler: exigirAdmin,
      schema: {
        tags: ['API pública'], summary: 'Cadastra parceiro externo', security: [{ bearerAuth: [] }],
        body: {
          type: 'object', required: ['nome', 'emailContato', 'organizacaoId'], additionalProperties: false,
          properties: {
            nome: { type: 'string', minLength: 1, maxLength: 120 },
            emailContato: { type: 'string', format: 'email', maxLength: 254 },
            organizacaoId: { type: 'string', minLength: 1 },
          },
        },
        response: { 201: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => reply.code(201).send(await service.criarParceiro(request.body, {
      id: request.user.sub, usuario: request.user.usuario,
    })),
  );

  app.get('/parceiros-api', {
    preHandler: exigirAdmin,
    schema: {
      tags: ['API pública'], summary: 'Lista parceiros e metadados das chaves', security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } } },
    },
  }, async (_request, reply) => reply.send(await service.listarParceiros()));

  app.post<{
    Params: { parceiroId: string };
    Body: { escopos: EscopoApi[] };
  }>(
    '/parceiros-api/:parceiroId/chaves',
    {
      preHandler: exigirAdmin,
      schema: {
        tags: ['API pública'], summary: 'Emite uma chave de API, exibida apenas nesta resposta', security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['parceiroId'], additionalProperties: false, properties: { parceiroId: { type: 'string', minLength: 1 } } },
        body: {
          type: 'object', required: ['escopos'], additionalProperties: false,
          properties: { escopos: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: Object.values(EscopoApi) } } },
        },
        response: { 201: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => reply.code(201).send(await service.criarChave(
      request.params.parceiroId,
      request.body.escopos,
      { id: request.user.sub, usuario: request.user.usuario },
    )),
  );

  app.post<{ Params: { chaveId: string } }>(
    '/parceiros-api/chaves/:chaveId/revogar',
    {
      preHandler: exigirAdmin,
      schema: {
        tags: ['API pública'], summary: 'Revoga uma chave de API', security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['chaveId'], additionalProperties: false, properties: { chaveId: { type: 'string', minLength: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => reply.send(await service.revogarChave(request.params.chaveId, {
      id: request.user.sub, usuario: request.user.usuario,
    })),
  );
}
