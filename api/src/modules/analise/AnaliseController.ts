import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { ErroNaoEncontrado, ErroValidacao } from '@/shared/errors/DomainError.js';
import type { AnaliseService } from './AnaliseService.js';

export async function AnaliseController(
  app: FastifyInstance,
  exigirAcesso: preHandlerHookHandler,
  service: AnaliseService,
): Promise<void> {
  app.post<{ Body: { dataReferencia?: string } }>(
    '/relatorios/analiticos',
    {
      preHandler: exigirAcesso,
      schema: {
        tags: ['Relatórios'],
        summary: 'Executa as análises operacionais e preditivas',
        description:
          'Calcula eficiência desde o primeiro histórico RECEBIDO, recuperação bruta comprovada e previsão OLS por tipo. A previsão usa somente eventos até dataReferencia; a escala de estado é ordinal e assume distância uniforme entre níveis. O resultado é persistido para consulta histórica.',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dataReferencia: {
              type: 'string',
              format: 'date-time',
              description: 'Data de corte inclusiva. O padrão é a data e hora atual.',
            },
          },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          401: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          403: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const dataReferencia = request.body.dataReferencia
        ? new Date(request.body.dataReferencia)
        : new Date();
      if (!Number.isFinite(dataReferencia.getTime())) {
        throw new ErroValidacao('A data de referência da análise é inválida.');
      }
      return reply.send(await service.executar(dataReferencia));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/relatorios/analiticos/:id',
    {
      preHandler: exigirAcesso,
      schema: {
        tags: ['Relatórios'],
        summary: 'Consulta uma execução analítica persistida',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1 } },
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          401: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          403: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
          404: { type: 'object', properties: { codigo: { type: 'string' }, erro: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const execucao = await service.buscarExecucao(request.params.id);
      if (!execucao) throw new ErroNaoEncontrado('Execução analítica não encontrada.');
      return reply.send(execucao);
    },
  );
}
