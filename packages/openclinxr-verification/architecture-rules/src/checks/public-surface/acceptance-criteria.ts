import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_GROUPS } from "./apply-map.js";
import {
  APPROVALS_DIR_REL,
  RAW_INVENTORY_REL,
  requireAllReviewed,
  requireApplied,
} from "./gates.js";
import type { ApprovalRow, GateResult, RawInventoryRow } from "./gates.js";
import { measureSurface } from "./resolve.js";
import type { SurfaceReport } from "./resolve.js";

/**
 * PSR-00B acceptance: plan criteria 3, 4, 5, 6 and 12 (plan:117-128).
 *
 * Recomputes the compiler surface, reuses --require-applied / --require-all-reviewed,
 * and names a refuse reason. Child-card status and a self-authored success flag
 * cannot close the program. Independent review of residual exceptions is residual.
 */

export const CELLIX_REFERENCE_REVISION = "adf3bc9deb2d0ca006041d9326215996a2b00e12";
export const CELLIX_CLONE_PATH = "/Volumes/files/src/cellixjs-current";
export const EXCEPTIONS_DIR_REL = "docs/openclinxr/package-public-surface-reduction/exceptions";

/** Plan criterion 6 review targets (plan:122). */
export const REVIEW_TARGETS = {
  rootExportsAtMost: 1000,
  medianAtMost: 15,
  p90AtMost: 25,
  noRootAbove: 50,
  duplicateNamesAtMost: 200,
} as const;

const COMPLETION_KEYS = new Set(["migrated", "completedby", "completed", "done", "applied", "complete", "success"]);

export type CriterionName = "3" | "4" | "5" | "6" | "12";

export type CriterionResult = {
  criterion: CriterionName;
  id: string;
  ok: boolean;
  detail: string;
};

export type QuantitativeMiss = {
  metric: string;
  measured: number;
  target: number;
  exceptionId?: string;
};

export type AcceptanceRecord = {
  schema: "openclinxr.psr-00b-acceptance.v1";
  revision: string;
  hash: string;
  totals: SurfaceReport["totals"];
  quantiles: { median: number; p90: number; maxRoot: number };
  cellix: {
    planPin: string;
    clonePath: string;
    clone: "absent" | { head: string; matchesPin: boolean };
  };
  criteria: Record<CriterionName, CriterionResult>;
  quantitativeMisses: QuantitativeMiss[];
  verdict: "close" | "refuse";
  refuseReasons: string[];
  limitations: string;
  notTested: string;
};

export type AcceptanceEvaluation = {
  failed: boolean;
  lines: string[];
  record: AcceptanceRecord;
};

function readJson(root: string, rel: string): unknown | undefined {
  const full = join(root, rel);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function completionFlag(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!COMPLETION_KEYS.has(key.toLowerCase())) continue;
    if (entry === true) return key;
    if (typeof entry === "string" && entry !== "") return key;
    if (typeof entry === "number" && entry !== 0) return key;
  }
  return undefined;
}

function rowKey(row: { package: string; entrypoint: string; symbol: string; kind?: string }): string {
  return `${row.package}\t${row.entrypoint}\t${row.symbol}\t${row.kind ?? "runtime"}`;
}

function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Nearest-rank p90 on a sorted ascending sample (plan:122). */
function p90Of(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(0.9 * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function rootQuantiles(report: SurfaceReport): { median: number; p90: number; maxRoot: number } {
  const roots = report.packages.map((pkg) => pkg.rootSymbols).sort((left, right) => left - right);
  return { median: medianOf(roots), p90: p90Of(roots), maxRoot: roots[roots.length - 1] ?? 0 };
}

function criterion3(report: SurfaceReport): CriterionResult {
  const hits: string[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      if (entry.wildcardDeclarations > 0) {
        hits.push(`${pkg.packageDir}${entry.specifier} export * from ×${entry.wildcardDeclarations}`);
      }
      if (entry.typeWildcardDeclarations > 0) {
        hits.push(`${pkg.packageDir}${entry.specifier} export type * from ×${entry.typeWildcardDeclarations}`);
      }
    }
  }
  if (hits.length === 0) {
    return {
      criterion: "3",
      id: "no-wildcard-publication",
      ok: true,
      detail: "zero export * / export type * on supported entrypoints",
    };
  }
  return { criterion: "3", id: "no-wildcard-publication", ok: false, detail: hits.slice(0, 5).join("; ") };
}

function criterion4(root: string): CriterionResult {
  const raw = readJson(root, RAW_INVENTORY_REL) as { inventoryHash?: string; rows?: RawInventoryRow[] } | undefined;
  if (raw === undefined || !Array.isArray(raw.rows)) {
    return {
      criterion: "4",
      id: "complete-contract-inventory",
      ok: false,
      detail: `raw inventory ${RAW_INVENTORY_REL} is absent or malformed`,
    };
  }
  const classified = new Map<string, string>();
  const unresolved: string[] = [];
  for (const group of REVIEW_GROUPS) {
    const value = readJson(root, `${APPROVALS_DIR_REL}/${group}.json`) as { rows?: ApprovalRow[] } | undefined;
    if (value === undefined || !Array.isArray(value.rows) || value.rows.length === 0) {
      return {
        criterion: "4",
        id: "complete-contract-inventory",
        ok: false,
        detail: `approval manifest for ${group} is absent or empty`,
      };
    }
    for (const row of value.rows) {
      const disposition = row.disposition ?? "unresolved";
      classified.set(rowKey(row), disposition);
      if (disposition === "unresolved") unresolved.push(`${row.package}${row.entrypoint} ${row.symbol}`);
    }
  }
  const missing = (raw.rows ?? []).filter((row) => !classified.has(rowKey(row)));
  if (unresolved.length > 0) {
    return {
      criterion: "4",
      id: "complete-contract-inventory",
      ok: false,
      detail: `${unresolved.length} unresolved classifications: ${unresolved.slice(0, 5).join(", ")}`,
    };
  }
  if (missing.length > 0) {
    return {
      criterion: "4",
      id: "complete-contract-inventory",
      ok: false,
      detail: `${missing.length} inventory symbols have no keep/remove/migrate row: ${missing
        .slice(0, 3)
        .map((row) => `${row.package} ${row.symbol}`)
        .join(", ")}`,
    };
  }
  return {
    criterion: "4",
    id: "complete-contract-inventory",
    ok: true,
    detail: `all ${raw.rows.length} inventory symbols classified keep/remove/migrate`,
  };
}

function criterion5(root: string, report: SurfaceReport): CriterionResult {
  const reviewed = requireAllReviewed(root);
  if (!reviewed.ok) {
    return { criterion: "5", id: "reviewed-execution", ok: false, detail: reviewed.detail };
  }
  const applied: GateResult[] = [];
  for (const group of REVIEW_GROUPS) applied.push(requireApplied(root, group, report));
  const failed = applied.filter((result) => !result.ok);
  if (failed.length > 0) {
    return {
      criterion: "5",
      id: "reviewed-execution",
      ok: false,
      detail: failed.map((result) => result.detail).join("; "),
    };
  }
  return {
    criterion: "5",
    id: "reviewed-execution",
    ok: true,
    detail: `${reviewed.detail}; applied ${REVIEW_GROUPS.join(", ")}`,
  };
}

type ExceptionFile = { id?: string; exceptions?: { kind?: string; owner?: string; reason?: string }[] };

function loadExceptions(root: string): { files: ExceptionFile[]; error?: string } {
  const dir = join(root, EXCEPTIONS_DIR_REL);
  if (!existsSync(dir)) return { files: [] };
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return { files: [], error: `exceptions dir ${EXCEPTIONS_DIR_REL} unreadable` };
  }
  const files: ExceptionFile[] = [];
  for (const name of names) {
    const value = readJson(root, `${EXCEPTIONS_DIR_REL}/${name}`);
    const flag = completionFlag(value);
    if (flag !== undefined) {
      return { files: [], error: `exception ${name} carries self-attested completion flag "${flag}"` };
    }
    if (value === null || typeof value !== "object") {
      return { files: [], error: `exception ${name} is malformed` };
    }
    files.push(value as ExceptionFile);
  }
  return { files };
}

const TARGET_KIND = {
  rootExports: "program-root-export-count",
  median: "program-median-root-symbols",
  p90: "program-p90-root-symbols",
  maxRoot: "program-no-root-above",
  duplicateNames: "program-duplicate-names",
} as const;

function exceptionFor(files: ExceptionFile[], kind: string): string | undefined {
  for (const file of files) {
    for (const entry of file.exceptions ?? []) {
      if (entry.kind === kind && typeof entry.owner === "string" && entry.owner !== "" && typeof entry.reason === "string" && entry.reason !== "") {
        return typeof file.id === "string" ? file.id : kind;
      }
    }
  }
  return undefined;
}

function criterion6(
  report: SurfaceReport,
  quantiles: { median: number; p90: number; maxRoot: number },
  files: ExceptionFile[],
): { result: CriterionResult; misses: QuantitativeMiss[]; targetsMet: boolean } {
  const checks: { metric: string; measured: number; target: number; kind: string }[] = [
    { metric: "rootSymbols", measured: report.totals.rootSymbols, target: REVIEW_TARGETS.rootExportsAtMost, kind: TARGET_KIND.rootExports },
    { metric: "median", measured: quantiles.median, target: REVIEW_TARGETS.medianAtMost, kind: TARGET_KIND.median },
    { metric: "p90", measured: quantiles.p90, target: REVIEW_TARGETS.p90AtMost, kind: TARGET_KIND.p90 },
    { metric: "maxRoot", measured: quantiles.maxRoot, target: REVIEW_TARGETS.noRootAbove, kind: TARGET_KIND.maxRoot },
    { metric: "duplicateNames", measured: report.totals.duplicateNames, target: REVIEW_TARGETS.duplicateNamesAtMost, kind: TARGET_KIND.duplicateNames },
  ];
  const misses: QuantitativeMiss[] = [];
  const uncovered: string[] = [];
  for (const check of checks) {
    if (check.measured <= check.target) continue;
    const exceptionId = exceptionFor(files, check.kind);
    const miss: QuantitativeMiss = { metric: check.metric, measured: check.measured, target: check.target };
    if (exceptionId !== undefined) miss.exceptionId = exceptionId;
    misses.push(miss);
    if (exceptionId === undefined) uncovered.push(`${check.metric} ${check.measured} > ${check.target} (no exception ${check.kind})`);
  }
  const targetsMet = misses.length === 0;
  if (uncovered.length > 0) {
    return {
      result: {
        criterion: "6",
        id: "quantitative-review-targets",
        ok: false,
        detail: uncovered.join("; "),
      },
      misses,
      targetsMet,
    };
  }
  if (targetsMet) {
    return {
      result: {
        criterion: "6",
        id: "quantitative-review-targets",
        ok: true,
        detail: `rootSymbols ${report.totals.rootSymbols}≤${REVIEW_TARGETS.rootExportsAtMost}, median ${quantiles.median}≤${REVIEW_TARGETS.medianAtMost}, p90 ${quantiles.p90}≤${REVIEW_TARGETS.p90AtMost}, maxRoot ${quantiles.maxRoot}≤${REVIEW_TARGETS.noRootAbove}, dups ${report.totals.duplicateNames}≤${REVIEW_TARGETS.duplicateNamesAtMost}`,
      },
      misses,
      targetsMet,
    };
  }
  return {
    result: {
      criterion: "6",
      id: "quantitative-review-targets",
      ok: true,
      detail: `targets missed with checked-in exceptions: ${misses.map((miss) => `${miss.metric}=${miss.measured} via ${miss.exceptionId}`).join("; ")}`,
    },
    misses,
    targetsMet,
  };
}

function cellixClone(): AcceptanceRecord["cellix"]["clone"] {
  if (!existsSync(CELLIX_CLONE_PATH)) return "absent";
  const gitDir = join(CELLIX_CLONE_PATH, ".git");
  if (!existsSync(gitDir)) return { head: "unreadable", matchesPin: false };
  try {
    const headFile = readFileSync(join(CELLIX_CLONE_PATH, ".git", "HEAD"), "utf8").trim();
    let head = headFile;
    if (headFile.startsWith("ref: ")) {
      const ref = headFile.slice("ref: ".length);
      head = readFileSync(join(CELLIX_CLONE_PATH, ".git", ref), "utf8").trim();
    }
    return { head, matchesPin: head === CELLIX_REFERENCE_REVISION };
  } catch {
    return { head: "unreadable", matchesPin: false };
  }
}

function missingInventoryPackages(root: string, report: SurfaceReport): string[] {
  const raw = readJson(root, RAW_INVENTORY_REL) as { rows?: RawInventoryRow[] } | undefined;
  if (raw === undefined || !Array.isArray(raw.rows)) return [];
  const have = new Set(report.packages.map((pkg) => pkg.packageDir));
  const want = new Set(raw.rows.map((row) => row.package));
  return [...want].filter((dir) => !have.has(dir)).sort();
}

function criterion12(options: {
  report: SurfaceReport;
  missingPackages: string[];
  exceptionError: string | undefined;
  cellixRecorded: boolean;
}): CriterionResult {
  if (options.report.packages.length === 0 || options.report.totals.entrypoints === 0) {
    return {
      criterion: "12",
      id: "independent-closure",
      ok: false,
      detail: "empty sample: no packages or entrypoints (refuse; do not close on a raw count of zero)",
    };
  }
  if (options.missingPackages.length > 0) {
    return {
      criterion: "12",
      id: "independent-closure",
      ok: false,
      detail: `missing packages vs inventory: ${options.missingPackages.slice(0, 5).join(", ")}`,
    };
  }
  if (options.exceptionError !== undefined) {
    return { criterion: "12", id: "independent-closure", ok: false, detail: options.exceptionError };
  }
  if (!options.cellixRecorded) {
    return { criterion: "12", id: "independent-closure", ok: false, detail: "Cellix reference revision was not recorded" };
  }
  return {
    criterion: "12",
    id: "independent-closure",
    ok: true,
    detail: `recomputed ${options.report.packages.length} packages from the tree; Cellix pin ${CELLIX_REFERENCE_REVISION}; no self-attested completion flag`,
  };
}

export function evaluateAcceptance(root: string, report?: SurfaceReport): AcceptanceEvaluation {
  const measured = report ?? measureSurface(root);
  const quantiles = rootQuantiles(measured);
  const exceptions = loadExceptions(root);
  const c3 = criterion3(measured);
  const c4 = criterion4(root);
  const c5 = criterion5(root, measured);
  const c6 = criterion6(measured, quantiles, exceptions.files);
  const missingPackages = missingInventoryPackages(root, measured);
  const c12 = criterion12({
    report: measured,
    missingPackages,
    exceptionError: exceptions.error,
    cellixRecorded: CELLIX_REFERENCE_REVISION.length > 0,
  });
  const criteria = { "3": c3, "4": c4, "5": c5, "6": c6.result, "12": c12 };
  const refuseReasons: string[] = [];
  for (const item of [c3, c4, c5, c6.result, c12]) {
    if (!item.ok) refuseReasons.push(`criterion ${item.criterion} (${item.id}): ${item.detail}`);
  }
  const programClose = c3.ok && c4.ok && c5.ok && c6.targetsMet && c12.ok;
  if (!programClose && c6.result.ok && !c6.targetsMet) {
    refuseReasons.push(
      "criterion 6 targets missed with checked-in exceptions; independent review of those exceptions is residual (not this card)",
    );
  }
  const verdict: "close" | "refuse" = programClose ? "close" : "refuse";
  const record: AcceptanceRecord = {
    schema: "openclinxr.psr-00b-acceptance.v1",
    revision: "working-tree",
    hash: createHash("sha256").update(JSON.stringify(measured)).digest("hex"),
    totals: measured.totals,
    quantiles,
    cellix: {
      planPin: CELLIX_REFERENCE_REVISION,
      clonePath: CELLIX_CLONE_PATH,
      clone: cellixClone(),
    },
    criteria,
    quantitativeMisses: c6.misses,
    verdict,
    refuseReasons,
    limitations:
      "Unknown consumers outside this private repository; clinical validity, Quest readiness, runtime performance, and public npm compatibility. CellixJS is a directional reference, not feature-equivalence.",
    notTested:
      "Whether the residual exceptions will be accepted on review; that is decided outside this card.",
  };
  const lines = [
    `criterion 3 (${c3.id}): ${c3.ok ? "ok" : "FAIL"}: ${c3.detail}`,
    `criterion 4 (${c4.id}): ${c4.ok ? "ok" : "FAIL"}: ${c4.detail}`,
    `criterion 5 (${c5.id}): ${c5.ok ? "ok" : "FAIL"}: ${c5.detail}`,
    `criterion 6 (${c6.result.id}): ${c6.result.ok ? "ok" : "FAIL"}: ${c6.result.detail}`,
    `criterion 12 (${c12.id}): ${c12.ok ? "ok" : "FAIL"}: ${c12.detail}`,
    `verdict: ${verdict}${refuseReasons.length > 0 ? ` — ${refuseReasons[0]}` : ""}`,
  ];
  return { failed: verdict !== "close", lines, record };
}

const SELF_TEST_MANIFEST = (name: string): string =>
  JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } });

function writeSelfTestPackage(fixture: string, dir: string, source: string): void {
  mkdirSync(join(fixture, dir, "src"), { recursive: true });
  writeFileSync(join(fixture, dir, "package.json"), SELF_TEST_MANIFEST(`@openclinxr/${dir.split("/").pop()}`));
  writeFileSync(join(fixture, dir, "src/index.ts"), source);
}

/** Fail-closed proofs for acceptance: empty sample and leftover wildcards refuse. */
export function acceptanceSelfTest(): GateResult[] {
  const out: GateResult[] = [];
  const emptyRoot = join(tmpdir(), `psr-00b-empty-${process.pid}`);
  try {
    rmSync(emptyRoot, { recursive: true, force: true });
    mkdirSync(emptyRoot, { recursive: true });
    writeFileSync(join(emptyRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    const empty = evaluateAcceptance(emptyRoot);
    out.push({
      ok: empty.record.verdict === "refuse" && !empty.record.criteria["12"].ok,
      detail: `empty sample refused: ${empty.record.criteria["12"].detail}`,
    });
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
  const wildRoot = join(tmpdir(), `psr-00b-wild-${process.pid}`);
  try {
    rmSync(wildRoot, { recursive: true, force: true });
    mkdirSync(join(wildRoot, APPROVALS_DIR_REL), { recursive: true });
    writeFileSync(join(wildRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
    writeSelfTestPackage(
      wildRoot,
      "packages/openclinxr/fixture-wild",
      "export const kept = 1;\nexport * from './empty.js';\n",
    );
    writeFileSync(join(wildRoot, "packages/openclinxr/fixture-wild/src/empty.ts"), "export {};\n");
    const wild = evaluateAcceptance(wildRoot);
    out.push({
      ok: !wild.record.criteria["3"].ok,
      detail: `wildcard publication refused: ${wild.record.criteria["3"].detail}`,
    });
  } finally {
    rmSync(wildRoot, { recursive: true, force: true });
  }
  return out;
}
