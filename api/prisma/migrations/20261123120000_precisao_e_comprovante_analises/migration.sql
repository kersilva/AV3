-- Preserve decimal precision from regression and validation calculations.
CREATE TYPE "NivelEstimativaRecuperacao" AS ENUM ('CORRESPONDENCIA_COMPLETA', 'TIPO_ESTADO');
ALTER TYPE "MetricaAnalise" ADD VALUE 'VIDA_UTIL_RESTANTE_MESES';

ALTER TABLE "PrevisaoVidaUtil"
ALTER COLUMN "vidaUtilEstimadaMeses" TYPE DECIMAL(10,2)
USING "vidaUtilEstimadaMeses"::DECIMAL(10,2);

ALTER TABLE "ValidacaoPrevisao"
ALTER COLUMN "idadeRealMeses" TYPE DECIMAL(10,2)
USING "idadeRealMeses"::DECIMAL(10,2),
ALTER COLUMN "erroAbsolutoMeses" TYPE DECIMAL(10,2)
USING "erroAbsolutoMeses"::DECIMAL(10,2);

ALTER TABLE "Equipamento"
ADD COLUMN "referenciaComprovante" TEXT,
ADD COLUMN "amostrasEstimativa" INTEGER,
ADD COLUMN "nivelEstimativa" "NivelEstimativaRecuperacao";
