import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createOpenClinXrXrAppMetadata,
  isOpenClinXrCapacityFingerprintInput,
  openClinXrCapacityFingerprintPlugin,
  openClinXrXrBuildOutput,
  openClinXrXrChunkSizeWarningLimitKb,
  resolveOpenClinXrCapacitySourceHash,
} from "./vite.config.js";

function withCapacitySource(run: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "capacity-vite-"));
  const files = ["packages/openclinxr/xr-capacity/src/index.ts", "packages/openclinxr/xr-capacity/dist/index.js", "packages/openclinxr/xr-capacity/package.json", "packages/openclinxr/xr-capacity/tsconfig.json", "packages/cellix/config-typescript/tsconfig.base.json", "apps/ui-xr/index.html", "apps/ui-xr/package.json", "apps/ui-xr/vite.config.ts", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), `${file}\n`); }
  return Promise.resolve().then(() => run(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

describe("XR Vite build configuration", () => {
  it("splits Three.js into a stable vendor chunk with an explicit XR warning budget", () => {
    expect(openClinXrXrBuildOutput.codeSplitting).toMatchObject({
      groups: [
        { name: "three-vendor", priority: 20 },
        { name: "vendor", priority: 10 },
      ],
    });
    expect(openClinXrXrChunkSizeWarningLimitKb).toBe(600);
  });

  it("injects package and build metadata for copied Quest evidence", () => {
    const metadata = createOpenClinXrXrAppMetadata("test");

    expect(metadata.packageName).toBe("@openclinxr/ui-xr");
    expect(metadata.version).toBe("0.1.0");
    expect(metadata.gitCommit).toMatch(/^[a-f0-9]{7,12}$|^unknown$/);
    expect(new Date(metadata.buildTime).toISOString()).toBe(metadata.buildTime);
    expect(metadata.mode).toBe("test");
    expect(metadata.capacitySourceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes identity for dirty harness source and dependency pins, excluding tests and timestamps", async () => {
    await withCapacitySource((root) => {
      const initial = resolveOpenClinXrCapacitySourceHash(root);
      expect(resolveOpenClinXrCapacitySourceHash(root)).toBe(initial);
      const test = join(root, "packages/openclinxr/xr-capacity/src/example.test.ts");
      writeFileSync(test, "unmeasured test fixture");
      expect(isOpenClinXrCapacityFingerprintInput(test, root)).toBe(false);
      expect(resolveOpenClinXrCapacitySourceHash(root)).toBe(initial);
      writeFileSync(join(root, "packages/openclinxr/xr-capacity/src/index.ts"), "export const changed = true;\n");
      const dirty = resolveOpenClinXrCapacitySourceHash(root);
      expect(dirty).not.toBe(initial);
      writeFileSync(join(root, "pnpm-lock.yaml"), "changed pin\n");
      const pinned = resolveOpenClinXrCapacitySourceHash(root);
      expect(pinned).not.toBe(dirty);
      writeFileSync(join(root, "packages/openclinxr/xr-capacity/dist/index.js"), "executed distribution changed\n");
      expect(resolveOpenClinXrCapacitySourceHash(root)).not.toBe(pinned);
    });
  });

  it("restarts only for a changed fingerprint input and removes its watcher on close", async () => {
    await withCapacitySource(async (root) => {
      vi.useFakeTimers();
      try {
        const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
        const httpServer = new EventEmitter();
        const restart = vi.fn(async () => undefined);
        const rebuild = vi.fn(() => {
          const distribution = join(root, "packages/openclinxr/xr-capacity/dist/index.js");
          writeFileSync(distribution, "compiled revision 2;\n");
          watcher.emit("all", "change", distribution);
        });
        const server = { watcher, httpServer, restart, config: { logger: { error: vi.fn() } } };
        const configure = openClinXrCapacityFingerprintPlugin(root, rebuild).configureServer;
        if (typeof configure !== "function") throw new Error("Missing scoped watcher");
        configure.call({} as never, server as never);
        const source = join(root, "packages/openclinxr/xr-capacity/src/index.ts");
        watcher.emit("all", "change", source);
        watcher.emit("all", "change", source.replace("index.ts", "index.test.ts"));
        await vi.advanceTimersByTimeAsync(60);
        expect(restart).not.toHaveBeenCalled();
        expect(rebuild).not.toHaveBeenCalled();
        writeFileSync(source, "export const revision = 2;\n");
        watcher.emit("all", "change", source);
        await vi.advanceTimersByTimeAsync(60);
        expect(restart).toHaveBeenCalledTimes(1);
        expect(rebuild).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60);
        expect(restart, "the rebuild's own distribution events must not restart again").toHaveBeenCalledTimes(1);
        expect(rebuild).toHaveBeenCalledTimes(1);
        httpServer.emit("close");
        expect(watcher.listenerCount("all")).toBe(0);
      } finally { vi.useRealTimers(); }
    });
  });
});
