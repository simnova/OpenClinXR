import { appendFileSync, readFileSync } from "node:fs";
import {
  composeSupportedActorWorldPosition,
  createEdChestPainRuntimeSceneManifest,
  supineActorWorldPosition,
} from "@openclinxr/asset-registry";
import { revalidateAcceptedScenePlan } from "@openclinxr/asset-registry/accepted-scene-plan-evidence";
import type { ObservedApproachGeometry } from "@openclinxr/asset-registry/case-approach-intent";
import {
  CASE_SCENE_PLAN_AUTHORIZED_VARIATION_INDICES,
  CASE_SCENE_PLAN_SOLVER_VERSION,
} from "@openclinxr/asset-registry/case-owned-scene-plan";
import { reopenFrozenScene } from "@openclinxr/asset-registry/frozen-scene-replay";
import { resolveBedsideLayoutFromSeed } from "@openclinxr/asset-registry/layout-solve";
import {
  canonicalJson,
  type FreezeScenePlanInput,
  freezeAcceptedScenePlan,
  observeScenePlanEvidence,
} from "@openclinxr/asset-registry/scene-plan-freeze";
import { observeMountedApproachGeometry } from "@openclinxr/xr-humanoid-animation/mounted-approach-geometry";
import { buildStationEnvironment } from "@openclinxr/xr-station";
import { Scene } from "three";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_SCENE_PLAN_REVIEW_NOT_EVIDENCE_FOR,
  privateKeysInProjection,
  projectAcceptedScenePlanForReview,
} from "../../../packages/openclinxr/review-workflow/src/accepted-scene-plan-review.js";
import {
  acceptedScenePlanProblems,
  type DurableAcceptedScenePlanRecord,
  requireAcceptedScenePlan,
} from "../../../packages/openclinxr/session-state/src/accepted-scene-plan.js";
// WHERE THE REPLAY BOUNDARY LIVES, and it was decided by two standing rules rather than by taste.
//
// It was first written into the scenario-runtime package. `workspace-architecture.test.ts:926` refused
// that: a UI app shell may not reach it, tests included — and note that clause is a CONTENT match on
// the package specifier, so naming it in full here would trip a gate this file does not violate. It
// was then moved into
// session-state, and `workspace-architecture.test.ts:1271` refused THAT: session-state's dependency
// list is pinned by exact equality to `@openclinxr/shared-schemas` alone, and the reopen needs the
// layout solver. Neither rule was weakened. What survives both is asset-registry, which apps/ui-xr
// already depends on and which owns the solver — so the record and its validators stay in
// session-state, the durable boundary this card's contract names, and the read that reopens them
// lives beside the solver it has to re-run.
//
// review-workflow is imported by relative path because apps/ui-xr does not depend on it and
// `apps/ui-xr/package.json` is outside this card's write roots. The precedent is
// `apps/ui-xr/src/static-assets.test.ts:5`.
import {
  SCENE_CLOSURE_CASE_ID,
  SCENE_CLOSURE_CASE_SOURCE_VERSION,
  SCENE_CLOSURE_CASE_VERSION,
  SCENE_CLOSURE_ENVIRONMENT_ID,
  SCENE_CLOSURE_PINNED_CAST,
  SCENE_CLOSURE_SELECTED_ASSET_MANIFEST,
  SCENE_CLOSURE_STATION_ID,
  sceneClosureCaseDocument,
} from "../../../tools/openclinxr/factory/scene-closure-case-source.js";

/**
 * SC-06 — the normal consumer reopens a frozen scene, and refuses a stale one.
 *
 * A-row A09. This drives the production modules a browser entry calls:
 * `observeMountedApproachGeometry` for the room, `freezeAcceptedScenePlan` for the server-side
 * freeze, `observeScenePlanEvidence` for what is on disk now, and `reopenFrozenScene` for the
 * reopen. Every refusal below comes back from that consumer; none is asserted about a fixture.
 *
 * THE THREE MEASURED DEFECTS ON THE UNCHANGED BASELINE 27efa3d2. Captured by
 * `tools/openclinxr/evidence/scene-closure/proofs/sc-06/baseline-replay-probe.ts`, which runs
 * against production modules only. None is an import error, an absent file or a missing report.
 *
 *  1. THE ACCEPTED PLAN CARRIES NO DURABLE IDENTITY. `resolveBedsideApproachIntent` returns
 *     thirteen fields — `approachSideSource, floorFrameId, geometryRevision, monitorVisibility,
 *     observedObstacleIds, physicianActorId, plan, refused, standoffMeters, start, sweptViolations,
 *     target, workingClearanceViolations` — and 0 OF THE 14 A09 FIELDS. There is nothing to reopen.
 *
 *  2. THE ONE EXISTING INVALIDATION IS BLIND TO ASSET IDENTITY. Freezing the ward plan and then
 *     substituting the physician's body for the nurse's — two files whose sha256 genuinely differ,
 *     `4a6d8a78cd2eabd7…` against `bc5b9009af577037…` — leaves `geometryRevisionDigest` at
 *     `geom-v1-c45e274d-7` in BOTH cases, because that digest covers the floor frame, support
 *     bounds, monitor bounds and obstacle boxes and nothing about which body, clip, rig or solver
 *     the plan was accepted against.
 *
 *  3. SO A STALE ACCEPTANCE IS SILENTLY REUSED. `beginBedsideApproachExecution`, handed the frozen
 *     plan and the post-substitution observation, returned an execution rather than a refusal.
 *
 * A FOURTH DEFECT, measured by grep rather than by this file: `resolveBedsideLayout`
 * (asset-registry/src/layout-variation.ts:126) and `deriveLayoutVariationSeed` (:62) had ZERO
 * production callers — only their declaring module, two test files and one architecture comment.
 * The card's own words are "Do not just hash an unused layout helper", and clause (b) below asserts
 * the solver is now in the production path by requiring the reopen to RE-SOLVE from the persisted
 * seed rather than read the frozen answer back out.
 *
 * WHAT THIS FILE DOES NOT CLAIM. That the frozen route was walked in this session, that a browser
 * rendered it, or anything clinical. The arrival numbers here are the ones a run recorded; SC-05
 * owns measuring them and SC-07 owns recording the walk. Qualified clinical review is pending and is
 * not implied by any assertion below.
 */

const WARD_BED_INSTANCE_ID = `${SCENE_CLOSURE_ENVIRONMENT_ID}:stretcher`;
const CASE_SOURCE_PATH = "tools/openclinxr/factory/scene-closure-case-source.ts";
const RIG_REVISION = "mpfb2_standard_137_joint";
const CLIP_REVISION = "openclinxr_retarget_walk_formal_cc0";

/** Values-not-verdicts sink, matching SC-05's. A no-op unless the env var is set. */
function observe(entries: ReadonlyArray<Record<string, unknown>>): void {
  const target = process.env["OPENCLINXR_SC06_OBSERVATIONS"];
  if (target === undefined || target === "") return;
  appendFileSync(target, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

/** The whole normal boot path for this case, in one room, with every decision taken by production code. */
function stageWard(): {
  geometry: ObservedApproachGeometry;
  patientWorld: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
} {
  const caseDocument = sceneClosureCaseDocument();
  const scene = new Scene();
  scene.add(buildStationEnvironment({ environmentId: SCENE_CLOSURE_ENVIRONMENT_ID }) as never);
  const geometry = observeMountedApproachGeometry(scene as never, {
    supportInstanceId: WARD_BED_INSTANCE_ID,
  });
  const placements = createEdChestPainRuntimeSceneManifest({
    scenarioId: caseDocument.scenarioId,
    stationId: SCENE_CLOSURE_STATION_ID,
    scenario: caseDocument as never,
    environmentId: SCENE_CLOSURE_ENVIRONMENT_ID,
  }).actorPlacements;
  const patientPlacement = placements[SCENE_CLOSURE_PINNED_CAST.patient];
  const patientWorld = composeSupportedActorWorldPosition({
    posture: "supine",
    fixtureAnchor: supineActorWorldPosition({}),
    ...(patientPlacement?.plantOffsetMeters
      ? { authoredOffsetMeters: patientPlacement.plantOffsetMeters }
      : {}),
    resolvedPosition: patientPlacement?.position ?? { x: 0, y: 0, z: 0 },
  });
  const physicianPlacement = placements[SCENE_CLOSURE_PINNED_CAST.physician];
  const start = composeSupportedActorWorldPosition({
    posture: "standing",
    fixtureAnchor: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
    ...(physicianPlacement?.plantOffsetMeters
      ? { authoredOffsetMeters: physicianPlacement.plantOffsetMeters }
      : {}),
    resolvedPosition: physicianPlacement?.position ?? { x: 0, y: 0, z: 0 },
    ...(geometry.floorFrame ? { floorFrame: geometry.floorFrame } : {}),
  });
  if ("refused" in patientWorld || "refused" in start) {
    throw new Error("the ward staging refused to compose a patient or physician position");
  }
  return { geometry, patientWorld, start };
}

/** The compiled bundle this encounter binds. Real selected assets, resolved from the case source. */
const BUNDLE_CONTENT = {
  bundleId: `${SCENE_CLOSURE_STATION_ID}:bundle`,
  caseId: SCENE_CLOSURE_CASE_ID,
  environmentId: SCENE_CLOSURE_ENVIRONMENT_ID,
  selected: SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.selected.map((entry) => ({
    actorId: entry.actorId,
    role: entry.role,
    assetPath: entry.assetPath,
    rig: entry.rig,
  })),
};

const SELECTED_ASSET_PATHS = SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.selected.map(
  (entry) => entry.assetPath,
);

function freezeInput(
  ward: ReturnType<typeof stageWard>,
  overrides: Partial<FreezeScenePlanInput> = {},
): FreezeScenePlanInput {
  return {
    planId: "scene_closure_supine_bedside_plan_v1",
    run: {
      stationRunId: "sc06-run-0001",
      sessionId: "sc06-session-0001",
      acceptedAtIso: "2026-09-10T00:00:00.000Z",
    },
    case: {
      caseId: SCENE_CLOSURE_CASE_ID,
      caseVersion: SCENE_CLOSURE_CASE_VERSION,
      caseSourceVersion: SCENE_CLOSURE_CASE_SOURCE_VERSION,
      caseSourcePath: CASE_SOURCE_PATH,
      stationId: SCENE_CLOSURE_STATION_ID,
      environmentId: SCENE_CLOSURE_ENVIRONMENT_ID,
    },
    bundle: { bundleId: BUNDLE_CONTENT.bundleId, bundleContent: BUNDLE_CONTENT },
    instances: [
      { instanceId: WARD_BED_INSTANCE_ID, kind: "support", contentId: "ward_stretcher_v1" },
      ...SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.selected.map((entry) => ({
        instanceId: `${SCENE_CLOSURE_STATION_ID}:${entry.actorId}`,
        kind: "actor" as const,
        contentId: entry.actorId,
        assetPath: entry.assetPath,
      })),
    ],
    revisions: { rigRevision: RIG_REVISION, clipRevision: CLIP_REVISION },
    variation: { variationIndex: 0, assetRevision: "2026-09-09" },
    geometry: ward.geometry,
    patientWorldPosition: ward.patientWorld,
    start: ward.start,
    arrival: {
      arrivalErrorMeters: 0.0041,
      settledHeadingErrorDegrees: 1.7,
      stoppedSeconds: 2.4,
      stoppedRootTravelMeters: 0.0009,
    },
    acknowledgment: {
      acknowledgedBy: "faculty_reviewer_ward_v1",
      acknowledgedAtIso: "2026-09-10T00:05:00.000Z",
    },
    eventOrder: [
      { sequence: 1, eventId: "evt-admitted", eventType: "encounter_admitted", atSecond: 0 },
      { sequence: 2, eventId: "turn-001", eventType: "actor_turn", atSecond: 1.5 },
      { sequence: 3, eventId: "evt-arrived", eventType: "bedside_arrival", atSecond: 6.2 },
    ],
    dialogueTurnIds: ["turn-001"],
    // THE DURABLE OWNER GRADES THE RECORD. `freezeAcceptedScenePlan` requires this: it cannot import
    // session-state, and a freeze that validated its own output would be the producer marking its own
    // work. Passing the real validator here is the composition root doing its job.
    validateRecord: acceptedScenePlanProblems,
    ...overrides,
  };
}

function freezeOrThrow(input: FreezeScenePlanInput): DurableAcceptedScenePlanRecord {
  const frozen = freezeAcceptedScenePlan(input);
  if (!frozen.frozen) throw new Error(`freeze refused: ${frozen.reason}`);
  return frozen.record;
}

/**
 * The reopen path as the normal consumer runs it: the DURABLE READ first, then the replay.
 *
 * `requireAcceptedScenePlan` owns absent / malformed / wrong_schema and lives with the record;
 * `reopenFrozenScene` owns staleness and reproduction and lives with the solver. Composing them here
 * is what a composition root does, and it is why neither package re-implements the other's question.
 */
function reopen(
  candidate: unknown,
  observation: Parameters<typeof reopenFrozenScene>[1],
): ReturnType<typeof reopenFrozenScene> {
  const read = requireAcceptedScenePlan(candidate);
  if (read.status !== "ok") {
    return {
      status: "refused",
      reason:
        read.status === "absent"
          ? "plan_absent"
          : read.status === "malformed"
            ? "plan_malformed"
            : "plan_wrong_schema",
      detail: `${read.status}: ${read.reason}`,
      conflicts: [],
    };
  }
  return reopenFrozenScene(read.record, observation);
}

/** What the tree shows right now, observed from real files by the production observer. */
function observeNow(
  ward: ReturnType<typeof stageWard>,
  overrides: Partial<Parameters<typeof observeScenePlanEvidence>[0]> = {},
): ReturnType<typeof observeScenePlanEvidence> {
  const record = freezeOrThrow(freezeInput(ward));
  return observeScenePlanEvidence({
    caseSourcePath: CASE_SOURCE_PATH,
    bundleContent: BUNDLE_CONTENT,
    assetPaths: SELECTED_ASSET_PATHS,
    rigRevision: RIG_REVISION,
    clipRevision: CLIP_REVISION,
    geometryRevision: record.revisions.geometryRevision,
    stationRunId: record.run.stationRunId,
    ...overrides,
  });
}

describe("the normal consumer replays and invalidates the frozen scene", () => {
  it("SC-06-required-behavior", () => {
    const ward = stageWard();

    // ── (a) A09: the freeze persists every bound identity, from bytes it read itself ────────────
    const record = freezeOrThrow(freezeInput(ward));
    expect(record.case.caseId).toBe(SCENE_CLOSURE_CASE_ID);
    expect(record.case.caseContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.bundle.bundleSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.variation.seed).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.revisions.solverVersion).toBe(CASE_SCENE_PLAN_SOLVER_VERSION);
    expect(record.revisions.rigRevision).toBe(RIG_REVISION);
    expect(record.revisions.clipRevision).toBe(CLIP_REVISION);
    // Support, actor and equipment instances are counted separately, and every actor instance
    // carries the digest and byte count of the file it loads. On the baseline the accepted plan had
    // 0 of these 14 fields; the record is the answer to that measurement.
    // COUNTED OFF THE RECORD, not typed. The first version emitted the literal 14 into the
    // observation stream and the verifier compared it against the constant 14, so an implementation
    // persisting nothing would have passed that gate by emitting the right number. Each entry below
    // reads the field it names and is counted only when that field is actually populated.
    const a09Fields: ReadonlyArray<[string, () => boolean]> = [
      ["caseId", () => record.case.caseId.length > 0],
      ["caseVersion", () => Number.isInteger(record.case.caseVersion)],
      ["bundleId", () => record.bundle.bundleId.length > 0],
      ["instanceIds", () => record.instances.length > 0],
      ["assetSha256ByPath", () => record.instances.some((i) => (i.assetSha256 ?? "").length === 64)],
      ["clipRevision", () => record.revisions.clipRevision.length > 0],
      ["rigRevision", () => record.revisions.rigRevision.length > 0],
      ["solverRevision", () => record.revisions.solverVersion.length > 0],
      ["planRevision", () => record.planRevision.length > 0],
      ["seed", () => /^[0-9a-f]{64}$/u.test(record.variation.seed)],
      ["variationIndex", () => Number.isInteger(record.variation.variationIndex)],
      ["acknowledgment", () => record.acknowledgment.acknowledgedPlanRevision.length > 0],
      ["eventOrder", () => record.eventOrder.length > 0],
      ["runId", () => record.run.stationRunId.length > 0],
    ];
    const a09Present = a09Fields.filter(([, populated]) => populated()).length;
    for (const [name, populated] of a09Fields) {
      expect(populated(), `A09 field ${name} is not populated on the frozen record`).toBe(true);
    }
    expect(a09Present).toBe(a09Fields.length);

    const actorInstances = record.instances.filter((instance) => instance.kind === "actor");
    expect(actorInstances.length).toBe(SELECTED_ASSET_PATHS.length);
    expect(record.instances.some((instance) => instance.kind === "support")).toBe(true);
    for (const instance of actorInstances) {
      expect(instance.assetSha256, `${instance.instanceId} has no digest`).toMatch(/^[a-f0-9]{64}$/u);
      expect(instance.byteCount ?? 0).toBeGreaterThan(0);
    }
    expect(record.eventOrder.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(record.dialogueTurnIds).toEqual(["turn-001"]);
    expect(record.acknowledgment.acknowledgedPlanRevision).toBe(record.planRevision);

    // ── (b) Reopen through the normal consumer: the frozen version reproduces ───────────────────
    const clean = observeNow(ward);
    const reopened = reopen(record, {
      evidence: clean,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(
      reopened.status,
      reopened.status === "reopened" ? "" : `${reopened.reason}: ${reopened.detail}`,
    ).toBe("reopened");
    if (reopened.status !== "reopened") return;
    // RE-SOLVED, not read back. The reproduction carries its own offset from the frozen target, and
    // that number is what makes this a reproduction rather than an echo: a consumer that returned
    // the recorded layout would report 0 while proving nothing.
    expect(reopened.reproduced.seed).toBe(record.variation.seed);
    expect(reopened.reproduced.approachSide).toBe(record.resolvedLayout.approachSide);
    expect(reopened.reproduced.standoffMeters).toBe(record.resolvedLayout.standoffMeters);
    expect(reopened.reproduced.targetOffsetMeters).toBeLessThanOrEqual(1e-9);
    expect(reopened.reproduced.waypointCount).toBe(record.resolvedLayout.waypointCount);

    // ── (c) Several permitted variation indices explore AUTHORIZED choices ──────────────────────
    // MEASURED in this ward, indices 0-9: six resolve to `patient_right @ 0.75 m` and four refuse
    // with `route_blocked`, because the seed's first byte flips which side the solver tries first
    // and the case's authored start cannot reach the patient's left without crossing the bed. Both
    // outcomes are the index reaching the solver's DECISION, which is the claim; asserting only that
    // the seeds differ would have passed on a solver nobody called.
    const seeds = new Set<string>();
    const resolvedIndices: number[] = [];
    const refusedIndices: number[] = [];
    for (const variationIndex of CASE_SCENE_PLAN_AUTHORIZED_VARIATION_INDICES) {
      const attempt = freezeAcceptedScenePlan(
        freezeInput(ward, { variation: { variationIndex, assetRevision: "2026-09-09" } }),
      );
      if (attempt.frozen) {
        seeds.add(attempt.record.variation.seed);
        resolvedIndices.push(variationIndex);
        expect(["patient_left", "patient_right"], `index ${variationIndex}`).toContain(
          attempt.record.resolvedLayout.approachSide,
        );
        // Every authorized choice that resolves must also REOPEN, or "explore" would mean
        // "produce something nobody can replay".
        const varied = reopen(attempt.record, {
          evidence: observeNow(ward, {
            geometryRevision: attempt.record.revisions.geometryRevision,
            stationRunId: attempt.record.run.stationRunId,
          }),
          geometry: ward.geometry,
          patientWorldPosition: ward.patientWorld,
          start: ward.start,
        });
        expect(
          varied.status,
          varied.status === "reopened" ? "" : `index ${variationIndex}: ${varied.detail}`,
        ).toBe("reopened");
        continue;
      }
      refusedIndices.push(variationIndex);
      // A refusal must NAME what defeated it. An empty conflict list would be a refusal with no
      // reason, which is indistinguishable from the solver never running.
      const conflicts = attempt.unresolved?.resolved === false ? attempt.unresolved.conflicts : [];
      expect(conflicts.length, `index ${variationIndex}`).toBeGreaterThan(0);
      for (const conflict of conflicts) {
        expect(conflict.reason.length, `index ${variationIndex}`).toBeGreaterThan(0);
      }
    }
    // The index reaches the decision: the authorized set produces BOTH outcomes, not one repeated.
    expect(resolvedIndices.length).toBeGreaterThan(0);
    expect(refusedIndices.length).toBeGreaterThan(0);
    // Every resolving index has its own seed, so no index is a duplicate of another.
    expect(seeds.size).toBe(resolvedIndices.length);

    // Determinism: the same index refreezes to the same seed, layout and revision.
    const refrozen = freezeOrThrow(freezeInput(ward));
    expect(refrozen.variation.seed).toBe(record.variation.seed);
    expect(refrozen.planRevision).toBe(record.planRevision);
    expect(refrozen.resolvedLayout.approachSide).toBe(record.resolvedLayout.approachSide);

    // ── (d) An impossible authored intent fails with NAMED CONFLICTS ────────────────────────────
    const impossible = freezeAcceptedScenePlan(
      freezeInput(ward, {
        // A standoff of 0 m puts the clinician inside the bed. Nothing can satisfy it, and the
        // refusal must SAY SO rather than quietly resolving somewhere the case never authored.
        intent: { approachSide: "patient_left", standoffMeters: 0 },
      }),
    );
    expect(impossible.frozen).toBe(false);
    if (impossible.frozen) return;
    expect(impossible.unresolved?.resolved).toBe(false);
    const namedConflicts = impossible.unresolved?.resolved === false ? impossible.unresolved.conflicts : [];
    expect(namedConflicts.length).toBeGreaterThan(0);
    for (const conflict of namedConflicts) {
      expect(conflict.approachSide).toBe("patient_left");
      expect(conflict.reason.length).toBeGreaterThan(0);
    }

    // ── (e) Changed, missing and corrupt evidence each refuse, and are DISTINGUISHED ────────────
    const changedGlb = reopen(record, {
      evidence: {
        ...clean,
        assetSha256ByPath: {
          ...clean.assetSha256ByPath,
          // The real substitution the baseline could not see: the physician's slot loading the
          // nurse's bytes. Both digests are real sha256 of real files.
          [SELECTED_ASSET_PATHS[1] ?? ""]: clean.assetSha256ByPath[SELECTED_ASSET_PATHS[2] ?? ""],
        },
      },
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(changedGlb.status).toBe("refused");
    if (changedGlb.status !== "refused") return;
    expect(changedGlb.reason).toBe("evidence_changed");
    expect(changedGlb.conflicts.some((conflict) => conflict.kind === "changed")).toBe(true);

    const removedGlb = reopen(record, {
      evidence: {
        ...clean,
        assetSha256ByPath: Object.fromEntries(
          Object.entries(clean.assetSha256ByPath).filter(([path]) => path !== SELECTED_ASSET_PATHS[1]),
        ),
      },
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(removedGlb.status).toBe("refused");
    if (removedGlb.status !== "refused") return;
    expect(removedGlb.reason).toBe("evidence_missing");

    const corruptGlb = reopen(record, {
      evidence: { ...clean, corruptPaths: [SELECTED_ASSET_PATHS[1] ?? ""] },
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(corruptGlb.status).toBe("refused");
    if (corruptGlb.status !== "refused") return;
    expect(corruptGlb.reason).toBe("evidence_corrupt");

    // MISSING, CORRUPT and CHANGED are three different answers for the same asset. Collapsing them
    // is how a damaged control silently becomes no control.
    const distinctRefusalKinds = new Set([changedGlb.reason, removedGlb.reason, corruptGlb.reason]);
    expect(distinctRefusalKinds.size).toBe(3);

    // The other four bound subjects refuse too: case, bundle, clip and solver.
    const subjects: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["case", { caseContentSha256: "0".repeat(64) }],
      ["bundle", { bundleSha256: "0".repeat(64) }],
      ["clip", { clipRevision: "openclinxr_retarget_walk_formal_cc0_v2" }],
      ["solver", { solverVersion: "openclinxr.bedside-layout-solver.v2" }],
      ["rig", { rigRevision: "mpfb2_standard_138_joint" }],
      ["geometry", { geometryRevision: "geom-v1-deadbeef-7" }],
    ];
    for (const [label, patch] of subjects) {
      const refused = reopen(record, {
        evidence: { ...clean, ...patch },
        geometry: ward.geometry,
        patientWorldPosition: ward.patientWorld,
        start: ward.start,
      });
      expect(refused.status, label).toBe("refused");
      if (refused.status !== "refused") continue;
      expect(refused.reason, label).toBe("evidence_changed");
    }

    // ── (f) Changed plan cannot silently reuse the acknowledgment ───────────────────────────────
    const editedAfterAcceptance: DurableAcceptedScenePlanRecord = {
      ...record,
      planRevision: `${record.planRevision}-edited`,
    };
    const stale = reopen(editedAfterAcceptance, {
      evidence: clean,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(stale.status).toBe("refused");
    if (stale.status !== "refused") return;
    expect(stale.reason).toBe("stale_acknowledgment");

    // ── (g) Repair requires FRESH OBSERVATION, not a sidecar overwrite ──────────────────────────
    const invalidatedEvidence = {
      ...clean,
      clipRevision: "openclinxr_retarget_walk_formal_cc0_v2",
    };
    // The cheapest "repair" is to re-stamp the record under its own revision. Refused.
    const overwrite = revalidateAcceptedScenePlan(record, {
      observedBy: "someone",
      observedAtIso: "2026-09-10T01:00:00.000Z",
      evidence: invalidatedEvidence,
      planRevision: record.planRevision,
    });
    expect(overwrite.status).toBe("refused");
    // So is an unattributed one.
    expect(
      revalidateAcceptedScenePlan(record, {
        observedBy: "",
        observedAtIso: "2026-09-10T01:00:00.000Z",
        evidence: invalidatedEvidence,
        planRevision: `${record.planRevision}-r2`,
      }).status,
    ).toBe("refused");
    // A genuine fresh observation, with a new revision and a named observer, succeeds — and the
    // reopened plan then passes through the same consumer.
    const repaired = revalidateAcceptedScenePlan(record, {
      observedBy: "faculty_reviewer_ward_v1",
      observedAtIso: "2026-09-10T01:00:00.000Z",
      evidence: invalidatedEvidence,
      planRevision: `${record.planRevision}-r2`,
    });
    expect(repaired.status, repaired.status === "refused" ? repaired.reason : "").toBe("revalidated");
    if (repaired.status !== "revalidated") return;
    expect(repaired.record.revisions.clipRevision).toBe("openclinxr_retarget_walk_formal_cc0_v2");
    expect(repaired.record.acknowledgment.acknowledgedPlanRevision).toBe(repaired.record.planRevision);
    const reopenedAfterRepair = reopen(repaired.record, {
      evidence: invalidatedEvidence,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(
      reopenedAfterRepair.status,
      reopenedAfterRepair.status === "reopened" ? "" : reopenedAfterRepair.detail,
    ).toBe("reopened");

    // ── (h) The review projection carries the decisions and no hidden facts ─────────────────────
    const projection = projectAcceptedScenePlanForReview(record);
    expect(projection.planRevision).toBe(record.planRevision);
    expect(projection.acknowledgment.bindsThisPlan).toBe(true);
    expect(projection.boundInstances.length).toBe(record.instances.length);
    // A MARKER CHECK, and it is labelled as one. `privateKeysInProjection` matches key NAMES against
    // /hidden|private|serverOnly|internal|secret|confidential/i, so a clinical fact under a benign key
    // name passes it. It is kept because it catches the careless case cheaply; it is not the control.
    expect(privateKeysInProjection(projection)).toEqual([]);
    // THE STRUCTURAL CONTROL. The projection is built field by field, so the guarantee is that no
    // free-form value survives at all — which holds whatever a key is called. This asserts the
    // projection's leaf VALUES are drawn from the record's own identity fields and nothing else, so a
    // note, a payload or a transcript added to the record cannot ride along under any name.
    const projectionLeaves: string[] = [];
    const collectLeaves = (value: unknown): void => {
      if (Array.isArray(value)) return void value.forEach(collectLeaves);
      if (typeof value === "object" && value !== null) return void Object.values(value).forEach(collectLeaves);
      if (typeof value === "string") projectionLeaves.push(value);
    };
    collectLeaves(projection);
    const recordLeaves = new Set<string>();
    const collectRecordLeaves = (value: unknown): void => {
      if (Array.isArray(value)) return void value.forEach(collectRecordLeaves);
      if (typeof value === "object" && value !== null) return void Object.values(value).forEach(collectRecordLeaves);
      if (typeof value === "string") recordLeaves.add(value);
    };
    collectRecordLeaves(record);
    const projectionOwnVocabulary = new Set<string>([
      "openclinxr.accepted-scene-plan-review.v1",
      "versioned_scene_decisions_and_measured_replay",
      ...ACCEPTED_SCENE_PLAN_REVIEW_NOT_EVIDENCE_FOR,
    ]);
    const unexplained = projectionLeaves.filter(
      (leaf) => !recordLeaves.has(leaf) && !projectionOwnVocabulary.has(leaf),
    );
    expect(unexplained, "the projection emitted a string the record does not contain").toEqual([]);
    // No free-form payload survives the projection, so there is nowhere for a hidden fact to sit.
    expect(canonicalJson(projection)).not.toMatch(/hiddenFact|serverOnly|secret/iu);

    // ── (i) The browser entry does not pull a server-only builtin ───────────────────────────────
    // The reopen path must run in the page. `frozen-scene-replay.ts` is the module this file's
    // clause (b) drove, and its imports are read from source rather than inferred: on 2026-09-09 a
    // node:crypto import reachable from the ui-xr bundle killed every page load.
    const replaySource = readFileSync(
      "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts",
      "utf8",
    );
    expect(replaySource).not.toMatch(/from "node:/u);
    expect(replaySource).not.toMatch(/asset-registry\/layout-variation/u);
    const planSource = readFileSync(
      "packages/openclinxr/asset-registry/src/case-owned-scene-plan.ts",
      "utf8",
    );
    expect(planSource).not.toMatch(/from "node:/u);
    const recordSource = readFileSync(
      "packages/openclinxr/session-state/src/accepted-scene-plan.ts",
      "utf8",
    );
    expect(recordSource).not.toMatch(/from "node:/u);
    // COUNTERWEIGHT: the server-only half genuinely IS server-only, so the split above is a real
    // division rather than three modules that happen to need nothing.
    const freezeSource = readFileSync(
      "packages/openclinxr/asset-registry/src/scene-plan-freeze.ts",
      "utf8",
    );
    expect(freezeSource).toMatch(/from "node:crypto"/u);

    // ── (j) A record the freeze could not have produced is refused by the same consumer ─────────
    // Three shapes that a hand-edited or hand-written record can have and a frozen one cannot.
    // Without these the reopen would accept anything with the right field names.
    const wallClockSeed: DurableAcceptedScenePlanRecord = {
      ...record,
      variation: { ...record.variation, seed: String(Date.now()) },
    };
    const seedRefusal = reopen(wallClockSeed, {
      evidence: clean,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(seedRefusal.status).toBe("refused");
    if (seedRefusal.status !== "refused") return;
    expect(seedRefusal.reason).toBe("plan_wrong_schema");

    // An arrival that never met the rubric must not be laundered by reopening it. 0.31 m is 6.2x
    // the 0.05 m cap `proof-contract-v2.md` fixes for SC-05, and is the value that card's own
    // verifier uses as its out-of-rubric control.
    const badArrival = freezeOrThrow(
      freezeInput(ward, {
        arrival: {
          arrivalErrorMeters: 0.31,
          settledHeadingErrorDegrees: 1.7,
          stoppedSeconds: 2.4,
          stoppedRootTravelMeters: 0.0009,
        },
      }),
    );
    const arrivalRefusal = reopen(badArrival, {
      evidence: observeNow(ward, {
        geometryRevision: badArrival.revisions.geometryRevision,
        stationRunId: badArrival.run.stationRunId,
      }),
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(arrivalRefusal.status).toBe("refused");
    if (arrivalRefusal.status !== "refused") return;
    expect(arrivalRefusal.reason).toBe("arrival_outside_rubric");

    // An event order naming a dialogue turn no turn id declares cannot be replayed as what was said.
    const orphanTurn: DurableAcceptedScenePlanRecord = { ...record, dialogueTurnIds: [] };
    const dialogueRefusal = reopen(orphanTurn, {
      evidence: clean,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
    });
    expect(dialogueRefusal.status).toBe("refused");
    if (dialogueRefusal.status !== "refused") return;
    expect(dialogueRefusal.reason).toBe("dialogue_identity_mismatch");

    // ── (j2) The DURABLE READ refuses the same records, on its own ──────────────────────────────
    // `reopen()` above runs `requireAcceptedScenePlan` first and `reopenFrozenScene` second, and both
    // check the seed — deliberate defence in depth across a boundary neither can import across. This
    // card's two-sided gate found that the redundancy hid the durable half: reverting session-state's
    // seed clause broke nothing, because the replay half caught it anyway. Two layers checking one
    // thing is right; only one of them having a test is not.
    expect(requireAcceptedScenePlan({ ...record, variation: { ...record.variation, seed: String(Date.now()) } }).status).toBe("wrong_schema");
    expect(requireAcceptedScenePlan({ ...record, instances: [] }).status).toBe("wrong_schema");
    expect(requireAcceptedScenePlan({ ...record, eventOrder: [] }).status).toBe("wrong_schema");
    expect(requireAcceptedScenePlan({ ...record, schemaVersion: "something.else.v9" }).status).toBe("wrong_schema");
    expect(requireAcceptedScenePlan(null).status).toBe("absent");
    expect(requireAcceptedScenePlan("not an object").status).toBe("malformed");
    // KNOWN-GOOD COLUMN: the real record reads ok, so the refusals are not refusing everything.
    expect(requireAcceptedScenePlan(record).status).toBe("ok");

    // ── (k0) THE TWO RECORD DECLARATIONS CORRESPOND ─────────────────────────────────────────────
    // `DurableAcceptedScenePlanRecord` is declared twice: authoritatively in session-state, and
    // pinned structurally in asset-registry because neither package may import the other (session-
    // state's manifest is frozen by exact equality; an asset-registry edge would dirty pnpm-lock.yaml
    // outside this card's write roots). A restated type that drifts is worse than an import.
    //
    // THIS READS BOTH SOURCES. A first version asserted `const pinned: PinnedRecord = record` and
    // compared `Object.keys` of an instance, and this card's own two-sided gate showed it was inert:
    // vitest STRIPS types without checking them, so the assignment cannot fail at run time, and an
    // unset optional field never appears in `Object.keys`. Adding a required field to one side
    // passed. Comparing the declared field names in the two files catches both.
    const declaredFields = (source: string): string[] => {
      const start = source.indexOf("export type DurableAcceptedScenePlanRecord = {");
      expect(start, "the record declaration moved or was renamed").toBeGreaterThanOrEqual(0);
      const body = source.slice(source.indexOf("{", start));
      let depth = 0;
      let end = 0;
      for (let index = 0; index < body.length; index += 1) {
        if (body[index] === "{") depth += 1;
        if (body[index] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }
      const fields: string[] = [];
      let nested = 0;
      for (const line of body.slice(1, end).split("\n")) {
        const trimmed = line.trim();
        if (nested === 0) {
          const match = /^([A-Za-z_$][\w$]*)\??\s*:/u.exec(trimmed);
          if (match?.[1] !== undefined) fields.push(match[1]);
        }
        nested += (line.match(/\{/gu) ?? []).length - (line.match(/\}/gu) ?? []).length;
      }
      return fields.sort();
    };
    const durableFields = declaredFields(
      readFileSync("packages/openclinxr/session-state/src/accepted-scene-plan.ts", "utf8"),
    );
    const pinnedFields = declaredFields(
      readFileSync("packages/openclinxr/asset-registry/src/accepted-scene-plan-evidence.ts", "utf8"),
    );
    expect(durableFields.length).toBeGreaterThanOrEqual(14);
    expect(pinnedFields).toEqual(durableFields);
    // And the live record carries every declared field, so the declarations describe what is built.
    expect(Object.keys(record).sort()).toEqual(durableFields);

    // ── (k) The seeded solver refuses a seed nothing derived ────────────────────────────────────
    // A GAP THIS CARD'S OWN TWO-SIDED GATE FOUND. Reverting `LAYOUT_SEED_PATTERN` in
    // `layout-solve.ts` broke nothing, because clause (j)'s wall-clock record is caught one layer
    // earlier by the RECORD validator and the solver never sees the bad seed. Two layers checking
    // the same thing is right; only one of them being covered is not. This drives the solver
    // directly, so its guard has a clause of its own.
    for (const notASeed of [String(Date.now()), "", "not-a-digest", "A".repeat(64)]) {
      expect(
        () =>
          resolveBedsideLayoutFromSeed({
            seed: notASeed,
            patientPosition: ward.patientWorld,
            obstacles: ward.geometry.obstacles,
          }),
        JSON.stringify(notASeed),
      ).toThrow(/refused seed/u);
    }
    // KNOWN-GOOD COLUMN: the real persisted seed goes straight through, so the guard above is not
    // refusing everything.
    expect(
      resolveBedsideLayoutFromSeed({
        seed: record.variation.seed,
        patientPosition: ward.patientWorld,
        obstacles: ward.geometry.obstacles,
      }).seed,
    ).toBe(record.variation.seed);

    // ── (l) THE REPRODUCTION COMPARISON IS LOAD-BEARING ─────────────────────────────────────────
    // BLOCKER FOUND IN REVIEW. `frozen-scene-replay.ts`'s `if (layoutProblems.length > 0)` was the
    // only code refusing a record whose stored layout disagrees with the re-solve, and NOTHING
    // asserted it. Reproduced independently: changing it to `> 99`, rebuilding @openclinxr/asset-
    // registry and running this file plus the verifier units gave 2 files, 27 tests, all passing.
    // The report's own heading, "The reopen re-solves; it does not echo", was true and would have
    // survived deletion with no gate noticing. Clause (b)'s seed equality proves the seed is
    // THREADED; only these clauses prove the layout is REPRODUCED.
    const otherSide = record.resolvedLayout.approachSide === "patient_left" ? "patient_right" : "patient_left";
    for (const [label, mutated] of [
      [
        "a stored approach side the re-solve does not produce",
        { ...record, resolvedLayout: { ...record.resolvedLayout, approachSide: otherSide as typeof record.resolvedLayout.approachSide } },
      ],
      [
        "a stored standoff the re-solve does not produce",
        { ...record, resolvedLayout: { ...record.resolvedLayout, standoffMeters: record.resolvedLayout.standoffMeters + 0.15 } },
      ],
      [
        "a stored target moved 1e-6 m, a thousand times the 1e-9 m reproduction tolerance",
        {
          ...record,
          resolvedLayout: {
            ...record.resolvedLayout,
            targetPosition: { ...record.resolvedLayout.targetPosition, x: record.resolvedLayout.targetPosition.x + 1e-6 },
          },
        },
      ],
    ] as ReadonlyArray<[string, DurableAcceptedScenePlanRecord]>) {
      const refused = reopen(mutated, {
        evidence: clean,
        geometry: ward.geometry,
        patientWorldPosition: ward.patientWorld,
        start: ward.start,
      });
      expect(refused.status, label).toBe("refused");
      if (refused.status !== "refused") continue;
      expect(refused.reason, label).toBe("layout_not_reproduced");
      expect(refused.detail.length, label).toBeGreaterThan(0);
    }

    // KNOWN-GOOD COLUMN for the tolerance, so it is a boundary and not a rubber stamp: a target moved
    // 1e-12 m — a thousand times BELOW the tolerance, and still far above double-precision noise at
    // metre scale — is reproduced rather than refused. Without this the clauses above would also pass
    // against a comparison that refused everything.
    const withinTolerance = reopen(
      {
        ...record,
        resolvedLayout: {
          ...record.resolvedLayout,
          targetPosition: { ...record.resolvedLayout.targetPosition, x: record.resolvedLayout.targetPosition.x + 1e-12 },
        },
      },
      { evidence: clean, geometry: ward.geometry, patientWorldPosition: ward.patientWorld, start: ward.start },
    );
    expect(
      withinTolerance.status,
      withinTolerance.status === "reopened" ? "" : withinTolerance.detail,
    ).toBe("reopened");

    // An authored intent nothing can satisfy reaches the same consumer and reports conflicts.
    const unsatisfiable = reopen(record, {
      evidence: clean,
      geometry: ward.geometry,
      patientWorldPosition: ward.patientWorld,
      start: ward.start,
      intent: { approachSide: "patient_left", standoffMeters: 0 },
    });
    expect(unsatisfiable.status).toBe("refused");
    if (unsatisfiable.status !== "refused") return;
    expect(unsatisfiable.reason).toBe("unsatisfiable_intent");
    expect(unsatisfiable.detail).toMatch(/patient_left/u);

    // ── (m) THE SHIPPED RUNTIME REACHES THIS RING ───────────────────────────────────────────────
    // BLOCKER FOUND IN REVIEW. The first attempt built seven modules that only this test entered:
    // `main.ts` imported none of them. Each link below is asserted from source, so severing any one
    // of them fails here. The app-to-package hop is a package specifier rather than a relative path,
    // so it is asserted by specifier and call site rather than by walking the module graph.
    const chain: ReadonlyArray<[string, string, RegExp]> = [
      [
        "main.ts value-imports the admission subpath",
        "apps/ui-xr/src/main.ts",
        /import \{[^}]*admitFrozenScenePlanForObservedScene[^}]*\} from "@openclinxr\/asset-registry\/encounter-bundle-admission"/u,
      ],
      [
        "main.ts calls it in the frame loop",
        "apps/ui-xr/src/main.ts",
        /admitFrozenScenePlanForObservedScene\(\{/u,
      ],
      [
        "the boot path value-imports the admission subpath",
        "apps/ui-xr/src/encounter-bundle-boot/index.ts",
        /from "@openclinxr\/asset-registry\/encounter-bundle-admission"/u,
      ],
      [
        "the boot path admits the carried plan",
        "apps/ui-xr/src/encounter-bundle-boot/index.ts",
        /admitFrozenScenePlan\(\{ bundle \}\)/u,
      ],
      [
        "the admission calls the reopen",
        "packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts",
        /reopenFrozenScene\(input\.record,/u,
      ],
      [
        "the reopen calls the case-owned solver consumer",
        "packages/openclinxr/asset-registry/src/frozen-scene-replay.ts",
        /resolveCaseOwnedScenePlan\(\{/u,
      ],
      [
        "the case-owned consumer calls the seeded solver",
        "packages/openclinxr/asset-registry/src/case-owned-scene-plan.ts",
        /resolveBedsideLayoutFromSeed\(\{/u,
      ],
    ];
    for (const [label, file, pattern] of chain) {
      // Comments are stripped first: a severed link that survives only inside a comment is severed.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^\s*\/\/.*$/gmu, "");
      expect(pattern.test(source), `${label} (${file})`).toBe(true);
    }
    // A type-only import would satisfy the specifier clause while erasing the runtime relationship.
    const mainSource = readFileSync("apps/ui-xr/src/main.ts", "utf8");
    const admissionImport = mainSource.slice(
      0,
      mainSource.indexOf('from "@openclinxr/asset-registry/encounter-bundle-admission"'),
    );
    const lastImport = admissionImport.lastIndexOf("import ");
    expect(admissionImport.slice(lastImport, lastImport + 12)).not.toContain("type");

    // ── (n) A REPAIR MUST POSTDATE THE ACCEPTANCE IT REPLACES ───────────────────────────────────
    expect(
      revalidateAcceptedScenePlan(record, {
        observedBy: "faculty_reviewer_ward_v1",
        // The plan was accepted at 2026-09-10T00:00:00Z; this looks back a day.
        observedAtIso: "2026-09-09T00:00:00.000Z",
        evidence: { ...clean, clipRevision: "openclinxr_retarget_walk_formal_cc0_v2" },
        planRevision: `${record.planRevision}-backdated`,
      }).status,
    ).toBe("refused");

    observe([
      { observationId: "sc06-a09-fields-present", metric: "a09_fields_present_on_record", unit: "count", value: a09Present, source: "counted off the frozen record" },
      { observationId: "sc06-reproduction-offset", metric: "layout_reproduction_offset_meters", unit: "meters", value: reopened.reproduced.targetOffsetMeters, source: "reopenFrozenScene" },
      { observationId: "sc06-variation-resolved", metric: "authorized_indices_that_resolved", unit: "count", value: resolvedIndices.length, source: "freezeAcceptedScenePlan" },
      { observationId: "sc06-variation-refused", metric: "authorized_indices_refused_with_named_conflicts", unit: "count", value: refusedIndices.length, source: "freezeAcceptedScenePlan" },
      { observationId: "sc06-distinct-refusals", metric: "distinct_evidence_refusal_kinds", unit: "count", value: distinctRefusalKinds.size, source: "reasons returned by reopenFrozenScene" },
      { observationId: "sc06-frozen-plan-revision", metric: "frozen_plan_revision", unit: "digest", value: record.planRevision, source: "scenePlanRevision" },
      { observationId: "sc06-frozen-seed", metric: "frozen_layout_seed", unit: "digest", value: record.variation.seed, source: "deriveLayoutVariationSeed" },
      { observationId: "sc06-geometry-revision", metric: "frozen_geometry_revision", unit: "digest", value: record.revisions.geometryRevision, source: "geometryRevisionDigest" },
    ]);
  });
});
