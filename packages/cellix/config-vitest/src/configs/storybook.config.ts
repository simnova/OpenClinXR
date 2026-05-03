import path from "node:path";
import { mergeConfig, type Plugin, type ViteUserConfig } from "vitest/config";
import { baseConfig, createDefaultTypecheckConfig, defaultTestIncludePatterns } from "./base.config.js";

export type StorybookVitestConfigOptions = {
  storybookDirRelativeToPackage?: string;
  setupFiles?: string[];
  browsers?: { browser: "chromium" | "firefox" | "webkit" }[];
  additionalCoverageExclude?: string[];
};

type StorybookTestPluginFactory = (options: { configDir: string }) => Plugin | Plugin[];
type BrowserProviderFactory = () => unknown;
type DynamicImporter = <TModule>(specifier: string) => Promise<TModule>;

type StorybookPluginModule = {
  storybookTest: StorybookTestPluginFactory;
};

type BrowserPlaywrightModule = {
  playwright: BrowserProviderFactory;
};

const defaultDynamicImport: DynamicImporter = async <TModule>(specifier: string) => {
  const importModule = new Function("specifier", "return import(specifier)") as DynamicImporter;
  return importModule<TModule>(specifier);
};

export function getStorybookBrowserApiPort(pkgDirname: string): number {
  const hash = Array.from(pkgDirname).reduce((total, char) => {
    return (total * 31 + (char.codePointAt(0) ?? 0)) % 1000;
  }, 0);

  return 64000 + hash;
}

export async function createStorybookVitestConfig(
  pkgDirname: string,
  opts: StorybookVitestConfigOptions = {},
  importModule: DynamicImporter = defaultDynamicImport,
): Promise<ViteUserConfig> {
  const [storybookModule, playwrightModule] = await Promise.all([
    importOptionalStorybookModule(importModule),
    importOptionalBrowserPlaywrightModule(importModule),
  ]);
  const storybookDir = opts.storybookDirRelativeToPackage ?? ".storybook";
  const setupFiles = opts.setupFiles ?? [".storybook/vitest.setup.ts"];
  const instances = opts.browsers ?? [{ browser: "chromium" as const }];
  const browserApiPort = getStorybookBrowserApiPort(pkgDirname);

  return mergeConfig(baseConfig as ViteUserConfig, {
    test: {
      api: {
        host: "127.0.0.1",
        port: browserApiPort,
      },
      globals: true,
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            include: [...defaultTestIncludePatterns],
            environment: "jsdom",
            typecheck: createDefaultTypecheckConfig(),
          },
        },
        {
          extends: true,
          plugins: [
            storybookModule.storybookTest({
              configDir: path.join(pkgDirname, storybookDir),
            }),
          ],
          test: {
            name: "storybook",
            typecheck: {
              enabled: false,
            },
            browser: {
              enabled: true,
              headless: true,
              provider: playwrightModule.playwright(),
              instances,
            },
            setupFiles,
          },
        },
      ],
      coverage: {
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "**/*.config.ts",
          "**/tsconfig.json",
          "**/.storybook/**",
          "**/*.stories.ts",
          "**/*.stories.tsx",
          "**/*.test.ts",
          "**/*.test.tsx",
          "**/generated.ts",
          "**/generated.tsx",
          "**/coverage/**",
          "**/*.d.ts",
          "dist/**",
          ...(opts.additionalCoverageExclude ?? []),
        ],
      },
    },
  });
}

async function importOptionalStorybookModule(importModule: DynamicImporter): Promise<StorybookPluginModule> {
  try {
    return await importModule<StorybookPluginModule>("@storybook/addon-vitest/vitest-plugin");
  } catch (error) {
    throw createOptionalDependencyError("@storybook/addon-vitest", error);
  }
}

async function importOptionalBrowserPlaywrightModule(importModule: DynamicImporter): Promise<BrowserPlaywrightModule> {
  try {
    return await importModule<BrowserPlaywrightModule>("@vitest/browser-playwright");
  } catch (error) {
    throw createOptionalDependencyError("@vitest/browser-playwright", error);
  }
}

function createOptionalDependencyError(packageName: string, cause: unknown): Error {
  return new Error(
    `Storybook browser Vitest config requires optional package ${packageName}. Install @storybook/addon-vitest, @vitest/browser-playwright, playwright, and storybook before calling createStorybookVitestConfig.`,
    { cause },
  );
}
