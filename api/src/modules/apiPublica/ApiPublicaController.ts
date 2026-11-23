import type { FastifyInstance } from 'fastify';
import { EscopoApi } from '@/generated/prisma/enums.js';
import { ErroAutenticacao } from '@/shared/errors/DomainError.js';
import type { ApiKeyService } from './ApiKeyService.js';
import type { ApiPublicaService } from './ApiPublicaService.js';

const limiteParceiro = { max: 120, timeWindow: '1 minute' };

export async function ApiPublicaController(
  app: FastifyInstance,
  apiKeys: ApiKeyService,
  service: ApiPublicaService,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/v1/public/equipamentos/:id/rastreabilidade',
    {
      preHandler: apiKeys.guard(EscopoApi.RASTREABILIDADE_LEITURA),
      config: { rateLimit: limiteParceiro },
      schema: {
        tags: ['API pública'], summary: 'Consulta rastreabilidade de equipamento da organização do parceiro',
        security: [{ apiKeyAuth: [] }],
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1 } } },
        response: {
          200: { type: 'object', additionalProperties: true },
          401: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          403: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          404: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          429: { type: 'object', properties: { statusCode: { type: 'integer' }, error: { type: 'string' }, message: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.apiParceiro) throw new ErroAutenticacao('Chave de API necessária.');
      return reply.send(await service.rastrearEquipamento(request.params.id, request.apiParceiro));
    },
  );

  app.post<{
    Body: {
      id: string;
      dataEntrada: string;
      organizacaoId: string;
      notaFiscal: string;
      transportadora: string;
      observacoes?: string;
    };
  }>(
    '/api/v1/public/lotes',
    {
      preHandler: apiKeys.guard(EscopoApi.LOTE_ESCRITA),
      config: { rateLimit: limiteParceiro },
      schema: {
        tags: ['API pública'], summary: 'Cria lote para a organização vinculada ao parceiro',
        description: 'Exige Idempotency-Key. Repetições com o mesmo conteúdo retornam o resultado original; reutilização com outro conteúdo retorna conflito.',
        security: [{ apiKeyAuth: [] }],
        headers: {
          type: 'object', required: ['idempotency-key'], additionalProperties: true,
          properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 200 } },
        },
        body: {
          type: 'object', required: ['id', 'dataEntrada', 'organizacaoId', 'notaFiscal', 'transportadora'], additionalProperties: false,
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 100 },
            dataEntrada: { type: 'string', format: 'date-time' },
            organizacaoId: { type: 'string', minLength: 1 },
            notaFiscal: { type: 'string', minLength: 1, maxLength: 100 },
            transportadora: { type: 'string', minLength: 1, maxLength: 120 },
            observacoes: { type: 'string', maxLength: 1000 },
          },
        },
        response: {
          201: { type: 'object', additionalProperties: true },
          400: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          401: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          403: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          409: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          422: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          429: { type: 'object', properties: { statusCode: { type: 'integer' }, error: { type: 'string' }, message: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.apiParceiro) throw new ErroAutenticacao('Chave de API necessária.');
      const resultado = await service.criarLote(
        { ...request.body, dataEntrada: new Date(request.body.dataEntrada) },
        request.apiParceiro,
        Array.isArray(request.headers['idempotency-key'])
          ? request.headers['idempotency-key'][0]
          : request.headers['idempotency-key'],
      );
      return reply.code(resultado.statusCode)
        .header('Idempotency-Replayed', resultado.replayed ? 'true' : 'false')
        .send(resultado.body);
    },
  );
}
