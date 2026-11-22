-- CreateEnum
CREATE TYPE "MetricaAnalise" AS ENUM ('EFICIENCIA_TEMPO_MEDIO_TRIAGEM_HORAS', 'EFICIENCIA_LOTES_CONCLUIDOS', 'EFICIENCIA_LOTES_PENDENTES', 'RECUPERACAO_MEDIA_BRUTA', 'RECUPERACAO_AMOSTRAS', 'VIDA_UTIL_INCLINACAO', 'VIDA_UTIL_INTERCEPTO', 'VIDA_UTIL_R2', 'VIDA_UTIL_PREVISTA_MESES', 'VIDA_UTIL_AMOSTRAS');

-- AlterTable
ALTER TABLE "PrevisaoVidaUtil" ADD COLUMN     "execucaoAnaliseId" TEXT;

-- CreateTable
CREATE TABLE "ExecucaoAnalise" (
    "id" TEXT NOT NULL,
    "tipoRelatorio" "TipoRelatorio" NOT NULL,
    "parametros" JSONB NOT NULL,
    "versaoCalculo" TEXT NOT NULL,
    "dataReferencia" TIMESTAMP(3) NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecucaoAnalise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultadoAnalise" (
    "id" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "metrica" "MetricaAnalise" NOT NULL,
    "chave" TEXT NOT NULL DEFAULT '',
    "valor" DECIMAL(14,4) NOT NULL,
    "amostras" INTEGER NOT NULL,

    CONSTRAINT "ResultadoAnalise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecucaoAnalise_tipoRelatorio_criadaEm_idx" ON "ExecucaoAnalise"("tipoRelatorio", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "ResultadoAnalise_execucaoId_metrica_chave_key" ON "ResultadoAnalise"("execucaoId", "metrica", "chave");

-- AddForeignKey
ALTER TABLE "ResultadoAnalise" ADD CONSTRAINT "ResultadoAnalise_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoAnalise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrevisaoVidaUtil" ADD CONSTRAINT "PrevisaoVidaUtil_execucaoAnaliseId_fkey" FOREIGN KEY ("execucaoAnaliseId") REFERENCES "ExecucaoAnalise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
