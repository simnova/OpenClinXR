import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertMatchesOrchestratorChoice, readDecision, recordDecision } from "./value-decision.js";

const roots: string[] = [];
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "value-decision-"));
  roots.push(root);
  mkdirSync(join(root, ".openclinxr", "evidence", "issue-x"), { recursive: true });
  writeFileSync(join(root, ".openclinxr", "evidence", "issue-x", "sweep.png"), "not-really-a-png");
  return root;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("a value decision belongs to the orchestrator (#204 retro)", () => {
  it("refuses to record a decision that was not graded from a sheet", () => {
    const root = makeRoot();
    expect(() =>
      recordDecision(root, {
        slice: "issue-x",
        key: "inset_m",
        value: 0.5,
        gradedFrom: ".openclinxr/evidence/issue-x/absent.png",
        why: "invented",
      }),
    ).toThrow(/does not exist.*graded from a rendered sweep/su);
  });

  it("fails a shipping value that no orchestrator decision covers", () => {
    const root = makeRoot();
    // This is the #204 failure exactly: a number chosen by whoever wrote it, justified afterwards.
    expect(() => assertMatchesOrchestratorChoice(root, "issue-x", "inset_m", 0.5))
      .toThrow(/no orchestrator decision recorded.*chosen by whoever wrote it/su);
  });

  it("fails when the shipping value drifts from the recorded choice", () => {
    const root = makeRoot();
    recordDecision(root, {
      slice: "issue-x",
      key: "inset_m",
      value: 0.5,
      gradedFrom: ".openclinxr/evidence/issue-x/sweep.png",
      why: "graded",
    });
    expect(() => assertMatchesOrchestratorChoice(root, "issue-x", "inset_m", 0.35))
      .toThrow(/ships 0.35 but the orchestrator chose 0.5/su);
    // And passes when they agree.
    expect(() => assertMatchesOrchestratorChoice(root, "issue-x", "inset_m", 0.5)).not.toThrow();
  });

  it("records who decided and what it was graded from", () => {
    const root = makeRoot();
    recordDecision(root, {
      slice: "issue-x",
      key: "inset_m",
      value: 0.5,
      gradedFrom: ".openclinxr/evidence/issue-x/sweep.png",
      why: "outer jamb at the wall plane",
    });
    const decision = readDecision(root, "issue-x", "inset_m");
    expect(decision?.decidedBy).toBe("orchestrator");
    expect(decision?.gradedFrom).toContain("sweep.png");
    expect(decision?.why).toContain("jamb");
  });
});
