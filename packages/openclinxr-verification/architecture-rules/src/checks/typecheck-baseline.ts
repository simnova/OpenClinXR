import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Typecheck error-count freeze (ArchUnit-style ratchet; sibling of file-size-budgets).
 *
 * WHY: `pnpm typecheck` is red on main and no git hook ran it, so the count could grow
 * unnoticed. This gate freezes the measured unique `error TSxxxx` diagnostic count and
 * refuses growth. Lowering the ceiling is always allowed; raising it is not.
 *
 * Measured 2026-09-04 on origin/main `544d552ae` after `pnpm -r build`:
 *   typecheck:strict    0
 *   typecheck:relaxed 225  (tsconfig.tools-relaxed.json, tools/ glob)
 * `pnpm typecheck` is `strict && relaxed && guardrails && packages:typecheck`, so it
 * dies on relaxed and never reaches packages. Counting turbo `packages:typecheck`
 * also flaps with cache replay. This freeze therefore counts unique `error TSxxxx`
 * diagnostics from strict + relaxed only. The card body said 47; that figure is stale.
 * Do not fix the 225 — that is unbounded and out of scope. Tighten only when the
 * live count drops, then lower TYPECHECK_ERROR_CEILING to match.
 *
 * RATCHET SEMANTICS (same shape as SIZE_FREEZE):
 *  - actual > ceiling → fail (errors grew; do NOT raise the ceiling)
 *  - ceiling > plant freeze → fail (the plant number may only shrink via the live ceiling)
 *  - actual < ceiling → fail (paid down — lower TYPECHECK_ERROR_CEILING)
 *  - actual === ceiling && ceiling <= plant → pass
 */

/** Immutable plant-day ceiling. TYPECHECK_ERROR_CEILING may only go down from this. */
export const TYPECHECK_ERROR_CEILING_AT_PLANT = 225;

/**
 * Shrink-only live ceiling. Lower it in the same commit that pays the count down.
 * Do not raise this number.
 *
 * Paid to zero 2026-09-05: strict 0 + relaxed 0 (was 225: stale dists rebuilt,
 * fetch-adapter RequestInfo/BodyInit root-caused, browser page globals declared,
 * remainder fixed per group). Lowered in the same commit that paid the count down.
 */
export const TYPECHECK_ERROR_CEILING = 0;

/**
 * 2026-11-03: typecheck:stations joins the zero ceiling. The 29 station sidecars ran with
 * exactOptionalPropertyTypes / noUncheckedIndexedAccess / noPropertyAccessFromIndexSignature
 * relaxed to false and no hook typechecked them; ~4,800 errors accumulated and were paid
 * down in 57381ab95. The script passes --force because turbo's typecheck inputs omit the
 * tools/** files each sidecar imports, so a cached replay is green after a tools/ edit.
 */
const TYPECHECK_SCRIPTS = ["typecheck:strict", "typecheck:relaxed", "typecheck:stations"] as const;

/** `file(line,col): error TSxxxx:` — turbo prefixes stay on `file`. */
export const TYPECHECK_DIAGNOSTIC_RE = /(.+?)\((\d+),(\d+)\): error (TS\d+):/gu;

export type TypecheckBaselineConfig = {
  actualErrorCount?: number;
  ceiling?: number;
  plantCeiling?: number;
  workspaceRoot?: string;
  /** Injected command output for parser probes; skips spawn when set. */
  diagnosticOutput?: string;
};

export type TypecheckDiagnostic = {
  file: string;
  line: string;
  column: string;
  code: string;
};

function findWorkspaceRoot(): string {
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

export function parseTypecheckDiagnostics(output: string): TypecheckDiagnostic[] {
  const seen = new Set<string>();
  const out: TypecheckDiagnostic[] = [];
  for (const match of output.matchAll(TYPECHECK_DIAGNOSTIC_RE)) {
    const file = match[1]?.trim() ?? "";
    const line = match[2] ?? "";
    const column = match[3] ?? "";
    const code = match[4] ?? "";
    const key = `${file}|${line}|${column}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, line, column, code });
  }
  return out;
}

function runPnpmScript(root: string, script: string): string {
  const result = spawnSync("pnpm", [script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

export function diagnosticKey(d: TypecheckDiagnostic): string {
  return `${d.file}|${d.line}|${d.column}|${d.code}`;
}

export function collectTypecheckDiagnostics(config?: TypecheckBaselineConfig): TypecheckDiagnostic[] {
  if (config?.diagnosticOutput !== undefined) {
    return parseTypecheckDiagnostics(config.diagnosticOutput);
  }
  const root = config?.workspaceRoot ?? findWorkspaceRoot();
  const output = TYPECHECK_SCRIPTS.map((script) => runPnpmScript(root, script)).join("\n");
  return parseTypecheckDiagnostics(output);
}

export function countTypecheckErrors(config?: TypecheckBaselineConfig): number {
  if (config?.actualErrorCount !== undefined) {
    return config.actualErrorCount;
  }
  return collectTypecheckDiagnostics(config).length;
}

export function checkTypecheckBaseline(config?: TypecheckBaselineConfig): string[] {
  const ceiling = config?.ceiling ?? TYPECHECK_ERROR_CEILING;
  const plant = config?.plantCeiling ?? TYPECHECK_ERROR_CEILING_AT_PLANT;
  const actual = countTypecheckErrors(config);
  const violations: string[] = [];

  if (ceiling > plant) {
    violations.push(
      `TYPECHECK_ERROR_CEILING ${ceiling} > plant freeze ${plant} (freeze ceilings may only shrink — do NOT raise the ceiling).`,
    );
  }
  if (actual > ceiling) {
    violations.push(
      `typecheck error count ${actual} > frozen ceiling ${ceiling} (freeze ceilings may only shrink — fix errors; do NOT raise the ceiling).`,
    );
  }
  if (actual < ceiling) {
    violations.push(
      `typecheck error count now ${actual} < ceiling ${ceiling} — lower TYPECHECK_ERROR_CEILING (paid down! ratchet must tighten).`,
    );
  }
  return violations;
}

/**
 * Second ratchet: tools/** under the three index/optional-property flags the relaxed tier
 * turns off (tsconfig.tools-strict.json extends tsconfig.tools-relaxed.json with them on).
 * Without it a new tools/ file outside every sidecar program can add violations unseen.
 *
 * Measured 2026-11-03 on origin/main 57381ab95: 4708 unique diagnostics, identical on two
 * consecutive runs. Same semantics as TYPECHECK_ERROR_CEILING: shrink-only, and a
 * paid-down count forces the ceiling down in the same commit.
 */
export const TOOLS_STRICT_ERROR_CEILING_AT_PLANT = 4708;
/** Shrink-only. Lower it in the commit that pays the count down. Do not raise it. */
export const TOOLS_STRICT_ERROR_CEILING = 4708;

export function collectToolsStrictDiagnostics(config?: TypecheckBaselineConfig): TypecheckDiagnostic[] {
  if (config?.diagnosticOutput !== undefined) {
    return parseTypecheckDiagnostics(config.diagnosticOutput);
  }
  return parseTypecheckDiagnostics(runPnpmScript(config?.workspaceRoot ?? findWorkspaceRoot(), "typecheck:tools-strict"));
}

export function checkToolsStrictBaseline(config?: TypecheckBaselineConfig): string[] {
  const ceiling = config?.ceiling ?? TOOLS_STRICT_ERROR_CEILING;
  const plant = config?.plantCeiling ?? TOOLS_STRICT_ERROR_CEILING_AT_PLANT;
  const actual = config?.actualErrorCount ?? collectToolsStrictDiagnostics(config).length;
  const violations: string[] = [];
  if (ceiling > plant) {
    violations.push(`TOOLS_STRICT_ERROR_CEILING ${ceiling} > plant freeze ${plant} (do NOT raise the ceiling).`);
  }
  if (actual > ceiling) {
    violations.push(
      `tools strict-flag error count ${actual} > frozen ceiling ${ceiling} (pnpm typecheck:tools-strict; fix the new errors; do NOT raise the ceiling).`,
    );
  }
  if (actual < ceiling) {
    violations.push(
      `tools strict-flag error count now ${actual} < ceiling ${ceiling} — lower TOOLS_STRICT_ERROR_CEILING (paid down! ratchet must tighten).`,
    );
  }
  return violations;
}

/**
 * tools/agent-factory/check-typescript-guardrails.ts forbids relaxing strict options in any
 * apps/ or packages/ tsconfig. It existed but no hook ran it; it was red from at least
 * 2026-09 (sc-05/sc-10 evidence) while 29 sidecars carried false overrides.
 */
export function checkTypescriptGuardrails(config?: { workspaceRoot?: string }): string[] {
  const result = spawnSync("pnpm", ["-s", "typecheck:guardrails"], {
    cwd: config?.workspaceRoot ?? findWorkspaceRoot(),
    encoding: "utf8",
    env: process.env,
  });
  if (result.status === 0) return [];
  return [`pnpm typecheck:guardrails failed (exit ${String(result.status)}):\n${result.stderr ?? ""}${result.stdout ?? ""}`];
}
