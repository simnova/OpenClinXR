/**
 * PLACEHOLDER for #62. Deliberately implements nothing.
 *
 * Exists so the planted contracts in `viseme-morph-apply.test.ts` can reference this module without
 * breaking `typecheck` — a dynamic `import()` is still resolved at compile time.
 *
 * WHAT GOES HERE: apply named viseme weights to a three.js morph target, resolving each name through
 * `morphTargetDictionary` rather than writing a fixed index.
 *
 * WHY: `main.ts:8496-8502` currently does `object.morphTargetInfluences[0] = weight` — index zero,
 * no name lookup — so every phoneme drives the same shape. #45's `driveVisemeTimeline` already
 * resolves phonemes to real viseme target names; this is the missing downstream that can apply them.
 *
 * NOT IN SCOPE: whether the resulting motion reads as speech, and anything about body proportions.
 */

export const VISEME_MORPH_APPLY_PLACEHOLDER = true;
