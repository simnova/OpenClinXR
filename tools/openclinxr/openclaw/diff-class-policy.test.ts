import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DIFF_CLASS_SEVERITY,
  PROTECTED_POLICY_PATHS,
  classifyDiff,
  classifyPath,
  type DiffClass,
  type RequiredCheck,
} from "./diff-class-policy.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function rootPackageScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

/** Extract root pnpm script name from a RequiredCheck.command, or null if unmet/non-pnpm. */
function rootScriptFromCommand(command: string): string | null {
  const m = /^pnpm\s+(\S+)$/u.exec(command.trim());
  return m?.[1] ?? null;
}

describe("diff-class-policy", () => {
  it("classifies every path in the protected set as protected-policy (incl. exact six docs)", () => {
    // Named set from GUARD_BLUEPRINT — AGENTS.md + six coordination surfaces (md/json pairs counted).
    const sixDocs = [
      "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.md",
      "docs/openclinxr/doc-authority-registry-2026-05-27.json",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.md",
      "docs/openclinxr/generated-artifact-registry-2026-05-27.json",
      "docs/openclinxr/openclaw-runbook-2026-05-27.md",
      "docs/openclinxr/openclaw-tool-adapters-2026-05-27.md",
    ];
    for (const p of PROTECTED_POLICY_PATHS) {
      expect(classifyPath(p), p).toBe("protected-policy");
    }
    for (const p of sixDocs) {
      expect(classifyPath(p), p).toBe("protected-policy");
    }
    expect(classifyPath("docs/madr/0001-example.md")).toBe("protected-policy");
  });

  it("does NOT treat an unrelated docs/openclinxr/*-2026-05-27 file as protected (over-match trap)", () => {
    // Blanket date matching would false-positive this historical/non-protected path.
    const notProtected = "docs/openclinxr/some-unrelated-note-2026-05-27.md";
    expect(classifyPath(notProtected)).not.toBe("protected-policy");
    // It's still markdown docs.
    expect(classifyPath(notProtected)).toBe("docs");
  });

  it("classifies file-size-budgets.ts as freeze-ratchet and ranks it above architecture-rule", () => {
    expect(
      classifyPath("packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts"),
    ).toBe("freeze-ratchet");
    expect(
      classifyPath("packages/openclinxr/architecture-rules/src/checks/markdown-references.ts"),
    ).toBe("freeze-ratchet");
    // Sibling under architecture-rules is architecture-rule, not freeze-ratchet.
    expect(
      classifyPath("packages/openclinxr/architecture-rules/src/checks/decision-invariants.ts"),
    ).toBe("architecture-rule");

    const freezeIdx = DIFF_CLASS_SEVERITY.indexOf("freeze-ratchet");
    const archIdx = DIFF_CLASS_SEVERITY.indexOf("architecture-rule");
    expect(freezeIdx).toBeGreaterThanOrEqual(0);
    expect(archIdx).toBeGreaterThanOrEqual(0);
    expect(freezeIdx).toBeLessThan(archIdx); // lower index = more severe
  });

  it("classifyDiff returns most severe class and the union of required checks", () => {
    const c = classifyDiff([
      "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts",
      "apps/ui-xr/src/main.ts",
      "README.md",
    ]);
    expect(c.diffClass).toBe("freeze-ratchet");
    expect(c.classesPresent).toEqual(
      expect.arrayContaining(["freeze-ratchet", "product", "docs"] as DiffClass[]),
    );

    const ids = c.requiredChecks.map((r) => r.id);
    // architecture from freeze-ratchet + docs; product typecheck/test
    expect(ids).toContain("architecture");
    expect(ids).toContain("packages-typecheck");
    expect(ids).toContain("packages-test");
    // Single architecture id even though freeze-ratchet and docs both demand it
    expect(ids.filter((id) => id === "architecture")).toHaveLength(1);
  });

  it("markdown-only diff does NOT pull in product test commands", () => {
    const c = classifyDiff(["docs/openclinxr/some-guide.md", "README.md"]);
    expect(c.classesPresent.every((x) => x === "docs")).toBe(true);
    expect(c.requiredChecks.some((r) => r.command.includes("packages:test"))).toBe(false);
    expect(c.requiredChecks.some((r) => r.command.includes("packages:typecheck"))).toBe(false);
    expect(c.requiredChecks.map((r) => r.id)).toEqual(["architecture"]);
  });

  it("AGENTS.md forbidden reason differs from PROJECT_STATUS.md (policy vs ownership)", () => {
    const agents = classifyDiff(["AGENTS.md"]);
    expect(agents.forbidden.length).toBeGreaterThan(0);
    expect(agents.forbidden[0]?.class).toBe("protected-policy");
    expect(agents.forbidden[0]?.reason).toMatch(/policy integrity/i);

    const status = classifyDiff(["PROJECT_STATUS.md"]);
    expect(status.forbidden.length).toBeGreaterThan(0);
    expect(status.forbidden[0]?.class).toBe("coordination-state");
    expect(status.forbidden[0]?.reason).toMatch(/ownership/i);

    // Reasons must be distinguishable
    expect(agents.forbidden[0]?.reason).not.toBe(status.forbidden[0]?.reason);
  });

  it("requiredChecks commands (non-unmet) all exist as package.json scripts", () => {
    const scripts = rootPackageScripts();
    // Exercise classes that emit real runners
    const c = classifyDiff([
      "packages/openclinxr/architecture-rules/src/index.ts",
      "packages/openclinxr/architecture-rules/src/checks/file-size-budgets.ts",
      "apps/ui-xr/src/main.ts",
      "tools/openclinxr/openclaw/diff-class-policy.ts",
      "docs/openclinxr/guide.md",
      "docs/openclinxr/promotion-gate-note.md",
    ]);

    const runnable = c.requiredChecks.filter((r) => !r.unmet);
    expect(runnable.length).toBeGreaterThan(0);
    for (const check of runnable) {
      const script = rootScriptFromCommand(check.command);
      expect(script, `command must be pnpm <script>: ${check.command}`).toBeTruthy();
      expect(
        scripts[script as string],
        `missing package.json script for required check ${check.id}: ${check.command}`,
      ).toBeDefined();
    }

    // Unmet isolation proof must still be present for harness, and must not claim a real script.
    const isolation = c.requiredChecks.find((r) => r.id === "harness-isolation-proof");
    expect(isolation?.unmet).toBe(true);
  });

  it("dedupes RequiredCheck ids when two classes demand the same check", () => {
    // freeze-ratchet + docs both require architecture
    const c = classifyDiff([
      "packages/openclinxr/architecture-rules/src/checks/markdown-references.ts",
      "docs/openclinxr/guide.md",
    ]);
    const architectureChecks = c.requiredChecks.filter((r) => r.id === "architecture");
    expect(architectureChecks).toHaveLength(1);
    const ids = c.requiredChecks.map((r: RequiredCheck) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
