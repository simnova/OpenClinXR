import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
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
  capacitySourceHash: string;
};

const uiXrPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as UiXrPackageJson;
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const capacitySourceRoot = "packages/openclinxr/xr-capacity/src";
const capacityDistributionRoot = "packages/openclinxr/xr-capacity/dist";
const capacityMetadataInputs = ["packages/openclinxr/xr-capacity/package.json", "packages/openclinxr/xr-capacity/tsconfig.json", "packages/cellix/config-typescript/tsconfig.base.json", "apps/ui-xr/index.html", "apps/ui-xr/package.json", "apps/ui-xr/vite.config.ts", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

export function isOpenClinXrCapacityFingerprintInput(file: string, root = workspaceRoot): boolean {
  const path = relative(root, resolve(file)).replaceAll("\\", "/");
  return capacityMetadataInputs.includes(path) || path.startsWith(`${capacityDistributionRoot}/`) && path.endsWith(".js") || (path.startsWith(`${capacitySourceRoot}/`) && path.endsWith(".ts") && !/(?:\.test|\.spec)\.ts$|(?:^|\/)__tests__\//.test(path));
}

/** Content identity includes dirty source and dependency pins; timestamps never enter it. */
export function resolveOpenClinXrCapacitySourceHash(root = workspaceRoot): string {
  const sourceFiles: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && isOpenClinXrCapacityFingerprintInput(file, root)) sourceFiles.push(relative(root, file).replaceAll("\\", "/"));
      if (sourceFiles.length > 1024) throw new Error("Capacity fingerprint exceeds 1024 files");
    }
  };
  visit(join(root, capacitySourceRoot));
  visit(join(root, capacityDistributionRoot));
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of [...sourceFiles, ...capacityMetadataInputs].sort()) {
    const body = readFileSync(join(root, path)); bytes += body.length;
    if (bytes > 8 * 1024 * 1024) throw new Error("Capacity fingerprint exceeds 8 MiB of source inputs");
    hash.update(path).update("\0").update(body).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** A scoped source change restarts Vite so its compile-time identity cannot remain stale. */
function buildCapacityPackage(root: string): void {
  execFileSync("pnpm", ["--filter", "@openclinxr/xr-capacity", "build"], { cwd: root, stdio: "pipe", timeout: 30000 });
}

export function openClinXrCapacityFingerprintPlugin(root = workspaceRoot, rebuild = () => buildCapacityPackage(root)): Plugin {
  return {
    name: "openclinxr-capacity-fingerprint",
    configureServer(server) {
      let previous = resolveOpenClinXrCapacitySourceHash(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const restart = () => { void server.restart().catch((error: unknown) => server.config.logger.error(`Capacity fingerprint restart failed: ${String(error)}`)); };
      const onFile = (_event: string, file: string) => {
        if (!isOpenClinXrCapacityFingerprintInput(file, root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          let current: string;
          try { current = resolveOpenClinXrCapacitySourceHash(root); }
          catch (error) { server.config.logger.error(`Capacity fingerprint unavailable: ${String(error)}`); restart(); return; }
          if (current === previous) return;
          try { rebuild(); }
          catch (error) { server.config.logger.error(`Capacity package rebuild failed: ${String(error)}`); return; }
          previous = resolveOpenClinXrCapacitySourceHash(root);
          restart();
        }, 50);
      };
      server.watcher.add([join(root, capacitySourceRoot), join(root, capacityDistributionRoot), ...capacityMetadataInputs.map((path) => join(root, path))]);
      server.watcher.on("all", onFile);
      server.httpServer?.once("close", () => { if (timer) clearTimeout(timer); server.watcher.off("all", onFile); });
    },
  };
}

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
    gitCommit: process.env['OPENCLINXR_BUILD_COMMIT'] ?? resolveOpenClinXrXrGitCommit(),
    buildTime: process.env['OPENCLINXR_BUILD_TIME'] ?? new Date().toISOString(),
    mode,
    capacitySourceHash: resolveOpenClinXrCapacitySourceHash(),
  };
}

export default defineConfig(({ mode }) => {
  buildCapacityPackage(workspaceRoot);
  const appMetadata = createOpenClinXrXrAppMetadata(mode);

  return {
    plugins: [openClinXrCapacityFingerprintPlugin(), {
      name: "capacity-runtime-build-identity",
      transformIndexHtml: () => [{ tag: "script", attrs: { id: "capacity-app-metadata", type: "application/json" }, children: JSON.stringify({ gitCommit: appMetadata.gitCommit, capacitySourceHash: appMetadata.capacitySourceHash }).replaceAll("<", "\\u003c"), injectTo: "head" }],
    }, ...(process.env['OPENCLINXR_CAPACITY_TLS_PROXY'] === "1" ? [{ name: "capacity-tls-fixture-no-hmr-client", transformIndexHtml: { order: "post" as const, handler: (html: string) => html.replace(/<script type="module" src="\/@vite\/client"><\/script>/g, "") } }] : [])],
    // The local TLS fixture proxies HTTP assets; it intentionally owns no Vite HMR socket.
    server: process.env['OPENCLINXR_CAPACITY_TLS_PROXY'] === "1" ? { hmr: false, ws: false } : {},
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
