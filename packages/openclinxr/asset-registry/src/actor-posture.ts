/**
 * Actor posture placement + clip binding (#81).
 *
 * Posture is declared placement data that reaches the runtime. Clip binding follows
 * posture. Seated height ownership:
 *   - verticalOffsetMeters + chair seatHeightMeters place the actor root in the room
 *   - clip root/pelvis TRANSLATION is not applied (stripped on any Mesh2Motion retarget)
 *     so seated height does not double-apply
 *
 * claimScope: placement posture vocabulary + clip binding data flow only.
 * notEvidenceFor: clinical sitting realism, retarget visual quality, Quest readiness.
 */

export type ActorPosture = "standing" | "seated" | "supine";

export const ACTOR_POSTURES: readonly ActorPosture[] = ["standing", "seated", "supine"] as const;

/** Clip names consumed by the seating wiring contracts (/sit/ match for seated). */
export const SEATED_CLIP_NAME = "openclinxr_seated_sit_idle";
export const STANDING_CLIP_NAME = "openclinxr_posture_shift_standing";

/**
 * Provenance strings for shipped clip sources. Licence guard: never include
 * CarnegieMellonAnimations / rancidmilk (excluded from Mesh2Motion CC0 grant).
 *
 * Mesh2Motion human-base Sitting_* is listed as the evaluated CC0 library residual
 * (#77 declined the rigger; #81 evaluates the clips). Procedural sit is the runtime
 * binding when 66→23 retarget does not clear our armature.
 */
export const SHIPPED_CLIP_SOURCES: readonly string[] = [
  "openclinxr/procedural:openclinxr_seated_sit_idle",
  "openclinxr/procedural:openclinxr_posture_shift_standing",
  "mesh2motion-app/static/animations/human-base-animations.glb#Sitting_Idle",
  "mesh2motion-app/static/animations/human-base-animations.glb#Sitting_Talking",
] as const;

export type PostureClipBinding = {
  posture: ActorPosture;
  clipName: string;
  source: string;
};

export function isActorPosture(value: unknown): value is ActorPosture {
  return value === "standing" || value === "seated" || value === "supine";
}

/**
 * Default posture from environment + slot. Telehealth home visit patient is seated
 * (patient_chair fixture); everyone else stands until a case declares otherwise.
 */
export function defaultPostureForEnvironmentSlot(input: {
  environmentId?: string | null | undefined;
  scenarioId?: string | null | undefined;
  slotKind: string;
}): ActorPosture {
  const env = (input.environmentId ?? "").toLowerCase();
  const scenario = (input.scenarioId ?? "").toLowerCase();
  const telehealth =
    env.includes("telehealth")
    || scenario.includes("telehealth");
  if (telehealth && input.slotKind === "primary_patient") {
    return "seated";
  }
  return "standing";
}

export function resolveActorPosture(input: {
  declared?: string | null | undefined;
  environmentId?: string | null | undefined;
  scenarioId?: string | null | undefined;
  slotKind: string;
}): ActorPosture {
  // Environment/scenario seating wins over a mismatched ED fixture that declares standing
  // (default local bundle is ED while telehealth scenario is selected — #72/#81 seam).
  const fromEnv = defaultPostureForEnvironmentSlot(input);
  if (fromEnv === "seated") {
    return "seated";
  }
  if (isActorPosture(input.declared)) {
    return input.declared;
  }
  return fromEnv;
}

export function clipBindingForPosture(posture: ActorPosture): PostureClipBinding {
  if (posture === "seated") {
    return {
      posture: "seated",
      clipName: SEATED_CLIP_NAME,
      source: "openclinxr/procedural:openclinxr_seated_sit_idle",
    };
  }
  if (posture === "supine") {
    return {
      posture: "supine",
      clipName: STANDING_CLIP_NAME,
      source: "openclinxr/procedural:openclinxr_posture_shift_standing",
    };
  }
  return {
    posture: "standing",
    clipName: STANDING_CLIP_NAME,
    source: "openclinxr/procedural:openclinxr_posture_shift_standing",
  };
}

/**
 * Seated height ownership decision (#81 unlocked decision):
 * verticalOffsetMeters positions the actor root relative to the chair seat;
 * Mesh2Motion Sitting_Idle pelvis/root translation is NOT applied (would double-apply).
 */
export const SEATED_HEIGHT_OWNERSHIP = {
  owner: "verticalOffsetMeters_and_chair_seatHeightMeters" as const,
  clipRootTranslation: "stripped_not_applied" as const,
  rationale:
    "Sitting_Idle carries pelvis translation (~0.33 Y in source); procedural clips are rotation-only. Applying both with verticalOffsetMeters double-counts seated height.",
};

/** Suggested vertical offset when a seated actor sits on a chair of known seat height. */
export function seatedVerticalOffsetForSeatHeight(seatHeightMeters: number): number {
  // Feet-near-origin humanoids: root at seat height places the pelvis near the seat once
  // hip-flex pose folds the legs. Own seated height; do not also apply clip translation.
  // seat 0.45 → root ≈ 0.42 (small clearance).
  return Math.max(0.15, seatHeightMeters - 0.03);
}

/**
 * Default patient_chair slot from telehealth_home_visit_v1 (environment-descriptors).
 * Used when a mismatched ED bundle still places the patient mid-bay.
 */
export const DEFAULT_PATIENT_CHAIR_POSITION = { x: -0.4, y: 0, z: -0.2 } as const;

export function seatedActorWorldPosition(input: {
  chairPosition?: { x: number; y: number; z: number } | null | undefined;
}): { x: number; y: number; z: number } {
  const chair = input.chairPosition ?? DEFAULT_PATIENT_CHAIR_POSITION;
  return { x: chair.x, y: 0, z: chair.z };
}
