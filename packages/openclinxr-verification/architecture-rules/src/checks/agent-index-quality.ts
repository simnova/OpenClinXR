import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPackageAgentIndex,
  findWorkspaceRoot,
  indexedPackages,
} from "./package-agent-index.js";

/**
 * Shrink-only ratchets on agent-index documentation quality (MADR 0060 decision 9).
 *
 * The index is derived, so its quality is a property of the tree's own TSDoc, not of the
 * committed JSON. Both ratchets measure from a fresh rebuild: hand-editing an arch-index.json
 * to clear one fails the currentness gate instead. Lowering either count means writing real
 * TSDoc in product packages, which is later work — a summary invented to clear this gate is
 * the defect it exists to catch.
 */

export const AGENT_INDEX_QUALITY_CEILING_FILENAME = "agent-index-quality.ceiling.json";

export type AgentIndexQualityMeasurement = {
  indexes: number;
  purposeMissingOrBoilerplate: number;
  exportsWithoutSummary: number;
  boilerplatePackages: string[];
};

export type AgentIndexQualityCeiling = {
  purposeMissingOrBoilerplate: number;
  exportsWithoutSummary: number;
};

/**
 * EXACT DEFINITION. A purpose is boilerplate when it is absent, or restates the package name
 * with no other content, or is shorter than 4 words. Operationally:
 *
 *   1. purpose === undefined (or blank) -> true. An absent purpose is a finding, not a default.
 *   2. /^Public (interface|entry)\b/ on the trimmed purpose -> true. This is the observed
 *      name-restating shape ("Public interface of @openclinxr/domain.",
 *      "Public entry: keep-only re-exports.").
 *   3. fewer than 4 whitespace-separated words -> true.
 *   4. otherwise, strip the package-name tokens (full specifier and trailing segment) and
 *      generic filler (public, interface, entry, package, of, the, for, a, an); nothing left
 *      -> true. This catches longer restatements such as "The xr-station-room package for XR."
 *
 * Anything else -> false. Deterministic: no I/O, no tree reads, pure function of two strings.
 */
export function isBoilerplatePurpose(purpose: string | undefined, packageName: string): boolean {
  if (purpose === undefined) return true;
  const text = purpose.trim();
  if (text === "") return true;
  if (/^Public (interface|entry)\b/u.test(text)) return true;
  if (text.split(/\s+/u).filter(Boolean).length < 4) return true;
  const short = packageName.split("/").pop() ?? packageName;
  const nameTokens = new Set(
    `${packageName} ${short}`.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
  );
  const filler = new Set([
    "public",
    "interface",
    "entry",
    "package",
    "of",
    "the",
    "for",
    "a",
    "an",
  ]);
  const rest = text
    .toLowerCase()
    .split(/[^a-z0-9@/-]+/u)
    .filter(Boolean)
    .filter((token) => !nameTokens.has(token) && !filler.has(token));
  return rest.length === 0;
}

/** Fresh rebuild of every indexed package; counts what the tree's own TSDoc does not say. */
export function measureAgentIndexQuality(
  root: string = findWorkspaceRoot(),
): AgentIndexQualityMeasurement {
  let purposeBad = 0;
  let withoutSummary = 0;
  let indexes = 0;
  const boilerplatePackages: string[] = [];
  for (const pkg of indexedPackages(root)) {
    const built = buildPackageAgentIndex(pkg, root);
    if (built === null) continue;
    indexes += 1;
    if (isBoilerplatePurpose(built.purpose, built.name)) {
      purposeBad += 1;
      boilerplatePackages.push(pkg);
    }
    for (const name of built.exports) {
      if (built.exportSummaries[name] === undefined) withoutSummary += 1;
    }
  }
  return {
    indexes,
    purposeMissingOrBoilerplate: purposeBad,
    exportsWithoutSummary: withoutSummary,
    boilerplatePackages: boilerplatePackages.sort(),
  };
}

/** The committed ceiling beside this file. Null when it is missing, which is itself a failure. */
export function readAgentIndexQualityCeiling(): AgentIndexQualityCeiling | null {
  const file = join(dirname(fileURLToPath(import.meta.url)), AGENT_INDEX_QUALITY_CEILING_FILENAME);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AgentIndexQualityCeiling;
  } catch {
    return null;
  }
}

/**
 * Shrink-only in both directions: above the ceiling fails (quality regressed), below the
 * ceiling fails (the tree improved and the ceiling must be lowered to the measured value).
 * Same semantics as the existing freezes.
 */
export function checkAgentIndexQuality(
  measured: AgentIndexQualityMeasurement = measureAgentIndexQuality(),
  ceiling: AgentIndexQualityCeiling | null = readAgentIndexQualityCeiling(),
): string[] {
  const violations: string[] = [];
  if (ceiling === null) {
    violations.push(
      `${AGENT_INDEX_QUALITY_CEILING_FILENAME}: missing. The documentation ratchets have no `
      + `committed ceiling, so any regression passes silently. FIX: restore the file.`,
    );
    return violations;
  }
  const metrics = [
    {
      key: "purposeMissingOrBoilerplate",
      measured: measured.purposeMissingOrBoilerplate,
      allowed: ceiling.purposeMissingOrBoilerplate,
      what: "package purposes missing or boilerplate",
    },
    {
      key: "exportsWithoutSummary",
      measured: measured.exportsWithoutSummary,
      allowed: ceiling.exportsWithoutSummary,
      what: '"." entrypoint exports with no TSDoc summary',
    },
  ] as const;
  for (const metric of metrics) {
    if (metric.measured > metric.allowed) {
      violations.push(
        `agent-index-quality: ${metric.measured} ${metric.what} > ceiling ${metric.allowed}. `
        + `The tree's own TSDoc regressed. Write real per-export and entrypoint docs; do not `
        + `hand-edit an arch-index.json to clear this (the currentness gate refuses that).`,
      );
    } else if (metric.measured < metric.allowed) {
      violations.push(
        `agent-index-quality: ${metric.key} ceiling ${metric.allowed} is above the measured `
        + `${metric.measured} — the docs improved but the ceiling was not lowered. Lower `
        + `${AGENT_INDEX_QUALITY_CEILING_FILENAME} ${metric.key} to ${metric.measured}.`,
      );
    }
  }
  return violations;
}
