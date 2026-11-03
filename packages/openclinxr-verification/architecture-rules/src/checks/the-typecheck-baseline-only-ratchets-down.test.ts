import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOOLS_STRICT_ERROR_CEILING,
  TOOLS_STRICT_ERROR_CEILING_AT_PLANT,
  TYPECHECK_ERROR_CEILING,
  TYPECHECK_ERROR_CEILING_AT_PLANT,
  checkToolsStrictBaseline,
  checkTypecheckBaseline,
  checkTypescriptGuardrails,
  collectToolsStrictDiagnostics,
  collectTypecheckDiagnostics,
  countTypecheckErrors,
  diagnosticKey,
  parseTypecheckDiagnostics,
} from "./typecheck-baseline.js";
import { describeTypecheckBaselineTests } from "../test-suites/typecheck-baseline.js";

function workspaceRootFromHere(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("workspace root not found");
}

/**
 * Destructive probe for the typecheck error-count freeze.
 *
 * Known-good column: file-size-budgets.ts SIZE_FREEZE — a number that may only shrink,
 * with honesty when the live count drops below the ceiling.
 *
 * Hermetic clauses inject counts. The live suite at the bottom shells out to
 * `pnpm typecheck:strict` and `typecheck:relaxed` (the prefix `pnpm typecheck` actually runs).
 */

describe("the typecheck baseline only ratchets down", () => {
  it("(1) RED: a grown error count is refused", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 18,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/18.*10/);
    expect(violations.some((v) => v.includes("do NOT raise the ceiling"))).toBe(true);
  });

  it("(2) RED: the refusal names the measured count and the ceiling", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 18,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/\b18\b/u);
    expect(violations.join("\n")).toMatch(/\b10\b/u);
  });

  it("(3) KNOWN-GOOD COLUMN: sitting exactly on the ceiling is allowed", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 10,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations).toEqual([]);
  });

  it("(4) lower is always allowed: a paid-down count forces the ceiling down", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 7,
      ceiling: 10,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/paid down/i);
    expect(violations.join("\n")).toMatch(/lower TYPECHECK_ERROR_CEILING/);
  });

  it("(5) raising the live ceiling above the plant freeze is refused", () => {
    const violations = checkTypecheckBaseline({
      actualErrorCount: 11,
      ceiling: 11,
      plantCeiling: 10,
    });
    expect(violations.join("\n")).toMatch(/plant freeze/);
  });

  it("(6) plant freeze is the 2026-09-04 measured unique count (225) and the live ceiling may only sit at or below it", () => {
    expect(TYPECHECK_ERROR_CEILING_AT_PLANT).toBe(225);
    expect(TYPECHECK_ERROR_CEILING).toBeLessThanOrEqual(TYPECHECK_ERROR_CEILING_AT_PLANT);
  });

  it("(7) parser counts unique error TSxxxx diagnostics and ignores non-diagnostic noise", () => {
    const fixture = [
      "ERROR: command finished with error: pnpm typecheck:relaxed",
      "tools/a.ts(1,1): error TS2304: Cannot find name 'window'.",
      "tools/a.ts(1,1): error TS2304: Cannot find name 'window'.",
      "@openclinxr/ui-admin:typecheck: src/App.tsx(341,68): error TS2339: Property 'value' does not exist.",
      "Failed",
    ].join("\n");
    const parsed = parseTypecheckDiagnostics(fixture);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.code).toBe("TS2304");
    expect(parsed[1]?.code).toBe("TS2339");
    expect(
      checkTypecheckBaseline({
        diagnosticOutput: fixture,
        ceiling: 2,
        plantCeiling: 2,
      }),
    ).toEqual([]);
  });

  it(
    "(8) two consecutive live counts on an unchanged tree produce the same diagnostic set",
    () => {
      const first = collectTypecheckDiagnostics().map(diagnosticKey).sort();
      const second = collectTypecheckDiagnostics().map(diagnosticKey).sort();
      expect(second).toEqual(first);
      expect(first.length).toBe(TYPECHECK_ERROR_CEILING);
    },
    180_000,
  );

  it(
    "(9) injecting one TypeScript error into tools/ raises the live count; removing it restores the freeze",
    () => {
      const root = workspaceRootFromHere();
      const planted = join(root, "tools/openclinxr/_typecheck-baseline-inject.ts");
      mkdirSync(dirname(planted), { recursive: true });
      writeFileSync(planted, 'export const planted: number = "not-a-number";\n', "utf8");
      try {
        const grown = countTypecheckErrors();
        expect(grown).toBeGreaterThan(TYPECHECK_ERROR_CEILING);
        expect(
          checkTypecheckBaseline({ actualErrorCount: grown }).some((v) => v.includes("do NOT raise the ceiling")),
        ).toBe(true);
      } finally {
        unlinkSync(planted);
      }
      expect(countTypecheckErrors()).toBe(TYPECHECK_ERROR_CEILING);
    },
    180_000,
  );
});

/**
 * 2026-11-03 strict-rule ratchet. The three index/optional-property flags were relaxed in
 * 29 station sidecars and the relaxed tools tier, and no hook typechecked the sidecars or
 * ran the guardrail that forbids the relaxation. Each clause below plants the defect it
 * guards against, proves the gate refuses it, removes it, and proves the gate is clean.
 * Fixture values are a single TS4111 (dot access on an index signature): an error ONLY
 * under noPropertyAccessFromIndexSignature, so the relaxed tier cannot see it.
 */
const STRICT_ONLY_PLANT =
  "const plantedRecord: Record<string, number> = {};\nexport const plantedValue = plantedRecord.plantedKey;\n";

describe("the strict TypeScript rules only ratchet", () => {
  it("(10) a strict-only error planted in a station sidecar raises the zero-ceiling count", () => {
    const planted = join(
      workspaceRootFromHere(),
      "packages/openclinxr/stations/staging-evidence/src/_typecheck-baseline-inject.ts",
    );
    writeFileSync(planted, STRICT_ONLY_PLANT, "utf8");
    try {
      const keys = collectTypecheckDiagnostics().map(diagnosticKey);
      expect(keys.some((k) => k.includes("_typecheck-baseline-inject.ts") && k.endsWith("|TS4111"))).toBe(true);
      expect(checkTypecheckBaseline().some((v) => v.includes("do NOT raise the ceiling"))).toBe(true);
    } finally {
      unlinkSync(planted);
    }
    expect(countTypecheckErrors()).toBe(TYPECHECK_ERROR_CEILING);
  }, 300_000);

  it("(11) typecheck:stations bypasses turbo's cache (its inputs omit the tools/** files sidecars import)", () => {
    const pkg = JSON.parse(readFileSync(join(workspaceRootFromHere(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts["typecheck:stations"] ?? "";
    expect(script).toContain("--filter='./packages/openclinxr/stations/*'");
    expect(script).toContain("--force");
    expect(script).toContain("--continue");
  });

  it("(12) a sidecar tsconfig that relaxes a strict flag fails typecheck:guardrails", () => {
    expect(checkTypescriptGuardrails()).toEqual([]);
    const planted = join(
      workspaceRootFromHere(),
      "packages/openclinxr/stations/staging-evidence/tsconfig.baseline-inject.json",
    );
    writeFileSync(planted, '{ "compilerOptions": { "noUncheckedIndexedAccess": false } }\n', "utf8");
    try {
      const violations = checkTypescriptGuardrails();
      expect(violations.join("\n")).toContain("tsconfig.baseline-inject.json: noUncheckedIndexedAccess must not be relaxed");
    } finally {
      unlinkSync(planted);
    }
    expect(checkTypescriptGuardrails()).toEqual([]);
  }, 120_000);

  it("(13) tools strict ceiling: growth refused, paid-down forces it lower, raising above plant refused", () => {
    expect(checkToolsStrictBaseline({ actualErrorCount: TOOLS_STRICT_ERROR_CEILING })).toEqual([]);
    expect(
      checkToolsStrictBaseline({ actualErrorCount: TOOLS_STRICT_ERROR_CEILING + 1 }).some((v) =>
        v.includes(`> frozen ceiling ${TOOLS_STRICT_ERROR_CEILING}`),
      ),
    ).toBe(true);
    expect(
      checkToolsStrictBaseline({ actualErrorCount: TOOLS_STRICT_ERROR_CEILING - 1 }).some((v) =>
        v.includes("lower TOOLS_STRICT_ERROR_CEILING"),
      ),
    ).toBe(true);
    expect(
      checkToolsStrictBaseline({
        actualErrorCount: TOOLS_STRICT_ERROR_CEILING_AT_PLANT + 1,
        ceiling: TOOLS_STRICT_ERROR_CEILING_AT_PLANT + 1,
      }).some((v) => v.includes("> plant freeze")),
    ).toBe(true);
    expect(TOOLS_STRICT_ERROR_CEILING).toBeLessThanOrEqual(TOOLS_STRICT_ERROR_CEILING_AT_PLANT);
  });

  it("(14) a strict-only error planted in tools/ raises the tools strict count; removing it restores the freeze", () => {
    const planted = join(workspaceRootFromHere(), "tools/openclinxr/_tools-strict-inject.ts");
    writeFileSync(planted, STRICT_ONLY_PLANT, "utf8");
    try {
      const diagnostics = collectToolsStrictDiagnostics();
      expect(diagnostics.some((d) => d.file.endsWith("_tools-strict-inject.ts") && d.code === "TS4111")).toBe(true);
      expect(diagnostics.length).toBeGreaterThan(TOOLS_STRICT_ERROR_CEILING);
    } finally {
      unlinkSync(planted);
    }
    expect(collectToolsStrictDiagnostics().length).toBe(TOOLS_STRICT_ERROR_CEILING);
  }, 180_000);
});

describeTypecheckBaselineTests();
