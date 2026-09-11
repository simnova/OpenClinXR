import { createHash } from "node:crypto";
import { evaluateAcceptance } from "./acceptance-criteria.js";
import type { AcceptanceRecord } from "./acceptance-criteria.js";
import { consumerFormSummary, discoverConsumers } from "./consumers.js";
import {
  currentManifestHashes,
  inventoryHash,
  requireAllReviewed,
  requireApplied,
  requireInventory,
  requireReviewedGroup,
} from "./gates.js";
import type { GateResult } from "./gates.js";
import { measureSurface } from "./resolve.js";
import type { SurfaceReport } from "./resolve.js";

/**
 * Shared CLI runner for the compiler-derived public-surface verifier (PSR-00).
 *
 * The CLIs are thin wrappers: verify.ts parses flags and delegates here, acceptance.ts
 * delegates its report path here. Neither CLI writes into the repository unless an
 * explicit output flag (--write-baseline, --report-out, --report) is passed.
 */

export type WriteFile = (rel: string, bytes: string) => void;

export type VerifyArgs = {
  requireInventoryFlag: boolean;
  reviewedGroups: string[];
  appliedGroups: string[];
  requireAllReviewedFlag: boolean;
  writeBaseline: boolean;
  reportOut?: string;
};

export type BaselineEntrypoint = {
  specifier: string;
  wildcardDeclarations: number;
  typeWildcardDeclarations: number;
};

export type BaselinePackage = {
  packageDir: string;
  rootSymbols: number;
  occurrences: number;
  uniqueSymbols: number;
  duplicateNames: number;
  entrypoints: BaselineEntrypoint[];
};

export type BaselineFile = {
  hash?: string;
  revision?: string;
  totals?: Record<string, number>;
  inventoryHash?: string;
  manifestHashes?: Record<string, string>;
  consumerForms?: Record<string, Record<string, number>>;
  consumerPackages?: number;
  packages?: BaselinePackage[];
};

export type BaselineSummary = BaselineFile & {
  hash: string;
  revision: string;
  totals: SurfaceReport["totals"];
  inventoryHash: string;
  manifestHashes: Record<string, string>;
  consumerPackages: number;
};

export function parseVerifyArgs(args: string[]): VerifyArgs {
  const out: VerifyArgs = {
    requireInventoryFlag: false,
    reviewedGroups: [],
    appliedGroups: [],
    requireAllReviewedFlag: false,
    writeBaseline: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--require-inventory") out.requireInventoryFlag = true;
    else if (flag === "--require-reviewed-group") {
      out.reviewedGroups.push(args[index + 1] ?? "");
      index += 1;
    } else if (flag === "--require-applied") {
      out.appliedGroups.push(args[index + 1] ?? "");
      index += 1;
    } else if (flag === "--require-all-reviewed") out.requireAllReviewedFlag = true;
    else if (flag === "--write-baseline") out.writeBaseline = true;
    else if (flag === "--report-out") {
      out.reportOut = args[index + 1] ?? "";
      index += 1;
    }
  }
  return out;
}

export function surfaceSummaryLine(report: SurfaceReport): string {
  const hash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  return (
    `${report.totals.roots} roots, ${report.totals.entrypoints} entrypoints, `
    + `${report.totals.rootSymbols} root symbols, ${report.totals.occurrences} occurrences, `
    + `${report.totals.uniqueSymbols} unique, ${report.totals.duplicateNames} duplicated names (surface ${hash.slice(0, 12)})`
  );
}

/** Full baseline record: totals plus the per-package, per-entrypoint table the ratchet reads. */
export function baselineRecord(root: string, report: SurfaceReport): BaselineSummary {
  return {
    hash: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    revision: "working-tree",
    totals: report.totals,
    inventoryHash: inventoryHash(root, report),
    manifestHashes: currentManifestHashes(root),
    consumerForms: consumerFormSummary(root),
    consumerPackages: discoverConsumers(root).size,
    packages: report.packages.map((pkg) => ({
      packageDir: pkg.packageDir,
      rootSymbols: pkg.rootSymbols,
      occurrences: pkg.occurrences,
      uniqueSymbols: pkg.uniqueSymbols,
      duplicateNames: pkg.duplicateNames.length,
      entrypoints: pkg.entrypoints.map((entry) => ({
        specifier: entry.specifier,
        wildcardDeclarations: entry.wildcardDeclarations,
        typeWildcardDeclarations: entry.typeWildcardDeclarations,
      })),
    })),
  };
}

export type BaselineComparison = { ok: boolean; detail: string };

/** Plain verify compares the measured surface with the checked-in baseline: growth fails. */
export function compareToBaseline(report: SurfaceReport, baseline: BaselineFile): BaselineComparison {
  const totals = baseline.totals ?? {};
  const failures: string[] = [];
  const check = (label: string, measured: number, allowed: number | undefined): void => {
    if (allowed === undefined) return;
    if (measured > allowed) failures.push(`${label} grew to ${measured} > baseline ${allowed}`);
  };
  check("root symbols", report.totals.rootSymbols, totals["rootSymbols"]);
  check("occurrences", report.totals.occurrences, totals["occurrences"]);
  check("unique symbols", report.totals.uniqueSymbols, totals["uniqueSymbols"]);
  check("duplicated names", report.totals.duplicateNames, totals["duplicateNames"]);
  const allowedByPackage = new Map((baseline.packages ?? []).map((pkg) => [pkg.packageDir, pkg]));
  for (const pkg of report.packages) {
    const allowed = allowedByPackage.get(pkg.packageDir);
    if (allowed === undefined) {
      failures.push(`${pkg.packageDir} is not in the checked-in baseline`);
      continue;
    }
    check(`${pkg.packageDir} root symbols`, pkg.rootSymbols, allowed.rootSymbols);
    check(`${pkg.packageDir} occurrences`, pkg.occurrences, allowed.occurrences);
    check(`${pkg.packageDir} unique symbols`, pkg.uniqueSymbols, allowed.uniqueSymbols);
    check(`${pkg.packageDir} duplicated names`, pkg.duplicateNames.length, allowed.duplicateNames);
    const allowedWildcards = new Map(
      (allowed.entrypoints ?? []).map((entry) => [entry.specifier, entry]),
    );
    for (const entry of pkg.entrypoints) {
      const allowedEntry = allowedWildcards.get(entry.specifier);
      if (allowedEntry === undefined) {
        failures.push(`${pkg.packageDir}${entry.specifier} is not in the checked-in baseline`);
        continue;
      }
      check(
        `${pkg.packageDir}${entry.specifier} wildcard declarations`,
        entry.wildcardDeclarations,
        allowedEntry.wildcardDeclarations,
      );
      check(
        `${pkg.packageDir}${entry.specifier} type wildcard declarations`,
        entry.typeWildcardDeclarations,
        allowedEntry.typeWildcardDeclarations,
      );
    }
  }
  if (failures.length === 0) return { ok: true, detail: "surface matches the checked-in baseline (no growth)" };
  return { ok: false, detail: failures.slice(0, 8).join("; ") };
}

export type RunnerIo = {
  readBaseline: () => BaselineFile | undefined;
  writeFile: WriteFile;
};

export type RunVerifyOptions = {
  root: string;
  args: string[];
  io: RunnerIo;
};

export type RunVerifyOutcome = { failed: boolean; lines: string[]; summary: BaselineSummary };

export function runVerify(options: RunVerifyOptions): RunVerifyOutcome {
  const { root, args, io } = options;
  const parsed = parseVerifyArgs(args);
  const report = measureSurface(root);
  const lines: string[] = [surfaceSummaryLine(report)];
  const results: GateResult[] = [];
  if (parsed.requireInventoryFlag) results.push(requireInventory(root, report));
  for (const group of parsed.reviewedGroups) results.push(requireReviewedGroup(root, group));
  for (const group of parsed.appliedGroups) results.push(requireApplied(root, group, report));
  if (parsed.requireAllReviewedFlag) results.push(requireAllReviewed(root));
  for (const result of results) lines.push(`${result.ok ? "ok" : "FAIL"}: ${result.detail}`);
  const summary = baselineRecord(root, report);
  if (parsed.writeBaseline) {
    io.writeFile(
      "docs/openclinxr/package-public-surface-reduction/baseline.json",
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    lines.push("baseline written (--write-baseline)");
  } else {
    const baseline = io.readBaseline();
    if (baseline !== undefined) {
      const comparison = compareToBaseline(report, baseline);
      lines.push(`${comparison.ok ? "ok" : "FAIL"} baseline ratchet: ${comparison.detail}`);
      results.push(comparison);
    }
  }
  if (parsed.reportOut !== undefined && parsed.reportOut !== "") {
    io.writeFile(
      parsed.reportOut,
      `${JSON.stringify({ hash: summary.hash, totals: report.totals, packages: report.packages }, null, 2)}\n`,
    );
    lines.push(`report written to ${parsed.reportOut}`);
  }
  return { failed: results.some((result) => !result.ok), lines, summary };
}

export type RunAcceptanceOptions = {
  root: string;
  args: string[];
  io: RunnerIo;
};

export type RunAcceptanceOutcome = { failed: boolean; lines: string[]; record: AcceptanceRecord };

/** Acceptance recomputes criteria 3/4/5/6/12; it writes only with an explicit --report flag. */
export function runAcceptance(options: RunAcceptanceOptions): RunAcceptanceOutcome {
  const { root, args, io } = options;
  const evaluation = evaluateAcceptance(root);
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--report" || args[index] === "--report-out") {
      output = args[index + 1] ?? "";
      index += 1;
    }
  }
  const lines = [...evaluation.lines];
  if (output !== undefined && output !== "") {
    io.writeFile(output, `${JSON.stringify(evaluation.record, null, 2)}\n`);
    lines.push(`acceptance report written to ${output}`);
  }
  if (evaluation.failed) {
    lines.push(`acceptance refuse: ${evaluation.record.refuseReasons[0] ?? "named criterion failed"}`);
  } else {
    lines.push("acceptance close: criteria 3, 4, 5, 6 and 12 hold on the recomputed tree");
  }
  return { failed: evaluation.failed, lines, record: evaluation.record };
}
