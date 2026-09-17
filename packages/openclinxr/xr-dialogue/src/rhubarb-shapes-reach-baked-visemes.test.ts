// ## THE DEFECT, MEASURED - IMMUTABLE. Flip it.fails to it and append ## FIXED below; do not rewrite these.
// Rhubarb mouth shapes become runtime tokens in packages/openclinxr/xr-dialogue/src/viseme-baked-cues.ts
// (RHUBARB_SHAPE_TO_TOKEN: A->AA, B->E, C->IH, D->OH, E->OU, F->FV, G->L, H->OU, X->sil).
// Tokens resolve to morph names via resolveVisemeTarget (xr-dialogue/src/viseme-timeline-drive.ts)
// which falls through to resolveMorphTarget in packages/openclinxr/asset-registry/src/morph-target-resolver.ts
// (identity -> case-variant -> MPFB_FACS_MORPH_NAMES alias).
// The shipped MPFB body apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb carries 47 morph
// targets including 15 visemes02 names: viseme_sil viseme_PP viseme_FF viseme_TH viseme_DD viseme_kk viseme_CH
// viseme_SS viseme_nn viseme_RR viseme_aa viseme_E viseme_I viseme_O viseme_U, plus 13 FACS mouth-* units.
// Measured through the public API (mouthCuesToPhonemeCues + applyNamedSpeechVisemes) on that body:
//   A -> viseme_aa ; B -> viseme_E ; C -> mouth-part-later ; D -> mouth-eversion ; E -> mouth-protusion ;
//   F -> mouth-elevation ; G -> mouth-parling ; H -> mouth-protusion
// So shapes C..H drive a generic FACS unit and never reach the baked viseme_I/O/U/FF/nn shapes the body carries.
// Anny cast bodies (e.g. apps/ui-xr/public/_garment_cand/fp/peds_nurse_kevin.glb) carry viseme_AA viseme_E
// viseme_IH viseme_OH viseme_OU viseme_FV viseme_L viseme_TH viseme_silence and resolve every shape by identity
// today; they must not change.
// FACS-only MPFB bodies (apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb)
// carry no viseme_* names and rely on the FACS alias rows; they must not change.
// NOT TESTED: legibility of the shapes, whether Rhubarb shape semantics in RHUBARB_SHAPE_TO_TOKEN are
// phonetically correct, jaw aperture, Quest.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMorphTarget } from "@openclinxr/asset-registry";
import { describe, expect, it } from "vitest";
import { applyNamedSpeechVisemes, mouthCuesToPhonemeCues } from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

const NURSE_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
const ANNY_GLB = "apps/ui-xr/public/_garment_cand/fp/peds_nurse_kevin.glb";
const FACS_ONLY_GLB =
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";

/** Target names read from the GLB at test time: 12-byte header, chunk length at LE(12), JSON at byte 20. */
function targetNamesFromGlb(relativePath: string): Set<string> {
  const buf = readFileSync(join(REPO_ROOT, relativePath));
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLength)) as {
    meshes?: Array<{ extras?: { targetNames?: string[] } }>;
  };
  const names = new Set<string>();
  for (const mesh of json.meshes ?? []) {
    for (const name of mesh?.extras?.targetNames ?? []) names.add(name);
  }
  return names;
}

/** Drive one Rhubarb shape through the public API; the driven target is the single weight > 0 (null if none). */
function drivenTargetForShape(names: Set<string>, shape: string): string | null {
  const dict: Record<string, number> = {};
  const influences: number[] = [];
  let index = 0;
  for (const name of names) {
    dict[name] = index;
    index += 1;
    influences.push(0);
  }
  const mesh = { name: "Body", morphTargetDictionary: dict, morphTargetInfluences: influences };
  const root = {
    userData: {} as Record<string, unknown>,
    traverse: (cb: (o: unknown) => void) => {
      cb(mesh);
    },
  };
  const cues = mouthCuesToPhonemeCues({ mouthCues: [{ start: 0, end: 0.1, value: shape }] });
  const r = applyNamedSpeechVisemes(
    {
      root,
      activeSpeech: { phonemeSequence: ["x"], startedAtMs: 0, durationMs: 100, bakedCues: cues },
    },
    50,
  );
  let best: string | null = null;
  let bestWeight = 0;
  for (const [key, weight] of Object.entries(r.weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = key;
    }
  }
  return best;
}

const SHAPES_A_TO_H = ["A", "B", "C", "D", "E", "F", "G", "H"];

describe("rhubarb shapes reach baked visemes02 targets on MPFB bodies", () => {
  it("every shape A..H drives a viseme_* name present in the nurse GLB", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    const misses = SHAPES_A_TO_H.map((shape) => ({ shape, drove: drivenTargetForShape(names, shape) })).filter(
      ({ drove }) => drove === null || !drove.startsWith("viseme_") || !names.has(drove),
    );
    expect(
      misses,
      `shapes missing baked visemes: ${misses.map(({ shape, drove }) => `${shape}->${drove}`).join(", ")}`,
    ).toEqual([]);
  });

  it("shapes C,D,E,F,G drive five DISTINCT viseme_* targets on the nurse body", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    const drove = ["C", "D", "E", "F", "G"].map((shape) => drivenTargetForShape(names, shape));
    expect(drove.every((target) => target?.startsWith("viseme_"))).toBe(true);
    expect(new Set(drove).size).toBe(5);
  });

  it("readme-meaning: nurse maps A->PP B->SS C->E D->aa E->O F->U G->FF H->nn, X silent", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    // README quotes beside each shape (mouth-shapes table, ~/.openclinxr-tools/rhubarb/README.adoc).
    expect(drivenTargetForShape(names, "A")).toBe("viseme_PP"); // "Closed mouth for the P, B, and M sounds"
    expect(drivenTargetForShape(names, "B")).toBe("viseme_SS"); // "Slightly open mouth with clenched teeth ... K, S, T"
    expect(drivenTargetForShape(names, "C")).toBe("viseme_E"); // "Open mouth ... EH as in men and AE as in bat"
    expect(drivenTargetForShape(names, "D")).toBe("viseme_aa"); // "Wide open mouth ... AA as in father"
    expect(drivenTargetForShape(names, "E")).toBe("viseme_O"); // "Slightly rounded mouth ... AO as in off and ER as in bird"
    expect(drivenTargetForShape(names, "F")).toBe("viseme_U"); // "Puckered lips ... UW as in you, OW as in show, W as in way"
    expect(drivenTargetForShape(names, "G")).toBe("viseme_FF"); // "Upper teeth touching the lower lip for F ... and V"
    expect(drivenTargetForShape(names, "H")).toBe("viseme_nn"); // 'long "L" sounds, with the tongue raised behind the upper teeth'
    const x = drivenTargetForShape(names, "X"); // "Idle position ... lips should be closed but relaxed"
    expect(x === null || x === "viseme_sil").toBe(true);
    expect(x).not.toBe("viseme_aa");
    expect(x).not.toBe("viseme_E");
  });

  it("counterweight asserts the README meaning: on a viseme_E-only body, C drives viseme_E", () => {
    const names = new Set(["viseme_E", "viseme_sil", "basis"]);
    // B ("clenched teeth ... EE sound in bee") no longer maps to the spread vowel E under the README.
    for (const shape of ["A", "B", "D", "E", "F", "G", "H"]) {
      expect(drivenTargetForShape(names, shape), `shape ${shape}`).toBeNull();
    }
    expect(drivenTargetForShape(names, "C")).toBe("viseme_E"); // "Open mouth ... EH as in men and AE as in bat"
  });

  it("net asserts the README meaning: Anny body resolves shapes to its carried viseme_* names", () => {
    const names = targetNamesFromGlb(ANNY_GLB);
    // README quotes beside each shape (mouth-shapes table, ~/.openclinxr-tools/rhubarb/README.adoc).
    // A: "Closed mouth for the P, B, and M sounds" — Anny carries no viseme_PP, and the
    // driver DOES write silence at weight > 0: PHONEME_ALIASES maps sil->silence
    // (viseme-timeline-drive.ts:58-60), resolveVisemeTarget tries viseme_silence first among
    // candidates (:179-185), and the active frame target is written at 1 (:254-257).
    const expected: Readonly<Record<string, string>> = {
      A: "viseme_silence",
      B: "viseme_IH", // "clenched teeth ... EE sound in bee" — IH is the nearest EE on Anny
      C: "viseme_E", // "Open mouth ... EH as in men and AE as in bat"
      D: "viseme_AA", // "Wide open mouth ... AA as in father"
      E: "viseme_OH", // "Slightly rounded mouth ... AO as in off and ER as in bird"
      F: "viseme_OU", // "Puckered lips ... UW as in you, OW as in show, W as in way"
      G: "viseme_FV", // "Upper teeth touching the lower lip for F ... and V"
      H: "viseme_L", // 'long "L" sounds, with the tongue raised behind the upper teeth'
    };
    for (const shape of SHAPES_A_TO_H) {
      expect(drivenTargetForShape(names, shape), `shape ${shape}`).toBe(expected[shape]);
    }
  });

  it("net asserts the README meaning: FACS-only library body keeps alias rows incl PP/SS", () => {
    const names = targetNamesFromGlb(FACS_ONLY_GLB);
    expect(resolveMorphTarget("viseme_IH", names)).toBe("mouth-part-later");
    expect(resolveMorphTarget("viseme_OU", names)).toBe("mouth-protusion");
    expect(resolveMorphTarget("viseme_PP", names)).toBe("mouth-compression");
    expect(resolveMorphTarget("viseme_SS", names)).toBe("mouth-part-later");
  });

  it("A is a closed-lip shape: drives viseme_PP and never viseme_aa on the nurse body", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    expect(drivenTargetForShape(names, "A")).toBe("viseme_PP"); // "Closed mouth for the P, B, and M sounds"
    expect(drivenTargetForShape(names, "A")).not.toBe("viseme_aa");
    expect(mouthCuesToPhonemeCues({ mouthCues: [{ start: 0, end: 0.1, value: "A" }] })[0]?.phoneme).not.toBe(
      "AA",
    );
  });

  it("vacuity guard: nurse GLB target set is the measured hybrid body", () => {
    expect(existsSync(join(REPO_ROOT, NURSE_GLB))).toBe(true);
    const names = targetNamesFromGlb(NURSE_GLB);
    expect(names.size).toBeGreaterThan(40);
    const visemes = [...names].filter((name) => name.startsWith("viseme_"));
    expect(visemes).toHaveLength(15);
    for (const name of ["viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_nn"]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});

// ## FIXED - appended below the immutable header above; the header's measured table is untouched.
// VISEMES02_MORPH_NAMES alias pass in packages/openclinxr/asset-registry/src/morph-target-resolver.ts
// (runs after the #463 case-variant pass, before the MPFB_FACS_MORPH_NAMES alias pass, consulted
// only when the alias name is present on the body): a baked visemes02 pack name beats a generic
// FACS unit. Measured through the public API on the nurse GLB:
//   C->viseme_I, D->viseme_O, E->viseme_U, F->viseme_FF, G->viseme_nn, H->viseme_U.

// ## SUPERSEDED (Rhubarb shape semantics) - appended below the ## FIXED block above; both blocks above are untouched.
// Rhubarb's README (~/.openclinxr-tools/rhubarb/README.adoc, "Mouth shapes" table) says:
//   A = "Closed mouth for the P, B, and M sounds"
//   B = "Slightly open mouth with clenched teeth ... most consonants (K, S, T, etc.) ... EE sound in bee"
//   C = "Open mouth ... vowels like EH as in men and AE as in bat"
//   D = "Wide open mouth ... vowels like AA as in father"
//   E = "Slightly rounded mouth ... AO as in off and ER as in bird"
//   F = "Puckered lips ... UW as in you, OW as in show, and W as in way"
//   G = "Upper teeth touching the lower lip for F as in for and V as in very"
//   H = "long L sounds, with the tongue raised behind the upper teeth"
//   X = "Idle position ... lips should be closed but relaxed"
// The old known-good clause pinning A->viseme_aa and B->viseme_E, the viseme_E-only counterweight
// pinning B->viseme_E, and the Anny net clause pinning A->viseme_AA ... H->viseme_OU encoded a
// misreading of Rhubarb's shapes. The clauses above now assert the README meaning instead.
