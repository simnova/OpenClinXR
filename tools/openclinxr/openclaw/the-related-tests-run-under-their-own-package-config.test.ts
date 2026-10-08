import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planTests, type TestPlan } from "./test-touched.js";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "test-owner-routing-"));
  try {
    for (const [dir, name] of [
      ["apps/web", "@fixture/web"],
      ["packages/openclinxr/xr-pose", "@fixture/pose"],
      ["packages/openclinxr/outer", "@fixture/outer"],
      ["packages/openclinxr/outer/nested", "@fixture/nested"],
    ]) {
      mkdirSync(join(root, dir!), { recursive: true });
      writeFileSync(join(root, dir!, "package.json"), JSON.stringify({ name }));
    }
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function assertNestedOwner(plan: TestPlan): void {
  assert.equal(plan.kind, "run");
  if (plan.kind !== "run") throw new Error("expected a runnable plan");
  assert.deepEqual(plan.rootFiles, [], "nested package must not enter the root tools runner");
  assert.deepEqual(plan.byPackage.get("@fixture/pose"), {
    dir: "packages/openclinxr/xr-pose", files: ["src/pose.test.ts"],
  });
}

/** Retained old truncation, exercised against the same real package fixture. */
function oldTruncatedPlan(file: string, root: string): TestPlan {
  const parts = /^(packages\/.+?\/|apps\/.+?\/)/u.exec(file)![1]!.split("/").filter(Boolean);
  for (let i = parts.length; i >= 1; i--) {
    const dir = parts.slice(0, i).join("/");
    try {
      const { name } = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      if (typeof name === "string") return { kind: "run", rootFiles: [], byPackage: new Map([[name, { dir, files: [] }]]) };
    } catch { /* A missing owner is the original fallback. */ }
  }
  return { kind: "run", rootFiles: [file], byPackage: new Map() };
}

describe("related tests run under their own package configuration", () => {
  it("routes a nested package to its actual owner", () => fixture((root) => {
    assertNestedOwner(planTests(["packages/openclinxr/xr-pose/src/pose.test.ts"], root));
  }));

  it("the same owner assertion refuses the old truncated lookup", () => fixture((root) => {
    expect(() => assertNestedOwner(oldTruncatedPlan("packages/openclinxr/xr-pose/src/pose.test.ts", root)))
      .toThrow("nested package must not enter the root tools runner");
  }));

  it("uses the deepest owner, keeps shallow apps, and leaves tools and orphans at root", () => fixture((root) => {
    const plan = planTests([
      "apps/web/src/app.ts", "packages/openclinxr/outer/nested/src/unit.ts",
      "packages/openclinxr/outer/src/parent.ts", "tools/diagnostic.ts",
      "packages/openclinxr/orphan/src/unowned.ts",
    ], root);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") throw new Error("expected runnable mixed plan");
    expect(plan.byPackage.get("@fixture/web")).toEqual({ dir: "apps/web", files: ["src/app.ts"] });
    expect(plan.byPackage.get("@fixture/nested")).toEqual({ dir: "packages/openclinxr/outer/nested", files: ["src/unit.ts"] });
    expect(plan.byPackage.get("@fixture/outer")).toEqual({ dir: "packages/openclinxr/outer", files: ["src/parent.ts"] });
    expect(plan.rootFiles).toEqual(["tools/diagnostic.ts", "packages/openclinxr/orphan/src/unowned.ts"]);
  }));

  it("preserves an empty plan", () => fixture((root) => {
    expect(planTests([], root)).toEqual({ kind: "none" });
  }));

  it("routes the actual shipped pose source through its package config", () => {
    const plan = planTests(["packages/openclinxr/xr-pose/src/supine-support-contact.test.ts"]);
    expect(plan.kind).toBe("run");
    if (plan.kind !== "run") throw new Error("expected runnable actual-tree plan");
    expect(plan.rootFiles).toEqual([]);
    expect(plan.byPackage.get("@openclinxr/xr-pose")).toEqual({
      dir: "packages/openclinxr/xr-pose", files: ["src/supine-support-contact.test.ts"],
    });
  });
});
