import { describe, expect, it } from "vitest";
import {
  assertTouchedWithinWriteRoots,
  findSoleAuthorLockViolations,
  getRolePathScope,
  soleAuthorLocks,
} from "./role-harness-policy.js";
import { rolePathScopes } from "./role-path-scopes.js";

const TARGETS = [".github/workflows/ci.yml", "turbo.json", "knip.json"];

describe("role-config-ownership", () => {
  it("architect allows the exact 3 CI config literals", () => {
    const scope = getRolePathScope("architect");
    for (const t of TARGETS) expect(scope.writeRoots).toContain(t);
    expect(assertTouchedWithinWriteRoots(TARGETS, scope).ok).toBe(true);
  });

  it("architect still refuses neighboring roots and broad globs", () => {
    const scope = getRolePathScope("architect");
    const refused = assertTouchedWithinWriteRoots(
      [
        ".github/workflows/other.yml",
        ".github/CODEOWNERS",
        "turbo.json.orig",
        "knip.json.bak",
        "vitest.config.ts",
        "tsconfig.json",
        "apps/api/src/index.ts",
        "packages/openclinxr/domain/patient.ts",
      ],
      scope,
    );
    expect(refused.ok).toBe(false);
    expect(refused.violations.length).toBe(8);
  });

  it("admits exact literals only, no wildcard widening", () => {
    const scope = getRolePathScope("architect");
    for (const broad of [
      ".github/**",
      "*.json",
      "*.yml",
      "**/*.json",
      "turbo.*",
      "knip.*",
      "packages/**",
      "apps/**",
    ])
      expect(scope.writeRoots).not.toContain(broad);
  });

  it("exact 3 are architect-only: every other role still refuses", () => {
    const others = Object.keys(rolePathScopes).filter((r) => r !== "architect");
    expect(others.length).toBe(17);
    for (const role of others) {
      const res = assertTouchedWithinWriteRoots(TARGETS, getRolePathScope(role));
      expect(res.ok).toBe(false);
      expect(res.violations.sort()).toEqual([...TARGETS].sort());
    }
    // Pre-existing broad tools/** owner (license-provenance-specialist) still
    // does not cover these repo-root paths.
    expect(
      assertTouchedWithinWriteRoots(TARGETS, getRolePathScope("license-provenance-specialist"))
        .ok,
    ).toBe(false);
  });

  it("no sole-author lock covers the 3; path-scope-policy lock stays intact", () => {
    for (const lock of soleAuthorLocks)
      for (const p of lock.paths)
        expect(TARGETS).not.toContain(p);
    expect(
      findSoleAuthorLockViolations("architect", TARGETS),
    ).toEqual([]);
    // Unchanged behavior: non-owner touching the policy file still violates.
    expect(
      findSoleAuthorLockViolations("implementation-planning-lead", [
        "packages/openclinxr/agent-loop/src/role-harness-policy.ts",
      ]).some((v) => v.lockId === "path-scope-policy"),
    ).toBe(true);
    // Architect forbidden range unchanged: product/xr roots still refused.
    const scope = getRolePathScope("architect");
    expect(scope.forbidden).toEqual(
      expect.arrayContaining([
        "apps/**",
        "packages/openclinxr/domain/**",
        "packages/openclinxr/scenario-runtime/**",
      ]),
    );
  });
});
