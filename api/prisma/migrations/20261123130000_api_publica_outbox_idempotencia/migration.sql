CREATE TYPE "StatusOutboxRelatorio" AS ENUM ('PENDENTE', 'PUBLICADO');

ALTER TABLE "ParceiroApi" ADD COLUMN "organizacaoId" TEXT;
UPDATE "ParceiroApi"
SET "organizacaoId" = (SELECT "id" FROM "Organizacao" ORDER BY "id" LIMIT 1)
WHERE "organizacaoId" IS NULL;
ALTER TABLE "ParceiroApi" ALTER COLUMN "organizacaoId" SET NOT NULL;
ALTER TABLE "ParceiroApi"
ADD CONSTRAINT "ParceiroApi_organizacaoId_fkey"
FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "IdempotenciaApi" (
    "id" TEXT NOT NULL,
    "parceiroId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "resposta" JSONB NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotenciaApi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxRelatorio" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "status" "StatusOutboxRelatorio" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicadoEm" TIMESTAMP(3),
    CONSTRAINT "OutboxRelatorio_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SolicitacaoRelatorio" ADD COLUMN "resultado" JSONB;

CREATE UNIQUE INDEX "IdempotenciaApi_parceiroId_chave_key" ON "IdempotenciaApi"("parceiroId", "chave");
CREATE INDEX "IdempotenciaApi_criadaEm_idx" ON "IdempotenciaApi"("criadaEm");
CREATE UNIQUE INDEX "OutboxRelatorio_solicitacaoId_key" ON "OutboxRelatorio"("solicitacaoId");
CREATE INDEX "OutboxRelatorio_status_criadoEm_idx" ON "OutboxRelatorio"("status", "criadoEm");

ALTER TABLE "IdempotenciaApi"
ADD CONSTRAINT "IdempotenciaApi_parceiroId_fkey"
FOREIGN KEY ("parceiroId") REFERENCES "ParceiroApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboxRelatorio"
ADD CONSTRAINT "OutboxRelatorio_solicitacaoId_fkey"
FOREIGN KEY ("solicitacaoId") REFERENCES "SolicitacaoRelatorio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
