import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenClinXrAzureFunctionsRolldownConfig } from "@openclinxr/config-rolldown";
import { defineConfig } from "rolldown";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineConfig(async () =>
  createOpenClinXrAzureFunctionsRolldownConfig({
    repoRoot,
    appPackageName: "@openclinxr/api",
    input: "./src/index.ts",
  }),
);
