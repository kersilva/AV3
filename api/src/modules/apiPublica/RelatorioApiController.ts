import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EscopoApi } from '@/generated/prisma/enums.js';
import { ErroAutenticacao, ErroNaoEncontrado } from '@/shared/errors/DomainError.js';
import type { ApiKeyService } from './ApiKeyService.js';
import type { RelatorioApiService } from './RelatorioApiService.js';

export async function RelatorioApiController(
  app: FastifyInstance,
  apiKeys: ApiKeyService,
  service: RelatorioApiService,
): Promise<void> {
  const guardarParceiro = (request: FastifyRequest) => {
    if (!request.apiParceiro) throw new ErroAutenticacao('Chave de API necessária.');
    return request.apiParceiro;
  };

  app.post<{ Body: { dataReferencia?: string } }>(
    '/api/v1/public/relatorios',
    {
      preHandler: apiKeys.guard(EscopoApi.RELATORIO_LEITURA),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['API pública'], summary: 'Solicita relatório analítico assíncrono',
        security: [{ apiKeyAuth: [] }],
        headers: { type: 'object', required: ['idempotency-key'], additionalProperties: true, properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 200 } } },
        body: { type: 'object', additionalProperties: false, properties: { dataReferencia: { type: 'string', format: 'date-time' } } },
        response: { 202: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => {
      guardarParceiro(request);
      const key = request.headers['idempotency-key'];
      const resultado = await service.solicitar(
        request.apiParceiro!, request.body ?? {}, Array.isArray(key) ? key[0] : key,
      );
      return reply.code(202).header('Idempotency-Replayed', resultado.replayed ? 'true' : 'false').send(resultado);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/public/relatorios/:id',
    { preHandler: apiKeys.guard(EscopoApi.RELATORIO_LEITURA), config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['API pública'], security: [{ apiKeyAuth: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } },
    async (request) => {
      const parceiro = await guardarParceiro(request);
      return service.buscarStatus(request.params.id, parceiro.parceiroId);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/public/relatorios/:id/download',
    {
      preHandler: apiKeys.guard(EscopoApi.RELATORIO_LEITURA),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['API pública'], summary: 'Baixa relatório concluído do próprio parceiro',
        security: [{ apiKeyAuth: [] }],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parceiro = await guardarParceiro(request);
      const id = await service.buscarArquivo(request.params.id, parceiro.parceiroId);
      const diretorio = process.env.REPORTS_DIR ?? path.resolve(process.cwd(), 'storage', 'relatorios');
      try {
        const conteudo = await readFile(path.join(diretorio, `${id}.json`), 'utf8');
        return reply.type('application/json; charset=utf-8').send(conteudo);
      } catch (erro) {
        if (typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'ENOENT') {
          throw new ErroNaoEncontrado('Arquivo do relatório não encontrado.');
        }
        throw erro;
      }
    },
  );
}
