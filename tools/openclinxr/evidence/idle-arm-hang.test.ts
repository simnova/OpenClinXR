import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#91) — standing figures hold their arms out from the shoulder like a plank.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the seated posture fix must survive. It is
 * `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE THE LIVE SCENE FIRST. THE ARTIFACT IS A PROOF, NOT A SUGGESTION.
 *
 * `.openclinxr/evidence/idle-arm-hang/pre-fix.json` must exist before any product edit and must carry,
 * per station and per actor: the RUNTIME bone names for the arm chain, each bone's local rotation AND
 * quaternion after the render loop has advanced, and shoulder/wrist world positions.
 *
 * **USE THE PROBE THAT ALREADY WORKS.** `tools/openclinxr/evidence/seated-posture-survives-mixer.ts`
 * exports `measureLivePostureGeometry`, which boots the portless dev server, waits for the station
 * shell, waits for `minFrames` so the mixer has run, and reads the page. It uses
 * `buildRoomCaptureUrl(baseUrl, scenarioId, captureMode)` and `waitForStationShell` — I hand-rolled a
 * URL and skipped the ready-wait and my probe hung for 34 minutes with no output. Extend that module
 * rather than writing a new one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT I SAW — four captures, my own pixel grade
 *
 * `psych_suicidal_ideation_safety_v1`, `ward_delirium_med_rec_v1`, `oncology_bad_news_family_v1` and
 * `peds_fever_v1` all render standing figures whose arms extend outward from the shoulder, roughly
 * horizontal, reading as a T-pose plank rather than arms hanging at the sides. #91 was originally
 * filed for a SEATED figure; it is not seated-only.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CAUSE IS NOT KNOWN TO ME. Do not take any hypothesis here as fact.
 *
 * What IS established:
 *   - `main.ts:4537-4565` `applyGeneratedHumanoidClinicalIdlePosture` holds TWO key sets for the same
 *     bones: dotted (`upper_arm.L` `{z:-0.24}`) and undotted (`upper_armL` `{x:-1.42, y:0.08, z:-0.22}`).
 *   - The shipped GLB's nodes are DOTTED — `forearm.L`, `upper_arm.L`, `forearm.R`, `upper_arm.R`.
 *   - It is called on load (`main.ts:7237`) and again EVERY FRAME after `mixer.update`
 *     (`main.ts:8255-8257`), then role-specific rotations are applied over it (`main.ts:4609+`, `:4638+`).
 *   - It writes `object.rotation.x/y/z` only (`:4557-4559`). `seated-pose.ts:188-202` documents that
 *     the mixer writes QUATERNIONS and that a Euler-only write can be discarded — and forces
 *     `quaternion.setFromEuler` for exactly that reason. This path does not.
 *   - `userData.openClinXrClinicalIdlePostureCueIds` is set on the root unconditionally (`:4561-4566`),
 *     so the "arms_lowered_from_generator_bind_pose_cue" string is present whether or not any arm moved.
 *
 * Candidates, UNRANKED, possibly all wrong, possibly an interaction. I have not distinguished them:
 *   - three.js renames dotted bones on load, so the dotted half is dead and only the undotted applies
 *   - three.js does NOT rename them, so the undotted half is dead and only a small z-rotation applies
 *   - the rotation applies but the mixer's quaternion write discards it
 *   - the role-specific map overwrites the clinical idle values a frame later
 *   - the arms are horizontal in the bind mesh and no rotation in this map is large enough
 *
 * **I ASSERTED THE FIRST OF THESE AND A PEER ROUND CORRECTED ME.** `PropertyBinding.sanitizeNodeName`
 * governs animation TRACK PATH parsing; whether the loader also rewrites `Object3D.name` is a
 * different question and I did not verify it for this rig. Settle it from the live dump.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DO NOT CONTRACT A BONE ROTATION VALUE. This is the trap.
 *
 * Asserting `rotation.x === -1.42` is wrong if the names do not match, wrong if the axis is wrong, and
 * wrong if the mixer overwrites it — and it would go green while the arms stay horizontal. Contract
 * (1) is a WORLD-SPACE observable: the wrist sits below the shoulder. That is what "arms hang" means
 * and no naming or axis subtlety can fake it.
 *
 * Deleting the dead half of the key map is cleanup, not the fix. If arms are unchanged afterwards, the
 * slice is not done.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Whether the two key sets collapse into one alias-based lookup (the pattern already used at
 *    `main.ts:4571-4576`) or the dead half is simply removed once the dump says which is dead.
 *  - Whether the posture write becomes a quaternion write, as `seated-pose.ts:188-202` does. If the
 *    dump shows the Euler write surviving the mixer, say so and leave it.
 *  - Whether clinical idle and the role-specific map merge, or keep their current ordering. Today the
 *    role map runs last and overwrites arms with different values.
 *  - What "hangs" means numerically for the counterweight's sake — you are choosing the margin in
 *    contract (1); justify it from the dump rather than from taste.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands wrists below shoulders in world space and is satisfiable by rotating arms into the
 * torso. (2) forbids that — hands must stay clear of the body's mid-line. (3) is green today: #87 and
 * #83 seated a figure with a 0.002 m pelvis-to-seat gap and its feet planted, and a change to the
 * shared posture path must not cost that.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectIdleArmHang()`. What must not change:
 * stations are enumerated from what ships, the numbers come from the LIVE scene after the render loop
 * has advanced, and the measurement uses the existing portless probe rather than a new one.
 *
 * REQUIRED, the observable half: re-capture psych and state what the arms look like. A world-space
 * assertion that passes while the figure still reads as a plank is a failed slice, and the pixel grade
 * is mine.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, SAY SO IN YOUR REPORT. Do not silently run a
 * corrected version.
 *
 * IN-SCOPE VISUAL VERDICT required: "in psych the standing figures' arms ___". Separately name any
 * out-of-scope wrongness — the object and what it looks like, not "deformed". If satisfying these
 * contracts makes the product visibly worse, say so and then satisfy them anyway.
 *
 * SCOPE: whether a standing figure's arms hang. Says NOTHING about hand pose, finger articulation,
 * garments (#73/#76/#82), or whether the posture is clinically appropriate — that needs a clinician.
 */

const load = async () => import("./idle-arm-hang.js") as Promise<Record<string, unknown>>;

type ArmMeasurement = {
  scenarioId: string;
  actorId: string;
  posture: string;
  /** Runtime bone names, as the loaded scene graph reports them. */
  shoulderBoneName: string;
  wristBoneName: string;
  shoulderWorldY: number;
  wristWorldY: number;
  /** Horizontal distance from the body mid-line to the wrist. */
  wristLateralOffsetMeters: number;
  /** Frames advanced before measuring — must be > 0 so the mixer has run. */
  framesAdvanced: number;
};
type Inspect = () => Promise<{ scenarios: string[]; arms: ArmMeasurement[] }>;

/** A hanging arm puts the wrist clearly below the shoulder. A plank puts it level. */
const MIN_SHOULDER_TO_WRIST_DROP_METERS = 0.25;
/** ...but not by folding the arms through the torso. */
const MIN_WRIST_LATERAL_CLEARANCE_METERS = 0.05;

describe("a standing figure's arms hang (#91)", () => {
  it.fails("every standing actor's wrist sits below its shoulder", async () => {
    // World-space, deliberately: a bone-rotation assertion goes green while the arms stay horizontal
    // if the names do not match, the axis is wrong, or the mixer discards the write.
    const mod = await load();
    const inspect = mod["inspectIdleArmHang"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.arms.length, "no arms were measured at all").toBeGreaterThan(0);

    const planks: string[] = [];
    for (const a of report.arms) {
      expect(a.framesAdvanced, `${a.scenarioId}/${a.actorId} measured before the render loop advanced`).toBeGreaterThan(0);
      const drop = a.shoulderWorldY - a.wristWorldY;
      if (drop < MIN_SHOULDER_TO_WRIST_DROP_METERS) {
        planks.push(`${a.scenarioId}/${a.actorId} ${a.wristBoneName}: drop ${drop.toFixed(3)}m below ${a.shoulderBoneName}`);
      }
    }
    expect(planks, `arms held out rather than hanging:\n${planks.join("\n")}`).toHaveLength(0);
  }, 1_800_000);

  it.fails("arms hang beside the body, not folded through it", async () => {
    // Kills the cheap satisfaction of the first contract: rotating the arms inward drops the wrists
    // below the shoulders and puts the hands inside the torso.
    const mod = await load();
    const inspect = mod["inspectIdleArmHang"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const folded = report.arms.filter((a) => a.wristLateralOffsetMeters < MIN_WRIST_LATERAL_CLEARANCE_METERS);
    expect(
      folded.map((a) => `${a.scenarioId}/${a.actorId} wrist ${a.wristLateralOffsetMeters.toFixed(3)}m from the mid-line`),
      "arms folded into the torso",
    ).toHaveLength(0);
  }, 1_800_000);

  it.fails("the seated figure keeps its seated posture (COUNTERWEIGHT — true since #87)", async () => {
    // Clinical idle and the seated map share bones and a frame loop. #87 and #83 put a pelvis on a
    // seat with a 0.002 m gap and feet planted; changing the shared path must not cost that.
    const mod = await load();
    const inspect = mod["inspectIdleArmHang"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const seated = report.arms.filter((a) => a.posture === "seated");
    expect(seated.length, "no seated actor was measured — the counterweight proves nothing").toBeGreaterThan(0);
    for (const a of seated) {
      expect(a.framesAdvanced, `seated ${a.actorId} measured before the loop advanced`).toBeGreaterThan(0);
      expect(
        a.shoulderWorldY - a.wristWorldY,
        `seated ${a.actorId} lost its arm posture`,
      ).toBeGreaterThan(0);
    }
  }, 1_800_000);
});
