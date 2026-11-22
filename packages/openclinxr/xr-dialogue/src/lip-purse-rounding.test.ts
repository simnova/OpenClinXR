/** Lip purse table (lip-rounding-b1): O/U drive the purse morphs. No GLB. */
import { describe, expect, it } from "vitest";
import { resolveMorphTarget } from "@openclinxr/asset-registry";
import {
  applyLipPurseToRoot,
  lipPurseWeights,
  type LipPurseTable,
} from "./lip-purse-rounding.js";
import { applyNamedSpeechVisemes } from "./viseme-runtime-wire.js";

const HALF_O: LipPurseTable = (["mouth-pursing", "mouth-protusion"] as const).flatMap((key) => [
  { viseme: "O" as const, key, weight: 0.5, source: "test" },
]);

const ZERO_PURSE: LipPurseTable = [
  { viseme: "O" as const, key: "mouth-pursing" as const, weight: 0, source: "test zero table" },
  { viseme: "O" as const, key: "mouth-protusion" as const, weight: 0, source: "test zero table" },
  { viseme: "U" as const, key: "mouth-pursing" as const, weight: 0, source: "test zero table" },
  { viseme: "U" as const, key: "mouth-protusion" as const, weight: 0, source: "test zero table" },
];

describe("lip purse rounding (b1)", () => {
  it("explicit zero table maps every drive to {}", () => {
    expect(ZERO_PURSE).toHaveLength(4);
    expect(ZERO_PURSE.every((row) => row.weight === 0)).toBe(true);
    for (const weights of [{ viseme_O: 1 }, { viseme_U: 1 }, { viseme_O: 1, viseme_U: 1 }, {}]) {
      expect(lipPurseWeights(weights, ZERO_PURSE)).toEqual({});
    }
  });

  it("O weight 0.5 with viseme_O 1 drives both keys 0.5", () => {
    expect(lipPurseWeights({ viseme_O: 1 }, HALF_O)).toEqual({
      "mouth-pursing": 0.5,
      "mouth-protusion": 0.5,
    });
  });

  it("non-O/U drives map to {}", () => {
    for (const weights of [{ viseme_E: 1 }, { viseme_CH: 1 }, { viseme_RR: 1 }, { viseme_PP: 1 }, { viseme_FF: 1 }]) {
      expect(lipPurseWeights(weights, HALF_O)).toEqual({});
    }
  });

  it("clamps the summed drive at 1", () => {
    const table: LipPurseTable = [
      { viseme: "U", key: "mouth-pursing", weight: 0.8, source: "test" },
      { viseme: "U", key: "mouth-pursing", weight: 0.8, source: "test" },
    ];
    expect(lipPurseWeights({ viseme_U: 1 }, table)).toEqual({ "mouth-pursing": 1 });
  });

  it("FACS-only dict keeps a pre-set protusion: no write without baked O/U", () => {
    // source: HANDBACK-7 N1 (resolveMorphTarget maps viseme_OU to
    // mouth-protusion on meshes with no viseme_* targets; the purse pass must
    // not erase that timeline drive). Synthetic mesh, no GLB.
    const mesh = {
      morphTargetDictionary: { "mouth-pursing": 0, "mouth-protusion": 1 },
      morphTargetInfluences: [0, 1],
    };
    const root = { traverse: (cb: (o: unknown) => void) => void cb(mesh) };
    const touched = applyLipPurseToRoot(root, { viseme_U: 1 });
    expect(touched).toBe(0);
    expect(mesh.morphTargetInfluences).toEqual([0, 1]);
  });

  it("dict with baked O/U plus both keys is written", () => {
    // source: HANDBACK-7 N1 control: the guarded path writes as today.
    const mesh = {
      morphTargetDictionary: { viseme_O: 0, viseme_U: 1, "mouth-pursing": 2, "mouth-protusion": 3 },
      morphTargetInfluences: [0, 0, 0, 0],
    };
    const root = { traverse: (cb: (o: unknown) => void) => void cb(mesh) };
    const touched = applyLipPurseToRoot(root, { viseme_U: 1 });
    expect(touched).toBe(1);
    expect(mesh.morphTargetInfluences[2]).toBeCloseTo(0.5, 12);
    expect(mesh.morphTargetInfluences[3]).toBe(0);
  });

  it("CW-FALLBACK: named U drives mouth-protusion on a viseme-less mesh end to end", () => {
    // source: HANDBACK-7b (cap56 R11): on a FACS-only dict the viseme channel
    // aliases viseme_OU to mouth-protusion; the purse guard must not erase it.
    // Synthetic mesh, no GLB, production path applyNamedSpeechVisemes.
    const mesh = {
      name: "body",
      morphTargetDictionary: { "mouth-pursing": 0, "mouth-protusion": 1, "mouth-open": 2 },
      morphTargetInfluences: [0, 0, 0],
    };
    const root = { traverse: (cb: (o: unknown) => void) => void cb(mesh) };
    const result = applyNamedSpeechVisemes(
      { root, activeSpeech: { phonemeSequence: ["U"], startedAtMs: 0, durationMs: 1000 } },
      500,
    );
    const dictKeys = new Set(Object.keys(mesh.morphTargetDictionary));
    const channelKey = Object.keys(result.weights).find(
      (name) => resolveMorphTarget(name, dictKeys) === "mouth-protusion",
    );
    expect(channelKey).toBeDefined();
    const expected = result.weights[channelKey!];
    expect(expected).toBeGreaterThan(0);
    expect(mesh.morphTargetInfluences[1]).toBeGreaterThan(0);
    expect(mesh.morphTargetInfluences[1]).toBeCloseTo(expected ?? 0, 6);
  });
});
