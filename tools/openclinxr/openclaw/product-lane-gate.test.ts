/**
 * PRODUCT-LANE GATE (superagent ruling 2026-08-22) — planted RED.
 *
 * The defect this test exists to prevent is ORCHESTRATOR drift, not worker error: between
 * 2026-08-22T06:00Z and 14:55Z the loop landed 40 commits and ZERO on any product path while
 * calling itself productive. Doctrine prose ("after one evidence-only slice the next must be
 * product construction") did not bind slice selection. This gate does: once PRODUCT_IDLE_LIMIT
 * consecutive commits land without touching a release lane, every non-product dispatch REFUSES
 * before any worktree or worker token.
 *
 * Diagnosis and measured tables below are IMMUTABLE per PROTO_VERIFY_DELEGATION §10y convention;
 * append a `## FIXED` block rather than rewriting them.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertProductLaneNotStarved,
  measureProductLaneState,
  PRODUCT_IDLE_LIMIT,
} from "./product-lane-gate.js";
import { gitEnvWithoutInheritedRepoVars } from "./worktree-base-freshness.js";

/** Build a throwaway git repo whose history is [product x N, then evidence x M] and run the gate against it. */
function repoWithHistory(productCommits: number, evidenceCommits: number): string {
  const dir = mkdtempSync(join(tmpdir(), "product-lane-gate-"));
  const git = (args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      env: gitEnvWithoutInheritedRepoVars(),
    });
  git(["init"]);
  git(["config", "user.email", "gate@test"]);
  git(["config", "user.name", "gate"]);
  const commit = (path: string, message: string) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), `${message}\n`); // unique content or git refuses an empty commit
    git(["add", path]);
    git(["commit", "-m", message]);
  };
  for (let i = 0; i < productCommits; i++) commit("apps/ui-xr/scene.ts", `product ${i}`);
  for (let i = 0; i < evidenceCommits; i++) commit("tools/openclinxr/evidence/probe.json", `evidence ${i}`);
  return dir;
}

describe("product-lane gate", () => {
  it("counts consecutive non-product commits since the last product-path commit", () => {
    // Live main is currently deep in an evidence-only stretch; the walker must see it.
    const live = measureProductLaneState(process.cwd());
    expect(live.evidenceOnlyCommits).toBeGreaterThanOrEqual(0);
    expect(live.lastProductCommit).not.toBeNull();
  });

  it("REFUSES a non-product dispatch once the evidence-only stretch reaches the limit (destructive)", () => {
    const repo = repoWithHistory(2, PRODUCT_IDLE_LIMIT);
    expect(() =>
      assertProductLaneNotStarved(repo, { slice: "issue-test-evidence-only" }),
    ).toThrow(/PRODUCT-LANE GATE/);
  });

  it("ALLOWS a declared-product dispatch even mid-stretch — the escape hatch is landing bytes", () => {
    const repo = repoWithHistory(1, PRODUCT_IDLE_LIMIT + 3);
    expect(() =>
      assertProductLaneNotStarved(repo, { slice: "issue-test-product", product: true }),
    ).not.toThrow();
  });

  it("ALLOWS non-product dispatches while the product clock is fresh", () => {
    const repo = repoWithHistory(1, PRODUCT_IDLE_LIMIT - 1);
    expect(() =>
      assertProductLaneNotStarved(repo, { slice: "issue-test-fresh-clock" }),
    ).not.toThrow();
  });

  it("does not count coordination/evidence paths as product even when recently touched", () => {
    const repo = repoWithHistory(1, 0);
    // A tooling commit on top must NOT reset the clock...
    mkdirSync(join(repo, "tools/openclinxr/openclaw"), { recursive: true });
    writeFileSync(join(repo, "tools/openclinxr/openclaw/score.json"), "x\n");
    execFileSync("git", ["-C", repo, "add", "tools/openclinxr/openclaw/score.json"], {
      env: gitEnvWithoutInheritedRepoVars(),
    });
    execFileSync("git", ["-C", repo, "commit", "-m", "tooling"], {
      env: gitEnvWithoutInheritedRepoVars(),
    });
    const state = measureProductLaneState(repo);
    expect(state.evidenceOnlyCommits).toBe(1);
  });

  it("a product-path commit RESETS the clock after an expired stretch", () => {
    const repo = repoWithHistory(1, PRODUCT_IDLE_LIMIT);
    expect(measureProductLaneState(repo).evidenceOnlyCommits).toBe(PRODUCT_IDLE_LIMIT);
    commitOn(repo, "packages/openclinxr/scenario-runtime/scene.ts", "product reset");
    expect(measureProductLaneState(repo).evidenceOnlyCommits).toBe(0);
  });

  it("the capture harness is NOT a release lane — the #558-#566 window must not have counted", () => {
    // The toil this gate exists for: four slices on model-vetting-studio's clip ranker while
    // the shipped exam got nothing. A commit touching ONLY that app must not reset the clock.
    const repo = repoWithHistory(1, 0);
    commitOn(repo, "apps/arena/model-vetting-studio/src/body-motion-probe-clip.ts", "clip ranking");
    const state = measureProductLaneState(repo);
    expect(state.evidenceOnlyCommits).toBe(1); // still one evidence-only commit since product
  });

  it("ui-xr IS a release lane — a runtime commit resets the clock", () => {
    const repo = repoWithHistory(0, PRODUCT_IDLE_LIMIT + 2);
    commitOn(repo, "apps/ui-xr/src/main.ts", "wire the clip into the mixer");
    expect(measureProductLaneState(repo).evidenceOnlyCommits).toBe(0);
  });
});

function commitOn(repo: string, path: string, message: string): void {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), `${message}\n`);
  execFileSync("git", ["-C", repo, "add", path], { env: gitEnvWithoutInheritedRepoVars() });
  execFileSync("git", ["-C", repo, "commit", "-m", message], { env: gitEnvWithoutInheritedRepoVars() });
}
