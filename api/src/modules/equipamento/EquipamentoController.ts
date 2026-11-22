import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { NovoEquipamento, EquipamentoService } from '@equipamento/EquipamentoService.js';
import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import { StatusRastreamento } from '@domain/enums/StatusRastreamento.js';
import { erroSchema, respostasErroComuns } from '@infra/swaggerSchemas.js';

const respostasErroInterno = {
  500: {
    description: 'Erro interno do servidor',
    ...erroSchema,
  },
} as const;

const paramsId = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      description: 'Identificador único do equipamento.',
    },
  },
} as const;

const schemaVersao = {
  type: 'object',
  additionalProperties: false,
  required: ['versao'],
  properties: {
    versao: {
      type: 'integer',
      minimum: 1,
      description: 'Versão atual do equipamento para controle otimista.',
    },
  },
} as const;

const estadoFisicoEnum = {
  type: 'string',
  enum: Object.values(EstadoFisico),
} as const;

const statusRastreamentoEnum = {
  type: 'string',
  enum: Object.values(StatusRastreamento),
} as const;

const equipamentoResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'codigoBarrasInterno',
    'tipo',
    'marca',
    'modelo',
    'anoFabricacao',
    'estadoFisico',
    'pesoQuilogramas',
    'loteId',
    'posicaoNoLote',
    'statusRastreamento',
    'versao',
  ],
  properties: {
    id: { type: 'string', description: 'Identificador único do equipamento.' },
    codigoBarrasInterno: { type: 'string', description: 'Código de barras interno.' },
    tipo: { type: 'string', description: 'Tipo do equipamento.' },
    marca: { type: 'string', description: 'Marca do equipamento.' },
    modelo: { type: 'string', description: 'Modelo do equipamento.' },
    anoFabricacao: { type: 'integer', description: 'Ano de fabricação.' },
    estadoFisico: { ...estadoFisicoEnum, description: 'Estado físico atual.' },
    pesoQuilogramas: { type: 'number', description: 'Peso em quilogramas.' },
    loteId: { type: 'string', description: 'Identificador do lote associado.' },
    posicaoNoLote: { type: 'integer', description: 'Posição ocupada no lote.' },
    statusRastreamento: { ...statusRastreamentoEnum, description: 'Status de rastreamento atual.' },
    versao: { type: 'integer', description: 'Versão atual do registro.' },
  },
} as const;

const movimentacaoResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'equipamentoId', 'destino', 'dataHora', 'responsavelId'],
  properties: {
    id: { type: 'string', description: 'Identificador da movimentação.' },
    equipamentoId: { type: 'string', description: 'Identificador do equipamento.' },
    origem: { ...statusRastreamentoEnum, description: 'Status de origem da movimentação.' },
    destino: { ...statusRastreamentoEnum, description: 'Status de destino da movimentação.' },
    dataHora: { type: 'string', format: 'date-time', description: 'Data e hora da movimentação.' },
    responsavelId: {
      type: ['string', 'null'],
      description:
        'Identificador do usuário responsável pelo registro. Nulo quando o registro foi feito pelo sistema.',
    },
    observacao: {
      type: ['string', 'null'],
      description: 'Observações adicionais.',
    },
  },
} as const;

export async function EquipamentoController(
  app: FastifyInstance,
  ler: preHandlerHookHandler,
  escrever: preHandlerHookHandler,
  service: EquipamentoService
) {
  app.get(
    '/equipamentos',
    {
      preHandler: ler,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Lista os equipamentos',
        description: 'Retorna todos os equipamentos registrados no sistema.',
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Equipamentos encontrados com sucesso',
            type: 'array',
            items: equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (_req, res) => res.send(await service.listar())
  );

  app.get<{ Params: { id: string } }>(
    '/equipamentos/:id',
    {
      preHandler: ler,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Rastreia um equipamento por ID',
        description: 'Retorna os detalhes de rastreamento de um equipamento específico.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        response: {
          200: {
            description: 'Equipamento encontrado com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) => res.send(await service.rastrearEquipamento(req.params.id))
  );

  app.get<{ Params: { id: string } }>(
    '/equipamentos/:id/movimentacoes',
    {
      preHandler: ler,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Lista as movimentações de um equipamento',
        description: 'Retorna o histórico de movimentações associado a um equipamento.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        response: {
          200: {
            description: 'Movimentações encontradas com sucesso',
            type: 'array',
            items: movimentacaoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) => res.send(await service.listarMovimentacoes(req.params.id))
  );

  app.post<{ Body: NovoEquipamento }>(
    '/equipamentos',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Cadastra um novo equipamento',
        description: 'Cria um novo registro de equipamento no sistema.',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'codigoBarrasInterno',
            'tipo',
            'marca',
            'modelo',
            'anoFabricacao',
            'estadoFisico',
            'pesoQuilogramas',
            'loteId',
            'posicaoNoLote',
          ],
          properties: {
            id: { type: 'string', minLength: 1, description: 'Identificador único.' },
            codigoBarrasInterno: {
              type: 'string',
              minLength: 1,
              description: 'Código de barras interno.',
            },
            tipo: { type: 'string', description: 'Tipo do equipamento.' },
            marca: { type: 'string', minLength: 1, description: 'Marca.' },
            modelo: { type: 'string', minLength: 1, description: 'Modelo.' },
            anoFabricacao: { type: 'integer', minimum: 1900, description: 'Ano de fabricação.' },
            estadoFisico: { type: 'string', description: 'Estado físico inicial.' },
            pesoQuilogramas: { type: 'number', exclusiveMinimum: 0, description: 'Peso em kg.' },
            loteId: { type: 'string', minLength: 1, description: 'ID do lote.' },
            posicaoNoLote: { type: 'integer', minimum: 1, description: 'Posição no lote.' },
            statusRastreamento: { type: 'string', description: 'Status de rastreamento inicial.' },
          },
        },
        response: {
          201: {
            description: 'Equipamento cadastrado com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.code(201).send(
        await service.cadastrar(req.body, {
          id: req.user.sub,
          usuario: req.user.usuario,
        })
      )
  );

  app.patch<{
    Params: { id: string };
    Body: {
      estadoFisico: EstadoFisico;
      justificativa?: string;
      versao: number;
    };
  }>(
    '/equipamentos/:id/estado',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Atualiza o estado físico de um equipamento',
        description:
          'Altera o estado físico do equipamento. A justificativa é obrigatória apenas quando a queda for de duas ou mais categorias.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['estadoFisico', 'versao'],
          properties: {
            estadoFisico: {
              ...estadoFisicoEnum,
              description: 'Novo estado físico.',
            },
            justificativa: {
              type: 'string',
              description: 'Justificativa da alteração.',
            },
            versao: {
              type: 'integer',
              minimum: 1,
              description: 'Versão atual para controlo otimista.',
            },
          },
        },
        response: {
          200: {
            description: 'Estado físico atualizado com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.send(
        await service.atualizarEstadoFisico(
          req.params.id,
          req.body.estadoFisico,
          req.body.justificativa ?? '',
          req.body.versao,
          { id: req.user.sub, usuario: req.user.usuario }
        )
      )
  );

  app.patch<{
    Params: { id: string };
    Body: {
      statusRastreamento: StatusRastreamento;
      justificativa: string;
      versao: number;
    };
  }>(
    '/equipamentos/:id/status',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Atualiza o status de rastreamento de um equipamento',
        description: 'Altera o status de rastreamento exigindo justificativa e versão atual.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['statusRastreamento', 'justificativa', 'versao'],
          properties: {
            statusRastreamento: {
              ...statusRastreamentoEnum,
              description: 'Novo status de rastreamento.',
            },
            justificativa: {
              type: 'string',
              minLength: 1,
              description: 'Justificativa da alteração.',
            },
            versao: {
              type: 'integer',
              minimum: 1,
              description: 'Versão atual para controlo otimista.',
            },
          },
        },
        response: {
          200: {
            description: 'Status de rastreamento atualizado com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.send(
        await service.atualizarStatus(
          req.params.id,
          req.body.statusRastreamento,
          req.body.justificativa,
          req.body.versao,
          { id: req.user.sub, usuario: req.user.usuario }
        )
      )
  );

  app.post<{
    Params: { id: string };
    Body: { destino: StatusRastreamento; observacao?: string; versao: number };
  }>(
    '/equipamentos/:id/movimentacoes',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Registra uma movimentação para o equipamento',
        description:
          'Adiciona um novo registro de movimentação informando o destino e observações.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['destino', 'versao'],
          properties: {
            destino: {
              ...statusRastreamentoEnum,
              description: 'Status de destino da movimentação.',
            },
            observacao: { type: 'string', description: 'Observação opcional.' },
            versao: { type: 'integer', minimum: 1, description: 'Versão atual do equipamento.' },
          },
        },
        response: {
          201: {
            description: 'Movimentação registrada com sucesso',
            ...movimentacaoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.code(201).send(
        await service.registrarMovimentacao(req.params.id, req.body, req.body.versao, {
          id: req.user.sub,
          usuario: req.user.usuario,
        })
      )
  );

  app.delete<{ Params: { id: string }; Body: { versao: number } }>(
    '/equipamentos/:id',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Exclui um equipamento',
        description: 'Remove um equipamento com base no ID e na versão atual.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        body: schemaVersao,
        response: {
          200: {
            description: 'Equipamento excluído com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.send(
        await service.excluir(req.params.id, req.body.versao, {
          id: req.user.sub,
          usuario: req.user.usuario,
        })
      )
  );

  app.patch<{ Params: { id: string }; Body: { versao: number } }>(
    '/equipamentos/:id/reativar',
    {
      preHandler: escrever,
      schema: {
        tags: ['Equipamentos'],
        summary: 'Reativa um equipamento',
        description: 'Reativa um equipamento previamente inativado/excluído usando a versão atual.',
        security: [{ bearerAuth: [] }],
        params: paramsId,
        body: schemaVersao,
        response: {
          200: {
            description: 'Equipamento reativado com sucesso',
            ...equipamentoResponseSchema,
          },
          ...respostasErroComuns,
          ...respostasErroInterno,
        },
      },
    },
    async (req, res) =>
      res.send(
        await service.reativar(req.params.id, req.body.versao, {
          id: req.user.sub,
          usuario: req.user.usuario,
        })
      )
  );
}
