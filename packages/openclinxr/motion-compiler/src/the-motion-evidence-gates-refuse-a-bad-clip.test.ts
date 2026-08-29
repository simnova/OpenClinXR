import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PLANTED RED - BothyBoard tsk_156b04a905f21c4f (M3).
 *
 * OBSERVABLE: a compiled motion clip cannot reach a learner unless SEVEN deterministic validators
 * have measured it and said yes. Today nothing measures a clip at all: the only motion evidence in
 * the tree is a capture harness that proves a clip PLAYED, never that it is CORRECT.
 *
 * IMMUTABLE DIAGNOSIS HEADER - do not rewrite, do not delete the tables. Flip `it.fails` to `it`
 * and append a `## FIXED (#N)` block BELOW this header.
 *
 * ============================================================================================
 * THE TRAP THIS MODULE EXISTS TO SURVIVE: TWO INSTRUMENTS AGREEING IS NOT CORRECTNESS.
 * ============================================================================================
 * A prior gate in this repo compared a NodeIO scene-graph AABB against a three.js scene-graph
 * AABB. They agreed at 1e-4 relative error. SIX OF SEVEN shipped humanoids were rendering
 * HEAD-DOWN. Both instruments were correct, independently implemented, and blind in the same
 * place: both measure a world mesh AABB, and an inverted figure is exactly as tall as an upright
 * one. Independence of IMPLEMENTATION does not buy independence of BLINDNESS.
 *
 * Seven validators multiply that risk rather than removing it. Therefore each gate MUST carry its
 * own `cannotSee` string into the emitted report - the blindness travels with the verdict, so a
 * later reader cannot mistake seven greens for correctness. The seven, and what each is blind to:
 *
 *  1. effector_target_error - measures |achieved - target| for an effector at a keyed frame.
 *     CANNOT SEE how the chain got there. A hand that reaches the target through an inverted
 *     elbow, a 180-degree twisted forearm, or a left/right mirrored assignment scores ZERO error.
 *     It also cannot see a target that is itself in the wrong place.
 *
 *  2. contact_error - measures |effector point - surface point| at declared contact frames.
 *     CANNOT SEE WHICH SIDE of the surface the effector is on: a hand resting on the mattress and
 *     a hand embedded 0 mm into it are the same number. It cannot see contact that SHOULD exist
 *     but was never declared - an undeclared frame is not measured, so omission reads as clean.
 *
 *  3. joint_limit - bounds each joint's rotation magnitude against a per-joint range.
 *     CANNOT SEE COMBINATIONS or ORDER. Shoulder, elbow and wrist each inside range while the arm
 *     passes through the torso is seven greens. It cannot see a joint that is absent from the
 *     limit table (unlisted is unchecked), nor a limit table that is itself wrong.
 *
 *  4. support_drift - measures support/root translation across the clip.
 *     CANNOT SEE DIRECTION or DISTRIBUTION: sliding forward and sliding backward measure
 *     identically, and one large jump is indistinguishable from the same total accumulated in
 *     per-frame increments that are each below notice. It cannot see FEET that skate while the
 *     root is pinned - the root is the thing measured, so a pinned root reports zero drift.
 *
 *  5. collision - tests sampled proxy volumes for interpenetration.
 *     CANNOT SEE anything outside the proxy set - garment, hair, equipment, a second actor - and
 *     cannot see BETWEEN samples: passing at sampled frames says nothing about the frames in
 *     between, and a capsule proxy cannot resolve a self-intersection finer than the capsule.
 *
 *  6. clip_integrity - checks STRUCTURE: frame count, fps, monotonic times, track/joint names,
 *     no NaN. CANNOT SEE CONTENT. A structurally perfect T-pose held for 200 frames passes every
 *     integrity check, as does a clip whose joint NAMES match the target while its VALUES drive a
 *     different skeleton.
 *
 *  7. runtime_smoke - proves the clip loads and plays in the runtime without throwing.
 *     CANNOT SEE WHETHER WHAT PLAYS IS RIGHT. This is the head-down trap itself: it cannot tell an
 *     upright figure from an inverted one, a frustum-culled actor from a rendered one, or a mixer
 *     silently playing a fallback clip from the intended one.
 *
 *  SHARED BLINDNESS, stated because it is the failure that defeats all seven at once: every gate
 *  above measures a MAGNITUDE or a STRUCTURE in the SAME world frame. A globally wrong frame -
 *  mirrored, rotated 90 degrees, wrong up-axis - moves all seven consistently and fires none of
 *  them. That is exactly the class that shipped six head-down humanoids. Seven green gates are
 *  therefore evidence about SEVEN NAMED DEFECT CLASSES and about nothing else.
 *
 * ============================================================================================
 * PRECEDENCE: DETERMINISTIC VALIDATORS ARE AUTHORITATIVE OVER ANY VLM / VISUAL FINDING.
 * ============================================================================================
 * A visual or VLM grade may ADD a finding. It may never satisfy a gate that did not run, and it
 * may never flip a deterministic refusal to an acceptance. Rationale: a visual grader is the one
 * instrument in this loop with no reproducible measurement behind it, and it is the instrument
 * most likely to agree with a plausible-looking wrong result. Clause (3) enforces this on the
 * tree TODAY and keeps enforcing it on the module once it exists.
 *
 * NO THRESHOLD IS INVENTED HERE. Every tolerance is an INPUT (`MotionGateSpec`), supplied by the
 * caller, never a constant chosen by this test. A number written into a contract becomes the
 * design target of the thing being measured; this contract states none. The fixtures clear or
 * breach the caller's own spec by large margins, recorded below, so no verdict is threshold-fitted:
 *
 *   | fixture | measure                | value   | spec tolerance | margin |
 *   |---------|------------------------|---------|----------------|--------|
 *   | GOOD    | effector target error  | 0.004 m | 0.02 m         | 5x in  |
 *   | GOOD    | elbow flexion          | 1.20 r  | 2.60 r         | 2.2x in|
 *   | BAD     | effector target error  | 0.420 m | 0.02 m         | 21x out|
 *   | BAD     | elbow flexion          | 3.40 r  | 2.60 r         | 1.3x out|
 *
 * The BAD clip is the GOOD clip with exactly two injected defects and nothing else changed, so a
 * refusal cannot be attributed to an unrelated difference between two hand-written fixtures.
 *
 * FORBIDDEN (the cheap greens this contract exists to refuse):
 *   - A gate set that refuses everything. Clause (2) is why both directions are planted.
 *   - Dropping or short-circuiting a gate so fewer than seven run. Clause (2) counts them.
 *   - Emitting a verdict without `measured` and without `cannotSee` - the blindness must survive
 *     into the artifact or the head-down lesson is lost the first time someone reads a green.
 *   - A FOURTH capture harness. `clinical-touch-smoke.ts` (loads the runtime, drives interaction,
 *     validates its own report) and `bvh-retarget-lab-smoke.ts` (loads clips, measures motion
 *     range, explode ratio, back pitch) already exist and are the runtime_smoke path. Reuse them.
 *   - Weakening or deleting a clause - merge-kill fires on deleted-test.
 *
 * claimScope: whether seven named deterministic validators refuse a clip with a known injected
 *   defect, accept a clip without one, and rank above any visual finding.
 * notEvidenceFor: motion QUALITY; clinical plausibility of any pose; that the seven gates are the
 *   RIGHT seven; that a clip passing all seven looks correct to a human; coverage of the shared
 *   world-frame blindness named above; any real shipped clip.
 */

const MODULE_UNDER_TEST = "./motion-evidence-gates.js";
const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up to the workspace root so clause (3) reads the tree from any vitest cwd. */
function repoRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found above " + HERE);
}

const TOUCH_SMOKE = "tools/openclinxr/evidence/clinical-touch-smoke.ts";
const RETARGET_SMOKE = "tools/openclinxr/evidence/bvh-retarget-lab-smoke.ts";
const PKG_DIR = "packages/openclinxr/motion-compiler";

/** Identifiers by which a visual/VLM verdict would enter a deterministic path. Absent today. */
const VISUAL_OVERRIDE_IDENTIFIERS = [
  "vlmVerdict", "visualVerdict", "visionVerdict", "graderSaysOk",
  "overrideGate", "acceptOnVisual", "skipGateIfVisual",
];
/** A fourth capture harness would arrive as one of these inside the package. */
const BROWSER_LAUNCH_IDENTIFIERS = ["playwright", "puppeteer", "chromium.launch", "webkit.launch"];

/** The seven gates. Enumerated here so a dropped gate cannot pass unnoticed. */
const EXPECTED_GATE_IDS = [
  "effector_target_error", "contact_error", "joint_limit",
  "support_drift", "collision", "clip_integrity", "runtime_smoke",
] as const;

type Vec3 = readonly [number, number, number];

/**
 * Minimal clip shape the gates consume. Field formulas, so no field is defined in prose:
 *   effectorTargetErrorM = |achievedWorld - targetWorld|            (metres, per keyed frame)
 *   contactErrorM        = |effectorPointWorld - surfacePointWorld| (metres, per declared contact)
 *   jointFlexionRad      = max over frames of |rotationRad[joint]|  (radians, per joint)
 *   supportDriftM        = |rootTranslation[last] - rootTranslation[0]| projected on the XZ plane
 *   minSeparationM       = min over sampled frames of proxy-pair separation (negative = overlap)
 */
type MotionClipFixture = {
  id: string;
  fps: number;
  frameCount: number;
  rootTranslationPerFrame: readonly Vec3[];
  jointFlexionRad: Readonly<Record<string, number>>;
  effectorKeys: readonly { frame: number; effector: string; targetWorld: Vec3; achievedWorld: Vec3 }[];
  contacts: readonly { frame: number; effector: string; surfaceId: string; effectorPointWorld: Vec3; surfacePointWorld: Vec3 }[];
  proxyMinSeparationM: number;
  trackFrameCounts: readonly number[];
  hasNaN: boolean;
  runtimeLoadedClipName: string | null;
};

/** Caller-supplied tolerances. The gates read these; this test never asserts a product threshold. */
const SPEC = {
  effectorTargetErrorToleranceM: 0.02,
  contactErrorToleranceM: 0.01,
  jointLimitsRad: { elbow_flexion_l: 2.6, knee_flexion_l: 2.4, shoulder_abduction_l: 3.0 },
  supportDriftToleranceM: 0.05,
  minProxySeparationM: 0.0,
  expectedRuntimeClipName: "openclinxr_motion_compiled_v1",
} as const;

/** GOOD: every measure inside the caller's own spec by the margins tabled in the header. */
const GOOD_CLIP: MotionClipFixture = {
  id: "fixture_good_v1",
  fps: 24,
  frameCount: 24,
  rootTranslationPerFrame: [[0, 0.94, 0], [0.004, 0.94, 0.001]],
  jointFlexionRad: { elbow_flexion_l: 1.2, knee_flexion_l: 0.9, shoulder_abduction_l: 0.7 },
  effectorKeys: [{ frame: 12, effector: "hand_l", targetWorld: [0.31, 1.02, 0.18], achievedWorld: [0.314, 1.02, 0.18] }],
  contacts: [{ frame: 12, effector: "hand_l", surfaceId: "exam_table_top", effectorPointWorld: [0.31, 0.86, 0.18], surfacePointWorld: [0.31, 0.86, 0.18] }],
  proxyMinSeparationM: 0.03,
  trackFrameCounts: [24, 24, 24],
  hasNaN: false,
  runtimeLoadedClipName: SPEC.expectedRuntimeClipName,
};

/** BAD: GOOD with exactly two injected defects. Nothing else differs. */
const BAD_CLIP: MotionClipFixture = {
  ...GOOD_CLIP,
  id: "fixture_bad_v1",
  // defect 1 - elbow exceeds the caller's limit 2.6 rad
  jointFlexionRad: { ...GOOD_CLIP.jointFlexionRad, elbow_flexion_l: 3.4 },
  // defect 2 - effector misses its target by 0.42 m against a 0.02 m tolerance
  effectorKeys: [{ frame: 12, effector: "hand_l", targetWorld: [0.31, 1.02, 0.18], achievedWorld: [0.73, 1.02, 0.18] }],
};

type GateResult = { id: string; verdict: "pass" | "fail"; measured: number; threshold: number; unit: string; cannotSee: string };
type MotionEvidenceReport = {
  schemaVersion: string;
  verdict: "accept" | "refuse";
  gates: GateResult[];
  visualFindingsAdvisoryOnly: boolean;
};
type GatesModule = {
  runMotionEvidenceGates: (clip: MotionClipFixture, spec: typeof SPEC) => Promise<MotionEvidenceReport> | MotionEvidenceReport;
  MOTION_GATE_IDS: readonly string[];
  combineMotionVerdict?: (deterministic: MotionEvidenceReport, visual: { verdict: "accept" | "refuse" }) => MotionEvidenceReport;
};

/** Dynamic so an absent module throws INSIDE the clause - the planted RED's own reason - and not
 *  at collection time, where it would red the whole file for a resolution error instead. */
async function loadGates(): Promise<GatesModule> {
  return (await import(MODULE_UNDER_TEST)) as GatesModule;
}

function assertGateShape(g: GateResult, where: string): void {
  expect(typeof g.measured, `${where}: gate ${g.id} must report a measured NUMBER, not a bare verdict`).toBe("number");
  expect(Number.isFinite(g.measured), `${where}: gate ${g.id} measured must be finite`).toBe(true);
  expect(typeof g.threshold, `${where}: gate ${g.id} must report the threshold it was judged against`).toBe("number");
  expect((g.cannotSee ?? "").length, `${where}: gate ${g.id} must carry its own blindness statement into the report - seven greens are not correctness`).toBeGreaterThan(40);
}

describe("the motion evidence gates refuse a bad clip", () => {
  it.fails("(1) REFUSES a clip whose elbow exceeds its limit and whose effector misses its target", async () => {
    const { runMotionEvidenceGates } = await loadGates();
    const report = await runMotionEvidenceGates(BAD_CLIP, SPEC);

    expect(report.verdict, "a clip with two injected defects must be REFUSED").toBe("refuse");

    const failed = report.gates.filter((g) => g.verdict === "fail").map((g) => g.id).sort();
    // Refusing for the wrong reason is not a passing gate.
    expect(failed, "the two injected defects must be the gates that fired").toContain("joint_limit");
    expect(failed, "the two injected defects must be the gates that fired").toContain("effector_target_error");
    // The five undefected gates must NOT fire - a gate set that reds everything passes clause (1)
    // trivially and is exactly what clause (2) exists to catch.
    expect(failed.length, `only the two injected defects should fail; got ${failed.join(", ")}`).toBe(2);

    for (const g of report.gates) assertGateShape(g, "BAD");
    expect(report.visualFindingsAdvisoryOnly, "a refusal must be recorded as non-overridable by any visual finding").toBe(true);
  });

  it.fails("(2) ACCEPTS a known-good clip, with all seven gates run and none skipped", async () => {
    const { runMotionEvidenceGates, MOTION_GATE_IDS } = await loadGates();
    const report = await runMotionEvidenceGates(GOOD_CLIP, SPEC);

    expect(report.verdict, "a clip inside every caller tolerance must be ACCEPTED - a validator that refuses everything is not a validator").toBe("accept");

    const ids = report.gates.map((g) => g.id).sort();
    expect(ids, "all seven gates must appear in the report").toEqual([...EXPECTED_GATE_IDS].sort());
    expect(report.gates.length, "exactly seven gates - a skipped gate accepts by omission").toBe(7);
    expect([...MOTION_GATE_IDS].sort(), "the module's own gate list must match the seven contracted ids").toEqual([...EXPECTED_GATE_IDS].sort());
    expect(report.gates.every((g) => g.verdict === "pass"), "no gate may fail on the known-good clip").toBe(true);

    for (const g of report.gates) assertGateShape(g, "GOOD");
  });

  it("(3) COUNTERWEIGHT: a visual/VLM finding cannot satisfy or override a deterministic gate", () => {
    const root = repoRoot();

    // Live half - passes on arrival, fails independently if a harness is stubbed, deleted, or if a
    // visual-override path is introduced. Failure mode on the far side of each floor is named.
    for (const [rel, minLines] of [[TOUCH_SMOKE, 100], [RETARGET_SMOKE, 100]] as const) {
      const abs = join(root, rel);
      expect(existsSync(abs), `${rel} must exist - runtime_smoke reuses it; do NOT invent a fourth capture harness`).toBe(true);
      const src = readFileSync(abs, "utf8");
      // Floor is far below the measured sizes (558 and 221 lines on 2026-08-29). What is on the
      // far side of it is a HOLLOWED harness kept only to satisfy an existsSync.
      expect(src.split("\n").length, `${rel} must not be hollowed out to a stub`).toBeGreaterThan(minLines);
      expect(src.includes("SCHEMA_VERSION"), `${rel} must keep a versioned, machine-checkable report`).toBe(true);
      expect(src.includes("--validate"), `${rel} must keep its deterministic replay/validate path`).toBe(true);
      for (const ident of VISUAL_OVERRIDE_IDENTIFIERS) {
        expect(src.includes(ident), `${rel} must not gain a visual-override path (${ident}) - deterministic validators are authoritative`).toBe(false);
      }
    }

    // Package half - vacuous while the package is empty, and it BITES the moment sources land:
    // no visual-override identifier, and no fourth capture harness, anywhere under the package.
    const pkg = join(root, PKG_DIR);
    const forbidden = [...VISUAL_OVERRIDE_IDENTIFIERS, ...BROWSER_LAUNCH_IDENTIFIERS];
    const walk = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap((name) => {
        if (name === "node_modules" || name === "dist" || name === "__tests__") return [];
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        // PRODUCT SOURCE ONLY. Test files legitimately NAME the banned identifiers (this one does,
        // in VISUAL_OVERRIDE_IDENTIFIERS above); scanning them would make the clause self-red.
        if (/\.(test|spec)\.[cm]?tsx?$/.test(name)) return [];
        return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [p] : [];
      });
    };
    for (const file of walk(pkg)) {
      const src = readFileSync(file, "utf8");
      for (const ident of forbidden) {
        expect(src.includes(ident), `${file.slice(root.length + 1)} must not contain ${ident} - visual findings are advisory, and runtime_smoke reuses the existing harnesses`).toBe(false);
      }
    }

    // Module half - runs only once the module exists, and REQUIRES the precedence to be expressed
    // as code rather than as a comment: a deterministic REFUSE combined with a visual ACCEPT is
    // still a refuse, and the visual finding may not flip a single gate verdict.
    const built = join(root, PKG_DIR, "src", "motion-evidence-gates.ts");
    if (existsSync(built)) {
      const src = readFileSync(built, "utf8");
      expect(src.includes("combineMotionVerdict"), "once the module exists it must expose combineMotionVerdict so precedence is enforced in code, not in prose").toBe(true);
      expect(src.includes("visualFindingsAdvisoryOnly"), "the report must record that visual findings are advisory only").toBe(true);
    }
  });
});

// NOT TESTED: that these are the RIGHT seven validators; the shared world-frame blindness named in
// the header (mirrored / rotated / wrong-up-axis clips defeat all seven at once and nothing here
// catches that); any real compiled clip - both fixtures are hand-written; the runtime_smoke gate
// actually driving clinical-touch-smoke.ts or bvh-retarget-lab-smoke.ts end to end; whether a clip
// passing all seven looks correct to a human; the numeric tolerances in SPEC, which are inputs
// chosen to make the fixtures' margins legible and are not proposed as product thresholds.
