/**
 * Dialogue phoneme/viseme pipeline, extracted from `apps/ui-xr/src/main.ts` (#376) — step one of
 * #375, and a pure move: the behaviour below is TODAY'S letter-by-letter grapheme classification,
 * pinned wrong answers and all by `tools/openclinxr/evidence/dialogue-visemes-are-extractable.test.ts`.
 * The pronunciation defect (#375) is a separate contract, not this module.
 *
 * Exported as a pair because the runtime needs both: `phonemesForText` feeds the speech-evidence
 * `phonemeSequence` field, virtual-device state, and the duration estimate; `visemesForText` is the
 * collapse #375's contract will assert on — the viseme sequence the mouth animates to.
 */

/** Today's phoneme sequence — the letter-by-letter heuristic #375 will replace. */
export function phonemesForText(text: string): string[] {
  const spoken = text.replace(/^[^:]+:\s*/u, "").toLowerCase();
  const sequence: string[] = [];
  for (const char of spoken) {
    if (/[aeiou]/u.test(char)) sequence.push(char);
    else if (/[bmp]/u.test(char)) sequence.push("m");
    else if (/[fv]/u.test(char)) sequence.push("f");
    else if (/[tdnlsz]/u.test(char)) sequence.push("t");
    else if (/[kgqcr]/u.test(char)) sequence.push("k");
    else if (/[wy]/u.test(char)) sequence.push("w");
    else if (/[.!?]/u.test(char)) sequence.push("sil");
  }
  return sequence.length > 0 ? sequence.slice(0, 48) : ["sil"];
}

/** The viseme sequence the mouth animates to — `phonemesForText` mapped through the resolver. */
export function visemesForText(text: string): string[] {
  return phonemesForText(text).map(visemeForPhoneme);
}

function visemeForPhoneme(phoneme: string): string {
  if (phoneme === "sil") return "rest";
  if (phoneme === "m") return "closed";
  if (phoneme === "f") return "teeth";
  if (phoneme === "w") return "rounded";
  if (phoneme === "a" || phoneme === "o") return "open";
  if (phoneme === "e" || phoneme === "i") return "wide";
  return "mid";
}
