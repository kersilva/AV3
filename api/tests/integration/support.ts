import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { EscopoApi } from '../../src/generated/prisma/enums.js';
import { prisma } from '../../src/infrastructure/database.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const disconnectHookRegistered = new WeakSet<object>();

function digitoCnpj(base: string, pesos: number[]): number {
  const soma = [...base].reduce((total, digito, indice) => total + Number(digito) * pesos[indice]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cnpjAleatorioValido(): string {
  const base = randomInt(0, 1_000_000_000_000).toString().padStart(12, '0');
  const primeiro = digitoCnpj(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const baseComPrimeiro = `${base}${primeiro}`;
  const segundo = digitoCnpj(baseComPrimeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${baseComPrimeiro}${segundo}`;
}

export type ParceiroFixture = {
  organizacaoId: string;
  parceiroId: string;
  chaveId: string;
  apiKey: string;
  contexto: {
    parceiroId: string;
    nome: string;
    organizacaoId: string;
    chaveId: string;
    escopos: EscopoApi[];
  };
};

export async function criarParceiroFixture(context: TestContext, nome = 'Parceiro de integração'): Promise<ParceiroFixture> {
  const organizacaoId = randomUUID();
  const parceiroId = randomUUID();
  const chaveId = randomUUID();
  const apiKey = `gc_live_${randomBytes(32).toString('base64url')}`;
  const escopos = [EscopoApi.RELATORIO_LEITURA];

  if (!disconnectHookRegistered.has(context)) {
    disconnectHookRegistered.add(context);
    context.after(() => prisma.$disconnect());
  }
  context.after(async () => {
    await prisma.solicitacaoRelatorio.deleteMany({ where: { parceiroId } });
    await prisma.chaveApi.deleteMany({ where: { parceiroId } });
    await prisma.parceiroApi.deleteMany({ where: { id: parceiroId } });
    await prisma.organizacao.deleteMany({ where: { id: organizacaoId } });
  });

  await prisma.organizacao.create({ data: {
    id: organizacaoId,
    razaoSocial: `Organização ${nome}`,
    cnpj: cnpjAleatorioValido(),
    inscricaoEstadual: 'ISENTO',
    enderecoCompleto: 'Endereço de teste',
    telefone: '11999999999',
    email: `${organizacaoId}@example.test`,
  } });
  await prisma.parceiroApi.create({ data: {
    id: parceiroId, nome, emailContato: `${parceiroId}@example.test`, organizacaoId,
  } });
  await prisma.chaveApi.create({ data: {
    id: chaveId,
    parceiroId,
    chaveHash: createHash('sha256').update(apiKey).digest('hex'),
    prefixo: apiKey.slice(0, 18),
    escopos,
  } });

  return {
    organizacaoId,
    parceiroId,
    chaveId,
    apiKey,
    contexto: { parceiroId, nome, organizacaoId, chaveId, escopos },
  };
}

export async function criarSolicitacaoConcluida(fixture: ParceiroFixture, id = randomUUID()): Promise<string> {
  const criadoEm = new Date(Date.now() - 10_000);
  await prisma.solicitacaoRelatorio.create({ data: {
    id,
    parceiroId: fixture.parceiroId,
    tipoRelatorio: 'COMPLETO',
    parametros: { organizacaoId: fixture.organizacaoId, dataReferencia: criadoEm.toISOString() },
    status: 'CONCLUIDO',
    resultado: { execucaoId: randomUUID(), tipoRelatorio: 'COMPLETO' },
    tentativas: 1,
    processamentoIniciadoEm: criadoEm,
    ultimaTentativaIniciadaEm: criadoEm,
    duracaoProcessamentoMs: 125,
    criadoEm,
    concluidoEm: new Date(),
    resultUrl: `/api/v1/public/relatorios/${id}/download`,
  } });
  return id;
}

export async function portaDisponivel(): Promise<number> {
  const servidor = createServer();
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Não foi possível obter uma porta de teste.');
  const porta = endereco.port;
  await new Promise<void>((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  return porta;
}

export async function iniciarApi(porta: number): Promise<{ processo: ChildProcess; aguardarParada: () => Promise<void> }> {
  const processo = spawn(process.execPath, [
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/main.ts',
  ], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(porta) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  processo.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4_000); });
  const aguardarParada = async () => {
    if (processo.exitCode !== null || processo.signalCode !== null) return;
    const encerramento = once(processo, 'exit').then(() => undefined);
    processo.kill('SIGTERM');
    await Promise.race([
      encerramento,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('API não encerrou no prazo.')), 8_000)),
    ]);
  };

  const prazo = Date.now() + 20_000;
  let ultimoErro: unknown;
  while (Date.now() < prazo) {
    if (processo.exitCode !== null || processo.signalCode !== null) {
      throw new Error(`API encerrou durante a inicialização. ${stderr}`);
    }
    try {
      const resposta = await fetch(`http://127.0.0.1:${porta}/docs`);
      if (resposta.ok) return { processo, aguardarParada };
    } catch (erro) {
      ultimoErro = erro;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await aguardarParada().catch(() => undefined);
  throw new Error(`API não ficou pronta. ${ultimoErro instanceof Error ? ultimoErro.message : ''} ${stderr}`);
}
