/**
 * THE RUN THIS CARD ACTUALLY OBSERVED, copied verbatim from the retained artifact.
 *
 * These are not fixtures. Every value below was read off
 * `window.__openClinXrBedsideApproachEvidence` in a headless chromium run of the shipped UI-XR
 * entry on the persisted scene-closure case, and the same bytes are retained in the owner evidence
 * store so a reviewer can resolve them independently:
 *
 *   sc-evidence:sc-07/sc07-blocked-run-2026-09-13-telemetry.json
 *     5,003 bytes  sha256 f222e350d69271d6dd538857eaf7d29c182e9ccc1f68355d37d4c46fe6f5fd04
 *   sc-evidence:sc-07/sc07-blocked-run-2026-09-13.webm
 *     3,316,410 bytes  sha256 bdcfcf80a043265a7edbea6726c0ede336da165cd0fc1c5915a53f05c0b7717d
 *     decodes to 48.68 s / 1217 video frames under `decodeRetainedVideo`
 *
 * WHY A COMMITTED COPY EXISTS AT ALL. The named behavior test must run under a plain
 * `pnpm exec vitest run <path>` with no environment, so it cannot reach into the owner store. This
 * module is the measured excerpt it reads; the store copy is what the direct verifier CLI resolves.
 * If the two ever disagree, the store bytes are authoritative and the hashes above locate them.
 *
 * WHAT THIS RUN IS NOT. It is not an activation-to-arrival recording, and nothing in this package
 * may present it as one: the encounter never activated, so there is no walk, no arrival and no stop
 * interval on this film. A10 stays OPEN. See `docs/openclinxr/scene-closure-2026-09-09/evidence/sc-07.md`.
 *
 * claimScope: what one headless chromium run of the shipped entry published about itself.
 * notEvidenceFor: clinical validity, worn-headset readiness, public deployment, gait realism,
 * scoring validity, and any activation-to-arrival claim.
 */

import type { RecordedWorkflowTelemetry } from "./normal-workflow-recording.js";

export const SC07_OBSERVED_RUN_ID = "sc07-blocked-run-2026-09-13";
export const SC07_OBSERVED_RUN_SOURCE_COMMIT = "f3fec290699212d5a5b4150cb23e591d6d93afa1";
export const SC07_OBSERVED_TELEMETRY_SHA256 =
  "f222e350d69271d6dd538857eaf7d29c182e9ccc1f68355d37d4c46fe6f5fd04";
export const SC07_OBSERVED_VIDEO_SHA256 =
  "bdcfcf80a043265a7edbea6726c0ede336da165cd0fc1c5915a53f05c0b7717d";
export const SC07_OBSERVED_VIDEO_BYTES = 3_316_410;
export const SC07_OBSERVED_VIDEO_DECODED_SECONDS = 48.68;
export const SC07_OBSERVED_VIDEO_DECODED_FRAMES = 1217;

/**
 * The recorder was already running when the page was navigated: 45 ms of video precede the request
 * that starts the encounter. That is the one clause of the card this run does satisfy, and it is
 * worth keeping because it is the part of the recorder design that was in doubt.
 */
export const SC07_OBSERVED_RECORDER_LEAD_MS = 45;

/** No locomotion/recorder global was defined; the refusal is the runtime's own, not an injection. */
export const SC07_OBSERVED_RECORDER_GLOBAL_PRESENT = false;

/** Verbatim from the retained telemetry's `observed.bedsideApproachEvidence`. */
export const SC07_OBSERVED_TELEMETRY: RecordedWorkflowTelemetry = {
  driveSource: null,
  refusal: null,
  phase: null,
  physicianActorId: null,
  toeBonesResolved: false,
  skeletonSampleCount: 0,
  samples: [],
  targetWorld: null,
  targetHeadingRadians: null,
  stoppedSeconds: 0,
  observedObstacleIds: [],
};

/**
 * The same run with ONLY the activation fields restored.
 *
 * This is a controlled mutation of the measured record, not a second run and not an invented
 * arrival: every other field is still the observed one, and it still has zero samples. Its only job
 * is to show that the instrument's refusal is SPECIFIC — restoring activation must retire the
 * activation reason and nothing else — so a reader can tell the instrument apart from a function
 * that returns `false` for everything.
 */
export const SC07_OBSERVED_TELEMETRY_WITH_ACTIVATION_RESTORED: RecordedWorkflowTelemetry = {
  ...SC07_OBSERVED_TELEMETRY,
  driveSource: "case_owned_bedside_approach",
  phase: "walking",
  physicianActorId: "senior_resident_ward_v1",
};

/**
 * What the runtime's frozen-plan admission answered, measured three ways on the same commit.
 *
 * Recorded here because it is the reason the run above never activated, and because the runtime
 * publishes no telemetry for it — a reader who only had the telemetry would see an absence with no
 * cause attached.
 */
export const SC07_OBSERVED_ADMISSION = {
  /** Live browser scene, real composed positions. */
  browserLive: {
    status: "refused",
    reason: "evidence_changed",
    detail: "revisions.geometryRevision changed: the room geometry the route was cleared against",
  },
  /** Node, parametric station shell, real composed positions — the freeze's own conditions. */
  nodeShell: { status: "admitted", reproducedSeed: "62a49d3f625f5154c1fe67f6fdf86f8b345db4ebe539cd218b8aa943186c28ee" },
  frozenGeometryRevision: "geom-v1-c45e274d-7",
  nodeShellGeometryRevision: "geom-v1-c45e274d-7",
  browserGeometryRevision: "geom-v1-cdaa4a22-7",
} as const;
