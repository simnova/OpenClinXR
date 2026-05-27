import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type OpenClawReadinessFailure = {
  check: string;
  message: string;
};

export type OpenClawReadinessReport = {
  ok: boolean;
  branchLine: string;
  failures: OpenClawReadinessFailure[];
};

export function buildOpenClawReadinessReport(statusText: string): OpenClawReadinessReport {
  const lines = statusText.split(/\r?\n/u).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## ")) ?? "";
  const changedLines = lines.filter((line) => !line.startsWith("## "));
  const failures: OpenClawReadinessFailure[] = [];

  if (changedLines.length > 0) {
    failures.push({
      check: "worktree-clean",
      message: `worktree has ${changedLines.length} uncommitted path(s); classify/commit/prune before unattended OpenClaw work`,
    });
  }

  if (/\[.*\bbehind \d+/u.test(branchLine)) {
    failures.push({
      check: "upstream-current",
      message: "branch is behind upstream; fetch/merge before unattended OpenClaw work",
    });
  }

  if (/\[.*\bahead \d+/u.test(branchLine)) {
    failures.push({
      check: "upstream-published",
      message: "branch has unpushed commits; publish or intentionally switch to a branch before unattended OpenClaw work",
    });
  }

  if (!branchLine.includes("...")) {
    failures.push({
      check: "upstream-configured",
      message: "branch does not show an upstream tracking ref; configure upstream before unattended OpenClaw work",
    });
  }

  return {
    ok: failures.length === 0,
    branchLine,
    failures,
  };
}

function run(command: string, args: string[]): void {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--short", "--branch"], { encoding: "utf8" });
}

function fail(report: OpenClawReadinessReport): void {
  for (const failure of report.failures) {
    console.error(`${failure.check}: ${failure.message}`);
  }
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const initial = buildOpenClawReadinessReport(gitStatus());
  if (!initial.ok) {
    fail(initial);
    return;
  }

  run("pnpm", ["docs:authority"]);
  run("pnpm", ["docs:artifacts"]);
  run("pnpm", ["docs:drift-check"]);
  run("pnpm", ["agent:alignment"]);
  run("pnpm", ["openclaw:post-slice"]);

  const final = buildOpenClawReadinessReport(gitStatus());
  if (!final.ok) {
    fail(final);
    return;
  }

  console.log("\nOpenClaw readiness passed: canonical registries are reproducible, drift/alignment checks pass, worktree is clean, and branch is synchronized with upstream.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
