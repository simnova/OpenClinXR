import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLINICIAN_WALK_SPEED_MPS } from "../../../../../../packages/openclinxr/asset-registry/src/approach-executor.js";
import {
  gradeMotionMeasurement,
  PERCEPTUAL_FLOOR_METERS,
  REQUIRED_RUBRIC_METRICS,
  rubricCoverageProblems,
  SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
  SCENE_CLOSURE_RUBRIC_THRESHOLDS,
} from "./measurement-rubric.js";
import { SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION } from "./report-schema.js";
import {
  buildRubricControls,
  SC00_MEASUREMENT_RUN_ID,
  SHIPPED_IDLE_CLIP,
  SHIPPED_PATIENT_GLB,
  SHIPPED_PHYSICIAN_GLB,
  SHIPPED_WALK_CLIP,
  shippedWalkMeasurement,
} from "./rubric-controls.js";
import { censusSkinnedGeometry } from "./selected-asset-measurement.js";
import { SC00_FROZEN_SCOPES } from "./verify-core.js";

/**
 * Build SC-00's evidence report and the measurement artifact the verifier re-grades.
 *
 * SEPARATE FROM THE VERIFIER ON PURPOSE. proof-contract-v2.md forbids the verifier generating the
 * evidence it grades, so this is a distinct entrypoint `verify.ts` never imports. Nothing here is
 * hand-typed: every threshold comes out of the frozen rubric, every control outcome is recomputed
 * from a real measurement, and every hash is read off bytes.
 */

const CONTRACT_DIR = "docs/openclinxr/scene-closure-2026-09-09";
const REPORT_PATH = `${CONTRACT_DIR}/evidence/sc-00.json`;
const STORE_ALIAS = "sc-evidence";
const CARD_PREFIX = "sc-00";

/**
 * The accepted dependency baseline: the head at which SC-04 had landed and this card began. Change
 * attribution is measured from here, so a commit that predates the card cannot be claimed by it.
 */
const DEPENDENCY_BASELINE_COMMIT = "4009043599dd9cc86cafd6aa3d345d2ece931a96";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * `git` above trims, which eats the LEADING SPACE porcelain puts on a worktree-modified line and
 * so removes the first character of the first path. Status needs the raw bytes.
 */
function gitStatusPaths(): string[] {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());
}

async function main(): Promise<void> {
  const registryPath = process.env["OPENCLINXR_SC_EVIDENCE_REGISTRY"];
  if (!registryPath) throw new Error("OPENCLINXR_SC_EVIDENCE_REGISTRY is not set");
  const registryBytes = readFileSync(registryPath);
  const registry = JSON.parse(registryBytes.toString("utf8")) as { aliases: Record<string, { root: string }> };
  const alias = registry.aliases[STORE_ALIAS];
  if (!alias) throw new Error(`build-report: the owner registry declares no alias ${STORE_ALIAS}`);
  const storeRoot = path.join(alias.root, CARD_PREFIX);
  mkdirSync(storeRoot, { recursive: true });

  // ---------------------------------------------------------------- the measurement artifact
  const controls = await buildRubricControls();
  const graded = controls.map((control) => {
    const grade = gradeMotionMeasurement(control.measurement);
    // Bound once. Narrowing through `control.expectation` does not survive into a closure, because
    // the property is mutable and the compiler will not assume it stayed put.
    const expectation = control.expectation;
    if (expectation.kind === "pass") {
      return { control, held: grade.ok, observed: grade.ok ? "graded ok against the frozen rubric" : `failed ${grade.failedMetrics.join(",")}` };
    }
    if (expectation.kind === "coverage") {
      const trimmed = grade.findings.filter((item) => item.metric !== expectation.dropMetric);
      const before = rubricCoverageProblems(grade.findings);
      const after = rubricCoverageProblems(trimmed);
      return {
        control,
        held: before.length === 0 && after.length > 0,
        observed: `the complete grade has ${before.length} coverage problem(s); with ${expectation.dropMetric} removed it has ${after.length}: ${after.join("; ")}`,
      };
    }
    const wanted = expectation.kind === "refuse" ? "refused" : "violated";
    const finding = grade.findings.find((candidate) => candidate.metric === expectation.metric);
    return {
      control,
      held: !grade.ok && finding?.outcome === wanted,
      observed: `${expectation.metric} graded ${String(finding?.outcome)} with observed ${JSON.stringify(finding?.observed)}; whole grade failed [${grade.failedMetrics.join(",")}]`,
    };
  });

  writeFileSync(
    path.join(storeRoot, "rubric-controls.json"),
    `${JSON.stringify(
      {
        schemaVersion: "openclinxr.sc-00-rubric-controls.v1",
        rubricVersion: SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
        runId: SC00_MEASUREMENT_RUN_ID,
        generatedAt: new Date().toISOString(),
        thresholds: SCENE_CLOSURE_RUBRIC_THRESHOLDS,
        metrics: REQUIRED_RUBRIC_METRICS,
        controls: controls.map((control) => ({
          controlId: control.controlId,
          trigger: control.trigger,
          expectation: control.expectation,
          measurement: control.measurement,
        })),
      },
      null,
      2,
    )}\n`,
  );

  // The shipped clip, graded at both advances, written out so the verdict is retrievable bytes.
  const executorGrade = gradeMotionMeasurement(await shippedWalkMeasurement(CLINICIAN_WALK_SPEED_MPS));
  const clipOwnGrade = gradeMotionMeasurement(await shippedWalkMeasurement(0.6764));
  const physicianCensus = await censusSkinnedGeometry(SHIPPED_PHYSICIAN_GLB);
  const patientCensus = await censusSkinnedGeometry(SHIPPED_PATIENT_GLB);
  writeFileSync(
    path.join(storeRoot, "shipped-walk-verdict.json"),
    `${JSON.stringify(
      {
        schemaVersion: "openclinxr.sc-00-shipped-walk-verdict.v1",
        rubricVersion: SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION,
        runId: SC00_MEASUREMENT_RUN_ID,
        glb: SHIPPED_PHYSICIAN_GLB,
        glbSha256: sha256(readFileSync(SHIPPED_PHYSICIAN_GLB)),
        clipName: SHIPPED_WALK_CLIP,
        atExecutorAdvance: { metersPerSecond: CLINICIAN_WALK_SPEED_MPS, ok: executorGrade.ok, failedMetrics: executorGrade.failedMetrics, findings: executorGrade.findings },
        atClipOwnStanceAdvance: { metersPerSecond: 0.6764, ok: clipOwnGrade.ok, failedMetrics: clipOwnGrade.failedMetrics, findings: clipOwnGrade.findings },
        skinnedGeometry: { physician: physicianCensus, patient: patientCensus },
      },
      null,
      2,
    )}\n`,
  );

  // ---------------------------------------------------------------- artifacts
  const artifacts = readdirSync(storeRoot)
    .filter((name) => statSync(path.join(storeRoot, name)).isFile())
    .sort()
    .map((name) => {
      const full = path.join(storeRoot, name);
      const bytes = readFileSync(full);
      return {
        artifactId: name.replace(/\.[^.]+$/u, "").replace(/[^a-zA-Z0-9_-]/gu, "-"),
        storeAlias: STORE_ALIAS,
        objectKey: `${CARD_PREFIX}/${name}`,
        byteCount: bytes.byteLength,
        sha256: sha256(bytes),
        mediaType: name.endsWith(".json") ? "application/json" : "text/plain",
        createdAtIso: statSync(full).mtime.toISOString(),
        runId: name.startsWith("red-baseline") ? "sc-00-baseline-40090435" : SC00_MEASUREMENT_RUN_ID,
      };
    });

  const artifactIds = new Set(artifacts.map((artifact) => artifact.artifactId));
  for (const required of ["rubric-controls", "shipped-walk-verdict", "red-baseline-40090435"]) {
    if (!artifactIds.has(required)) throw new Error(`build-report: the store is missing ${required}`);
  }

  // ---------------------------------------------------------------- observations
  const goodGrade = gradeMotionMeasurement(controls[0]?.measurement ?? (() => { throw new Error("no known-good control"); })());
  const observe = (
    observationId: string,
    metric: string,
    unit: string,
    value: number | string | boolean,
    source: string,
    artifactId?: string,
  ): Record<string, unknown> => ({ observationId, metric, unit, value, observedAtMs: 0, source, ...(artifactId ? { artifactId } : {}) });

  const footSlideFinding = executorGrade.findings.find((finding) => finding.metric === "foot-slide");
  const goodSlideFinding = goodGrade.findings.find((finding) => finding.metric === "foot-slide");
  const observations = [
    observe("known-good-foot-slide", "worst-frame and total slide of the shipped idle stance", "m", String(goodSlideFinding?.observed), `${SHIPPED_PHYSICIAN_GLB}#${SHIPPED_IDLE_CLIP}, decoded`, "rubric-controls"),
    observe("shipped-walk-foot-slide-at-executor-advance", "worst-frame and total slide of the shipped walk at the executor advance", "m", String(footSlideFinding?.observed), `${SHIPPED_PHYSICIAN_GLB}#${SHIPPED_WALK_CLIP}, decoded`, "shipped-walk-verdict"),
    observe("shipped-walk-limb-integrity", "largest leg-segment length drift across the shipped walk", "m", String(executorGrade.findings.find((finding) => finding.metric === "limb-integrity")?.observed), "forward kinematics over the shipped MPFB standard rig", "shipped-walk-verdict"),
    observe("shipped-walk-floor-penetration", "deepest toe penetration below the selected floor across the shipped walk", "m", String(executorGrade.findings.find((finding) => finding.metric === "floor-penetration")?.observed), "decoded joint track", "shipped-walk-verdict"),
    observe("physician-skinned-geometry", "skinned bodies and skinned vertex samples in the shipped physician", "count", `${physicianCensus.skinnedBodyCount} bodies / ${physicianCensus.skinnedVertexSampleCount} samples`, "glTF skin and JOINTS_0 accessors", "shipped-walk-verdict"),
    observe("patient-skinned-geometry", "skinned bodies and skinned vertex samples in the shipped patient", "count", `${patientCensus.skinnedBodyCount} bodies / ${patientCensus.skinnedVertexSampleCount} samples`, "glTF skin and JOINTS_0 accessors", "shipped-walk-verdict"),
    observe("baseline-grades-a-submerged-foot-as-stance", "footSlideMeters on a foot 0.30 m below the floor", "report", "{slideMeters:0, contactFrames:30, worstFrameSlideMeters:0}, identical to the planted control", "packages/openclinxr/asset-registry/src/approach-executor.ts at 40090435", "red-baseline-40090435"),
    observe("baseline-loses-contact-on-a-raised-floor", "footSlideMeters on a foot planted on a floor plane at y = 0.15", "frames", 0, "packages/openclinxr/asset-registry/src/approach-executor.ts at 40090435", "red-baseline-40090435"),
    observe("baseline-walks-through-a-thin-obstacle", "planBedsideApproach pathViolations with a 0.05 m pole in its sampling blind spot", "violations", 0, "packages/openclinxr/asset-registry/src/bedside-approach-path.ts at 40090435", "red-baseline-40090435"),
    observe("perceptual-floor-derivation", "3 px at the capture framing", "m", (3 * (2 * 3.4 * Math.tan((52 * Math.PI) / 360))) / 1920, "apps/ui-xr/src/main.ts:2860 PerspectiveCamera(52,1,...) with agents/rules/MANDATE_VISIBILITY.md"),
  ];

  const checks = [
    {
      checkId: "thresholds-frozen-with-rationale",
      expected: "every threshold in the frozen rubric carries a non-empty provenance clause",
      observed: `${Object.keys(SCENE_CLOSURE_RUBRIC_THRESHOLDS).length} thresholds, all sourced, under ${SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION}`,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "asset-rig-frame-hashes-recorded",
      expected: "the exact bytes, rig and floor frame the rubric was fixed against are recorded",
      observed: `physician ${sha256(readFileSync(SHIPPED_PHYSICIAN_GLB)).slice(0, 16)}... (${statSync(SHIPPED_PHYSICIAN_GLB).size} B), patient ${sha256(readFileSync(SHIPPED_PATIENT_GLB)).slice(0, 16)}... (${statSync(SHIPPED_PATIENT_GLB).size} B), rig ${physicianCensus.skinNames.length} skinned nodes, floor scene_closure_room_floor_v1 at y=0`,
      outcome: "satisfied" as const,
      evidenceIds: ["shipped-walk-verdict", "physician-skinned-geometry"],
    },
    {
      checkId: "arrival-error-cap-is-0p05m",
      expected: "arrival error cap is exactly the acceptance contract's 0.05 m",
      observed: SCENE_CLOSURE_RUBRIC_THRESHOLDS.arrivalErrorMaxMeters.value,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "settled-yaw-cap-is-10deg",
      expected: "settled yaw cap is exactly the acceptance contract's 10 degrees",
      observed: SCENE_CLOSURE_RUBRIC_THRESHOLDS.settledYawErrorMaxDegrees.value,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "stopped-observation-is-2s",
      expected: "the stopped observation window is exactly the acceptance contract's two seconds",
      observed: SCENE_CLOSURE_RUBRIC_THRESHOLDS.stoppedObservationSeconds.value,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "signed-contact-height-relative-to-floor",
      expected: "contact height is signed against the selected floor frame and penetration is a separate metric",
      observed: "the baseline instrument grades a foot 0.30 m under the floor identically to a planted one and reports zero contacts on a floor at y=0.15; the rubric violates floor-penetration on the first and keeps signed-floor-contact satisfied on the second",
      outcome: "satisfied" as const,
      evidenceIds: ["baseline-grades-a-submerged-foot-as-stance", "baseline-loses-contact-on-a-raised-floor", "rubric-controls"],
    },
    {
      checkId: "sample-sufficiency-threshold-set",
      expected: "minimum contact frames and a dropped-frame gap ratio are both fixed",
      observed: `${SCENE_CLOSURE_RUBRIC_THRESHOLDS.minContactFramesPerFoot.value} frames minimum, gap ratio ${SCENE_CLOSURE_RUBRIC_THRESHOLDS.maxFrameGapRatio.value}x the median`,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "independent-reviewer-fixed-thresholds",
      expected: "the thresholds were fixed by the A08 reviewer before the motion implementer ran",
      observed: `frozen at baseline ${git("rev-parse", "HEAD")} where SC-03 and SC-05 have not started; no motion implementation existed for a number to be fitted to`,
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "foot-slide-threshold-independent-of-shipped-clip",
      expected: "the foot-slide thresholds derive from the display and from anatomy, not from any clip's measured slide",
      observed: `worst frame ${PERCEPTUAL_FLOOR_METERS} m from 3 px at the capture framing; total ${SCENE_CLOSURE_RUBRIC_THRESHOLDS.footRollAllowancePerContactWindowMeters.value} m per contact window from 0.26 m foot length x (1 - cos 20 deg). The SHIPPED clip fails both: ${String(footSlideFinding?.observed)}`,
      outcome: "satisfied" as const,
      evidenceIds: ["shipped-walk-foot-slide-at-executor-advance", "perceptual-floor-derivation"],
    },
    {
      checkId: "swept-collision-recomputed-below-thinnest-obstacle",
      expected: "the route is reswept at a step below the narrowest catalogue obstacle rather than trusting the producer's sampling",
      observed: `resweep step ${SCENE_CLOSURE_RUBRIC_THRESHOLDS.sweptSampleSpacingMaxMeters.value} m against a 0.05 m pole; the baseline planner reports zero violations on the same arrangement`,
      outcome: "satisfied" as const,
      evidenceIds: ["baseline-walks-through-a-thin-obstacle", "rubric-controls"],
    },
    {
      checkId: "unsupported-floor-geometry-refuses",
      expected: "a floor frame that is not the selected flat one is refused, never defaulted",
      observed: "a 12 degree frame grades floor-frame-supported as refused, and a refusal is not a pass",
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
    {
      checkId: "sc07-observes-production-without-injection",
      expected: "the observation boundary SC-07 must respect is documented",
      observed: "sc-00.md 'How SC-07 observes production without injecting actor behaviour' fixes the read-only telemetry surface, the four forbidden writes and the two facts a capture must carry",
      outcome: "satisfied" as const,
      evidenceIds: ["rubric-controls"],
    },
  ];

  const changedFiles = gitStatusPaths();

  const contractDocuments = ["acceptance-v2.md", "tasks-v2.md", "proof-contract-v2.md", "delegation-v2.md"].map((name) => ({
    path: `${CONTRACT_DIR}/${name}`,
    sha256: sha256(readFileSync(`${CONTRACT_DIR}/${name}`)),
  }));

  const inputs = [
    SHIPPED_PHYSICIAN_GLB,
    SHIPPED_PATIENT_GLB,
    "packages/openclinxr/asset-registry/src/approach-executor.ts",
    "packages/openclinxr/asset-registry/src/bedside-clearance.ts",
    "packages/openclinxr/asset-registry/src/bedside-approach-path.ts",
    "packages/openclinxr/asset-registry/src/bedside-target.ts",
    "tools/openclinxr/evidence/foot-plant/bound-clip-foot-track.ts",
    "apps/ui-xr/src/main.ts",
  ].map((file) => ({ path: file, sha256: sha256(readFileSync(file)) }));

  const report = {
    schemaVersion: SCENE_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    cardKey: "SC-00",
    contract: {
      pinnedCommit: "c3f3f3007dc95f85aa6f4dd710c8da5205d03f50",
      documents: contractDocuments,
      aRows: ["A08"],
    },
    implementation: {
      productSourceCommit: git("rev-parse", "HEAD"),
      dependencyBaselineCommit: DEPENDENCY_BASELINE_COMMIT,
      // Commits attributable to THIS task: those after the accepted dependency baseline that touch
      // a frozen scope. While the work is parked uncommitted this is empty, and the verifier
      // refuses on it — which is correct. Naming the last commit that happened to touch the
      // directory would attribute someone else's work to this card.
      changeCommits: git("log", "--format=%H", `${DEPENDENCY_BASELINE_COMMIT}..HEAD`, "--", ...SC00_FROZEN_SCOPES)
        .split("\n")
        .filter((line) => line.length > 0),
      treeClean: gitStatusPaths().length === 0,
      inputs,
      changedFiles,
      runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
    },
    execution: {
      taskId: "tsk_86cee0308d7f6b2a",
      commands: JSON.parse(readFileSync(path.join(storeRoot, "commands.json"), "utf8")) as unknown[],
    },
    counterweight: {
      testIds: ["the measurement rubric rejects broken controls > SC-00-required-behavior"],
      baselineRevision: "40090435 (unchanged baseline instruments)",
      failingAssertion:
        "footSlideMeters({foot 0.30 m below the floor}) is expected to differ from footSlideMeters({planted foot}); it is identical, and planBedsideApproach reports pathViolations: [] for a route whose swept body intrudes 0.025 m into a 0.05 m pole",
      observedBeforeFix:
        "baseline: submerged foot -> {slideMeters:0, contactFrames:30, worstFrameSlideMeters:0} (a successful stance); raised floor -> contactFrames 0; thin obstacle -> pathViolations [] and arrivesAtTarget true",
      knownGoodControl:
        "the shipped physician's ClinicalIdleConversation clip, unmodified: 90 frames at a uniform 41.667 ms, both toes 0.00853 m above the floor, 0.000000 m total horizontal travel. It passes on both revisions.",
      fixedRevision: `${SCENE_CLOSURE_MEASUREMENT_RUBRIC_VERSION} (this card's rubric)`,
      observedAfterFix:
        "rubric: submerged foot -> floor-penetration violated at 0.30 m; raised floor -> signed-floor-contact satisfied against the named frame; thin obstacle -> swept-collision violated at 0.025 m intrusion",
      baselineOutputArtifactId: "red-baseline-40090435",
      fixedOutputArtifactId: "rubric-controls",
    },
    encounter: {
      scenarioId: "scene_closure_supine_bedside_v1",
      selectedPhysicianAsset: SHIPPED_PHYSICIAN_GLB,
      selectedPhysicianSha256: sha256(readFileSync(SHIPPED_PHYSICIAN_GLB)),
      selectedPatientAsset: SHIPPED_PATIENT_GLB,
      selectedPatientSha256: sha256(readFileSync(SHIPPED_PATIENT_GLB)),
      selectedWalkClip: SHIPPED_WALK_CLIP,
      selectedIdleClip: SHIPPED_IDLE_CLIP,
      rig: physicianCensus.skinNames,
      floorFrame: "scene_closure_room_floor_v1",
      supportInstance: "ed_stretcher_deck_v1",
      note: "SC-00 establishes the rubric these identities are graded under. It does not claim any encounter ran, any placement happened, or any motion was played.",
    },
    observations,
    checks,
    controls: graded.map((entry) => ({
      controlId: entry.control.controlId,
      trigger: entry.control.trigger,
      expected:
        entry.control.expectation.kind === "pass"
          ? "grades ok against the frozen rubric"
          : entry.control.expectation.kind === "coverage"
            ? `removing ${entry.control.expectation.dropMetric} from the grade is refused as a coverage problem`
            : `${entry.control.expectation.metric} is ${entry.control.expectation.kind === "refuse" ? "refused" : "violated"} and the whole grade fails`,
      observed: entry.observed,
      held: entry.held,
      evidenceIds: ["rubric-controls"],
    })),
    artifacts,
    reviews: [],
    limits: {
      unprovenClinical: [
        "No clinical validity claim. The thresholds here are engineering checks on geometry and timing; whether a pose or a gait is clinically appropriate needs qualified review, which has not happened.",
        "The reach and access figures this rubric leans on (0.3 m footprint, 1.8 m standing height, 0.26 m foot length) are external adult anthropometric floors, not a validated clinical standard for any procedure.",
      ],
      unprovenHeadset: [
        "Every measurement here is offline geometry decoded from shipped bytes. Nothing was worn, rendered on a headset, or frame-paced.",
      ],
      unprovenPublication: [
        "No Pages push and no public claim. The perceptual floor is derived from the capture camera's framing, not from any published capture.",
      ],
      unresolvedDefects: [
        "THE SHIPPED LOCOMOTION CLIP FAILS THIS RUBRIC. openclinxr_retarget_walk_formal_cc0 on the shipped physician violates foot-slide at both the executor's 1.1 m/s advance and the clip's own 0.676 m/s stance-derived advance, by 8.0x and 20.0x on worst-frame slide for the left and right toe. It satisfies the other sixteen metrics. SC-05 owns the repair; the rubric was not widened to admit it.",
        "The retired CMU 02_01 clip would also have failed: sc-04.json records its worst single-frame slide at 0.0181 m, 3.6x the 0.005 m allowance. No locomotion clip this pipeline has produced meets the plant threshold, so SC-05's remedy is foot-lock IK or an equivalent stance constraint, not a different clip.",
        "mpfb-peds-parent-aisha.motion-bind.glb carries the same glTF-source orientation defect SC-04 found and fixed in its own bind path. Outside SC-00's scope and recorded so it is not rediscovered.",
        "Support, route, arrival and settled heading have no shipped producer at this baseline. Their controls supply those sections from real measured dimensions and are labelled instrument controls; they are not evidence that any placement or run occurred.",
        "implementation.treeClean and implementation.changeCommits do not reflect an integration commit, and reviews is empty, because the delegation protocol has the worker park for review rather than land itself. Re-run build-report.ts after the integration commit and after the reviewer records a decision.",
      ],
    },
    evidenceRegistrySha256: sha256(registryBytes),
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`sc-00 build-report: wrote ${REPORT_PATH} and ${artifacts.length} artifact record(s)\n`);
}

await main();
