import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

type UiXrPackageJson = {
  name: string;
  version: string;
};

export type OpenClinXrXrAppMetadata = {
  packageName: string;
  version: string;
  gitCommit: string;
  buildTime: string;
  mode: string;
};

const uiXrPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as UiXrPackageJson;

export const openClinXrXrBuildOutput = Object.freeze({
  codeSplitting: {
    groups: [
      {
        name: "three-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?three/,
        priority: 20,
      },
      {
        name: "vendor",
        test: /node_modules/,
        priority: 10,
      },
    ],
  },
});

export const openClinXrXrChunkSizeWarningLimitKb = 600;

export function resolveOpenClinXrXrGitCommit(): string {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export function createOpenClinXrXrAppMetadata(mode: string): OpenClinXrXrAppMetadata {
  return {
    packageName: uiXrPackage.name,
    version: uiXrPackage.version,
    gitCommit: process.env.OPENCLINXR_BUILD_COMMIT ?? resolveOpenClinXrXrGitCommit(),
    buildTime: process.env.OPENCLINXR_BUILD_TIME ?? new Date().toISOString(),
    mode,
  };
}

export default defineConfig(({ mode }) => {
  const appMetadata = createOpenClinXrXrAppMetadata(mode);

  return {
    define: {
      __OPENCLINXR_UI_XR_APP_METADATA__: JSON.stringify(appMetadata),
    },
    build: {
      chunkSizeWarningLimit: openClinXrXrChunkSizeWarningLimitKb,
      rolldownOptions: {
        output: openClinXrXrBuildOutput,
      },
    },
  };
});
