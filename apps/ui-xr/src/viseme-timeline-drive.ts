/**
 * PLACEHOLDER for #45. Deliberately implements nothing.
 *
 * Exists so the planted contracts in `viseme-timeline-drive.test.ts` can reference this module
 * without breaking `typecheck` — a dynamic `import()` is still resolved at compile time, so an
 * absent module is a hard error rather than a runtime one.
 *
 * WHAT GOES HERE (#45): drive the viseme morph targets the humanoids already carry, from a phoneme
 * timeline, and prove the mouth actually changes shape.
 *
 * WHAT IS ALREADY TRUE, so this is smaller than the issue originally implied:
 *   - the GLBs carry the shapes. `peds_patient_child.glb` has 26 shape keys including
 *     `viseme_silence, viseme_AA, viseme_E, viseme_IH, viseme_OH, viseme_OU, viseme_FV, viseme_L`.
 *   - the registry declares the mapping: `asset-registry/src/index.ts:618` → `lipSync: ["viseme_phoneme_map"]`
 *   - `main.ts` already models a timeline: `visemeSequence` (:1528), `morphTargetAppliedTargetCount`
 *     (:1571), `morphTargetPlaybackMode` (:1572), `visemeTimelineComparatorEvidencePresent` (:1574)
 *
 * WHAT IS MISSING is evidence that any of it moves a face. `voice-gateway` has only Mock and Local
 * adapters, so no real speech has ever driven these shapes — but NO TTS IS NEEDED to prove the rig
 * works. A hardcoded phoneme timeline is sufficient, and the peer round was explicit that a
 * source-selection bake-off is only required once production lip-sync QUALITY is being claimed.
 *
 * SCOPE: prove the mouth changes shape over a timeline. NOT: which phoneme source to adopt, audio
 * sync accuracy, or anything a clinician would need to judge as realistic.
 */

export const VISEME_TIMELINE_DRIVE_PLACEHOLDER = true;
