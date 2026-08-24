// Proves the spike's declared IWSDK packages EXECUTE in this workspace, consumed the way the
// runtime consumes them: dynamic import() resolved from the spike root — the same context Vite
// uses for main.ts:409-410 and src/uikitml-spatial-text.ts:115. CJS require() resolution is
// reported per specifier but is EXPECTED to fail for @iwsdk/core: 0.5.3 ships an ESM-only
// "exports" map (types + import, no require/default).
//
// Usage: node scripts/probe-iwsdk.mjs [out.json]
// Writes a JSON report ({ cwd, results }) to out.json, or pretty-prints to stdout.
// Exit 0 when every specifier imports; exit 1 when any import() fails.

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
