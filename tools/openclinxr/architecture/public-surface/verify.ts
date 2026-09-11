import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerify } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/runner.js";
import { workspaceRoot } from "../../../../packages/openclinxr-verification/architecture-rules/src/checks/public-surface/resolve.js";

/**
 * `pnpm arch:public-surface:verify` — compiler-derived package surface verifier (PSR-00).
 * Thin wrapper: flag parsing and exit codes live here, measurement and gates in runner.ts.
 * Read-only by default; only --write-baseline writes baseline.json. Approved contract
 * manifests are read-only inputs.
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
const outcome = runVerify({
  root,
  args: process.argv.slice(2),
  io: {
    readBaseline: () => {
      const full = join(root, "docs/openclinxr/package-public-surface-reduction/baseline.json");
      if (!existsSync(full)) return undefined;
      try {
        return JSON.parse(readFileSync(full, "utf8")) as { totals?: Record<string, number> };
      } catch {
        return undefined;
      }
    },
    writeFile: (rel: string, bytes: string) => {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, bytes);
    },
  },
});
for (const line of outcome.lines) console.log(line);
if (outcome.failed) {
  console.error("public-surface verify FAILED: one or more required gates failed");
  process.exit(1);
}
