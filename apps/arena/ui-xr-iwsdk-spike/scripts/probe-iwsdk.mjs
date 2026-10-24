// Proves the spike's declared IWSDK packages EXECUTE in this workspace, consumed the way the
// runtime consumes them: dynamic import() resolved from the spike root — the same context Vite
// uses for main.ts:415-416 and src/uikitml-spatial-text.ts:115.
//
// LICENSED-PIN NOTE (2026-10-20, xr-systems-architect): the spike runs the licensed hold
// @iwsdk/core@0.4.2 / @iwsdk/xr-input@0.4.2 / @iwsdk/vite-plugin-dev@0.3.1 (see
// licenses/report.md: 0.5.x/1.0.1 carry unlicensed @drawcall/uikitml@0.1.8; 0.3.1 resolves
// sharp libvips 1.0.4 inside the approved set). Two measured 0.4.2 facts replace the 0.5.3
// comment that used to live here:
//   (a) 0.4.2 ships a CJS dist/index.js with NO "exports" map, so CJS require().resolve is
//       EXPECTED to succeed (0.5.3 was ESM-only and could not resolve via CJS at all).
//   (b) 0.4.2 REQUIRES DOM at import time: @iwsdk/xr-input/dist/pointer/cursor-visual.js:12
//       runs `document.createElement('canvas')` at module top level, so a bare-Node import()
//       honestly fails with `document is not defined`. The spike executes under Vite/browser
//       where document exists (build/typecheck green); the Node probe records the DOM reason,
//       it does not mock it.
//
// Usage: node scripts/probe-iwsdk.mjs [out.json]
// Writes a JSON report ({ cwd, results }) to out.json, or pretty-prints to stdout.
// Exit 0 when every specifier imports; exit 1 when any import() fails (expected on the
// licensed 0.4.2 pin under bare Node — see above).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const specifiers = ["@iwsdk/core", "@iwsdk/xr-input", "three"];
const requireFromSpike = createRequire(new URL("../package.json", import.meta.url));

const results = {};
for (const specifier of specifiers) {
  const row = {};
  try {
    row.cjsResolve = String(requireFromSpike.resolve(specifier));
  } catch (error) {
    row.cjsResolveError = error.code ?? String(error.message ?? error);
  }
  try {
    const imported = await import(specifier);
    row.imported = true;
    row.moduleKind = typeof imported;
    row.exportCount = Object.keys(imported).length;
    row.functionExportCount = Object.values(imported).filter((value) => typeof value === "function").length;
    if (typeof imported.VERSION === "string") {
      row.version = imported.VERSION;
    }
  } catch (error) {
    row.imported = false;
    row.importError = error.code ?? String(error.message ?? error);
  }
  results[specifier] = row;
}

const report = { cwd: process.cwd(), results };
const outPath = process.argv[2];
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = Object.values(results).some((row) => row.imported === false) ? 1 : 0;
