ALTER TABLE "SolicitacaoRelatorio"
  ADD COLUMN "processamentoIniciadoEm" TIMESTAMP(3),
  ADD COLUMN "ultimaTentativaIniciadaEm" TIMESTAMP(3),
  ADD COLUMN "duracaoProcessamentoMs" INTEGER NOT NULL DEFAULT 0;
