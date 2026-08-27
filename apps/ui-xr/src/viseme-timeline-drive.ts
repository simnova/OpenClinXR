/**
 * Phoneme timeline → viseme morph weights (#45).
 *
 * Standalone driver — not wired into `main.ts` in this slice. The contract only requires
 * that a phoneme timeline produces changing weights on real mesh viseme targets. Wiring into
 * the existing `visemeSequence` / morph-target playback path is a follow-on.
 *
 * Decisions recorded here:
 * - Interpolation: **step** — one frame per phoneme cue; active viseme at 1.0, others 0.
 *   Contract only requires change, not smoothness.
 * - Phoneme → viseme: exact `viseme_${PHONEME}` when present; `sil`/`silence` → `viseme_silence`;
 *   case-insensitive match against `availableTargets`; unmapped phonemes yield zero weights
 *   (no invented target names).
 * - #722: the final resolution pass goes through `resolveMorphTarget` — the SAME identity /
 *   case-variant / MPFB FACS alias map the applier uses (#308/#353). A body that carries some
 *   `viseme_*` names plus FACS mouth units (the hybrid rail) would otherwise resolve only the
 *   identity-matching tokens and drop AA/IH/OH/OU/FV/TH/L to all-zero frames while the applier
 *   could have aliased them. Driver and applier cannot disagree when they share the resolver.
 */

import { resolveMorphTarget } from "@openclinxr/asset-registry";

export type PhonemeCue = {
  phoneme: string;
  atSecond: number;
  /** Per-phone dwell length in seconds. Omitted by callers that pre-time their own cues. */
  durationSeconds?: number;
};

export type VisemeFrame = {
  atSecond: number;
  /** Dwell length in seconds; absent when the caller supplied no per-phone durations. */
  durationSeconds?: number;
  weights: Record<string, number>;
  /**
   * Jaw bone rotation (radians) that parts the lips. Viseme morphs are lip-surface shapes only
   * (#552); the mouth opens via the `jaw` bone. Unit is radians so the runtime can apply a bone
   * rotation — metres-per-radian is a per-asset lever arm the driver does not know.
   */
  jawOpenRadians: number;
};

export type DriveVisemeTimelineInput = {
  phonemes: ReadonlyArray<PhonemeCue>;
  availableTargets: readonly string[];
};

export type DriveVisemeTimelineResult = {
  frames: VisemeFrame[];
};

/** Alias phonemes that do not match `viseme_${token}` by construction. */
const PHONEME_ALIASES: Readonly<Record<string, string>> = {
  sil: "silence",
  silence: "silence",
  rest: "silence",
};

/**
 * Canonical ARKit viseme names driven when a body carries NO `viseme_*` targets (the MPFB FACS
 * rail). The frame weights must carry these canonical spellings — `applyVisemeWeights` resolves
 * them through the FACS alias map, so a FACS name in the weights map would write as-is with the
 * active phoneme never matched and the mouth would never move (#353).
 */
const CANONICAL_FALLBACK_VISEME_NAMES: readonly string[] = [
  "viseme_sil", "viseme_AA", "viseme_E", "viseme_IH",
  "viseme_OH", "viseme_OU", "viseme_FV", "viseme_TH", "viseme_L",
];

const SILENCE_TOKENS: ReadonlySet<string> = new Set(["sil", "silence", "rest"]);

/**
 * Minimum jaw rotation that clears the teeth-derived anterior aperture on the shipped
 * `mpfb-viseme-inspect.glb` rig: asin(0.020725011825561523 / 0.137901) ≈ 0.15086 rad (8.64°).
 * Both inputs are bind-pose / mesh properties — never fitted to an effect (#552).
 */
export const JAW_OPEN_TEETH_CLEAR_RADIANS = Math.asin(0.020725011825561523 / 0.137901);

/**
 * Per-shape jaw aperture as a fraction of {@link JAW_OPEN_TEETH_CLEAR_RADIANS}.
 * Coarse classes only — Rhubarb collapses many consonants (#582); do not invent per-phone precision.
 * Recorded in `.openclinxr/evidence/issue-552/jaw-aperture.json`.
 */
const JAW_APERTURE_FRACTION: Readonly<Record<string, number>> = {
  // Closed / bilabial stop — lips sealed, jaw shut.
  sil: 0,
  silence: 0,
  rest: 0,
  pp: 0,
  b: 0,
  m: 0,
  // Open vowels — full teeth-clearing aperture (widest).
  aa: 1,
  ah: 1,
  ae: 1,
  ay: 1,
  a: 1,
  // Rounded / back open — near-full.
  o: 0.85,
  oh: 0.85,
  ao: 0.85,
  ow: 0.85,
  oy: 0.85,
  // Mid vowels.
  e: 0.45,
  eh: 0.45,
  er: 0.45,
  ey: 0.45,
  // Close / near-close.
  i: 0.35,
  ih: 0.35,
  iy: 0.35,
  u: 0.4,
  uh: 0.4,
  uw: 0.4,
  ou: 0.5,
  // Partials (fricatives / liquids / residual consonants).
  fv: 0.15,
  th: 0.25,
  ss: 0.2,
  ch: 0.25,
  nn: 0.2,
  rr: 0.3,
  l: 0.3,
  w: 0.35,
  y: 0.3,
};

/** Jaw aperture in radians for a phoneme token. Unknown tokens get a mid partial, never invent names. */
export function jawOpenRadiansForPhoneme(phoneme: string): number {
  const raw = phoneme.trim();
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  if (SILENCE_TOKENS.has(lower)) return 0;
  const fraction = JAW_APERTURE_FRACTION[lower];
  if (typeof fraction === "number") {
    return Number((fraction * JAW_OPEN_TEETH_CLEAR_RADIANS).toFixed(6));
  }
  // Unknown consonant / residual — partial, not sealed and not full-open.
  return Number((0.25 * JAW_OPEN_TEETH_CLEAR_RADIANS).toFixed(6));
}

/** Snapshot of the aperture table for evidence / inspection (fractions of teeth-clear radians). */
export function jawApertureFractionTable(): Readonly<Record<string, number>> {
  return { ...JAW_APERTURE_FRACTION };
}

/** Canonical name for a phoneme token, or null when the token is not in the ARKit set. */
function canonicalVisemeName(phoneme: string): string | null {
  const raw = phoneme.trim();
  if (!raw) return null;
  if (SILENCE_TOKENS.has(raw.toLowerCase())) return "viseme_sil";
  const upper = raw.toUpperCase();
  return CANONICAL_FALLBACK_VISEME_NAMES.includes(`viseme_${upper}`) ? `viseme_${upper}` : null;
}

/**
 * Resolve a phoneme token to a morph target name that exists on the mesh, or null.
 * Never invents target names outside `availableTargets`.
 */
export function resolveVisemeTarget(
  phoneme: string,
  availableTargets: readonly string[],
): string | null {
  const available = new Set(availableTargets);
  const raw = phoneme.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const alias = PHONEME_ALIASES[lower] ?? lower;

  // Prefer ARKit-style names used on shipped GLBs (viseme_AA, viseme_silence, …).
  const candidates = [
    `viseme_${alias}`,
    `viseme_${alias.toUpperCase()}`,
    `viseme_${raw}`,
    `viseme_${raw.toUpperCase()}`,
    alias,
    raw,
  ];

  for (const candidate of candidates) {
    if (available.has(candidate)) return candidate;
  }

  // Case-insensitive fallback against the real mesh list only.
  for (const target of availableTargets) {
    if (target.toLowerCase() === `viseme_${alias}`.toLowerCase()) return target;
    if (target.toLowerCase() === alias.toLowerCase()) return target;
  }

  // #722 — the applier's own resolution pass: identity / case-variant / MPFB FACS alias map.
  // A HYBRID body (some viseme_* names + FACS mouth units) reaches the non-identity baked
  // tokens this way; the canonical name here is the one `applyVisemeWeights` will also resolve,
  // so the frame's active target is exactly the target the applier writes. A body with NO
  // viseme_* names keeps the #353 canonical-fallback path (driveTargets = canonical names),
  // which the applier aliases — resolving to the FACS name here would change that frame's
  // reported active name for no behavioural difference.
  const hasVisemeTargets = availableTargets.some((target) =>
    target.toLowerCase().startsWith("viseme_"),
  );
  const canonical = canonicalVisemeName(phoneme);
  if (canonical !== null && hasVisemeTargets) {
    const viaApplier = resolveMorphTarget(canonical, new Set(availableTargets));
    if (viaApplier !== null) return viaApplier;
  }

  return null;
}

/**
 * Drive viseme morph weights from a timed phoneme sequence.
 *
 * Step interpolation: at each phoneme cue, the resolved viseme is 1.0 and every other
 * available viseme target is 0. Frames key names from `availableTargets`; a body that
 * carries NO `viseme_*` targets (the MPFB FACS rail, #353) is driven by the canonical
 * ARKit names instead, which `applyVisemeWeights` resolves through the FACS alias map.
 */
export function driveVisemeTimeline(
  input: DriveVisemeTimelineInput,
): DriveVisemeTimelineResult {
  const { phonemes, availableTargets } = input;
  const visemeTargets = availableTargets.filter((name) =>
    name.toLowerCase().startsWith("viseme_"),
  );
  // If the mesh exposes no viseme_* names, drive the canonical ARKit names the applier
  // resolves through the FACS alias map (see CANONICAL_FALLBACK_VISEME_NAMES).
  const driveTargets =
    visemeTargets.length > 0 ? visemeTargets : [...CANONICAL_FALLBACK_VISEME_NAMES];

  const frames: VisemeFrame[] = phonemes.map((cue) => {
    const active =
      resolveVisemeTarget(cue.phoneme, availableTargets) ??
      (visemeTargets.length === 0 ? canonicalVisemeName(cue.phoneme) : null);
    const weights: Record<string, number> = {};
    for (const target of driveTargets) {
      weights[target] = active !== null && target === active ? 1 : 0;
    }
    // If the active target is in availableTargets but not in driveTargets (edge case),
    // still set it so the frame is non-empty and names only real targets.
    if (active !== null && !(active in weights) && availableTargets.includes(active)) {
      weights[active] = 1;
    }
    const frame: VisemeFrame = {
      atSecond: cue.atSecond,
      weights,
      jawOpenRadians: jawOpenRadiansForPhoneme(cue.phoneme),
    };
    if (cue.durationSeconds !== undefined) frame.durationSeconds = cue.durationSeconds;
    return frame;
  });

  return { frames };
}

/**
 * Dwell length of one frame in seconds. Prefers the cue-supplied duration; falls back to the
 * `atSecond` gap for callers that build cues without durations (uniform step).
 */
export function frameDurationSeconds(frames: readonly VisemeFrame[], index: number): number {
  const frame = frames[index];
  if (!frame) return 0;
  const explicit = frame.durationSeconds;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) return explicit;
  const next = frames[index + 1];
  if (next) return Math.max(0, next.atSecond - frame.atSecond);
  const prev = frames[index - 1];
  if (prev) return Math.max(0, frame.atSecond - prev.atSecond);
  return 0.12;
}

/** Total timeline length = sum of per-frame dwells. */
export function totalTimelineDurationSeconds(frames: readonly VisemeFrame[]): number {
  return frames.reduce((sum, _, i) => sum + frameDurationSeconds(frames, i), 0);
}
