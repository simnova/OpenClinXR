#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";
import {
  evaluateIntegrateGate,
  pendingMergeParents,
  readGateReport,
  requiresKillReport,
  stagedTreeHash,
} from "./integrate-gate.js";

/**
 * Pre-commit half of the land boundary. Exits 0 for anything that is not an integrate land, so
 * ordinary work on main is unaffected; refuses a land whose kill report is missing, stale, or a kill.
 */
const repoRoot = process.cwd();
const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  env: gitEnvWithoutInheritedRepoVars(),
}).trim();

const required = requiresKillReport({
  branch,
  integrating: process.env["OPENCLINXR_INTEGRATING"] === "1",
  mergeParents: pendingMergeParents(repoRoot),
});
if (!required) {
  console.log("not an integrate land — gate not applicable");
  process.exit(0);
}

const verdict = evaluateIntegrateGate({ treeHash: stagedTreeHash(repoRoot), report: readGateReport(repoRoot) });
if (!verdict.allowed) {
  console.error(`Integrate gate REFUSED: ${verdict.reason}`);
  process.exit(1);
}
console.log("integrate gate: clean report matches the staged tree");
