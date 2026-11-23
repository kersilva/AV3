// src/infrastructure/swaggerConfig.ts

import type { SwaggerOptions } from '@fastify/swagger';
import type { FastifySwaggerUiOptions } from '@fastify/swagger-ui';

export const swaggerOptions: SwaggerOptions = {
  openapi: {
    info: {
      title: 'GreenCode API',
      description: 'API pública para parceiros em /api/v1/public e API interna para usuários e gestão em /api/v1/internal.',
      version: '1.0.0',
      contact: {
        name: 'Técnicas de Programação - AV3',
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Chave de API do parceiro externo. O segredo é exibido apenas uma vez na emissão.',
        },
      },
    },
    tags: [
      { name: 'Autenticação', description: 'Login e emissão de token JWT' },
      { name: 'Usuários', description: 'Gestão de usuários e papéis' },
      { name: 'Organizações', description: 'Cadastro de organizações' },
      { name: 'Contratos', description: 'Contratos vinculados a organizações' },
      { name: 'Lotes', description: 'Recebimento e triagem de lotes' },
      { name: 'Equipamentos', description: 'Equipamentos e movimentações' },
      { name: 'Auditoria', description: 'Consulta ao journal' },
      { name: 'Relatórios', description: 'Relatórios operacionais e análises persistidas' },
      { name: 'Configuração', description: 'Configurações do sistema' },
      { name: 'API pública', description: 'Integrações versionadas para parceiros externos' },
    ],
  },
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    persistAuthorization: true,
  },
  uiHooks: {
    onRequest: function (_request, _reply, next) {
      next();
    },
    preHandler: function (_request, _reply, next) {
      next();
    },
  },
};
