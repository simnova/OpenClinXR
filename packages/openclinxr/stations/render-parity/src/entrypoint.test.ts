import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCaptureArgs, resolveLevers, runRuntimeCapture } from "./index.js";
import type { CaptureCli } from "./index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from src to the dir holding package.json. */
function packageRoot(): string {
  let dir = HERE;
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("package root not found — refusing");
    dir = parent;
  }
}

describe("entrypoint: the thin-CLI + dist contract", () => {
  it("publishes parse/run/types and resolves presets through the entrypoint", async () => {
    expect(typeof parseCaptureArgs).toBe("function");
    expect(typeof runRuntimeCapture).toBe("function");
    const { name, levers } = await resolveLevers("p2b-e2");
    expect(name).toBe("p2b-e2");
    expect(levers["exposure"]).toBe(0.87);
    const cli: CaptureCli = parseCaptureArgs([
      "--cameras",
      "cameras.json",
      "--out",
      "E/check",
      "--levers",
      "p2b-e2",
    ]);
    expect(cli.levers).toBe("p2b-e2");
  });

  it("pack ships dist + presets + non-test drivers; the packed dist resolves p2b-e2", async () => {
    const root = packageRoot();
    const work = path.join(root, ".pack-test");
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      if (!existsSync(path.join(root, "dist", "index.js"))) {
        execSync("pnpm build", { cwd: root, stdio: "pipe", timeout: 300_000 });
      }
      execSync(`pnpm pack --pack-destination ${work}`, { cwd: root, stdio: "pipe", timeout: 300_000 });
      const tgz = readdirSync(work).find((f) => f.endsWith(".tgz"));
      expect(tgz).toBeDefined();
      execSync(`tar -xzf ${path.join(work, tgz!)} -C ${work}`, { stdio: "pipe", timeout: 120_000 });
      const pkgDir = path.join(work, "package");
      const loadPacked = async () =>
        (await import(pathToFileURL(path.join(pkgDir, "dist", "index.js")).href)) as {
          resolveLevers: (spec: string) => Promise<{ name: string; levers: Record<string, unknown> }>;
        };
      const loadPackedArgs = async () =>
        (await import(pathToFileURL(path.join(pkgDir, "dist", "capture-args.js")).href)) as {
          driversDir: () => string;
          captureArgsModuleUrl: string;
        };
      let mod = await loadPacked();
      let modArgs = await loadPackedArgs();
      if (typeof modArgs.captureArgsModuleUrl !== "string") {
        // Stale dist predates the marker export: rebuild, repack, reload.
        execSync("pnpm build", { cwd: root, stdio: "pipe", timeout: 300_000 });
        rmSync(work, { recursive: true, force: true });
        mkdirSync(work, { recursive: true });
        execSync(`pnpm pack --pack-destination ${work}`, { cwd: root, stdio: "pipe", timeout: 300_000 });
        const tgz2 = readdirSync(work).find((f) => f.endsWith(".tgz"));
        execSync(`tar -xzf ${path.join(work, tgz2!)} -C ${work}`, { stdio: "pipe", timeout: 120_000 });
        mod = await loadPacked();
        modArgs = await loadPackedArgs();
      }
      // Counterweight: the import must resolve inside the extract, never to repo src.
      expect(pathToFileURL(pkgDir).href).toContain(".pack-test");
      expect(modArgs.captureArgsModuleUrl).toContain(".pack-test");
      expect(modArgs.captureArgsModuleUrl).toContain(".pack-test/package/dist/");
      const { name, levers } = await mod.resolveLevers("p2b-e2");
      expect(name).toBe("p2b-e2");
      expect(levers["exposure"]).toBe(0.87);
      const drivers = modArgs.driversDir();
      expect(drivers.startsWith(pkgDir)).toBe(true);
      expect(existsSync(path.join(drivers, "compare.py"))).toBe(true);
      expect(existsSync(path.join(drivers, "eye_detail_test.py"))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 300_000);
});
