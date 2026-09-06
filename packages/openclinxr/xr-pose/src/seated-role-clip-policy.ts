/**
 * Seated role-clip playability (#574 extension of the #83 carve-out).
 *
 * #83's invariant at register time: seated/supine actors get no AnimationMixer,
 * because falling back to ALL glTF clips played standing armature tracks that
 * overwrote the procedural sit every frame. That guard stays. This module is the
 * narrow seam a SEATED-RIG clip passes through so a seated actor can perform it:
 *
 *   - A seated-rig clip must be NAMED for sitting (`/seat/i`) — a standing clip must
 *     never re-enter through this seam.
 *   - Its TRANSLATION tracks must not animate. Seated height ownership is
 *     verticalOffsetMeters + chair seatHeightMeters + plantSeatedPelvisOnSeat
 *     (actor-posture.ts SEATED_HEIGHT_OWNERSHIP); an animated pelvis/root translation
 *     would fight the once-only register-time plant every frame.
 *
 * Rotation tracks — including leg rotations — are allowed: the clip was retargeted
 * FROM a seated source take, so its leg motion is seated motion, and the per-frame
 * applyMpfb2SeatedFold / applyPosturePose re-asserts the authored sit after
 * mixer.update exactly as it already does against clinical idle.
 *
 * Measured 2026-08-22 on mpfb-peds-parent-aisha.motion-bind.glb,
 * openclinxr_retarget_seated_talking_cc0: 411 channels; ALL translation channels are
 * CONSTANT (2 identical keys — bind pose restated, nothing animated); rotation runs
 * upper body + face + legs (90-key knee/foot tracks). So this predicate passes on
 * real track data without weakening the height-ownership invariant.
 *
 * claimScope: playability policy for named clips under the seated carve-out.
 * notEvidenceFor: visual quality of the retargeted motion, lip-sync timing, or any
 * claim that the actor looks right while performing it.
 */

export type SeatedRoleClipTrackSummary = {
  /**
   * ANIMATED translation channel target names on the clip (file or runtime spelling),
   * or null/undefined when unmeasured. Constant channels restate the bind pose and are
   * inert — they do not belong in this list.
   */
  translationBoneNames?: readonly string[] | null | undefined;
};

/** Structural shape of a three.js KeyframeTrack — no three.js import needed here. */
export type SeatedClipTrackLike = {
  name: string;
  times: ArrayLike<number>;
  values: ArrayLike<number>;
};

/**
 * True when `clipName` names a seated-rig performance AND its measured translation
 * channels do not animate root/pelvis/leg bones, so playing it under the #83 seated
 * carve-out cannot fight seated height ownership. Unmeasured track data (`undefined`)
 * is treated as UNPROVEN and refused when the name alone does not already clear the
 * bar — the mixer path needs this predicate TRUE, never merely un-false.
 */
export function seatedRoleClipIsPlayable(
  clipName: string,
  tracks?: SeatedRoleClipTrackSummary | null | undefined,
): boolean {
  if (!SEATED_ROLE_CLIP_NAME_PATTERN.test(clipName ?? "")) {
    return false;
  }
  const translationBoneNames = tracks?.translationBoneNames;
  if (translationBoneNames == null) {
    // Name-only admission: the retarget pipeline strips animated root/pelvis
    // translation from Mesh2Motion sources (SEATED_HEIGHT_OWNERSHIP), so a
    // `*_seated_*` retargeted clip is admitted on pipeline contract when no
    // measurement is handed in.
    return true;
  }
  return !translationBoneNames.some((boneName) => {
    const lower = (boneName ?? "").toLowerCase();
    const stripped = stripDottedRuntimeName(lower);
    return SEATED_HEIGHT_OWNED_BONE_PREFIXES.some(
      (prefix) => lower.startsWith(prefix) || stripped.startsWith(prefix),
    );
  });
}

/**
 * Bone-name prefixes whose TRANSLATION owns seated height (plant + vertical offset),
 * never a mixer track. Legs are included: hip/knee chain translation is body height.
 */
const SEATED_HEIGHT_OWNED_BONE_PREFIXES = [
  "root",
  "pelvis",
  "hips",
  "upperleg",
  "upper_leg",
  "lowerleg",
  "lower_leg",
  "thigh",
  "shin",
  "calf",
] as const;

/**
 * Runtime scene-graph spelling strips dots from glTF node names
 * (three.js PropertyBinding.sanitizeNodeName — "." is a path separator there).
 * Match BOTH spellings so a gate built on either layer agrees.
 */
function stripDottedRuntimeName(lowerName: string): string {
  return lowerName.includes(".") ? lowerName.replaceAll(".", "") : lowerName;
}

/**
 * A seated-rig clip declares itself in its name. The retarget pipeline prefixes
 * retargeted library motion with `openclinxr_retarget_`; the seated talking take
 * carries `_seated_` in the middle. Procedural posture clips are applied directly
 * as poses (applyPosturePose), not played through the mixer carve-out.
 */
export const SEATED_ROLE_CLIP_NAME_PATTERN = /seat/i;

/** True when every value in the track is (numerically) identical to the first key. */
function trackIsConstant(times: ArrayLike<number>, values: ArrayLike<number>): boolean {
  const keyCount = Math.min(
    times.length,
    Math.floor(values.length / VALUES_PER_TRANSLATION_KEY),
  );
  if (keyCount <= 1) return true;
  const stride = values.length / keyCount;
  for (let key = 1; key < keyCount; key += 1) {
    for (let c = 0; c < stride; c += 1) {
      if (values[key * stride + c] !== values[c]) return false;
    }
  }
  return true;
}

const VALUES_PER_TRANSLATION_KEY = 3;

/**
 * Extract ANIMATED translation-bone names from a three.js AnimationClip's tracks.
 * Translation tracks whose keys are all identical restate the bind pose and never
 * move anything — they are inert and excluded, so a retargeted clip that merely
 * restates bind translations passes seated height ownership (measured on
 * openclinxr_retarget_seated_talking_cc0: all 411 translation channels constant).
 */
export function animatedTranslationBoneNames(tracks: readonly SeatedClipTrackLike[]): string[] {
  const animated: string[] = [];
  for (const track of tracks) {
    if (!track.name.endsWith(".position")) continue;
    const boneName = track.name.slice(0, -".position".length);
    if (!trackIsConstant(track.times, track.values)) {
      if (!animated.includes(boneName)) animated.push(boneName);
    }
  }
  return animated;
}
