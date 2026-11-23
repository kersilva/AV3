-- Claim durável e fencing para impedir que workers concorrentes confirmem a mesma solicitação.
ALTER TABLE "SolicitacaoRelatorio"
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "claimVersion" INTEGER NOT NULL DEFAULT 0;

-- Uma solicitação pode ter no máximo uma execução analítica lógica.
ALTER TABLE "ExecucaoAnalise" ADD COLUMN "solicitacaoRelatorioId" TEXT;
CREATE UNIQUE INDEX "ExecucaoAnalise_solicitacaoRelatorioId_key"
  ON "ExecucaoAnalise"("solicitacaoRelatorioId");
ALTER TABLE "ExecucaoAnalise"
  ADD CONSTRAINT "ExecucaoAnalise_solicitacaoRelatorioId_fkey"
  FOREIGN KEY ("solicitacaoRelatorioId") REFERENCES "SolicitacaoRelatorio"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
