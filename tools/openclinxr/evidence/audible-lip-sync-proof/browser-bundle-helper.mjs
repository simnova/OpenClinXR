import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Bundle a browser control entry with the declared Vite API only.
 * No Bun, no new deps. Entry + output live under one unique temp dir;
 * caller must finally dispose. Three resolves from the real checkout
 * via createRequire(import.meta.url); the entry itself lives in the
 * unique temp dir under OPENCLINXR_JOB_TMP. */
export async function buildBrowserControlBundle(sourceText) {
  const { build } = await import("vite");
  const { createRequire } = await import("node:module");
  const threeEntry = createRequire(import.meta.url).resolve("three");
  const jobTmp = process.env.OPENCLINXR_JOB_TMP || join(tmpdir(), "openclinxr-job-fallback");
  const root = join(jobTmp, `audible-vite-${process.pid}-${randomUUID()}`);
  const entry = join(root, "control.js");
  const outDir = join(root, "dist");
  mkdirSync(root, { recursive: true });
  writeFileSync(entry, sourceText, "utf8");
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      resolve: { alias: [{ find: /^three$/, replacement: threeEntry }] },
      build: {
        outDir,
        emptyOutDir: true,
        write: true,
        minify: false,
        lib: { entry, formats: ["iife"], name: "audibleControl", fileName: () => "control.bundle.js" },
      },
    });
    return { code: readFileSync(join(outDir, "control.bundle.js"), "utf8"), dispose: () => rmSync(root, { recursive: true, force: true }) };
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
}
