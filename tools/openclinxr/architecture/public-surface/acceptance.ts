import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/runner.js";
import { acceptanceSelfTest } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/acceptance-criteria.js";
import { selfTest } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/gates.js";
import { workspaceRoot } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.js";

/**
 * `pnpm arch:public-surface:acceptance` — independent closure check (PSR-00B).
 * Thin wrapper: criteria 3/4/5/6/12 live in acceptance-criteria.ts via runner.ts.
 * `--self-test` proves gates and acceptance fail closed (absent, unapplied, empty,
 * leftover wildcards). Writes only with an explicit --report / --report-out flag.
 */
function repoRoot(): string {
  try {
    return workspaceRoot();
  } catch {
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
}

const root = repoRoot();
const args = process.argv.slice(2);

if (args.includes("--self-test")) {
  const results = [...selfTest(root), ...acceptanceSelfTest()];
  let failed = 0;
  for (const result of results) {
    console.log(`${result.ok ? "ok(fails-closed)" : "UNEXPECTED-OK"}: ${result.detail}`);
    if (!result.ok) failed += 1;
  }
  if (failed > 0) {
    console.error("acceptance self-test FAILED: a gate passed on real or fixture input it must refuse");
    process.exit(1);
  }
  console.log("acceptance self-test passed: gates fail closed on absent, unapplied, empty, wildcard, and unreviewed C6 exceptions");
  process.exit(0);
}

const outcome = runAcceptance({
  root,
  args,
  io: {
    readBaseline: () => undefined,
    writeFile: (rel: string, bytes: string) => {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    },
  },
});
for (const line of outcome.lines) console.log(line);
if (outcome.failed) process.exit(1);
