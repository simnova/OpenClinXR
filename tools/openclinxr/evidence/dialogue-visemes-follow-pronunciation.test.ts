import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { visemesForText } from "../../../apps/ui-xr/src/dialogue-visemes.js";

/**
 * **Every actor's mouth is driven by English SPELLING, not pronunciation.** `phonemesForText`
 * (`apps/ui-xr/src/dialogue-visemes.ts`, extracted from `main.ts:9085` by #376) classifies letters:
 * vowels to themselves, `b/m/p -> m`, `f/v -> f`, `t/d/n/l/s/z -> t`, `k/g/q/c/r -> k`, `w/y -> w`.
 * `h` matches nothing and is silently dropped. Measured 2026-08-13:
 *
 *   HOMOPHONES — same pronunciation, so the viseme sequences MUST match. 0 of 5 do:
 *     no     mid,open                  know   mid,mid,open,rounded
 *     two    mid,rounded,open          too    mid,open,open
 *     sea    mid,wide,open             see    mid,wide,wide
 *     right  mid,wide,mid,mid          write  rounded,mid,wide,mid,wide
 *     one    open,mid,wide             won    rounded,open,mid
 *
 *   THE INVERSE ERROR — different sounds, IDENTICAL output:
 *     though mid,open,mid,mid          cough  mid,open,mid,mid
 *
 *   THE WORST SINGLE CASE — a lip CLOSURE on a word whose first sound is /f/:
 *     phone  closed,open,mid,wide      <- the mouth snaps shut on "ph"
 *
 * ## THE GROUND TRUTH IS ENGLISH PHONOLOGY, NOT A THRESHOLD I INVENTED (SS9h)
 *
 * Two homophones are *defined* as having the same pronunciation, so any correct grapheme-to-phoneme
 * mapping produces the same viseme sequence for both. The reference is external to this repo and to
 * me. Nothing here needs a tuned number, and there is no known-good column to argue about — the
 * property either holds or it does not.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                      | (1) homophones | (2) though/cough | (3) alphabet | (4) coverage | result
 *   -----------------------------------------------|----------------|------------------|--------------|--------------|--------
 *   a) today                                       |   **FAIL**     |    **FAIL**      |     pass     |     pass     | REFUSED
 *   b) hardcode the five pairs above               |     pass       |    **FAIL**      |     pass     |     pass     | REFUSED
 *   c) emit richer viseme names the resolver lacks |     pass       |      pass        |   **FAIL**   |     pass     | REFUSED
 *   d) real G2P that drops out-of-vocabulary words |     pass       |      pass        |     pass     |   **FAIL**   | REFUSED
 *   e) real G2P with a declared OOV fallback       |     pass       |      pass        |     pass     |     pass     | ALL PASS
 *
 * ## FIXED (#375)
 *
 * Treatment (e) landed 2026-08-14: `phonemesForText` is now a per-word lookup in
 * `DIALOGUE_PRONUNCIATIONS` — a bank-scoped CMUdict extraction (build-time input; see the generated
 * table's header for provenance and the CMU BSD licence notice) — with the #376 letter classifier
 * kept as the declared fallback for out-of-dictionary words (`bronchodilator`, `ecg`, `nebulized`,
 * plus anything future scenarios add). ARPAbet phones collapse to the seven resolver visemes.
 * Clauses (1) and (2) below are flipped from `it.fails` to `it`: 5/5 homophone pairs match,
 * `though`/`cough` and `through`/`trough` differ. The fallback is spelling, not phonetics, so the
 * homophone property still does not hold for out-of-dictionary words — recorded as #375's unlocked
 * decision 1 and in the module header.
 *
 * **(b) is why clause (2) exists.** Clause (1) alone is satisfied by a lookup table of the five pairs
 * it names. `though`/`cough` are NOT homophones, so no pair table separates them — only actual
 * pronunciation data does. The two clauses cannot both be satisfied by memorising this file.
 *
 * **(d) is why clause (4) exists**, and it is the likely real-world failure. CMUdict has ~134k
 * entries and the shipped bank speaks **228 distinct words** (measured across all 15
 * `learner-runtime-bundle.v1.json` files: 105 spoken lines, 6,986 characters). Clinical terms and
 * proper nouns are the expected misses. A dictionary lookup that silently returns nothing for a miss
 * makes the actor's mouth stop moving mid-sentence — worse than today's wrong-but-continuous motion.
 * Clause (4) enumerates the bank's vocabulary **dynamically from the shipped bundles**, so a fourth
 * scenario is covered the day it ships rather than being green-by-construction against a frozen list.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) were REDS and failed 2026-08-13; both are
 * fixed and asserted as `it` since #375 landed. (3) and (4) are counterweights, independent of what
 * (1) and (2) measure — pronunciation does not change the output alphabet, and the OOV fallback is
 * what keeps every bank word yielding output.
 *
 * NOT TESTED:
 *   - **Timing.** This asserts the SEQUENCE of mouth shapes, never their durations. Nothing here says
 *     a viseme is held for the right length, and `phonemesForText`'s 48-element cap is untouched.
 *   - **That a learner sees the difference.** Only a graded capture mid-utterance settles that, and
 *     that grade is the orchestrator's.
 *   - **Heteronyms** (`lead`, `read`, `wind`) need sentence context and are deliberately out of scope.
 *   - **`phonemesForText` itself.** Only the viseme collapse is asserted, because that is what the
 *     mouth animates to; a correct phoneme sequence that collapses wrongly must still fail.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BUNDLES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");

/** Same pronunciation. Any correct mapping gives both members the same viseme sequence. */
const HOMOPHONES: readonly (readonly [string, string])[] = [
  ["no", "know"],
  ["two", "too"],
  ["sea", "see"],
  ["right", "write"],
  ["one", "won"],
];

/** Spelled alike, pronounced differently. No pair table separates these — only pronunciation does. */
const NOT_HOMOPHONES: readonly (readonly [string, string])[] = [
  ["though", "cough"],
  ["through", "trough"],
];

/** The seven names the runtime morph resolver knows. Anything else is a silent skip at runtime. */
const KNOWN_VISEMES = new Set(["rest", "closed", "teeth", "rounded", "open", "wide", "mid"]);

/** Fields in a shipped bundle that carry words an actor actually says. */
const SPOKEN_FIELD = /(chiefConcern|dialogueTurns|initialDialogueText|utterance|\.text$|spokenLine)/i;

/** Enumerate the bank's spoken vocabulary from the SHIPPED bundles — never a frozen list. */
function bankVocabulary(): string[] {
  const words = new Set<string>();
  let bundles = 0;
  for (const dir of readdirSync(BUNDLES)) {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(BUNDLES, dir, "learner-runtime-bundle.v1.json"), "utf8"));
    } catch {
      continue;
    }
    bundles += 1;
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (SPOKEN_FIELD.test(path) && value.length > 12 && /[a-z]{3}\s+[a-z]{3}/i.test(value)) {
          for (const w of value.toLowerCase().replace(/^[^:]{0,40}:\s*/u, "").match(/[a-z']+/gu) ?? []) {
            words.add(w);
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value && typeof value === "object") {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          walk((value as Record<string, unknown>)[k], `${path}.${k}`);
        }
      }
    };
    walk(doc, "");
  }
  if (bundles === 0) return [];
  return [...words].sort();
}

const vocabulary = bankVocabulary();
const seq = (text: string): string => visemesForText(text).join(",");

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireVocabulary(): void {
  expect(
    vocabulary.length,
    `distinct spoken words enumerated from ${BUNDLES} (228 measured 2026-08-13)`,
  ).toBeGreaterThanOrEqual(150);
}

describe("dialogue visemes follow pronunciation, not spelling", () => {
  it("(1) homophones produce identical viseme sequences", () => {
    const differing = HOMOPHONES.filter(([a, b]) => seq(a) !== seq(b)).map(
      ([a, b]) => `${a} [${seq(a)}] != ${b} [${seq(b)}]`,
    );
    expect(differing, "homophone pairs whose mouths disagree").toEqual([]);
  });

  it("(2) words spelled alike but pronounced differently produce DIFFERENT sequences", () => {
    // Refuses (b): a lookup table of clause (1)'s five pairs cannot separate these, because they are
    // not homophones. Only real pronunciation data satisfies both clauses at once.
    const identical = NOT_HOMOPHONES.filter(([a, b]) => seq(a) === seq(b)).map(
      ([a, b]) => `${a} and ${b} both [${seq(a)}] — spelling collapsed two different pronunciations`,
    );
    expect(identical, "differently-pronounced words whose mouths are identical").toEqual([]);
  });

  it("(3) COUNTERWEIGHT: every emitted viseme is one the runtime resolver knows", () => {
    // Refuses (c): richer names the morph resolver cannot bind are a SILENT SKIP at runtime, so the
    // mouth would simply stop moving. Pin the output alphabet.
    requireVocabulary();
    const unknown = new Set<string>();
    for (const word of [...vocabulary, ...HOMOPHONES.flat(), ...NOT_HOMOPHONES.flat()]) {
      for (const v of visemesForText(word)) if (!KNOWN_VISEMES.has(v)) unknown.add(v);
    }
    expect([...unknown], "visemes emitted that the resolver cannot bind").toEqual([]);
  });

  it("(4) COUNTERWEIGHT: every word the bank actually speaks produces a non-empty sequence", () => {
    // Refuses (d): a dictionary lookup that returns nothing for an out-of-vocabulary word stops the
    // mouth mid-sentence — worse than today's wrong-but-continuous motion. Whatever the OOV fallback
    // is, it must exist. Enumerated dynamically so a new scenario is covered the day it ships.
    requireVocabulary();
    const silent = vocabulary.filter((w) => visemesForText(w).length === 0);
    expect(
      silent.slice(0, 20),
      `bank words producing no visemes (of ${vocabulary.length} enumerated)`,
    ).toEqual([]);
  });
});
