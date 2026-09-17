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
  it.fails("every shape A..H drives a viseme_* name present in the nurse GLB", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    const misses = SHAPES_A_TO_H.map((shape) => ({ shape, drove: drivenTargetForShape(names, shape) })).filter(
      ({ drove }) => drove === null || !drove.startsWith("viseme_") || !names.has(drove),
    );
    expect(
      misses,
      `shapes missing baked visemes: ${misses.map(({ shape, drove }) => `${shape}->${drove}`).join(", ")}`,
    ).toEqual([]);
  });

  it.fails("shapes C,D,E,F,G drive five DISTINCT viseme_* targets on the nurse body", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    const drove = ["C", "D", "E", "F", "G"].map((shape) => drivenTargetForShape(names, shape));
    expect(drove.every((target) => target?.startsWith("viseme_"))).toBe(true);
    expect(new Set(drove).size).toBe(5);
  });

  it("known-good: A->viseme_aa, B->viseme_E, X stays silent (never aa/E)", () => {
    const names = targetNamesFromGlb(NURSE_GLB);
    expect(drivenTargetForShape(names, "A")).toBe("viseme_aa");
    expect(drivenTargetForShape(names, "B")).toBe("viseme_E");
    const x = drivenTargetForShape(names, "X");
    expect(x === null || x === "viseme_sil").toBe(true);
    expect(x).not.toBe("viseme_aa");
    expect(x).not.toBe("viseme_E");
  });

  it("counterweight: on a viseme_E-only body, A,C,D,E,F,G,H drive null and B drives viseme_E", () => {
    const names = new Set(["viseme_E", "viseme_sil", "basis"]);
    for (const shape of ["A", "C", "D", "E", "F", "G", "H"]) {
      expect(drivenTargetForShape(names, shape), `shape ${shape}`).toBeNull();
    }
    expect(drivenTargetForShape(names, "B")).toBe("viseme_E");
  });

  it("net: Anny body resolves every shape by identity to its carried viseme_* names", () => {
    const names = targetNamesFromGlb(ANNY_GLB);
    const expected: Readonly<Record<string, string>> = {
      A: "viseme_AA",
      B: "viseme_E",
      C: "viseme_IH",
      D: "viseme_OH",
      E: "viseme_OU",
      F: "viseme_FV",
      G: "viseme_L",
      H: "viseme_OU",
    };
    for (const shape of SHAPES_A_TO_H) {
      expect(drivenTargetForShape(names, shape), `shape ${shape}`).toBe(expected[shape]);
    }
  });

  it("net: FACS-only library body keeps the alias rows for viseme_IH / viseme_OU", () => {
    const names = targetNamesFromGlb(FACS_ONLY_GLB);
    expect(resolveMorphTarget("viseme_IH", names)).toBe("mouth-part-later");
    expect(resolveMorphTarget("viseme_OU", names)).toBe("mouth-protusion");
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
