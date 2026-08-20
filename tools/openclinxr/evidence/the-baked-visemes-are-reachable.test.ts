import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { mapDialoguePhonemeToArkit } from "../../../apps/ui-xr/src/viseme-runtime-wire.js";
import { resolveMorphTarget } from "../../../packages/openclinxr/asset-registry/src/morph-target-resolver.js";

/**
 * E2 / xr-systems-architect. Superagent ruled B over A on 2026-08-20:
 *
 *   "AH is already the product's phoneme... resolveVisemeTarget("AH") looks for viseme_AH, which the
 *    mesh does not have. THE MIXER IS INCOMPLETE. THE SOURCE IS NOT WRONG. Widen that alias table onto
 *    the visemes02 names that already exist. Do not change phonemesForText. Do not invent a viseme_AH
 *    morph. Prove it in isolation. Do not send it through the crown-aim capture."
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`; do not rewrite these.
 *
 * `mpfb-peds-parent-aisha.glb` carries 47 morph targets, **15 of them visemes02**. Driving every token
 * in `DIALOGUE_PHONEME_TO_ARKIT`'s codomain through the real three-pass resolver reaches **4 of 15**:
 *
 *   reachable    viseme_aa  viseme_E  viseme_TH  viseme_sil
 *   unreachable  CH DD FF I O PP RR SS U kk nn          <- 11 baked targets no dialogue can ever drive
 *
 * `dialogue-pronunciations.ts:19` is `"a": "AH"`, so the parent's most common vowel is ARPAbet `AH`.
 * `AH` is not a key in the alias table, so it resolves to NOTHING at all.
 *
 * ## TWO MEASUREMENTS OF MINE DIED GETTING HERE. Both were population errors and both were mine.
 *
 *   1. I first reported "4/15 reachable, tokens FV/IH/OH/OU/L hit nothing" from a TWO-pass model.
 *      `resolveMorphTarget` (`morph-target-resolver.ts:114-124`) has THREE passes and the third
 *      aliases `viseme_IH -> mouth-part-later`, `OH -> mouth-eversion`, `OU -> mouth-protusion`,
 *      `FV -> mouth-elevation`, `L -> mouth-parling`. **The mouth is NOT silent today.**
 *   2. Re-running it, `L` still read UNRESOLVED — because I had HAND-TYPED the mesh target set and
 *      omitted `mouth-parling`, which is on the mesh.
 *
 * **Hence every population in this file is read from the GLB at test time (SS7k). None is typed.**
 *
 * ## WHAT IS AND IS NOT WRONG
 *
 * The mouth moves. Four vowel/consonant classes route through generic FACS `mouth-*` action units,
 * which is a legitimate fallback and NOT a defect on a body with no viseme pack. The defect is that
 * THIS body HAS the pack — 15 baked visemes02 shapes — and the codomain routes past 11 of them, so the
 * distinctions the pack exists to provide (I vs O vs U) collapse onto shared FACS shapes.
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — the four rows that already work
 *
 * `sil -> viseme_sil`, `AA -> viseme_aa` (via the #463 case-variant pass), `E -> viseme_E`,
 * `TH -> viseme_TH`. Same table, same resolver, same mesh: these prove the mechanism is sound and the
 * codomain is the only thing wrong.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)(2)(3) interrogate the alias table's codomain: **REDS**, planted `it.fails`.
 * (4)(5)(6) read the GLB and the tree and pass today: **TRUE NETS**.
 *
 * NOT TESTED:
 *   - That a human can read a viseme off a frame. This proves reachability, not legibility. The
 *     crown-aim defect (A) still photographs the room hull, so no capture can grade this yet.
 *   - Which visemes02 shape is phonetically correct for each ARPAbet class. Distinctness is asserted;
 *     phonetic accuracy is a clinical/animation judgement this contract does not make.
 *   - Consonant classes beyond the vowels named below.
 *   - Quest, clinical validity, exam equivalence.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GLB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const PRONUNCIATIONS = join(REPO_ROOT, "apps/ui-xr/src/dialogue-pronunciations.ts");
const WIRE = join(REPO_ROOT, "apps/ui-xr/src/viseme-runtime-wire.ts");

/** Machine-read, never typed — the two errors in the header were both hand-typed populations. */
async function shippedTargets(): Promise<Set<string>> {
  const doc = await new NodeIO().read(GLB);
  const names = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const n of ((mesh.getExtras() as { targetNames?: string[] })?.targetNames ?? [])) names.add(n);
  }
  return names;
}

const TARGETS = await shippedTargets();
const VISEMES02 = new Set([...TARGETS].filter((n) => n.startsWith("viseme_")));

/** Drive one dialogue token the way the runtime does: alias table -> three-pass resolver. */
function driven(token: string): string | null {
  return resolveMorphTarget(`viseme_${mapDialoguePhonemeToArkit(token)}`, TARGETS);
}

/** The parent's own vowels, from CMUdict. Not a set I chose — see dialogue-pronunciations.ts. */
const VOWELS = ["AH", "IY", "OW", "UW"] as const;

describe("the baked visemes02 targets are reachable from dialogue", () => {
  it.fails("(1) RED: the parent's most common vowel drives a baked viseme", () => {
    // dialogue-pronunciations.ts:19 is "a": "AH". Today AH is not a key in DIALOGUE_PHONEME_TO_ARKIT,
    // so it resolves to nothing at all — not even a FACS fallback.
    const target = driven("AH");
    expect(target, `AH must drive some target`).not.toBeNull();
    expect(VISEMES02.has(target ?? ""), `AH resolved to ${target}, which is not one of the baked visemes02`).toBe(true);
  });

  it.fails("(2) RED: each CMUdict vowel reaches a baked viseme", () => {
    const missed = VOWELS.filter((v) => !VISEMES02.has(driven(v) ?? ""));
    expect(missed, `these vowels route past the baked pack: ${missed.join(" ")}`).toEqual([]);
  });

  it.fails("(3) RED+COUNTERWEIGHT: the vowels stay distinguishable", () => {
    // Refuses the cheap fix: mapping every vowel onto viseme_aa satisfies (1) and (2) and destroys the
    // only reason to widen the table. A pack whose shapes are all the same shape is not a pack.
    const hit = VOWELS.map((v) => driven(v));
    // A null is NOT a distinct shape. Probe D3 (2026-08-20) passed this clause on [null,I,O,U]
    // because Set treated the null as a fourth value — a vacuity hole in my own counterweight.
    expect(hit.filter((h) => h === null), `unresolved vowels are not "distinct": ${JSON.stringify(hit)}`).toEqual([]);
    expect(new Set(hit).size, `four vowels produced ${JSON.stringify(hit)}`).toBe(VOWELS.length);
  });

  it("(4) NET: nothing in the codomain invents a morph the body lacks", () => {
    // Refuses "add a viseme_AH shape". Reads the GLB, passes today, and keeps passing: every token the
    // table can emit must land on a target the shipped body actually carries.
    // Keys read from the source, NEVER typed: probe D3 added `AH: "AH"` and a hand-typed token list
    // did not contain AH, so this net stayed green while the codomain pointed at an absent morph.
    const table = readFileSync(WIRE, "utf8").match(/DIALOGUE_PHONEME_TO_ARKIT[^=]*=\s*\{([\s\S]*?)\n\};/);
    const tokens = [...(table?.[1] ?? "").matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map((m) => m[1]);
    expect(tokens.length, "alias-table keys parsed from source").toBeGreaterThan(20);
    const unresolved = tokens.filter((t) => driven(t) === null);
    expect(unresolved, `these emit a target absent from the shipped body: ${unresolved.join(" ")}`).toEqual([]);
  });

  it("(5) NET: the phoneme SOURCE is untouched", () => {
    // The superagent ruled the source correct and the mixer incomplete. Changing CMUdict to emit a
    // token the table already knows would satisfy (1) while leaving 11 targets unreachable.
    expect(readFileSync(PRONUNCIATIONS, "utf8"), `"a" must still resolve to AH`).toContain('"a": "AH"');
  });

  it("(6) VACUITY GUARD: the population is real and machine-read", () => {
    expect(existsSync(GLB), "the shipped parent body must exist").toBe(true);
    expect(TARGETS.size, "morph targets read from the GLB").toBeGreaterThan(40);
    expect(VISEMES02.size, "baked visemes02 shapes on this body").toBe(15);
    expect(VISEMES02.has("viseme_I") && VISEMES02.has("viseme_O") && VISEMES02.has("viseme_U"),
      "the distinct vowel shapes clause (3) needs must exist on the body").toBe(true);
  });
});
