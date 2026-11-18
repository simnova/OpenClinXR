/**
 * Shared sample-routing plumbing for the round-1 station instruments
 * (supine-patient-on-deck, per-station-actor-integrity,
 * declared-equipment-mounted, arm-abduction-ceiling).
 *
 * One implementation of: explicit-or-sampled selection identity, keyed
 * in-process cache, sampled-vs-canonical disk guard with refusal lines, and
 * routed writer defaults with canonical refusal. Each instrument keeps its own
 * bank, union, report shape, write triggers, and log label; those arrive as
 * parameters so every message, path, and selection stays identical to the
 * per-file version this replaces. Union coverage assertions already live in
 * room-supine-sample.ts (assertSampledStationCoverage); station-room and
 * inpatient-supine keep their own copies as the known-good reference.
 */

import path from "node:path";
import type { SampleRecord } from "../station-subset.js";
import { selectStationSubset } from "../station-subset.js";
import {
  explicitSelectionCacheKey,
  isUsableSampledDiskReport,
  selectionCacheKey,
} from "./room-supine-sample.js";

export type SampledSelection = {
  ids: string[];
  sample: SampleRecord | null;
};

/** Raw seeded subset with no union (S4 shape). */
export function selectRawSample(
  allIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): SampledSelection {
  const subset = selectStationSubset(allIds, env);
  if (subset.full) return { ids: [...allIds], sample: null };
  return { ids: [...subset.ids], sample: { seed: subset.seed as string, ids: [...subset.ids] } };
}

/**
 * Seeded subset unioned with must-include targets (S1/S2/S3 shape,
 * inpatient-supine union precedent). sample.ids stays the raw subset;
 * ids cover the union.
 */
export function selectUnionSample(
  allIds: string[],
  env: NodeJS.ProcessEnv,
  targets: readonly string[],
): SampledSelection {
  const subset = selectStationSubset(allIds, env);
  if (subset.full) return { ids: [...allIds], sample: null };
  const keep = targets.filter((id) => allIds.includes(id));
  const ids = [...new Set([...subset.ids, ...keep])];
  return { ids, sample: { seed: subset.seed as string, ids: [...subset.ids] } };
}

/** Explicit scenarioIds get their own key, distinct from "full" and every seed. */
export function selectionIdentityKey(
  scenarioIds: string[] | undefined,
  sample: SampleRecord | null,
): string {
  return scenarioIds?.length
    ? explicitSelectionCacheKey(scenarioIds)
    : selectionCacheKey(sample);
}

/**
 * Keyed in-process cache: a full report never satisfies a sampled call or
 * vice versa, and concurrent different-key flights never share.
 */
export class SampledMeasureCache<T> {
  private cached: T | null = null;
  private cachedKey: string | null = null;
  private flight: Promise<T> | null = null;
  private flightKey: string | null = null;

  peek(key: string): T | null {
    return this.cachedKey === key ? this.cached : null;
  }

  peekFlight(key: string): Promise<T> | null {
    return this.flightKey === key ? this.flight : null;
  }

  store(report: T, key: string): void {
    this.cached = report;
    this.cachedKey = key;
  }

  async run(key: string, task: Promise<T>): Promise<T> {
    this.flight = task;
    this.flightKey = key;
    try {
      return await task;
    } finally {
      if (this.flight === task) {
        this.flight = null;
        this.flightKey = null;
      }
    }
  }

  reset(): void {
    this.cached = null;
    this.cachedKey = null;
    this.flight = null;
    this.flightKey = null;
  }
}

/**
 * Sampled-vs-canonical disk guard. Returns the usable report or null, printing
 * the same refusal lines the per-file blocks printed: sampled artifacts are
 * reusable only on exact seed + sample ids with measured rows covering every
 * requested id; canonical artifacts serve only when they carry no sample.
 */
export function checkSampledDiskReport<T>(input: {
  instrument: string;
  fromDisk: T | null;
  sampled: boolean;
  selectionSample: SampleRecord | null;
  neededIds: string[];
  diskSample: SampleRecord | null;
  diskMeasuredIds: string[];
}): T | null {
  const { fromDisk } = input;
  if (!fromDisk) return null;
  if (input.sampled && input.selectionSample) {
    const sel = input.selectionSample;
    if (
      isUsableSampledDiskReport({
        reportSample: input.diskSample,
        measuredScenarioIds: input.diskMeasuredIds,
        requestedSeed: sel.seed,
        requestedSampleIds: sel.ids,
        neededIds: input.neededIds,
      })
    ) {
      return fromDisk;
    }
    process.stdout.write(
      `${input.instrument}: refusing sampled disk artifact for seed=${sel.seed} sample=[${[...sel.ids].sort().join(",")}]\n`,
    );
    return null;
  }
  if (!input.sampled) {
    if (input.diskSample !== null) {
      process.stdout.write(
        `${input.instrument}: refusing canonical disk artifact carrying sample seed=${input.diskSample.seed} (canonical only by a full run)\n`,
      );
      return null;
    }
    const covered = new Set(input.diskMeasuredIds);
    if (input.neededIds.every((id) => covered.has(id))) return fromDisk;
    process.stdout.write(
      `${input.instrument}: refusing disk artifact (covers ${covered.size} of ${input.neededIds.length} needed)\n`,
    );
    return null;
  }
  return null;
}

/**
 * Routed writer default: explicit outputPath wins, otherwise the sampled
 * sibling for sampled reports and the canonical path for full runs,
 * optionally redirected under a test-only evidence root.
 */
export function routedArtifactDefault(input: {
  reportSample: SampleRecord | null;
  canonicalRel: string;
  sampledRel: string;
  evidenceRoot?: string | undefined;
  outputPath?: string | undefined;
}): string {
  if (input.outputPath) return input.outputPath;
  const rel = input.reportSample ? input.sampledRel : input.canonicalRel;
  return path.join(input.evidenceRoot ?? ".", rel);
}

/**
 * A sampled report addressed at a canonical artifact throws instead of
 * overwriting it (station-room R3-F3). `kind` is "sampled report" except the
 * supine pre-fix writer, which says "sampled pre-fix".
 */
export function refuseSampledAtCanonical(input: {
  instrument: string;
  kind: string;
  reportSample: SampleRecord | null;
  outputPath: string;
  canonicalRels: string[];
  canonicalSuffix: string | ((matched: string) => string);
  evidenceRoot?: string | undefined;
}): void {
  if (input.reportSample === null || input.evidenceRoot) return;
  for (const canonical of input.canonicalRels) {
    if (path.resolve(input.outputPath) === path.resolve(canonical)) {
      const suffix = typeof input.canonicalSuffix === "function"
        ? input.canonicalSuffix(canonical)
        : input.canonicalSuffix;
      throw new Error(
        `${input.instrument}: refusing to write ${input.kind} (seed=${input.reportSample.seed}) to canonical path ${input.outputPath}${suffix}`,
      );
    }
  }
}
