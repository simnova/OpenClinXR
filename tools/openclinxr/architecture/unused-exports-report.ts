import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unusedEntrypointExports } from "../../../packages/openclinxr-verification/architecture-rules/src/checks/unused-entrypoint-exports.ts";

/**
 * `pnpm arch:unused-exports [package]` — where to look when shrinking an entrypoint.
 *
 * This is a MARKER CHECK over identifier names, not proof. Removing an export is proved by
 * `pnpm packages:typecheck:agent`: a real consumer fails the build. See
 * checks/unused-entrypoint-exports.ts for the two ways a name search is wrong in each direction.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const only = process.argv[2];
const reports = unusedEntrypointExports(repoRoot());
const shown = only === undefined ? reports : reports.filter((r) => r.pkg === only);
if (shown.length === 0 && only !== undefined) {
  console.error(`no package "${only}" publishes a src/index.ts`);
  process.exit(1);
}

const publishedTotal = reports.reduce((sum, r) => sum + r.published, 0);
const unusedTotal = reports.reduce((sum, r) => sum + r.unreferencedOutside.length, 0);
console.log(
  `${reports.length} packages publish ${publishedTotal} symbols; `
  + `${unusedTotal} are referenced by no file outside their own package `
  + `(${Math.round((100 * unusedTotal) / Math.max(publishedTotal, 1))}%).`,
);
console.log("MARKER CHECK over identifier names. Proof is pnpm packages:typecheck:agent.\n");

for (const report of shown) {
  if (report.unreferencedOutside.length === 0) continue;
  console.log(
    `${report.pkg}: ${report.unreferencedOutside.length} of ${report.published} unreferenced outside`,
  );
  if (only !== undefined) {
    for (const symbol of report.unreferencedOutside) console.log(`  ${symbol}`);
  }
}
