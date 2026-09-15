import { AnimationClip, type AnimationMixer, Group, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { registerGeneratedHumanoidAnimation } from "./index.js";

type RegisterArgs = Parameters<typeof registerGeneratedHumanoidAnimation>;
type SlotWithMixer = { mixer?: AnimationMixer; actorId: string };

const RESPONSE_NAME = "openclinxr_role_patient_guard_withdraw_rlq";
const SAFE_RESPONSE = new AnimationClip(RESPONSE_NAME, 1, [
  new QuaternionKeyframeTrack("Spine.quaternion", [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.995]),
]);
const ROOT_TRANSLATING_RESPONSE = new AnimationClip(RESPONSE_NAME, 1, [
  new VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0.1, 0, 0]),
]);
const LEG_TRANSLATING_RESPONSE = new AnimationClip(RESPONSE_NAME, 1, [
  new VectorKeyframeTrack("LeftLeg.position", [0, 1], [0, 0, 0, 0, 0, 0.1]),
]);
const UNCLASSIFIED_TRANSLATING_RESPONSE = new AnimationClip(RESPONSE_NAME, 1, [
  new VectorKeyframeTrack("Spine.position", [0, 1], [0, 0, 0, 0, 0.02, 0]),
]);
const OTHER_TRANSLATING_RESPONSE = new AnimationClip(RESPONSE_NAME, 1, [
  new VectorKeyframeTrack("Neck.position", [0, 1], [0, 0, 0, 0.01, 0, 0]),
]);
const WALK = new AnimationClip("openclinxr_retarget_cmu_02_01_walk", 1, [
  new VectorKeyframeTrack("LeftLeg.position", [0, 1], [0, 0, 0, 0, 0, 0.1]),
]);
const STANDING_IDLE = new AnimationClip("ClinicalIdleConversation", 1, []);

function register(
  posture: "supine" | "seated" | "standing",
  clips: readonly AnimationClip[],
  options: { actorId?: string; responseNames?: string[]; roleNames?: string[]; seatedPlayable?: boolean } = {},
): {
  slot: SlotWithMixer;
  planted: number;
  translationInspections: number;
} {
  const slots: SlotWithMixer[] = [];
  let planted = 0;
  let translationInspections = 0;
  const context = {
    touchResponseClipNames: () => options.responseNames ?? [RESPONSE_NAME],
    seatedClipPlayable: () => options.seatedPlayable ?? false,
    translationBoneNames: (tracks: Array<{ name?: string }>) => {
      translationInspections += 1;
      return tracks
      .map((track) => track.name ?? "")
      .filter((name) => name.endsWith(".position"))
        .map((name) => name.slice(0, -".position".length));
    },
    applyPosture: () => {},
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: 0 }),
    seatedChairHeight: () => 0.45,
    findStretcherInScene: () => null,
    applyAndPlantSupineDeck: () => { planted += 1; },
    stretcherDeckTopWorldY: () => 0.8,
    animationSlots: () => slots,
    pushAnimationSlot: (pushed: SlotWithMixer) => slots.push(pushed),
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    createEmotionState: () => ({}),
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: () => {},
    selectedHumanoidSourceComparator: () => null,
    // Keep the registration-only test out of the browser dialogue branch.
    runtimePatientActorId: () => "another_runtime_patient",
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    triggerDialogue: () => {},
    schedulePedsPlaybackIfReady: () => {},
    recordBootPhase: () => {},
  } as unknown as RegisterArgs[0];
  const humanoid = new Group();
  humanoid.userData["openClinXrActorPosture"] = posture;
  registerGeneratedHumanoidAnimation(context, {
    assetId: "mpfb-gown-adult-patient",
    actorId: options.actorId ?? "supine_actor_under_test",
    actorSlot: new Group(),
    humanoid,
    mouthCue: new Group() as never,
    gazeCue: new Group() as never,
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    animationClips: clips,
    roleAnimationClipNames: options.roleNames ?? [RESPONSE_NAME, STANDING_IDLE.name],
    gazeProbeAnimationClipNames: [],
    playbackEnabled: true,
    fixedSourcePoseSampleSeconds: null,
  });
  const slot = slots[0];
  if (!slot) throw new Error("registration pushed no animation slot");
  return { slot, planted, translationInspections };
}

describe("a supine patient mixes only posture-safe one-shots", () => {
  it.fails("admits a safe response mixer without auto-playing response, walk, or standing idle", () => {
    const first = register("supine", [SAFE_RESPONSE, WALK, STANDING_IDLE], { actorId: "supine_actor_a" });
    const second = register("supine", [SAFE_RESPONSE], { actorId: "supine_actor_b" });
    const { slot, planted } = first;
    expect(second.slot.mixer, "policy must not be pinned to one actor id").toBeDefined();
    expect(slot.mixer, "safe selected upper-body response should admit a mixer").toBeDefined();
    expect(slot.mixer?.existingAction(SAFE_RESPONSE), "one-shot must wait for touch").toBeFalsy();
    expect(slot.mixer?.existingAction(WALK), "locomotion must not auto-play").toBeFalsy();
    expect(slot.mixer?.existingAction(STANDING_IDLE), "standing idle must not auto-play supine").toBeFalsy();
    expect(planted, "supine deck planting remains active").toBe(1);
  });

  it.fails("consults the production translation classifier for selected supine responses", () => {
    expect(register("supine", [SAFE_RESPONSE]).translationInspections).toBeGreaterThan(0);
    expect(register("supine", [ROOT_TRANSLATING_RESPONSE]).translationInspections).toBeGreaterThan(0);
  });

  it("refuses a mixer when the selected response translates the root", () => {
    const { slot, planted } = register("supine", [ROOT_TRANSLATING_RESPONSE]);
    expect(slot.mixer).toBeUndefined();
    expect(planted).toBe(1);
  });

  it("refuses selected response translation on a leg or an unclassified bone", () => {
    expect(register("supine", [LEG_TRANSLATING_RESPONSE]).slot.mixer).toBeUndefined();
    expect(register("supine", [UNCLASSIFIED_TRANSLATING_RESPONSE]).slot.mixer).toBeUndefined();
    expect(register("supine", [OTHER_TRANSLATING_RESPONSE]).slot.mixer).toBeUndefined();
  });

  it("does not admit a mixer when the selected response name has no loaded clip", () => {
    expect(register("supine", [WALK, STANDING_IDLE]).slot.mixer).toBeUndefined();
  });

  it("keeps standing and seated mixer counterweights", () => {
    const { slot } = register("standing", [STANDING_IDLE, WALK]);
    expect(slot.mixer).toBeDefined();
    expect(slot.mixer?.existingAction(STANDING_IDLE)).toBeTruthy();
    expect(slot.mixer?.existingAction(WALK)).toBeFalsy();

    const seatedRole = new AnimationClip("openclinxr_role_patient_seated_idle", 1, []);
    const seated = register("seated", [seatedRole], {
      responseNames: [], roleNames: [seatedRole.name], seatedPlayable: true,
    });
    expect(seated.slot.mixer).toBeDefined();
    expect(seated.slot.mixer?.existingAction(seatedRole)).toBeTruthy();
  });
});
