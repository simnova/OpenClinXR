import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_GROUPS } from "./apply-map.js";
import {
  APPROVALS_DIR_REL,
  RAW_INVENTORY_REL,
  groupHash,
  inventoryHash,
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
  metric: keyof typeof METRIC_TO_TARGET;
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

export type ReviewTarget = keyof typeof REVIEW_TARGETS;

type LoadedExceptionFile = { fileName: string; id: string; exceptions: unknown[] };

function loadExceptions(root: string): { files: LoadedExceptionFile[]; error?: string } {
  const dir = join(root, EXCEPTIONS_DIR_REL);
  if (!existsSync(dir)) return { files: [] };
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return { files: [], error: `exceptions dir ${EXCEPTIONS_DIR_REL} unreadable` };
  }
  const files: LoadedExceptionFile[] = [];
  for (const name of names) {
    const value = readJson(root, `${EXCEPTIONS_DIR_REL}/${name}`);
    const flag = completionFlag(value);
    if (flag !== undefined) {
      return { files: [], error: `exception ${name} carries self-attested completion flag "${flag}"` };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { files: [], error: `exception ${name} is malformed` };
    }
    const rec = value as Record<string, unknown>;
    const idRaw = rec["id"];
    files.push({
      fileName: name,
      id: typeof idRaw === "string" && idRaw !== "" ? idRaw : name,
      exceptions: Array.isArray(rec["exceptions"]) ? rec["exceptions"] : [],
    });
  }
  return { files };
}

export const METRIC_TO_TARGET = {
  rootSymbols: "rootExportsAtMost",
  median: "medianAtMost",
  p90: "p90AtMost",
  maxRoot: "noRootAbove",
  duplicateNames: "duplicateNamesAtMost",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReviewTarget(value: unknown): value is ReviewTarget {
  return (
    value === "rootExportsAtMost" ||
    value === "medianAtMost" ||
    value === "p90AtMost" ||
    value === "noRootAbove" ||
    value === "duplicateNamesAtMost"
  );
}

function isOldKindShape(entry: Record<string, unknown>): boolean {
  return "kind" in entry && !isReviewTarget(entry["target"]);
}

const KIND_TO_TARGET: Record<string, ReviewTarget> = {
  "program-root-export-count": "rootExportsAtMost",
  "program-median-root-symbols": "medianAtMost",
  "program-p90-root-symbols": "p90AtMost",
  "program-no-root-above": "noRootAbove",
  "program-duplicate-names": "duplicateNamesAtMost",
};

function independentlyReviewed(
  files: LoadedExceptionFile[],
  target: ReviewTarget,
  measured: number,
  threshold: number,
): { coveredBy?: string; refuse: string } {
  const oldShapeFiles: string[] = [];
  let sameOwner = false;
  let missingReviewer = false;
  let staleMeasured = false;
  let wrongThreshold = false;
  for (const file of files) {
    const rel = `${EXCEPTIONS_DIR_REL}/${file.fileName}`;
    for (const raw of file.exceptions) {
      if (!isRecord(raw)) continue;
      if (isOldKindShape(raw)) {
        const mapped = typeof raw["kind"] === "string" ? KIND_TO_TARGET[raw["kind"]] : undefined;
        if (mapped === target) oldShapeFiles.push(rel);
        continue;
      }
      if (raw["target"] !== target) continue;
      const owner = raw["owner"];
      const reason = raw["reason"];
      const reviewedBy = raw["reviewedBy"];
      if (typeof reviewedBy !== "string" || reviewedBy === "") {
        missingReviewer = true;
        continue;
      }
      if (typeof owner !== "string" || owner === "" || typeof reason !== "string" || reason === "") continue;
      if (reviewedBy === owner) {
        sameOwner = true;
        continue;
      }
      if (raw["threshold"] !== threshold) {
        wrongThreshold = true;
        continue;
      }
      if (raw["measured"] !== measured) {
        staleMeasured = true;
        continue;
      }
      return { coveredBy: file.id, refuse: "" };
    }
  }
  const head = `${target} ${measured} > ${threshold}`;
  if (oldShapeFiles.length > 0) {
    const named = [...new Set(oldShapeFiles)].join(", ");
    return { refuse: `${head} (${named} uses the retired kind shape, not target/measured/threshold/reviewedBy)` };
  }
  if (sameOwner) return { refuse: `${head} (reviewedBy equals owner; independent review required)` };
  if (missingReviewer) return { refuse: `${head} (no reviewedBy)` };
  if (staleMeasured) return { refuse: `${head} (exception measured differs from the tree)` };
  if (wrongThreshold) return { refuse: `${head} (exception threshold does not match REVIEW_TARGETS)` };
  return { refuse: `${head} (no independently reviewed exception)` };
}

function criterion6(
  report: SurfaceReport,
  quantiles: { median: number; p90: number; maxRoot: number },
  files: LoadedExceptionFile[],
): { result: CriterionResult; misses: QuantitativeMiss[]; targetsMet: boolean } {
  const checks: { metric: keyof typeof METRIC_TO_TARGET; measured: number; target: number }[] = [
    { metric: "rootSymbols", measured: report.totals.rootSymbols, target: REVIEW_TARGETS.rootExportsAtMost },
    { metric: "median", measured: quantiles.median, target: REVIEW_TARGETS.medianAtMost },
    { metric: "p90", measured: quantiles.p90, target: REVIEW_TARGETS.p90AtMost },
    { metric: "maxRoot", measured: quantiles.maxRoot, target: REVIEW_TARGETS.noRootAbove },
    { metric: "duplicateNames", measured: report.totals.duplicateNames, target: REVIEW_TARGETS.duplicateNamesAtMost },
  ];
  const misses: QuantitativeMiss[] = [];
  const uncovered: string[] = [];
  for (const check of checks) {
    if (check.measured <= check.target) continue;
    const match = independentlyReviewed(files, METRIC_TO_TARGET[check.metric], check.measured, check.target);
    const miss: QuantitativeMiss = { metric: check.metric, measured: check.measured, target: check.target };
    if (match.coveredBy !== undefined) miss.exceptionId = match.coveredBy;
    misses.push(miss);
    if (match.coveredBy === undefined) uncovered.push(match.refuse);
  }
  const targetsMet = misses.length === 0;
  if (uncovered.length > 0) {
    return {
      result: { criterion: "6", id: "quantitative-review-targets", ok: false, detail: uncovered.join("; ") },
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
      detail: `targets missed with independently reviewed exceptions: ${misses.map((miss) => `${miss.metric}=${miss.measured} via ${miss.exceptionId}`).join("; ")}`,
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
  const programClose = c3.ok && c4.ok && c5.ok && c6.result.ok && c12.ok;
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

const SELF_TEST_GROUPS: readonly { group: string; dir: string }[] = [
  { group: "psr-01b", dir: "packages/openclinxr/g-b" },
  { group: "psr-01c", dir: "packages/openclinxr/g-c" },
  { group: "psr-01d", dir: "packages/openclinxr/g-d" },
  { group: "psr-01e", dir: "packages/openclinxr/g-e" },
];

function writeSelfTestPackage(fixture: string, dir: string, source: string): void {
  mkdirSync(join(fixture, dir, "src"), { recursive: true });
  writeFileSync(join(fixture, dir, "package.json"), SELF_TEST_MANIFEST(`@openclinxr/${dir.split("/").pop()}`));
  writeFileSync(join(fixture, dir, "src/index.ts"), source);
}

function bulkySource(): string {
  return `${Array.from({ length: 60 }, (_, index) => `export const n${index} = ${index};\n`).join("")}export const kept = 1;\n`;
}

function writeClassifiedBulky(fixture: string): void {
  writeFileSync(join(fixture, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
  for (const item of SELF_TEST_GROUPS) {
    writeSelfTestPackage(fixture, item.dir, item.dir.endsWith("g-e") ? bulkySource() : "export const kept = 1;\n");
  }
  const report = measureSurface(fixture);
  const rows: { package: string; entrypoint: string; symbol: string; kind: string }[] = [];
  for (const pkg of report.packages) {
    for (const entry of pkg.entrypoints) {
      for (const symbol of entry.symbols) {
        rows.push({ package: pkg.packageDir, entrypoint: entry.specifier, symbol: symbol.name, kind: symbol.kind });
      }
    }
  }
  mkdirSync(join(fixture, "docs/openclinxr/package-public-surface-reduction"), { recursive: true });
  writeFileSync(join(fixture, RAW_INVENTORY_REL), JSON.stringify({ inventoryHash: inventoryHash(fixture, report), rows }, null, 2));
  mkdirSync(join(fixture, APPROVALS_DIR_REL), { recursive: true });
  for (const item of SELF_TEST_GROUPS) {
    const scoped = rows.filter((row) => row.package === item.dir);
    writeFileSync(
      join(fixture, `${APPROVALS_DIR_REL}/${item.group}.json`),
      JSON.stringify({
        id: item.group,
        rawInventoryHash: inventoryHash(fixture, report),
        groupHash: groupHash(rows, [item.dir]),
        rows: scoped.map((row) => ({
          ...row,
          disposition: "keep",
          owner: "fixture",
          rationale: "self-test keep",
        })),
      }),
    );
  }
}

function writeExceptionFile(fixture: string, name: string, exceptions: unknown[]): void {
  mkdirSync(join(fixture, EXCEPTIONS_DIR_REL), { recursive: true });
  writeFileSync(join(fixture, `${EXCEPTIONS_DIR_REL}/${name}`), JSON.stringify({ id: name.replace(/\.json$/u, ""), exceptions }));
}

function withTemp(prefix: string, run: (root: string) => GateResult): GateResult {
  const root = join(tmpdir(), `${prefix}-${process.pid}`);
  try {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function entriesForMisses(evaluation: AcceptanceEvaluation, tweak: (entry: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown>[] {
  return evaluation.record.quantitativeMisses.map((miss) =>
    tweak({
      target: METRIC_TO_TARGET[miss.metric],
      measured: miss.measured,
      threshold: miss.target,
      owner: "psr-08",
      reason: "fixture residual",
      reviewedBy: "independent-reviewer",
    }),
  );
}

/** Fail-closed proofs: empty/wildcard plus C6 reviewedBy fixtures. */
export function acceptanceSelfTest(): GateResult[] {
  const out: GateResult[] = [];
  out.push(
    withTemp("psr-00b-empty", (root) => {
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
      const empty = evaluateAcceptance(root);
      return {
        ok: empty.record.verdict === "refuse" && !empty.record.criteria["12"].ok,
        detail: `empty sample refused: ${empty.record.criteria["12"].detail}`,
      };
    }),
  );
  out.push(
    withTemp("psr-00b-wild", (root) => {
      writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/**\n");
      writeSelfTestPackage(root, "packages/openclinxr/fixture-wild", "export const kept = 1;\nexport * from './empty.js';\n");
      writeFileSync(join(root, "packages/openclinxr/fixture-wild/src/empty.ts"), "export {};\n");
      const wild = evaluateAcceptance(root);
      return { ok: !wild.record.criteria["3"].ok, detail: `wildcard publication refused: ${wild.record.criteria["3"].detail}` };
    }),
  );
  out.push(
    withTemp("psr-00b-c6-none", (root) => {
      writeClassifiedBulky(root);
      const evaluation = evaluateAcceptance(root);
      return {
        ok: !evaluation.record.criteria["6"].ok && evaluation.record.criteria["6"].detail.includes("no independently reviewed exception"),
        detail: `C6 no-exception refused: ${evaluation.record.criteria["6"].detail}`,
      };
    }),
  );
  out.push(
    withTemp("psr-00b-c6-owner", (root) => {
      writeClassifiedBulky(root);
      const baseline = evaluateAcceptance(root);
      writeExceptionFile(root, "psr-self.json", entriesForMisses(baseline, (entry) => ({ ...entry, reviewedBy: String(entry["owner"]) })));
      const evaluation = evaluateAcceptance(root);
      return {
        ok: !evaluation.record.criteria["6"].ok && evaluation.record.criteria["6"].detail.includes("reviewedBy equals owner"),
        detail: `C6 reviewedBy==owner refused: ${evaluation.record.criteria["6"].detail}`,
      };
    }),
  );
  out.push(
    withTemp("psr-00b-c6-norev", (root) => {
      writeClassifiedBulky(root);
      const baseline = evaluateAcceptance(root);
      writeExceptionFile(
        root,
        "psr-self.json",
        entriesForMisses(baseline, (entry) => {
          const { reviewedBy: _reviewedBy, ...rest } = entry;
          void _reviewedBy;
          return rest;
        }),
      );
      const evaluation = evaluateAcceptance(root);
      return {
        ok: !evaluation.record.criteria["6"].ok && evaluation.record.criteria["6"].detail.includes("no reviewedBy"),
        detail: `C6 missing reviewedBy refused: ${evaluation.record.criteria["6"].detail}`,
      };
    }),
  );
  out.push(
    withTemp("psr-00b-c6-stale", (root) => {
      writeClassifiedBulky(root);
      const baseline = evaluateAcceptance(root);
      writeExceptionFile(root, "psr-self.json", entriesForMisses(baseline, (entry) => ({ ...entry, measured: 1 })));
      const evaluation = evaluateAcceptance(root);
      return {
        ok: !evaluation.record.criteria["6"].ok && evaluation.record.criteria["6"].detail.includes("measured differs from the tree"),
        detail: `C6 stale measured refused: ${evaluation.record.criteria["6"].detail}`,
      };
    }),
  );
  out.push(
    withTemp("psr-00b-c6-ok", (root) => {
      writeClassifiedBulky(root);
      const baseline = evaluateAcceptance(root);
      writeExceptionFile(root, "psr-self.json", entriesForMisses(baseline, (entry) => entry));
      const evaluation = evaluateAcceptance(root);
      return {
        ok: evaluation.record.criteria["6"].ok,
        detail: `C6 conforming reviewed exception accepted: ${evaluation.record.criteria["6"].detail}`,
      };
    }),
  );
  return out;
}
