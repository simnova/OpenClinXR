/**
 * worktree-prune-cli — issue #367.
 *
 * Produces a classified prune plan for every registered worktree. --dry-run is the
 * default and writes the plan artifact; removal is opt-in via --apply --yes.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/openclaw/worktree-prune-cli.ts [--dry-run] [--json]
 *       [--output <path>] [--with-sizes]
 *   pnpm exec tsx tools/openclinxr/openclaw/worktree-prune-cli.ts --apply --yes [--output <path>]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyPrunePlan,
  buildPrunePlan,
  formatBytes,
  type PrunePlan,
  verifyPlanArithmetic,
} from "./worktree-prune.js";

export type CliFlags = {
  apply: boolean;
  yes: boolean;
  json: boolean;
  dryRun: boolean;
  withSizes: boolean;
  output: string;
};

export function parsePruneCliArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    apply: false,
    yes: false,
    json: false,
    dryRun: true,
    withSizes: false,
    output: ".openclinxr/evidence/issue-367/worktree-prune-plan.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      flags.apply = true;
      flags.dryRun = false;
    } else if (arg === "--yes") {
      flags.yes = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--dry-run") {
      flags.apply = false;
      flags.dryRun = true;
    } else if (arg === "--with-sizes") {
      flags.withSizes = true;
    } else if (arg === "--output" && argv[i + 1]) {
      flags.output = argv[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      flags.apply = false;
      flags.dryRun = true;
    }
  }
  return flags;
}

export function printHelp(): void {
  console.log(`worktree-prune — issue #367 safe-prune discriminator

Usage:
  pnpm exec tsx tools/openclinxr/openclaw/worktree-prune-cli.ts [--dry-run] [--json]
      [--output <path>] [--with-sizes]
  pnpm exec tsx tools/openclinxr/openclaw/worktree-prune-cli.ts --apply --yes

  --dry-run (default)  classify every registered worktree and write the plan artifact;
                       remove nothing.
  --apply --yes        opt-in removal: git worktree remove (no --force) for clean and
                       churn-only sets after reverting churn; git worktree prune for
                       missing-dir admin entries. Refuses when the plan is not
                       safeToRemove (drift vs issue #367 totals, or counterweight fail).
  --output <path>      plan artifact path (default .openclinxr/evidence/issue-367/
                       worktree-prune-plan.json, resolved against cwd).
  --with-sizes         measure grok-root and per-worktree sizes (slow).
  --json               print a compact machine summary to stdout.
`);
}

function writePlan(cwd: string, outputRel: string, plan: PrunePlan): string {
  const abs = path.resolve(cwd, outputRel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return abs;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const flags = parsePruneCliArgs(argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  const cwd = process.cwd();

  const plan = buildPrunePlan({ cwd, withSizes: flags.withSizes });
  const arithmeticProblems = verifyPlanArithmetic(plan);
  const planPath = writePlan(cwd, flags.output, plan);

  const printSummary = (): void => {
    const t = plan.totals;
    console.log(`worktree-prune plan: ${planPath}`);
    console.log(
      `registered=${t.registered}  clean=${t.clean}  churn_only=${t.churn_only}  ` +
        `has_work=${t.has_work}  unmerged=${t.unmerged}  missing=${t.missing}  ` +
        `(prunable=${t.prunable} preserved=${t.preserved})`,
    );
    if (arithmeticProblems.length > 0) {
      console.log(`ARITHMETIC PROBLEMS: ${arithmeticProblems.join("; ")}`);
    }
    if (plan.subagentClones.length > 0) {
      const bytes = plan.subagentClones.reduce((s, c) => s + c.sizeBytes, 0);
      console.log(`subagent-* clones (not worktrees, not removed): ${plan.subagentClones.length} ≈ ${formatBytes(bytes)}`);
    }
    if (plan.liveServers.length > 0) {
      console.log(
        `live servers: ${plan.liveServers
          .map((s) => `${path.basename(s.worktreePath)}:${s.pids.map((p) => p.port).join(",")}`)
          .join(" ")}`,
      );
    }
    console.log(
      `counterweight: issue-100 = ${String(plan.counterweight.issue100Classification)} ` +
        `(${plan.counterweight.passes ? "PASS" : "FAIL"})`,
    );
    console.log(`safeToRemove: ${plan.safeToRemove}`);
    if (!plan.safeToRemove) {
      console.log(
        `DRIFT: ${plan.drift.filter((d) => !d.matches).map((d) => `${d.bucket} expected=${d.expected} actual=${d.actual}`).join("; ")}`,
      );
    }
  };

  if (!flags.apply) {
    printSummary();
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            planPath,
            totals: plan.totals,
            safeToRemove: plan.safeToRemove,
            counterweight: plan.counterweight,
            drift: plan.drift.filter((d) => !d.matches),
            subagentClones: plan.subagentClones.length,
            liveServers: plan.liveServers.length,
          },
          null,
          2,
        ),
      );
    }
    return 0;
  }

  // --apply: opt-in removal.
  if (!flags.yes) {
    console.error("error: --apply requires --yes (destructive, irreversible)");
    return 2;
  }
  if (!plan.safeToRemove) {
    console.error("error: plan is not safe to apply — classification drift or counterweight failure");
    console.error(`plan: ${planPath}`);
    return 2;
  }
  if (arithmeticProblems.length > 0) {
    console.error(`error: plan arithmetic failed: ${arithmeticProblems.join("; ")}`);
    return 2;
  }

  const outcomes = applyPrunePlan(plan, { dryRun: false });
  const failures = outcomes.filter((o) => !o.ok);
  for (const o of outcomes) {
    console.log(`${o.ok ? "OK " : "FAIL"} ${o.action} ${o.path} — ${o.detail}`);
  }
  if (failures.length > 0) {
    console.error(`${failures.length} removal(s) failed (git refused or skip) — nothing forced.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main();
  process.exitCode = code;
}
