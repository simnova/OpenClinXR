import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type {
  DurableAcceptedScenePlanRecord,
  ObservedScenePlanEvidence,
} from "./accepted-scene-plan-evidence-mod.js";
import { canonicalJson } from "./canonical-json.js";
import { ACCEPTED_SCENE_PLAN_SCHEMA_VERSION } from "./frozen-scene-replay-mod.js";

type AcceptedScenePlanEvent = DurableAcceptedScenePlanRecord["eventOrder"][number];
type AcceptedScenePlanInstance = DurableAcceptedScenePlanRecord["instances"][number];

import type { ObservedApproachGeometry } from "./case-approach-intent-mod.js";
import {
  CASE_SCENE_PLAN_SOLVER_VERSION,
  type CaseOwnedScenePlan,
  type CaseOwnedScenePlanResult,
  resolveCaseOwnedScenePlan,
} from "./case-owned-scene-plan-mod.js";
import { FROZEN_SCENE_RUBRIC } from "./frozen-scene-replay-mod.js";
import type { BedsideLayoutIntent } from "./layout-solve-mod.js";
import { deriveLayoutVariationSeed } from "./layout-variation-mod.js";

/**
 * THE SERVER-ONLY HALF: derive the seed, hash the actual bytes, freeze the accepted scene plan.
 *
 * WHY IT IS A SEPARATE MODULE FROM THE REOPEN. `deriveLayoutVariationSeed` uses `node:crypto` and
 * hashing asset bytes uses `node:fs`; neither resolves in a browser. `asset-registry/src/index.ts`
 * carries two comments recording what a root-reachable `node:` builtin costs, the second dated
 * 2026-09-09, when `layout-variation.ts` was value-exported from the "." entry and every ui-xr page
 * load died on `Module "node:crypto" has been externalized for browser compatibility`. SC-06's
 * required_behavior 4 asks for exactly this division, and this module is the node side of it: it is
 * reachable only through the `./scene-plan-freeze` subpath, and the runtime's "." entry never
 * re-exports it.
 *
 * THE FREEZE IS AN OBSERVATION, NOT A DECLARATION. Every digest below is computed from bytes read
 * off disk at freeze time. A caller cannot hand in an asset hash; it hands in a PATH, and if the
 * path does not resolve the freeze refuses. That is what makes the reopen's `changed` verdict mean
 * something later: both sides of the comparison were measured by the same code from real files.
 *
 * claimScope: production of one durable accepted-scene-plan record from one resolved plan and the
 * bytes it was resolved against.
 * notEvidenceFor: that the plan was walked, that a browser rendered it, or clinical validity.
 */

export type ScenePlanAssetBinding = {
  instanceId: string;
  kind: AcceptedScenePlanInstance["kind"];
  contentId: string;
  /** Repo-relative path. Hashed here; never supplied as a digest by the caller. */
  assetPath?: string | undefined;
};

export type FreezeScenePlanInput = {
  planId: string;
  run: { stationRunId: string; sessionId: string; acceptedAtIso: string };
  case: {
    caseId: string;
    caseVersion: number;
    caseSourceVersion: string;
    /** Repo-relative path of the persisted case document. Hashed here. */
    caseSourcePath: string;
    stationId: string;
    environmentId: string;
  };
  bundle: {
    bundleId: string;
    /** The compiled bundle, as the producer emitted it. Hashed by canonical JSON. */
    bundleContent: unknown;
  };
  instances: readonly ScenePlanAssetBinding[];
  revisions: { rigRevision: string; clipRevision: string };
  variation: { variationIndex: number; assetRevision: string };
  geometry: ObservedApproachGeometry;
  patientWorldPosition: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
  intent?: BedsideLayoutIntent | undefined;
  arrival: {
    arrivalErrorMeters: number;
    settledHeadingErrorDegrees: number;
    stoppedSeconds: number;
    stoppedRootTravelMeters: number;
  };
  acknowledgment: { acknowledgedBy: string; acknowledgedAtIso: string };
  eventOrder: readonly AcceptedScenePlanEvent[];
  dialogueTurnIds: readonly string[];
  /** Reads the repo. Injected so a test can drive a missing or corrupt file without touching disk. */
  readBytes?: ((repoRelativePath: string) => Buffer) | undefined;
  /**
   * The DURABLE record's own validator, supplied by the composition root — in practice
   * `acceptedScenePlanProblems` from `@openclinxr/session-state/accepted-scene-plan`.
   *
   * REQUIRED, not optional, and that is the whole design of it. This package cannot import the
   * durable owner (see the pinned record type in `accepted-scene-plan-evidence.ts`), and a freeze
   * that graded its own output against its own idea of well-formed would be the producer marking its
   * own work. Making the parameter mandatory forces every caller to wire the durable boundary in,
   * so the record that gets persisted has been judged by the module that owns persistence.
   */
  validateRecord: (record: DurableAcceptedScenePlanRecord) => string[];
};

export type FreezeScenePlanResult =
  | { frozen: true; record: DurableAcceptedScenePlanRecord; plan: CaseOwnedScenePlan }
  | { frozen: false; reason: string; unresolved?: CaseOwnedScenePlanResult | undefined };

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export { canonicalJson };

/**
 * The digest that the acknowledgment binds.
 *
 * It covers exactly the frozen DECISIONS — case, bundle, instances, revisions, seed/index, layout
 * and arrival — and deliberately NOT the acknowledgment itself, which would make the record
 * self-referential and the binding unfalsifiable. Editing any decision moves this value, so the
 * acknowledgment that approved the old one stops binding and the reopen refuses.
 */
export function scenePlanRevision(
  record: Omit<DurableAcceptedScenePlanRecord, "planRevision" | "acknowledgment">,
): string {
  return `plan-v1-${sha256Hex(
    canonicalJson({
      planId: record.planId,
      run: record.run,
      case: record.case,
      bundle: record.bundle,
      instances: record.instances,
      revisions: record.revisions,
      variation: record.variation,
      resolvedLayout: record.resolvedLayout,
      arrival: record.arrival,
      eventOrder: record.eventOrder,
      dialogueTurnIds: record.dialogueTurnIds,
    }),
  ).slice(0, 32)}`;
}

/**
 * Freeze one accepted encounter, or refuse.
 *
 * The refusals are the interesting half. A path that does not resolve refuses rather than recording
 * an empty digest, because a record whose asset hash is `""` compares equal to every future tree
 * that also cannot read the file — the `assetSha256ByPath[path] = ""` shape that
 * `supine-control-freeze.ts:96-99` still carries and that this module does not copy.
 */
export function freezeAcceptedScenePlan(input: FreezeScenePlanInput): FreezeScenePlanResult {
  const read = input.readBytes ?? ((repoRelativePath: string): Buffer => readFileSync(repoRelativePath));
  const seed = deriveLayoutVariationSeed({
    scenarioId: input.case.caseId,
    assetRevision: input.variation.assetRevision,
    solverVersion: CASE_SCENE_PLAN_SOLVER_VERSION,
    variationIndex: input.variation.variationIndex,
  });

  const resolved = resolveCaseOwnedScenePlan({
    seed,
    variationIndex: input.variation.variationIndex,
    patientWorldPosition: input.patientWorldPosition,
    start: input.start,
    geometry: input.geometry,
    ...(input.intent === undefined ? {} : { intent: input.intent }),
  });
  if (!resolved.resolved) {
    return {
      frozen: false,
      reason:
        "the case's layout is unsatisfiable against the observed room, so there is no accepted plan to "
        + `freeze: ${resolved.conflicts
          .map((conflict) => `${conflict.constraint} on ${conflict.approachSide}: ${conflict.reason}`)
          .join("; ")}`,
      unresolved: resolved,
    };
  }

  let caseContentSha256: string;
  try {
    caseContentSha256 = sha256Hex(read(input.case.caseSourcePath));
  } catch (error) {
    return {
      frozen: false,
      reason:
        `the persisted case document ${input.case.caseSourcePath} could not be read (${
          error instanceof Error ? error.message : String(error)
        }). A plan frozen against a case nobody could read binds nothing.`,
    };
  }

  const instances: AcceptedScenePlanInstance[] = [];
  for (const binding of input.instances) {
    if (binding.assetPath === undefined) {
      instances.push({ instanceId: binding.instanceId, kind: binding.kind, contentId: binding.contentId });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = read(binding.assetPath);
    } catch (error) {
      return {
        frozen: false,
        reason:
          `instance ${binding.instanceId} names ${binding.assetPath}, which could not be read (${
            error instanceof Error ? error.message : String(error)
          }). Recording an empty digest here would make the record compare equal to every tree that also `
          + "cannot read it.",
      };
    }
    instances.push({
      instanceId: binding.instanceId,
      kind: binding.kind,
      contentId: binding.contentId,
      assetPath: binding.assetPath,
      assetSha256: sha256Hex(bytes),
      byteCount: bytes.byteLength,
    });
  }

  const withoutRevision: Omit<DurableAcceptedScenePlanRecord, "planRevision" | "acknowledgment"> = {
    schemaVersion: ACCEPTED_SCENE_PLAN_SCHEMA_VERSION,
    planId: input.planId,
    durableStore: "database_source_of_truth",
    run: { ...input.run },
    case: {
      caseId: input.case.caseId,
      caseVersion: input.case.caseVersion,
      caseSourceVersion: input.case.caseSourceVersion,
      caseContentSha256,
      stationId: input.case.stationId,
      environmentId: input.case.environmentId,
    },
    bundle: {
      bundleId: input.bundle.bundleId,
      bundleSha256: sha256Hex(canonicalJson(input.bundle.bundleContent)),
    },
    instances,
    revisions: {
      solverVersion: resolved.solverVersion,
      rigRevision: input.revisions.rigRevision,
      clipRevision: input.revisions.clipRevision,
      geometryRevision: resolved.geometryRevision,
      rubricVersion: FROZEN_SCENE_RUBRIC.rubricVersion,
    },
    variation: { seed, variationIndex: input.variation.variationIndex },
    resolvedLayout: {
      approachSide: resolved.approachSide,
      standoffMeters: resolved.standoffMeters,
      targetPosition: { ...resolved.target.position },
      targetHeadingRadians: resolved.target.headingRadians,
      floorFrameId: resolved.floorFrameId,
      observedObstacleIds: [...resolved.observedObstacleIds],
      waypointCount: resolved.plan.waypoints.length,
      routeLengthMeters: routeLengthMeters(resolved),
    },
    arrival: { ...input.arrival },
    eventOrder: input.eventOrder.map((event) => ({ ...event })),
    dialogueTurnIds: [...input.dialogueTurnIds],
  };

  const planRevision = scenePlanRevision(withoutRevision);
  const record: DurableAcceptedScenePlanRecord = {
    ...withoutRevision,
    planRevision,
    acknowledgment: {
      acknowledgedBy: input.acknowledgment.acknowledgedBy,
      acknowledgedAtIso: input.acknowledgment.acknowledgedAtIso,
      acknowledgedPlanRevision: planRevision,
    },
  };
  const problems = input.validateRecord(record);
  if (problems.length > 0) {
    return {
      frozen: false,
      reason: `the freeze produced a record its own validator refuses: ${problems.join("; ")}`,
    };
  }
  return { frozen: true, record, plan: resolved };
}

function routeLengthMeters(plan: CaseOwnedScenePlan): number {
  let total = 0;
  for (let index = 1; index < plan.plan.waypoints.length; index += 1) {
    const from = plan.plan.waypoints[index - 1]?.position;
    const to = plan.plan.waypoints[index]?.position;
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.z - from.z);
  }
  return total;
}

/**
 * Observe, right now, the evidence a frozen plan bound — for the reopen to compare against.
 *
 * The three outcomes are produced HERE, from the filesystem, rather than being described by a
 * caller: a path that does not exist is left out of the map (`missing`), a path that exists but
 * whose bytes will not decode is listed in `corruptPaths` (`corrupt`), and everything else gets its
 * real digest, which the reopen compares (`changed` or clean). A caller cannot assert a verdict.
 */
export function observeScenePlanEvidence(input: {
  caseSourcePath: string;
  bundleContent: unknown;
  assetPaths: readonly string[];
  solverVersion?: string | undefined;
  rigRevision: string;
  clipRevision: string;
  geometryRevision: string;
  stationRunId?: string | undefined;
  readBytes?: ((repoRelativePath: string) => Buffer) | undefined;
  /** Treated as corrupt: present on disk, refusing to decode. Named by the caller's decoder. */
  corruptPaths?: readonly string[] | undefined;
}): ObservedScenePlanEvidence {
  const read = input.readBytes ?? ((repoRelativePath: string): Buffer => readFileSync(repoRelativePath));
  const corrupt = new Set(input.corruptPaths ?? []);
  const assetSha256ByPath: Record<string, string | undefined> = {};
  for (const assetPath of input.assetPaths) {
    if (corrupt.has(assetPath)) continue;
    try {
      assetSha256ByPath[assetPath] = sha256Hex(read(assetPath));
    } catch {
      // Absent, unreadable or a directory: leave it out of the map so the reopen reports `missing`
      // rather than inventing a digest. `statSync` is consulted only to keep the distinction honest
      // when a path exists but the read failed for another reason.
      try {
        if (statSync(assetPath).isFile()) corrupt.add(assetPath);
      } catch {
        /* genuinely absent */
      }
    }
  }
  let caseContentSha256: string | undefined;
  try {
    caseContentSha256 = sha256Hex(read(input.caseSourcePath));
  } catch {
    caseContentSha256 = undefined;
  }
  return {
    ...(caseContentSha256 === undefined ? {} : { caseContentSha256 }),
    bundleSha256: sha256Hex(canonicalJson(input.bundleContent)),
    assetSha256ByPath,
    corruptPaths: [...corrupt],
    solverVersion: input.solverVersion ?? CASE_SCENE_PLAN_SOLVER_VERSION,
    rigRevision: input.rigRevision,
    clipRevision: input.clipRevision,
    geometryRevision: input.geometryRevision,
    ...(input.stationRunId === undefined ? {} : { stationRunId: input.stationRunId }),
  };
}
