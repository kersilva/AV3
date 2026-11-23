import "dotenv/config";
import { PapelUsuario } from "../src/domain/enums/PapelUsuario.js";
import { EstadoFisico } from "../src/domain/enums/EstadoFisico.js";
import { StatusLote } from "../src/domain/enums/StatusLote.js";
import { StatusRastreamento } from "../src/domain/enums/StatusRastreamento.js";
import { TipoEquipamento } from "../src/domain/enums/TipoEquipamento.js";
import { ContratoService } from "../src/modules/contrato/ContratoService.js";
import { PrismaContratoRepository } from "../src/infrastructure/repositories/PrismaContratoRepository.js";
import type { NovaOrganizacao } from "../src/domain/repositories/OrganizacaoRepository.js";
import type { NovoEquipamento } from "../src/domain/entities/Equipamento.js";
import { ORDEM_ESTADO } from "../src/domain/entities/Equipamento.js";
import { prisma } from "../src/infrastructure/database.js";
import { PrismaJournalTransacaoRepository } from "../src/infrastructure/repositories/PrismaJournalTransacaoRepository.js";
import { PrismaUsuarioRepository } from "../src/infrastructure/repositories/PrismaUsuarioRepository.js";
import { PrismaOrganizacaoRepository } from "../src/infrastructure/repositories/PrismaOrganizacaoRepository.js";
import { PrismaLoteRepository } from "../src/infrastructure/repositories/PrismaLoteRepository.js";
import { PrismaEquipamentoRepository } from "../src/infrastructure/repositories/PrismaEquipamentoRepository.js";
import { PrismaConfiguracaoRepository } from "../src/infrastructure/repositories/PrismaConfiguracaoRepository.js";
import { PrismaJournalWriter } from "../src/infrastructure/journal/PrismaJournalWriter.js";
import { PrismaUnitOfWork } from "../src/infrastructure/PrismaUnitOfWork.js";
import { BcryptHash } from "../src/infrastructure/crypto/BcryptHash.js";
import { UsuarioService } from "../src/modules/usuario/UsuarioService.js";
import { OrganizacaoService } from "../src/modules/organizacao/OrganizacaoService.js";
import { LoteService } from "../src/modules/lote/LoteService.js";
import { EquipamentoService } from "../src/modules/equipamento/EquipamentoService.js";
import { ConfiguracaoService } from "../src/modules/configuracao/ConfiguracaoService.js";
import { StatusLote as PrismaStatusLote } from "../src/generated/prisma/enums.js";
import {
  dataSeed,
  datasHistoricoEstadoFisico,
  datasHistoricoLote,
  datasMovimentacoes,
  inicioHistoricoLote,
} from "./seed-data.js";



type Ator = { id: string; usuario: string };
type DadosUsuarioSeed = {
  id: string;
  usuario: string;
  papel: PapelUsuario;
  senha: string;
};

// Mapeamento explícito entre o enum de domínio StatusLote e o enum gerado pelo
// Prisma. Substitui o cast `as keyof typeof PrismaStatusLote` da versão
// anterior, usado no prisma.lote.update dentro de garantirLote.
const STATUS_LOTE_DOMAIN_PARA_PRISMA: Record<StatusLote, PrismaStatusLote> = {
  [StatusLote.RECEBIDO]: PrismaStatusLote.RECEBIDO,
  [StatusLote.EM_TRIAGEM]: PrismaStatusLote.EM_TRIAGEM,
  [StatusLote.TRIAGEM_CONCLUIDA]: PrismaStatusLote.TRIAGEM_CONCLUIDA,
  [StatusLote.ENCAMINHADO]: PrismaStatusLote.ENCAMINHADO,
  [StatusLote.FINALIZADO]: PrismaStatusLote.FINALIZADO,
};

function obterSenhaSeed(): string {
  const senha = process.env.SEED_PASSWORD;
  if (!senha) {
    throw new Error(
      "Defina a variável de ambiente SEED_PASSWORD antes de executar o seed.",
    );
  }
  const bytes = new TextEncoder().encode(senha).length;
  if (bytes < 8 || bytes > 72) {
    throw new Error(
      `A senha definida em SEED_PASSWORD tem ${bytes} bytes; o limite é entre 8 e 72 bytes em UTF-8.`,
    );
  }
  return senha;
}

const senhaSeed: string = obterSenhaSeed();

const journalRepository = new PrismaJournalTransacaoRepository();
const journalWriter = new PrismaJournalWriter(journalRepository);
const unitOfWork = new PrismaUnitOfWork(async (transacao) => {
  await transacao.$queryRaw`SELECT set_config('greencode.seed_mode', 'on', true)`;
});
const usuarioRepository = new PrismaUsuarioRepository();
const loteRepository = new PrismaLoteRepository();
const equipamentoRepository = new PrismaEquipamentoRepository();
const usuarioService = new UsuarioService(
  usuarioRepository,
  new BcryptHash(),
  unitOfWork,
);
const organizacaoService = new OrganizacaoService(
  new PrismaOrganizacaoRepository(),
  unitOfWork,
);
const loteService = new LoteService(loteRepository, unitOfWork);
const equipamentoService = new EquipamentoService(
  equipamentoRepository,
  unitOfWork,
);
const contratoService = new ContratoService(new PrismaContratoRepository(), unitOfWork);
const configuracaoService = new ConfiguracaoService(
  new PrismaConfiguracaoRepository(),
  unitOfWork,
);

async function garantirUsuario(dados: DadosUsuarioSeed, ator?: Ator) {
  let usuario = await usuarioRepository.buscarPorId(dados.id);

  if (!usuario) {
    const usuarioComMesmoNome = await usuarioRepository.buscarPorUsuario(
      dados.usuario,
    );
    if (usuarioComMesmoNome) {
      throw new Error(
        `O usuário ${dados.usuario} já existe com outro identificador.`,
      );
    }

    await usuarioService.cadastrar(
      dados,
      ator ?? {
        id: dados.id,
        usuario: dados.usuario,
      },
    );
    usuario = await usuarioRepository.buscarPorId(dados.id);
    if (!usuario) {
      throw new Error(`O usuário seed ${dados.usuario} não foi persistido.`);
    }
  }

  const responsavel = ator ?? { id: usuario.id, usuario: usuario.usuario };
  if (usuario.usuario !== dados.usuario) {
    throw new Error(`O identificador ${dados.id} já pertence a outro usuário.`);
  }

  if (usuario.papel !== dados.papel) {
    await usuarioService.alterarPapel(
      usuario.id,
      dados.papel,
      usuario.versao,
      responsavel,
    );
    usuario = await usuarioRepository.buscarPorId(usuario.id);
    if (!usuario) throw new Error(`O usuário ${dados.usuario} desapareceu.`);
  }

  if (!usuario.ativo) {
    await usuarioService.alterarAtivo(
      usuario.id,
      true,
      usuario.versao,
      responsavel,
    );
    usuario = await usuarioRepository.buscarPorId(usuario.id);
    if (!usuario) throw new Error(`O usuário ${dados.usuario} desapareceu.`);
  }

  return usuario;
}

async function garantirOrganizacao(ator: Ator) {
  const organizacaoRepository = new PrismaOrganizacaoRepository();
  const id = "seed-organizacao-principal";
  const existente = await organizacaoRepository.buscarPorId(id);
  if (existente) return existente;

  const estado = await organizacaoRepository.obterEstadoExclusao(id);
  if (estado) {
    if (estado.excluidoEm) await organizacaoService.reativar(id, estado.versao, ator);
    const reativada = await organizacaoRepository.buscarPorId(id);
    if (!reativada) throw new Error("A organização seed não pôde ser reativada.");
    return reativada;
  }

  const cnpj = "11222333000181";
  const cnpjExistente = await prisma.organizacao.findUnique({
    where: { cnpj },
  });
  if (cnpjExistente) {
    throw new Error(
      `O CNPJ de exemplo já pertence à organização ${cnpjExistente.id}.`,
    );
  }

  const dados: NovaOrganizacao = {
    id,
    razaoSocial: "Organização de Demonstração Greencode",
    cnpj,
    inscricaoEstadual: "ISENTO",
    enderecoCompleto: "Rua de Testes, 100 - Centro",
    telefone: "11999990000",
    email: "contato@greencode.example",
  };
  return organizacaoService.cadastrar(dados, ator);
}

async function garantirLote(
  id: string,
  statusDesejado: StatusLote,
  organizacaoId: string,
  ator: Ator,
) {
  const ordemStatus = Object.values(StatusLote);
  const indiceStatusDesejado = ordemStatus.indexOf(statusDesejado);
  if (indiceStatusDesejado < 0) {
    throw new Error(`Estado de lote inválido no seed: ${statusDesejado}.`);
  }
  const inicioHistorico = inicioHistoricoLote(indiceStatusDesejado);
  let lote = await loteRepository.buscarPorId(id);
  if (!lote) {
    const estado = await loteRepository.obterEstadoExclusao(id);
    if (estado?.excluidoEm) {
      await loteService.reativar(id, estado.versao, ator);
      lote = await loteRepository.buscarPorId(id);
    }
  }
  if (!lote) {
    await loteService.criarLote(
      {
        id,
        dataEntrada: dataSeed(inicioHistorico),
        organizacaoId,
        notaFiscal: `SEED-${id}`,
        transportadora: "Transportadora de Demonstração",
        observacoes: "Registro de demonstração criado pelo seed.",
      },
      ator,
    );
    lote = await loteRepository.buscarPorId(id);
  }
  if (!lote) throw new Error(`O lote seed ${id} não foi persistido.`);

  await prisma.lote.update({
    where: { id },
    data: { dataEntrada: dataSeed(inicioHistorico) },
  });

  const estados = ordemStatus;
  const indiceDesejado = indiceStatusDesejado;
  let indiceAtual = estados.indexOf(lote.statusProcessamento);
  if (indiceDesejado < 0 || indiceAtual < 0) {
    throw new Error(`Estado de lote inválido no seed: ${statusDesejado}.`);
  }

  if (indiceAtual > indiceDesejado) {
    const anterior = lote.statusProcessamento;
    const novoEstado = STATUS_LOTE_DOMAIN_PARA_PRISMA[statusDesejado];
    await prisma.lote.update({
      where: { id },
      data: { statusProcessamento: novoEstado, versao: { increment: 1 } },
    });
    await journalWriter.registrar({
      operacao: "RESTAURAR_DADO_SEED",
      entidade: "Lote",
      usuarioId: ator.id,
      usuarioResponsavel: ator.usuario,
      dadosAntes: { id, statusProcessamento: anterior },
      dadosDepois: { id, statusProcessamento: statusDesejado },
    });
    lote = await loteRepository.buscarPorId(id);
    if (!lote) throw new Error(`O lote seed ${id} não foi encontrado.`);
    indiceAtual = estados.indexOf(lote.statusProcessamento);
  }

  while (indiceAtual < indiceDesejado) {
    await loteService.processarTriagem(id, lote.versao, ator);
    lote = await loteRepository.buscarPorId(id);
    if (!lote) throw new Error(`O lote seed ${id} não foi encontrado.`);
    indiceAtual = estados.indexOf(lote.statusProcessamento);
  }

  const historico = await prisma.historicoStatusLote.findMany({
    where: { loteId: id },
    orderBy: { timestamp: "asc" },
  });
  const datasLote = datasHistoricoLote(inicioHistorico, historico);
  for (const [indice, linha] of historico.entries()) {
    await prisma.historicoStatusLote.update({
      where: { id: linha.id },
      data: { timestamp: exigirData(datasLote, indice) },
    });
  }

  return lote;
}

async function garantirEquipamento(
  tipo: TipoEquipamento,
  estadoFisico: EstadoFisico,
  statusRastreamento: StatusRastreamento,
  loteId: string,
  posicaoNoLote: number,
  ator: Ator,
  sufixo = '',
  trajetoria: readonly EstadoFisico[] = [estadoFisico],
) {
  const complementoId = sufixo ? `-${sufixo}` : '';
  const id = `seed-equipamento-${tipo.toLowerCase()}${complementoId}`;
  const dados: NovoEquipamento = {
    id,
    codigoBarrasInterno: `SEED-${tipo}${complementoId}`,
    tipo,
    marca: "Greencode",
    modelo: `Modelo ${tipo}`,
    anoFabricacao: 2018 + (posicaoNoLote % 7),
    estadoFisico: EstadoFisico.NOVO,
    pesoQuilogramas: 3 + posicaoNoLote / 10,
    loteId,
    posicaoNoLote,
  };

  let equipamento = await prisma.equipamento.findUnique({ where: { id } });
  if (equipamento?.excluidoEm) {
    await equipamentoService.reativar(id, equipamento.versao, ator);
    equipamento = await prisma.equipamento.findUnique({ where: { id } });
  }
  if (!equipamento) {
    const codigoExistente = await prisma.equipamento.findUnique({
      where: { codigoBarrasInterno: dados.codigoBarrasInterno },
    });
    if (codigoExistente) {
      throw new Error(
        `O código ${dados.codigoBarrasInterno} já pertence ao equipamento ${codigoExistente.id}.`,
      );
    }
    await equipamentoService.cadastrar(dados, ator);
    equipamento = await prisma.equipamento.findUnique({ where: { id } });
  }
  if (!equipamento) {
    throw new Error(`O equipamento seed ${id} não foi persistido.`);
  }
  if (equipamento.tipo !== tipo || equipamento.loteId !== loteId) {
    throw new Error(`O equipamento seed ${id} tem dados incompatíveis.`);
  }

  let estadoAtual = await equipamentoService.rastrearEquipamento(id);
  const indiceEstadoAtual = ORDEM_ESTADO.indexOf(estadoAtual.estadoFisico);
  const indiceFinal = ORDEM_ESTADO.indexOf(estadoFisico);
  const indiceInicialTrajetoria = trajetoria.indexOf(estadoAtual.estadoFisico);
  const indiceFinalTrajetoria = trajetoria.indexOf(estadoFisico);
  const estadosPendentes = trajetoria.length > 1 && indiceInicialTrajetoria >= 0 && indiceFinalTrajetoria >= indiceInicialTrajetoria
    ? trajetoria.slice(indiceInicialTrajetoria + 1, indiceFinalTrajetoria + 1)
    : indiceEstadoAtual < indiceFinal
      ? [estadoFisico]
      : [];
  for (const estadoAlvo of estadosPendentes) {
    estadoAtual = await equipamentoService.atualizarEstadoFisico(
      id,
      estadoAlvo,
      "Seed de demonstração: trajetória histórica para as análises da AV3.",
      estadoAtual.versao,
      ator,
    );
  }

  const sequenciaStatus: StatusRastreamento[] = [
    StatusRastreamento.AGUARDANDO_TRIAGEM,
    StatusRastreamento.EM_TRIAGEM,
    StatusRastreamento.AGUARDANDO_DESMONTE,
    StatusRastreamento.EM_DESMONTE,
    StatusRastreamento.PECAS_REAPROVEITADAS,
    StatusRastreamento.MATERIAL_RECICLAVEL,
    StatusRastreamento.DESCARTE_SEGURO,
    StatusRastreamento.BAIXA_DEFINITIVA,
  ];
  const indiceDesejado = sequenciaStatus.indexOf(statusRastreamento);
  if (indiceDesejado < 0) {
    throw new Error(`Estado de rastreamento inválido: ${statusRastreamento}.`);
  }

  const atual = await equipamentoService.rastrearEquipamento(id);
  const indiceAtual = sequenciaStatus.indexOf(atual.statusRastreamento);
  if (indiceAtual < 0) {
    throw new Error(
      `Status de rastreamento inválido no equipamento ${id}: ${atual.statusRastreamento}.`,
    );
  }

  // Política do seed: não retrocede equipamentos para um status anterior ao
  // desejado, para não gerar histórico regressivo de movimentações. Esta
  // política é do seed, não do domínio — registrarMovimentacao aceita
  // retrocesso, mas o seed opta por não usá-lo aqui.
  if (indiceAtual > indiceDesejado) {
    throw new Error(
      `O equipamento ${id} está em ${atual.statusRastreamento}, além do desejado ${statusRastreamento}; o seed não retrocede equipamentos.`,
    );
  }

  // Avança do status atual até o desejado, uma transição por vez. Entre cada
  // chamada, relê o equipamento com rastrearEquipamento para obter a versão
  // atual, porque cada movimentação incrementa a versão. O domínio aceita
  // transições fora do desmonte; o grafo completo do fluxo depois do desmonte
  // ainda não está definido.
  let indice = indiceAtual;
  while (indice < indiceDesejado) {
    const destino = sequenciaStatus[indice + 1]!;
    const passo = await equipamentoService.rastrearEquipamento(id);
    if (passo.statusRastreamento === destino) {
      indice += 1;
      continue;
    }
    await equipamentoService.registrarMovimentacao(
      id,
      {
        destino,
        observacao: 'Seed de demonstração: avanço no fluxo de rastreamento.',
      },
      passo.versao,
      ator,
    );
    indice += 1;
  }

  const inicioHistorico = posicaoNoLote * 30;
  const historicoFisico = await prisma.historicoEstadoFisico.findMany({
    where: { equipamentoId: id },
    orderBy: { timestamp: "asc" },
  });
  const datasFisicas = datasHistoricoEstadoFisico(inicioHistorico, historicoFisico.length);
  for (const [indice, linha] of historicoFisico.entries()) {
    await prisma.historicoEstadoFisico.update({
      where: { id: linha.id },
      data: { timestamp: exigirData(datasFisicas, indice) },
    });
  }

  const movimentacoes = await prisma.movimentacao.findMany({
    where: { equipamentoId: id },
    orderBy: { dataHora: "asc" },
  });
  const datasDeMovimentacao = datasMovimentacoes(inicioHistorico, movimentacoes.length);
  for (const [indice, movimentacao] of movimentacoes.entries()) {
    await prisma.movimentacao.update({
      where: { id: movimentacao.id },
      data: { dataHora: exigirData(datasDeMovimentacao, indice) },
    });
  }

  return equipamentoService.rastrearEquipamento(id);
}

async function garantirContrato(organizacaoId: string, ator: Ator) {
  const contratoExistente = await prisma.contrato.findFirst({
    where: { organizacaoId },
    orderBy: { dataAssinatura: "desc" },
  });
  if (contratoExistente) {
    if (contratoExistente.excluidoEm) {
      await contratoService.reativar(contratoExistente.id, contratoExistente.versao, ator);
    }
    return;
  }

  await contratoService.cadastrar({
    id: "seed-contrato-principal",
    organizacaoId,
    dataAssinatura: new Date("2025-01-01T00:00:00.000Z"),
    dataVencimento: new Date("2030-01-01T00:00:00.000Z"),
    clausulas: [
      "Contrato de demonstração para testes locais.",
      "O equipamento permanece vinculado à organização responsável.",
    ],
    valorMensal: 1250,
    renovacaoAutomatica: true,
  }, ator);
}

async function garantirConfiguracao(ator: Ator) {
  const desejada = { aliquotaImposto: 0.075, coeficienteDepreciacao: 0.2 };
  const atual = await configuracaoService.obter();
  if (
    atual.aliquotaImposto === desejada.aliquotaImposto &&
    atual.coeficienteDepreciacao === desejada.coeficienteDepreciacao
  ) {
    return;
  }
  await configuracaoService.atualizar(
    { ...desejada, versao: atual.versao },
    ator,
  );
}

async function verificarCoberturaDosEnums() {
  const usuarios = await prisma.usuario.findMany({ select: { papel: true } });
  const lotes = await prisma.lote.findMany({
    select: { statusProcessamento: true },
  });
  const equipamentos = await prisma.equipamento.findMany({
    select: { tipo: true, estadoFisico: true, statusRastreamento: true },
  });

  conferirValores(
    "PapelUsuario",
    Object.values(PapelUsuario).map(String),
    usuarios.map((item) => String(item.papel)),
  );

  conferirValores(
    "StatusLote",
    Object.values(StatusLote).map(String),
    lotes.map((item) => String(item.statusProcessamento)),
  );

  conferirValores(
    "TipoEquipamento",
    Object.values(TipoEquipamento).map(String),
    equipamentos.map((item) => String(item.tipo)),
  );

  conferirValores(
    "EstadoFisico",
    Object.values(EstadoFisico).map(String),
    equipamentos.map((item) => String(item.estadoFisico)),
  );

  conferirValores(
    "StatusRastreamento",
    Object.values(StatusRastreamento).map(String),
    equipamentos.map((item) => String(item.statusRastreamento)),
  );
}

async function verificarCoberturaAnalitica() {
  const corteHistorico = new Date('2025-12-15T00:00:00.000Z');
  for (const tipo of Object.values(TipoEquipamento)) {
    const equipamentos = await prisma.equipamento.findMany({
      where: { tipo, excluidoEm: null },
      include: { historicoEstadoFisico: { orderBy: [{ timestamp: 'asc' }, { id: 'asc' }] } },
    });
    const datasFalha = equipamentos.flatMap((equipamento) => {
      const falha = equipamento.historicoEstadoFisico.find(
        (evento) => evento.estadoNovo === EstadoFisico.INSERVIVEL,
      );
      return falha ? [falha.timestamp] : [];
    });
    const falhasNoCorte = datasFalha.filter((data) => data <= corteHistorico).length;
    const falhasDepoisDoCorte = datasFalha.filter((data) => data > corteHistorico).length;
    const sobreviventes = equipamentos.filter(
      (equipamento) =>
        equipamento.historicoEstadoFisico.at(-1)?.estadoNovo !== EstadoFisico.INSERVIVEL,
    ).length;
    const amostrasDemonstracao = equipamentos.filter(
      (equipamento) =>
        equipamento.valorRealizadoRecuperacao !== null &&
        equipamento.dataRealizacao !== null &&
        equipamento.referenciaComprovante?.startsWith('DEMO-SEED:'),
    ).length;
    if (falhasNoCorte < 5 || falhasDepoisDoCorte < 1 || sobreviventes < 1 || amostrasDemonstracao < 2) {
      throw new Error(
        `Cobertura analítica insuficiente para ${tipo}: falhasNoCorte=${falhasNoCorte}, ` +
          `falhasDepoisDoCorte=${falhasDepoisDoCorte}, sobreviventes=${sobreviventes}, ` +
          `amostrasDemonstracao=${amostrasDemonstracao}.`,
      );
    }
  }
}

function conferirValores(
  nome: string,
  esperados: readonly string[],
  encontrados: readonly string[],
): void {
  const faltantes = esperados.filter((valor) => !encontrados.includes(valor));
  if (faltantes.length > 0) {
    throw new Error(`O seed não cobriu ${nome}: ${faltantes.join(", ")}.`);
  }
}

function exigirData(datas: readonly Date[], indice: number): Date {
  const data = datas[indice];
  if (!data) throw new Error(`Data de seed ausente no índice ${indice}.`);
  return data;
}

async function main() {
  const usuariosSeed: DadosUsuarioSeed[] = Object.values(PapelUsuario).map(
    (papel) => ({
      id: `seed-usuario-${papel.toLowerCase()}`,
      usuario: `seed.${papel.toLowerCase()}`,
      papel,
      senha: senhaSeed,
    }),
  );
  const administrador = await garantirUsuario(usuariosSeed[0]!);
  const ator: Ator = {
    id: administrador.id,
    usuario: administrador.usuario,
  };

  for (const dados of usuariosSeed.slice(1)) {
    await garantirUsuario(dados, ator);
  }

  const organizacao = await garantirOrganizacao(ator);
  await garantirConfiguracao(ator);
  await garantirContrato(organizacao.id, ator);

  const lotesPorEstado = new Map<StatusLote, string>();
  for (const status of Object.values(StatusLote)) {
    const lote = await garantirLote(
      `seed-lote-${status.toLowerCase()}`,
      status,
      organizacao.id,
      ator,
    );
    lotesPorEstado.set(status, lote.id);
  }
  const loteEquipamentos = lotesPorEstado.get(StatusLote.RECEBIDO)!;

  const tipos = Object.values(TipoEquipamento);
  const estados = Object.values(EstadoFisico);
  const status = Object.values(StatusRastreamento);
  for (let indice = 0; indice < tipos.length; indice += 1) {
    await garantirEquipamento(
      tipos[indice]!,
      estados[indice % estados.length]!,
      status[indice]!,
      loteEquipamentos,
      indice + 1,
      ator,
    );
  }
  for (let indiceTipo = 0; indiceTipo < tipos.length; indiceTipo += 1) {
    const tipo = tipos[indiceTipo]!;
    const loteAnalitico = await garantirLote(
      `seed-lote-analitico-${tipo.toLowerCase()}`,
      StatusLote.RECEBIDO,
      organizacao.id,
      ator,
    );
    for (let indiceFalha = 1; indiceFalha <= 6; indiceFalha += 1) {
      const posicao = indiceFalha;
      await garantirEquipamento(
        tipo,
        EstadoFisico.INSERVIVEL,
        StatusRastreamento.EM_DESMONTE,
        loteAnalitico.id,
        posicao,
        ator,
        `falha-${indiceFalha}`,
        ORDEM_ESTADO,
      );
    }
    const posicaoSobrevivente = 7;
    await garantirEquipamento(
      tipo,
      EstadoFisico.USADO_MODERADO,
      StatusRastreamento.EM_TRIAGEM,
      loteAnalitico.id,
      posicaoSobrevivente,
      ator,
      'sobrevivente',
      ORDEM_ESTADO.slice(0, 4),
    );
    for (let indiceAmostra = 1; indiceAmostra <= 2; indiceAmostra += 1) {
      const posicao = 7 + indiceAmostra;
      const equipamentoAmostra = await garantirEquipamento(
        tipo,
        EstadoFisico.USADO_MODERADO,
        StatusRastreamento.PECAS_REAPROVEITADAS,
        loteAnalitico.id,
        posicao,
        ator,
        `amostra-valor-${indiceAmostra}`,
        ORDEM_ESTADO.slice(0, 4),
      );
      await prisma.equipamento.update({
        where: { id: equipamentoAmostra.id },
        data: {
          valorRealizadoRecuperacao: 80 + indiceTipo * 25 + indiceAmostra * 10,
          dataRealizacao: dataSeed(posicao * 30 + 120),
          referenciaComprovante: `DEMO-SEED:NF-${tipo}-${indiceAmostra}`,
        },
      });
    }
  }
  await verificarCoberturaDosEnums();
  await verificarCoberturaAnalitica();

  console.info("Seed concluído. Os dados de demonstração estão disponíveis.");
}

try {
  await main();
} catch (erro) {
  console.error("Falha ao executar o seed:", erro);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
