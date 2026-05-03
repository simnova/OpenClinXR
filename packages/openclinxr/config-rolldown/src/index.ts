import type { RolldownOptions } from "rolldown";

export type OpenClinXrRolldownConfig = {
  input: string;
  platform: "node";
  treeshake: true;
  external: Array<string | RegExp>;
  resolve: {
    alias: Record<string, string>;
  };
  transform: {
    define: {
      __dirname: "import.meta.dirname";
    };
  };
  output: {
    dir: string;
    format: "esm";
    sourcemap: true;
    banner: string;
  };
} & RolldownOptions;

export type OpenClinXrRolldownConfigOptions = {
  repoRoot: string;
  appPackageName: "@openclinxr/api";
  input?: string;
  outputDir?: string;
  additionalExternal?: string[];
};

const azureFunctionsRequireBanner = `import { createRequire as __createRequire } from 'node:module';
globalThis.require = __createRequire(import.meta.url);`;

export function createOpenClinXrAzureFunctionsRolldownConfig(
  options: OpenClinXrRolldownConfigOptions,
): OpenClinXrRolldownConfig {
  const {
    repoRoot,
    appPackageName,
    input = "./dist/index.js",
    outputDir = "deploy/dist",
    additionalExternal = [],
  } = options;

  return {
    input,
    platform: "node",
    treeshake: true,
    external: [/^node:/, "@azure/functions-core", ...additionalExternal],
    resolve: {
      alias: {
        [appPackageName]: `${repoRoot}/apps/api/dist/index.js`,
      },
    },
    transform: {
      define: {
        __dirname: "import.meta.dirname",
      },
    },
    output: {
      dir: outputDir,
      format: "esm",
      sourcemap: true,
      banner: azureFunctionsRequireBanner,
    },
  };
}

export function summarizeRolldownAdoption() {
  return {
    candidateCellixPackage: "@cellix/config-rolldown",
    localPackage: "@openclinxr/config-rolldown",
    status: "local_compatibility_spike",
    reason:
      "Cellix config-rolldown is useful, but OpenClinXR needs a verified package layout and latest Rolldown compatibility before vendoring Cellix-derived code.",
  } as const;
}
