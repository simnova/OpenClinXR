import { AnimationClip, type AnimationMixer, Group } from "three";
import { describe, expect, it } from "vitest";
import { registerGeneratedHumanoidAnimation } from "./index.js";

/**
 * Publishing a walk clip into a shipped actor must not make that actor walk.
 *
 * `registerGeneratedHumanoidAnimation` falls back to playing EVERY glTF clip when no role clip
 * name matches, and none matches this actor: the defaults are `openclinxr_clinical_idle_breathing`
 * and `openclinxr_conversation_listen_nod`, while `mpfb-clinical-physician-adult.glb` carries
 * `ClinicalIdleConversation`, `ClinicalExpressionMicroTransition` and, since 2026-09-09, a
 * retargeted three-metre walk. Under that fallback a physician standing at the bedside would loop
 * the walk on top of the idle — an asset addition changing the behaviour of an actor nobody
 * touched.
 */

type RegisterArgs = Parameters<typeof registerGeneratedHumanoidAnimation>;
type SlotWithMixer = { mixer?: AnimationMixer; actorId: string };

const IDLE = new AnimationClip("ClinicalIdleConversation", 1, []);
const MICRO = new AnimationClip("ClinicalExpressionMicroTransition", 1, []);
const WALK = new AnimationClip("openclinxr_retarget_cmu_02_01_walk", 2.87, []);

function registerStandingActor(clips: readonly AnimationClip[]): SlotWithMixer {
  const slots: SlotWithMixer[] = [];
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
    pushAnimationSlot: (pushed: SlotWithMixer) => slots.push(pushed),
    setAnimationSlotByActor: () => {},
    setActorSlotByActor: () => {},
    createEmotionState: () => ({}),
    clinicalTouchScenario: () => undefined,
    registerTouchRegions: () => {},
    selectedHumanoidSourceComparator: () => null,
    // A physician is not the patient, so the dialogue branch (which needs requestAnimationFrame)
    // is never entered. Returning a different id is what keeps this a node-only test.
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
    // The live defaults, which match nothing in this GLB. That mismatch is the fallback's trigger.
    roleAnimationClipNames: ["openclinxr_clinical_idle_breathing", "openclinxr_conversation_listen_nod"],
    gazeProbeAnimationClipNames: [],
    playbackEnabled: true,
    fixedSourcePoseSampleSeconds: null,
  });
  const slot = slots[0];
  if (!slot) throw new Error("registerGeneratedHumanoidAnimation pushed no animation slot");
  return slot;
}

describe("a retargeted locomotion clip does not auto-play on a standing actor", () => {
  it("(1) the walk gets NO action, while the actor's own clips do", () => {
    const slot = registerStandingActor([IDLE, MICRO, WALK]);
    const mixer = slot.mixer;
    expect(mixer, "a standing actor with clips must still get a mixer").toBeDefined();
    expect(mixer?.existingAction(WALK), "the retargeted walk must not be auto-played").toBeFalsy();
    // The counterweight: if the filter rejected everything, clause (1) would pass while the actor
    // stood frozen. Both of its own clips must still be playing.
    expect(mixer?.existingAction(IDLE)).toBeTruthy();
    expect(mixer?.existingAction(MICRO)).toBeTruthy();
  });

  it("(2) an actor whose ONLY clip is a locomotion take gets no auto-played action either", () => {
    const slot = registerStandingActor([WALK]);
    expect(slot.mixer?.existingAction(WALK)).toBeFalsy();
  });

  it("(3) the exclusion is by PREFIX, not by this one clip's full name", () => {
    // A second bound clip must be excluded too, or the guard is a hardcode that the next bind
    // walks straight past.
    const other = new AnimationClip("openclinxr_retarget_cmu_07_01_walk", 3, []);
    const slot = registerStandingActor([IDLE, other]);
    expect(slot.mixer?.existingAction(other)).toBeFalsy();
    expect(slot.mixer?.existingAction(IDLE)).toBeTruthy();
  });
});
