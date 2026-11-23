import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcPath = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: srcPath },
      { find: /^@infra\//, replacement: `${srcPath}infrastructure/` },
      { find: /^@domain\//, replacement: `${srcPath}domain/` },
      { find: /^@autenticacao\//, replacement: `${srcPath}modules/autenticacao/` },
      { find: /^@configuracao\//, replacement: `${srcPath}modules/configuracao/` },
      { find: /^@contrato\//, replacement: `${srcPath}modules/contrato/` },
      { find: /^@equipamento\//, replacement: `${srcPath}modules/equipamento/` },
      { find: /^@journal\//, replacement: `${srcPath}modules/journal/` },
      { find: /^@lote\//, replacement: `${srcPath}modules/lote/` },
      { find: /^@organizacao\//, replacement: `${srcPath}modules/organizacao/` },
      { find: /^@relatorio\//, replacement: `${srcPath}modules/relatorio/` },
      { find: /^@usuario\//, replacement: `${srcPath}modules/usuario/` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
