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
 */

export type PhonemeCue = {
  phoneme: string;
  atSecond: number;
};

export type VisemeFrame = {
  atSecond: number;
  weights: Record<string, number>;
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
    return { atSecond: cue.atSecond, weights };
  });

  return { frames };
}
