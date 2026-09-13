import type { DurableAcceptedScenePlanRecord } from "./accepted-scene-plan-evidence-mod.js";
import { canonicalJson } from "./canonical-json.js";
import type { ObservedApproachGeometry } from "./case-approach-intent-mod.js";
import { resolveCaseOwnedScenePlan } from "./case-owned-scene-plan-mod.js";
import { sha256Hex } from "./sha256-hex.js";

/**
 * DOES THE COMMITTED RECORD STILL DESCRIBE THE FILES ON DISK. Runs in node: it rehashes bytes.
 *
 * The browser admission above cannot rehash an 11 MB GLB, so it carries the record's own digests
 * instead and answers geometry only (stated in the module header). The verifier CLI and
 * `observeScenePlanEvidence` DO rehash from the filesystem. This is the same check, callable
 * without a report: it compares the committed record's four asset digests, the
 * case document digest, the bundle digest and the re-derived route length against disk.
 *
 * `readBytes` is injected so the behavior test can drive it without touching disk. The record is
 * passed in rather than imported, so the clause fails on a drifted record, not a drifted import.
 */
export type CommittedScenePlanDiskCheck = {
  ok: boolean;
  problems: string[];
};

/**
 * Re-derive the route length from the persisted seed against the ward geometry, so the committed
 * record's `routeLengthMeters` is compared with a re-execution rather than trusted. Returns null
 * when the seed will not resolve here; the reopen owns that refusal, not this check.
 */
function rederiveRouteLengthMeters(input: {
  record: DurableAcceptedScenePlanRecord;
  geometry: ObservedApproachGeometry;
  patientWorldPosition: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
}): number | null {
  let resolved: ReturnType<typeof resolveCaseOwnedScenePlan>;
  try {
    resolved = resolveCaseOwnedScenePlan({
      seed: input.record.variation.seed,
      variationIndex: input.record.variation.variationIndex,
      patientWorldPosition: input.patientWorldPosition,
      start: input.start,
      geometry: input.geometry,
    });
  } catch {
    return null;
  }
  if (!resolved.resolved) return null;
  let total = 0;
  for (let index = 1; index < resolved.plan.waypoints.length; index += 1) {
    const from = resolved.plan.waypoints[index - 1]?.position;
    const to = resolved.plan.waypoints[index]?.position;
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.z - from.z);
  }
  return total;
}

export function verifyCommittedScenePlanAgainstDisk(input: {
  record: DurableAcceptedScenePlanRecord;
  caseSourcePath: string;
  bundleContent: unknown;
  geometry: ObservedApproachGeometry;
  patientWorldPosition: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
  readBytes: (repoRelativePath: string) => Buffer;
}): CommittedScenePlanDiskCheck {
  const problems: string[] = [];
  for (const instance of input.record.instances) {
    if (instance.assetPath === undefined || instance.assetSha256 === undefined) continue;
    let bytes: Buffer;
    try {
      bytes = input.readBytes(instance.assetPath);
    } catch {
      problems.push(`instance ${instance.instanceId} names ${instance.assetPath}, which cannot be read`);
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== instance.assetSha256) {
      problems.push(
        `instance ${instance.instanceId} hashes to ${actual.slice(0, 12)} on disk, `
          + `the committed record binds ${instance.assetSha256.slice(0, 12)}`,
      );
    }
  }
  try {
    const actual = sha256Hex(input.readBytes(input.caseSourcePath));
    if (actual !== input.record.case.caseContentSha256) {
      problems.push(
        `case document hashes to ${actual.slice(0, 12)} on disk, `
          + `the committed record binds ${input.record.case.caseContentSha256.slice(0, 12)}`,
      );
    }
  } catch {
    problems.push(`case document ${input.caseSourcePath} cannot be read`);
  }
  const bundleActual = sha256Hex(canonicalJson(input.bundleContent));
  if (bundleActual !== input.record.bundle.bundleSha256) {
    problems.push(
      `bundle content hashes to ${bundleActual.slice(0, 12)} on disk, `
        + `the committed record binds ${input.record.bundle.bundleSha256.slice(0, 12)}`,
    );
  }
  const resolved = rederiveRouteLengthMeters({
    record: input.record,
    geometry: input.geometry,
    patientWorldPosition: input.patientWorldPosition,
    start: input.start,
  });
  if (resolved !== null && resolved !== input.record.resolvedLayout.routeLengthMeters) {
    problems.push(
      `route length re-derives to ${String(resolved)} m, `
        + `the committed record binds ${String(input.record.resolvedLayout.routeLengthMeters)} m`,
    );
  }
  return { ok: problems.length === 0, problems };
}