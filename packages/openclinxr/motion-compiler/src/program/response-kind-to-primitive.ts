/**
 * Closed responseKind → primitive mapping. Shared by the deterministic
 * compiler and the authored-source binder so the two cannot drift.
 */

export const RESPONSE_KIND_TO_PRIMITIVE: Readonly<Record<string, string>> = {
  guarding: "guard_body_region",
  palpation: "reach_target",
  passive_rom: "imposed_limb_arc",
  positioning: "guided_placement",
};

export const RESPONSE_KIND_TO_BASE_DURATION_MS: Readonly<Record<string, number>> = {
  guarding: 800,
  palpation: 700,
  passive_rom: 1100,
  positioning: 1400,
};
