import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { RecuperacaoService } from './RecuperacaoService.js';
import { erroSchema } from '@infra/swaggerSchemas.js';

export async function RecuperacaoController(
  app: FastifyInstance,
  exigirEscrita: preHandlerHookHandler,
  service: RecuperacaoService,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/equipamentos/:id/recuperacao',
    {
      preHandler: exigirEscrita,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Consulta valores estimados e realizados de recuperação bruta',
        security: [{ bearerAuth: [] }],
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true }, 401: { ...erroSchema }, 403: { ...erroSchema }, 404: { ...erroSchema } },
      },
    },
    async (request, reply) => reply.send(await service.buscar(request.params.id)),
  );

  app.post<{
    Params: { id: string };
    Body: { versao: number };
  }>(
    '/equipamentos/:id/estimativa-recuperacao',
    {
      preHandler: exigirEscrita,
      schema: {
        tags: ['Relatórios'],
        summary: 'Estima a recuperação bruta durante a triagem',
        description: 'Usa amostras comprovadas. Tenta tipo, estado, marca e modelo; depois tipo e estado. Informa o número de amostras.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object', required: ['id'], additionalProperties: false,
          properties: { id: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object', required: ['versao'], additionalProperties: false,
          properties: { versao: { type: 'integer', minimum: 1 } },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: { ...erroSchema }, 401: { ...erroSchema }, 403: { ...erroSchema },
          404: { ...erroSchema }, 409: { ...erroSchema }, 422: { ...erroSchema },
        },
      },
    },
    async (request, reply) => reply.send(
      await service.estimar(request.params.id, request.body.versao, {
        id: request.user.sub,
        usuario: request.user.usuario,
      }),
    ),
  );

  app.post<{
    Params: { id: string };
    Body: { valor: number; dataRealizacao: string; referenciaComprovante: string; versao: number };
  }>(
    '/equipamentos/:id/recuperacao-realizada',
    {
      preHandler: exigirEscrita,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Registra valor realizado com referência do comprovante',
        description: 'O valor é recuperação bruta. O registro só é aceito depois do desmonte.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object', required: ['id'], additionalProperties: false,
          properties: { id: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object', required: ['valor', 'dataRealizacao', 'referenciaComprovante', 'versao'], additionalProperties: false,
          properties: {
            valor: { type: 'number', minimum: 0 },
            dataRealizacao: { type: 'string', format: 'date-time' },
            referenciaComprovante: { type: 'string', minLength: 1, maxLength: 200 },
            versao: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: { ...erroSchema }, 401: { ...erroSchema }, 403: { ...erroSchema },
          404: { ...erroSchema }, 409: { ...erroSchema }, 422: { ...erroSchema },
        },
      },
    },
    async (request, reply) => reply.send(
      await service.registrarRealizado(
        request.params.id,
        { ...request.body, dataRealizacao: new Date(request.body.dataRealizacao) },
        { id: request.user.sub, usuario: request.user.usuario },
      ),
    ),
  );
}
