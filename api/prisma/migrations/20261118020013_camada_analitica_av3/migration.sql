/*
  Warnings:

  - You are about to drop the column `responsavel` on the `Movimentacao` table. All the data in the column will be lost.
  - Changed the type of `origem` on the `Movimentacao` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `destino` on the `Movimentacao` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "MetodologiaPrevisao" AS ENUM ('REGRESSAO_OLS', 'SUAVIZACAO_EXPONENCIAL');

-- CreateEnum
CREATE TYPE "StatusSolicitacao" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoRelatorio" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE_POR_TIPO', 'PREVISAO_VIDA_UTIL', 'COMPLETO');

-- CreateEnum
CREATE TYPE "EscopoApi" AS ENUM ('RASTREABILIDADE_LEITURA', 'LOTE_ESCRITA', 'RELATORIO_LEITURA');

-- AlterTable
ALTER TABLE "Equipamento" ADD COLUMN     "dataEstimativa" TIMESTAMP(3),
ADD COLUMN     "dataRealizacao" TIMESTAMP(3),
ADD COLUMN     "valorEstimadoRecuperacao" DECIMAL(10,2),
ADD COLUMN     "valorRealizadoRecuperacao" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Movimentacao" DROP COLUMN "responsavel",
ADD COLUMN     "responsavelId" TEXT,
DROP COLUMN "origem",
ADD COLUMN     "origem" "StatusRastreamento" NOT NULL,
DROP COLUMN "destino",
ADD COLUMN     "destino" "StatusRastreamento" NOT NULL;

-- CreateTable
CREATE TABLE "HistoricoStatusLote" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "statusAnterior" "StatusLote",
    "statusNovo" "StatusLote" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsavelId" TEXT,
    "observacao" TEXT,

    CONSTRAINT "HistoricoStatusLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoEstadoFisico" (
    "id" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "estadoAnterior" "EstadoFisico",
    "estadoNovo" "EstadoFisico" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsavelId" TEXT,
    "justificativa" TEXT,

    CONSTRAINT "HistoricoEstadoFisico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrevisaoVidaUtil" (
    "id" TEXT NOT NULL,
    "tipoEquipamento" "TipoEquipamento" NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "dataPrevisao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodologia" "MetodologiaPrevisao" NOT NULL,
    "vidaUtilEstimadaMeses" INTEGER NOT NULL,
    "r2" DECIMAL(6,4),
    "amostras" INTEGER NOT NULL,
    "parametros" JSONB NOT NULL,
    "solicitacaoRelatorioId" TEXT,

    CONSTRAINT "PrevisaoVidaUtil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidacaoPrevisao" (
    "id" TEXT NOT NULL,
    "previsaoId" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "idadeRealMeses" INTEGER NOT NULL,
    "erroAbsolutoMeses" INTEGER NOT NULL,
    "registradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidacaoPrevisao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParceiroApi" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "emailContato" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParceiroApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChaveApi" (
    "id" TEXT NOT NULL,
    "parceiroId" TEXT NOT NULL,
    "chaveHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "escopos" "EscopoApi"[],
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataRevogacao" TIMESTAMP(3),
    "ultimaVez" TIMESTAMP(3),

    CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitacaoRelatorio" (
    "id" TEXT NOT NULL,
    "parceiroId" TEXT,
    "usuarioId" TEXT,
    "tipoRelatorio" "TipoRelatorio" NOT NULL,
    "parametros" JSONB NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'PENDENTE',
    "jobIdFila" TEXT,
    "resultUrl" TEXT,
    "erroMensagem" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "chaveIdempotencia" TEXT,

    CONSTRAINT "SolicitacaoRelatorio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricoStatusLote_loteId_timestamp_idx" ON "HistoricoStatusLote"("loteId", "timestamp");

-- CreateIndex
CREATE INDEX "HistoricoStatusLote_statusNovo_timestamp_idx" ON "HistoricoStatusLote"("statusNovo", "timestamp");

-- CreateIndex
CREATE INDEX "HistoricoStatusLote_responsavelId_idx" ON "HistoricoStatusLote"("responsavelId");

-- CreateIndex
CREATE INDEX "HistoricoEstadoFisico_equipamentoId_timestamp_idx" ON "HistoricoEstadoFisico"("equipamentoId", "timestamp");

-- CreateIndex
CREATE INDEX "HistoricoEstadoFisico_estadoNovo_timestamp_idx" ON "HistoricoEstadoFisico"("estadoNovo", "timestamp");

-- CreateIndex
CREATE INDEX "HistoricoEstadoFisico_responsavelId_idx" ON "HistoricoEstadoFisico"("responsavelId");

-- CreateIndex
CREATE INDEX "PrevisaoVidaUtil_tipoEquipamento_marca_modelo_dataPrevisao_idx" ON "PrevisaoVidaUtil"("tipoEquipamento", "marca", "modelo", "dataPrevisao");

-- CreateIndex
CREATE INDEX "ValidacaoPrevisao_previsaoId_idx" ON "ValidacaoPrevisao"("previsaoId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidacaoPrevisao_previsaoId_equipamentoId_key" ON "ValidacaoPrevisao"("previsaoId", "equipamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_chaveHash_key" ON "ChaveApi"("chaveHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChaveApi_prefixo_key" ON "ChaveApi"("prefixo");

-- CreateIndex
CREATE INDEX "ChaveApi_parceiroId_idx" ON "ChaveApi"("parceiroId");

-- CreateIndex
CREATE INDEX "SolicitacaoRelatorio_parceiroId_status_idx" ON "SolicitacaoRelatorio"("parceiroId", "status");

-- CreateIndex
CREATE INDEX "SolicitacaoRelatorio_usuarioId_status_idx" ON "SolicitacaoRelatorio"("usuarioId", "status");

-- CreateIndex
CREATE INDEX "SolicitacaoRelatorio_status_criadoEm_idx" ON "SolicitacaoRelatorio"("status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitacaoRelatorio_parceiroId_chaveIdempotencia_key" ON "SolicitacaoRelatorio"("parceiroId", "chaveIdempotencia");

-- CreateIndex
CREATE INDEX "Equipamento_tipo_marca_modelo_idx" ON "Equipamento"("tipo", "marca", "modelo");

-- CreateIndex
CREATE INDEX "Movimentacao_destino_dataHora_idx" ON "Movimentacao"("destino", "dataHora");

-- CreateIndex
CREATE INDEX "Movimentacao_responsavelId_idx" ON "Movimentacao"("responsavelId");

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoStatusLote" ADD CONSTRAINT "HistoricoStatusLote_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoStatusLote" ADD CONSTRAINT "HistoricoStatusLote_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoEstadoFisico" ADD CONSTRAINT "HistoricoEstadoFisico_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoEstadoFisico" ADD CONSTRAINT "HistoricoEstadoFisico_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoVidaUtil" ADD CONSTRAINT "PrevisaoVidaUtil_solicitacaoRelatorioId_fkey" FOREIGN KEY ("solicitacaoRelatorioId") REFERENCES "SolicitacaoRelatorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidacaoPrevisao" ADD CONSTRAINT "ValidacaoPrevisao_previsaoId_fkey" FOREIGN KEY ("previsaoId") REFERENCES "PrevisaoVidaUtil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidacaoPrevisao" ADD CONSTRAINT "ValidacaoPrevisao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "ParceiroApi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoRelatorio" ADD CONSTRAINT "SolicitacaoRelatorio_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "ParceiroApi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoRelatorio" ADD CONSTRAINT "SolicitacaoRelatorio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
