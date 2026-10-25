import { AnimationClip, Group, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { registerGeneratedHumanoidAnimation } from "./index.js";

/**
 * While a walk action drives the legs, no other action may contribute to
 * locomotion-owned leg bones (walk-clip slice Stage B).
 *
 * Cause (Stage A): the idle take co-ran at weight 1 beside the walk at
 * weight 1 and three.js normalised the pair to a half-amplitude walk (live
 * leg amplitudes 0.29-0.50x, toe lift 0.035 m vs 0.159 m in the clip).
 *
 * Construction: autoplayed non-locomotion clips lose their leg-bone tracks
 * at registration (in place, after the seated-admission reads). The idle
 * take's own leg tracks are bind-static (<=0.04 deg off bind), so standing
 * legs keep the bind pose; the walk clip is exempt by name and keeps every
 * track for the locomotion consumers that read it (`responseClips`,
 * calibration, stance labels).
 */

type RegisterArgs = Parameters<typeof registerGeneratedHumanoidAnimation>;

function legTrack(bone: string): QuaternionKeyframeTrack {
  return new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
}

function idleClipWithLegs(): AnimationClip {
  const clip = new AnimationClip("ClinicalIdleConversation", 3.75, [
    legTrack("upperleg01.L"),
    legTrack("foot.R"),
    new VectorKeyframeTrack("upperarm01.L.position", [0, 1], [0, 0, 0, 0, 0.01, 0]),
    // Shoulder01 is never posture-written: its idle tracks stay (rest pose
    // source), unlike upperarm01/lowerarm01/wrist (posture-owned at rest).
    new VectorKeyframeTrack("shoulder01.L.position", [0, 1], [0, 0, 0, 0, 0.01, 0]),
  ]);
  return clip;
}

function walkClipWithLegs(): AnimationClip {
  return new AnimationClip("openclinxr_retarget_walk_source", 1.708, [
    legTrack("upperleg01.L"),
    legTrack("foot.L"),
  ]);
}

function registerStandingActor(clips: readonly AnimationClip[]): {
  slot: { mixer?: import("three").AnimationMixer; responseClips?: AnimationClip[] };
  humanoid: Group;
} {
  const slots: Array<{ mixer?: import("three").AnimationMixer; responseClips?: AnimationClip[] }> = [];
  const context = {
    touchResponseClipNames: () => [],
    seatedClipPlayable: () => false,
    translationBoneNames: () => [],
    applyPosture: () => {},
    plantSeatedPelvis: () => ({ deltaY: 0, pelvisBefore: 0 }),
    seatedChairHeight: () => 0.45,
    findStretcherInScene: () => null,
    applyAndPlantSupineDeck: () => {},
    stretcherDeckTopWorldY: () => 0.8,
    animationSlots: () => slots,
    pushAnimationSlot: (pushed: never) => slots.push(pushed),
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    createEmotionState: () => ({}),
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: () => {},
    selectedHumanoidSourceComparator: () => null,
    runtimePatientActorId: () => "patient_robert_hayes_v1",
    dialogueText: () => ({ line: "", initial: "" }),
    visemeUtterance: () => "",
    triggerDialogue: () => {},
    schedulePedsPlaybackIfReady: () => {},
    recordBootPhase: () => {},
  } as unknown as RegisterArgs[0];
  const humanoid = new Group();
  humanoid.userData["openClinXrActorPosture"] = "standing";
  registerGeneratedHumanoidAnimation(context, {
    assetId: "mpfb-clinical-physician-adult",
    actorId: "senior_resident_ward_v1",
    actorSlot: new Group(),
    humanoid,
    mouthCue: new Group() as never,
    gazeCue: new Group() as never,
    eyeFocusCue: new Group(),
    expressionCue: new Group(),
    animationClips: clips,
    roleAnimationClipNames: ["openclinxr_clinical_idle_breathing", "openclinxr_conversation_listen_nod"],
    gazeProbeAnimationClipNames: [],
    playbackEnabled: true,
    fixedSourcePoseSampleSeconds: null,
  });
  const slot = slots[0];
  if (!slot) throw new Error("registerGeneratedHumanoidAnimation pushed no animation slot");
  return { slot, humanoid };
}

describe("autoplayed idle clips keep no locomotion leg tracks", () => {
  it("(1) the played idle action has no leg-bone tracks and no posture-owned arm tracks, but keeps the rest", () => {
    const idle = idleClipWithLegs();
    const walk = walkClipWithLegs();
    const { slot } = registerStandingActor([idle, walk]);
    const action = slot.mixer?.existingAction(idle);
    expect(action, "idle must still auto-play").toBeTruthy();
    const names = (action?.getClip()?.tracks ?? []).map((track) => track.name);
    expect(names.some((name) => name.startsWith("upperleg01.L"))).toBe(false);
    expect(names.some((name) => name.startsWith("foot.R"))).toBe(false);
    // Arms slice: upperarm01/lowerarm01/wrist idle tracks are redundant with
    // the posture pass at rest and halved the walking swing, so they strip.
    expect(names.some((name) => name.startsWith("upperarm01.L"))).toBe(false);
    // shoulder01 is never posture-written, so its idle track stays.
    expect(names.some((name) => name.startsWith("shoulder01.L"))).toBe(true);
  });

  it("(2) the walk clip keeps every track for the locomotion consumers", () => {
    const idle = idleClipWithLegs();
    const walk = walkClipWithLegs();
    const { slot } = registerStandingActor([idle, walk]);
    expect(slot.mixer?.existingAction(walk), "walk must not auto-play").toBeFalsy();
    const response = slot.responseClips?.find((clip) => clip.name === walk.name);
    const names = (response?.tracks ?? []).map((track) => track.name);
    expect(names.some((name) => name.startsWith("upperleg01.L"))).toBe(true);
    expect(names.some((name) => name.startsWith("foot.L"))).toBe(true);
  });

  it("(3) the strip is stamped on the humanoid for captures to read", () => {
    const idle = idleClipWithLegs();
    const { humanoid } = registerStandingActor([idle, walkClipWithLegs()]);
    const stamp = (humanoid.userData as Record<string, unknown>)["openClinXrAutoplayLegTrackStrip"] as
      | Array<{ clip: string; removed: number; kept: number }>
      | undefined;
    expect(stamp?.find((row) => row.clip === "ClinicalIdleConversation")).toEqual({
      clip: "ClinicalIdleConversation",
      removed: 2,
      kept: 2,
    });
  });

  it("(4) re-registration is idempotent (shared clip objects strip once)", () => {
    const idle = idleClipWithLegs();
    const walk = walkClipWithLegs();
    registerStandingActor([idle, walk]);
    const { slot } = registerStandingActor([idle, walk]);
    const names = (slot.mixer?.existingAction(idle)?.getClip()?.tracks ?? []).map((track) => track.name);
    expect(names).toEqual(["shoulder01.L.position"]);
  });
});
