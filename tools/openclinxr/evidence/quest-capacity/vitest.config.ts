import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["cli.test.ts", "secure.test.ts", "secure-build-identity.test.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
