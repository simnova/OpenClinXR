/**
 * Lip-rounding B1 pick proofs (card tsk_48915702ffcadd1e, aisha-parity).
 *
 * Proves the cap55 pick (mouth-pursing 0.5, mouth-protusion 0) narrows O/U
 * while the known-bad both-keys rows fail the counterweights. All 4 MPFB
 * speakers, O and U. Headless geometry; no GLB bytes in this file.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyGeneratedScalarVisemeToRoot,
  applyNamedSpeechVisemes,
  LIP_PURSE_TABLE,
  LIP_ROUNDING_TABLE,
  lipPurseWeights,
  lipRoundingScales,
} from "@openclinxr/xr-dialogue/package-viseme";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadHeadlessScene, type HeadlessScene } from "./headless-scene.js";
import {
  apertureHeightMm,
  assertPositiveSpan,
  lowerDropMm,
  narrowPct,
  pickLateral10,
  pickMidline,
  upperRiseMm,
  widthMm,
  type Lateral10,
  type LipPurseTable,
  type Midline,
} from "./lip-rounding-extent.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const ASSETS = [
  "mpfb-peds-parent-aisha",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-nurse-kevin",
  "mpfb-clinical-physician-adult",
] as const;
const PHONES = ["O", "U"] as const;

// source: cap55 b1-pick-ruling.md 2026-11-22 (pick.json sha256 prefix a3b531cb)
const ROUNDNESS_THRESHOLD = { O: 0.0667, U: -0.0314 } as const;
// source: pick.json a3b531cb cwDrop.expression (midpoint of 1.47 max P w0.5 drop and 3.15 min PT w0.25 drop)
const DROP_BAR_MM = 2.31;
// source: pick.json a3b531cb cwRise.expression (midpoint of 0.47 max P w0.5 rise and 3.2 min PT w0.75 rise)
const RISE_BAR_MM = 1.835;

const ZERO_PURSE: LipPurseTable = [
  { viseme: "O", key: "mouth-pursing", weight: 0, source: "b1 test zero baseline" },
  { viseme: "O", key: "mouth-protusion", weight: 0, source: "b1 test zero baseline" },
  { viseme: "U", key: "mouth-pursing", weight: 0, source: "b1 test zero baseline" },
  { viseme: "U", key: "mouth-protusion", weight: 0, source: "b1 test zero baseline" },
];

function bothKeysTable(w: number): LipPurseTable {
  return (["mouth-pursing", "mouth-protusion"] as const).flatMap((key) => [
    { viseme: "O" as const, key, weight: w, source: `b1 known-bad both-keys fixture w=${w}` },
    { viseme: "U" as const, key, weight: w, source: `b1 known-bad both-keys fixture w=${w}` },
  ]);
}

/** CW-DROP predicate, called once for the pick (must pass) and for fixtures (must fail). */
function dropPassesMm(dropMm: number): boolean {
  return dropMm <= DROP_BAR_MM;
}

/** CW-RISE predicate, called once for the pick (must pass) and for fixtures (must fail). */
function risePassesMm(riseMm: number): boolean {
  return riseMm <= RISE_BAR_MM;
}

// source: frozen copy of LIP_ROUNDING_TABLE at a4d873c1c (lip-bone-rounding.ts, untouched by B1)
const FROZEN_LIP_ROUNDING_ROWS = [
  { viseme: "O", bone: "oris04.L", channel: "x", fullMm: 6, source: "lb-probe T1-O outer -31.1% hw 0.175 bulge -3.1 lower 0" },
  { viseme: "O", bone: "oris04.R", channel: "x", fullMm: -6, source: "lb-probe T1-O outer -31.1% hw 0.175 bulge -3.1 lower 0" },
  { viseme: "O", bone: "oris01", channel: "z", fullMm: 3, source: "lb-probe T1-O lower-lip forward (oris01 owns lower lip)" },
  { viseme: "O", bone: "oris05", channel: "z", fullMm: 1, source: "lb-probe T1-O bulge at morph floor vs +7.1 at z2.5" },
  { viseme: "U", bone: "oris04.L", channel: "x", fullMm: 6, source: "lb-probe T1-U outer -18.6% hw 0.156 bulge -1.4 lower 0" },
  { viseme: "U", bone: "oris04.R", channel: "x", fullMm: -6, source: "lb-probe T1-U outer -18.6% hw 0.156 bulge -1.4 lower 0" },
  { viseme: "U", bone: "oris01", channel: "z", fullMm: 3, source: "lb-probe T1-U lower-lip forward (oris01 owns lower lip)" },
  { viseme: "U", bone: "oris05", channel: "z", fullMm: 1, source: "lb-probe T1-U bulge at morph floor vs +11.3 at z2.5" },
  { viseme: "CH", bone: "oris04.L", channel: "x", fullMm: 5, source: "lb-probe CH-E outer -18.6% hw 0.173 bulge +2.6 lower 0" },
  { viseme: "CH", bone: "oris04.R", channel: "x", fullMm: -5, source: "lb-probe CH-E outer -18.6% hw 0.173 bulge +2.6 lower 0" },
  { viseme: "CH", bone: "oris01", channel: "z", fullMm: 2, source: "lb-probe CH-E lower-lip forward" },
  { viseme: "CH", bone: "oris05", channel: "z", fullMm: 2, source: "lb-probe CH-E fwd to E plane; z2.5 breaches bulge" },
  { viseme: "RR", bone: "oris04.L", channel: "x", fullMm: 6, source: "lb-probe RR-F outer -12.7% hw 0.131 bulge -1.3 lower 0" },
  { viseme: "RR", bone: "oris04.R", channel: "x", fullMm: -6, source: "lb-probe RR-F outer -12.7% hw 0.131 bulge -1.3 lower 0" },
  { viseme: "RR", bone: "oris01", channel: "z", fullMm: 2, source: "lb-probe RR-F lower-lip forward" },
  { viseme: "RR", bone: "oris05", channel: "z", fullMm: 3, source: "lb-probe RR-F fwd -12 to -8; +4 needs ~+15 bulge" },
] as const;

const scenes = new Map<string, HeadlessScene>();
const laterals = new Map<string, Lateral10>();
const midlines = new Map<string, Midline>();

beforeAll(async () => {
  for (const asset of ASSETS) {
    const scene = await loadHeadlessScene(
      join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${asset}.glb`),
    );
    scenes.set(asset, scene);
    laterals.set(asset, pickLateral10(scene));
    midlines.set(asset, pickMidline(scene));
  }
}, 180_000);

function setup(asset: string): { scene: HeadlessScene; lateral: Lateral10; midline: Midline } {
  const scene = scenes.get(asset);
  const lateral = laterals.get(asset);
  const midline = midlines.get(asset);
  expect(scene, `no scene for ${asset}`).toBeDefined();
  expect(lateral, `no lateral10 for ${asset}`).toBeDefined();
  expect(midline, `no midline for ${asset}`).toBeDefined();
  return { scene: scene!, lateral: lateral!, midline: midline! };
}

function roundnessAt(scene: HeadlessScene, lateral: Lateral10, midline: Midline, ph: string, purse?: LipPurseTable): number {
  // source: sweep.json expressions (roundness = apertureHeightMm / widthMm, driver on)
  return apertureHeightMm(scene, midline, ph, "on", undefined, purse) / widthMm(scene, lateral, ph, "on", undefined, purse);
}

const influenceSnapshots = new Map<string, { body: number[]; teeth: number[] }>();

/** The silence drive every test ends with: restores purse/viseme/bone/jaw writes. */
function silenceScene(asset: string): HeadlessScene {
  const scene = scenes.get(asset);
  expect(scene, `no scene for ${asset}`).toBeDefined();
  applyNamedSpeechVisemes({ root: scene!.root });
  return scene!;
}

function snapshotSceneInfluences(scene: HeadlessScene): { body: number[]; teeth: number[] } {
  return {
    body: [...(scene.body.skinned.morphTargetInfluences ?? [])],
    teeth: [...(scene.teeth?.skinned.morphTargetInfluences ?? [])],
  };
}

function influenceKeyNameOf(dict: Record<string, number> | undefined, index: number): string {
  if (!dict) return "unknown";
  for (const [name, i] of Object.entries(dict)) if (i === index) return name;
  return "unknown";
}

beforeEach(() => {
  // source: HANDBACK-6 A2 — snapshot clean-to-clean. HANDBACK-7 N5: before
  // silence-cleaning, assert the purse keys are already 0 on every body mesh
  // (catches a beforeAll/setup leak instead of scrubbing it silently).
  for (const asset of ASSETS) {
    const scene = scenes.get(asset);
    expect(scene, `no scene for ${asset}`).toBeDefined();
    if (!scene) continue;
    const dict = scene.body.skinned.morphTargetDictionary ?? {};
    const influences = scene.body.skinned.morphTargetInfluences ?? [];
    for (const key of ["mouth-pursing", "mouth-protusion"] as const) {
      const index = dict[key];
      if (typeof index === "number") {
        expect(influences[index], `${asset} beforeEach pre-clean ${key}`).toBe(0);
      }
    }
    const cleaned = silenceScene(asset);
    influenceSnapshots.set(asset, snapshotSceneInfluences(cleaned));
  }
});

afterEach(() => {
  const leaks: string[] = [];
  for (const asset of ASSETS) {
    const scene = scenes.get(asset);
    const before = influenceSnapshots.get(asset);
    expect(scene, `no scene for ${asset}`).toBeDefined();
    expect(before, `no influence snapshot for ${asset}`).toBeDefined();
    if (!scene || !before) continue;
    const parts = [
      {
        label: "body",
        now: scene.body.skinned.morphTargetInfluences,
        prev: before.body,
        dict: scene.body.skinned.morphTargetDictionary as Record<string, number> | undefined,
      },
      {
        label: "teeth",
        now: scene.teeth?.skinned.morphTargetInfluences,
        prev: before.teeth,
        dict: scene.teeth?.skinned.morphTargetDictionary as Record<string, number> | undefined,
      },
    ];
    for (const part of parts) {
      const now = part.now;
      if (!now) continue;
      if (now.length !== part.prev.length) {
        leaks.push(`${asset} ${part.label} length ${now.length} != snapshot ${part.prev.length}`);
        continue;
      }
      now.forEach((value, index) => {
        if (value !== part.prev[index]) {
          leaks.push(
            `${asset} ${part.label} index ${index} key ${influenceKeyNameOf(part.dict, index)}: before=${part.prev[index]} after=${value}`,
          );
        }
      });
    }
  }
  expect(leaks, leaks.length > 0 ? `morph influence leak:\n${leaks.join("\n")}` : "no morph influence leaks").toEqual([]);
});

describe("lip rounding b1 pick", () => {
  it("G1 narrowPct(on, pick) >= 25 on O and U, all 4", () => {
    // source: card G1; sweep-split.json arm P w0.5 min 28.20 (parent U)
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      for (const ph of PHONES) {
        const n = narrowPct(scene, lateral, ph, "on", undefined, LIP_PURSE_TABLE);
        expect(n, `${asset} ${ph} narrowPct on pick ${n.toFixed(2)}`).toBeGreaterThanOrEqual(25);
      }
    }
  }, 180_000);

  it("G2 narrowPct(on) - narrowPct(off) >= 5 pp on O and U, all 4", () => {
    // source: card G2; measured min 10.33 (sweep-split.json arm P w0.5, parent O and U)
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      for (const ph of PHONES) {
        const on = narrowPct(scene, lateral, ph, "on", undefined, LIP_PURSE_TABLE);
        const off = narrowPct(scene, lateral, ph, "off", undefined, LIP_PURSE_TABLE);
        expect(on - off, `${asset} ${ph} delta on ${on.toFixed(2)} off ${off.toFixed(2)}`).toBeGreaterThanOrEqual(5);
      }
    }
  }, 180_000);

  it("G3 roundness(pick) >= pick.json threshold per phoneme", () => {
    // source: pick.json a3b531cb roundnessThreshold O 0.0667 (= 0.3783 min - 0.3116 spread), U -0.0314 (vacuous by the card formula; shape is carried by CW-DROP/CW-RISE, named deviation per b1-pick-ruling.md)
    for (const asset of ASSETS) {
      const { scene, lateral, midline } = setup(asset);
      for (const ph of PHONES) {
        const r = roundnessAt(scene, lateral, midline, ph, LIP_PURSE_TABLE);
        expect(r, `${asset} ${ph} roundness ${r.toFixed(4)}`).toBeGreaterThanOrEqual(ROUNDNESS_THRESHOLD[ph]);
      }
    }
  }, 180_000);

  it("G3b rounder > max(noise, 0.05 x roundness0) on O and U, all 4", () => {
    // source: RULINGS.md R2; noise 0.000 on all 4 (sweep.json), so floor = 0.05 x roundness0 (pick.json a3b531cb g3b)
    for (const asset of ASSETS) {
      const { scene, lateral, midline } = setup(asset);
      for (const ph of PHONES) {
        const r0 = roundnessAt(scene, lateral, midline, ph, ZERO_PURSE);
        const rp = roundnessAt(scene, lateral, midline, ph, LIP_PURSE_TABLE);
        const floor = Math.max(0, 0.05 * r0);
        expect(rp - r0, `${asset} ${ph} rounder ${(rp - r0).toFixed(4)} floor ${floor.toFixed(4)}`).toBeGreaterThan(floor);
      }
    }
  }, 180_000);

  it("CW-DROP lowerDropMm(pick) <= 2.31 on O and U, all 4", () => {
    // source: b1-pick-ruling.md; pick max 1.472 (sweep-split.json arm P w0.5, ob-Aisha O)
    for (const asset of ASSETS) {
      const { scene, midline } = setup(asset);
      for (const ph of PHONES) {
        const drop = lowerDropMm(scene, midline, ph, LIP_PURSE_TABLE);
        expect(dropPassesMm(drop), `${asset} ${ph} lowerDropMm ${drop.toFixed(3)}`).toBe(true);
      }
    }
  }, 180_000);

  for (const w of [0.25, 0.5, 0.75] as const) {
    it(`CW-DROP fixture both-keys w=${w} FAILS on every actor x O/U`, () => {
      // source: sweep-split.json arm PT min 3.146 (parent U w0.25); all PT cells must fail the 2.31 bar
      const table = bothKeysTable(w);
      for (const asset of ASSETS) {
        const { scene, midline } = setup(asset);
        for (const ph of PHONES) {
          const drop = lowerDropMm(scene, midline, ph, table);
          expect(dropPassesMm(drop), `${asset} ${ph} both-keys w=${w} lowerDropMm ${drop.toFixed(3)} must fail`).toBe(false);
        }
      }
    }, 180_000);
  }

  it("CW-RISE upperRiseMm(pick) <= 1.835 on O and U, all 4", () => {
    // source: b1-pick-ruling.md; pick max 0.474 (sweep-split.json arm P w0.5, Kevin O and U)
    for (const asset of ASSETS) {
      const { scene, midline } = setup(asset);
      for (const ph of PHONES) {
        const rise = upperRiseMm(scene, midline, ph, LIP_PURSE_TABLE);
        expect(risePassesMm(rise), `${asset} ${ph} upperRiseMm ${rise.toFixed(3)}`).toBe(true);
      }
    }
  }, 180_000);

  it("CW-RISE fixture k2 both-keys w=0.75 FAILS on every actor x O/U", () => {
    // source: sweep-split.json arm PT min 3.238 = k2 mpfb-ob-patient-aisha U w0.75; all PT w0.75 cells must fail the 1.835 bar
    const table = bothKeysTable(0.75);
    for (const asset of ASSETS) {
      const { scene, midline } = setup(asset);
      for (const ph of PHONES) {
        const rise = upperRiseMm(scene, midline, ph, table);
        expect(risePassesMm(rise), `${asset} ${ph} k2 both-keys w=0.75 upperRiseMm ${rise.toFixed(3)} must fail`).toBe(false);
      }
    }
    // F4: every measurement above ends in clearPose (silence path), so both
    // purse keys are back at 0 on every actor — no leak into the next test.
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      expect(influences[dict["mouth-pursing"]!], `${asset} clearPose mouth-pursing`).toBe(0);
      expect(influences[dict["mouth-protusion"]!], `${asset} clearPose mouth-protusion`).toBe(0);
    }
  }, 180_000);

  it("CW-E |widthMm(E, pick) - widthMm(E, zero)| <= 0.01 mm, all 4", () => {
    // source: purse drive reads O/U weights only, so E is untouched
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      // source: HANDBACK-7 N6 — production wire at E (no purse override):
      // both purse morphs are 0 on all 4.
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      expect(influences[dict["mouth-pursing"]!], `${asset} E mouth-pursing`).toBe(0);
      expect(influences[dict["mouth-protusion"]!], `${asset} E mouth-protusion`).toBe(0);
      applyNamedSpeechVisemes({ root: scene.root });
      const at = widthMm(scene, lateral, "E", "on", undefined, LIP_PURSE_TABLE);
      const zero = widthMm(scene, lateral, "E", "on", undefined, ZERO_PURSE);
      expect(Math.abs(at - zero), `${asset} E width pick vs zero`).toBeLessThanOrEqual(0.01);
    }
  }, 180_000);

  it("CW-ROWS non-O/U drives write nothing and the bone table is frozen", () => {
    // source: lipPurseWeights sums O/U rows only; a4d873c1c LIP_ROUNDING_TABLE rows
    for (const weights of [{ viseme_CH: 1 }, { viseme_RR: 1 }, { viseme_PP: 1 }, { viseme_FF: 1 }, { viseme_E: 1 }]) {
      expect(lipPurseWeights(weights, LIP_PURSE_TABLE)).toEqual({});
    }
    expect([...LIP_ROUNDING_TABLE]).toEqual([...FROZEN_LIP_ROUNDING_ROWS]);
  });

  it("CW-Z with a zero table, G1 is false on at least one of O/U on every actor", () => {
    // source: w0 U 20.69 parent / 21.25 ob-Aisha / 24.21 kevin / 21.62 physician (sweep-split.json arm P w0)
    for (const asset of ASSETS) {
      const { scene, lateral } = setup(asset);
      const o = narrowPct(scene, lateral, "O", "on", undefined, ZERO_PURSE);
      const u = narrowPct(scene, lateral, "U", "on", undefined, ZERO_PURSE);
      if (asset === "mpfb-peds-nurse-kevin") {
        const after = narrowPct(scene, lateral, "U", "on", undefined, LIP_PURSE_TABLE);
        // eslint-disable-next-line no-console
        console.log(`CW-Z kevin U narrowPct before(zero)=${u.toFixed(2)} after(pick)=${after.toFixed(2)}`);
      }
      expect(o >= 25 && u >= 25, `${asset} zero-table G1 must fail on O ${o.toFixed(2)} or U ${u.toFixed(2)}`).toBe(false);
    }
  }, 180_000);

  it("CW-WIRE production wire drives mouth-pursing at O/U and clears at E/silence", () => {
    // source: HANDBACK-5 F2/F3; default table, no instrument override: purse is
    // written beside the lip bones from the post-dynamics weights, and every
    // table key the mesh carries is written (0 when not driven), so E and
    // silence clear a previous O/U frame.
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      const pursing = dict["mouth-pursing"];
      const protusion = dict["mouth-protusion"];
      expect(typeof pursing, `${asset} body mesh carries mouth-pursing`).toBe("number");
      expect(typeof protusion, `${asset} body mesh carries mouth-protusion`).toBe("number");
      const drive = (phonemes: readonly string[]) =>
        applyNamedSpeechVisemes(
          { root: scene.root, activeSpeech: { phonemeSequence: phonemes, startedAtMs: 0, durationMs: 1000 } },
          500,
        );
      for (const ph of PHONES) {
        const result = drive([ph]);
        const scales = lipRoundingScales(result.weights);
        const expected = 0.5 * (ph === "O" ? scales.O : scales.U);
        expect(expected, `${asset} ${ph} enveloped O/U drive`).toBeGreaterThan(0);
        expect(influences[pursing!], `${asset} ${ph} mouth-pursing`).toBeCloseTo(expected, 6);
        expect(influences[protusion!], `${asset} ${ph} mouth-protusion`).toBe(0);
      }
      // source: HANDBACK-7 N4 — silence directly after U (no E step between):
      // pursing goes 0.5-scale -> 0.
      {
        const uResult = drive(["U"]);
        const uScales = lipRoundingScales(uResult.weights);
        const uExpected = 0.5 * uScales.U;
        expect(uExpected, `${asset} U re-drive enveloped drive`).toBeGreaterThan(0);
        expect(influences[pursing!], `${asset} U re-drive mouth-pursing`).toBeCloseTo(uExpected, 6);
        applyNamedSpeechVisemes({ root: scene.root });
        expect(influences[pursing!], `${asset} U->silence mouth-pursing`).toBe(0);
        expect(influences[protusion!], `${asset} U->silence mouth-protusion`).toBe(0);
      }
      drive(["E"]);
      expect(influences[pursing!], `${asset} E mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} E mouth-protusion`).toBe(0);
      applyNamedSpeechVisemes({ root: scene.root });
      expect(influences[pursing!], `${asset} silence mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} silence mouth-protusion`).toBe(0);
    }
  }, 180_000);

  it("CW-SCALAR scalar path clears a stale named-U purse (0.6 and 0)", () => {
    // source: HANDBACK-7 N2/P-h — applyGeneratedScalarVisemeToRoot writes the
    // purse on both return paths; AA/sil carry no O/U so both write 0.
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      const pursing = dict["mouth-pursing"];
      const protusion = dict["mouth-protusion"];
      expect(typeof pursing, `${asset} body mesh carries mouth-pursing`).toBe("number");
      expect(typeof protusion, `${asset} body mesh carries mouth-protusion`).toBe("number");
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["U"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      expect(influences[pursing!], `${asset} named U mouth-pursing`).toBeGreaterThan(0);
      applyGeneratedScalarVisemeToRoot(scene.root, 0.6);
      expect(influences[pursing!], `${asset} scalar 0.6 mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} scalar 0.6 mouth-protusion`).toBe(0);
      applyGeneratedScalarVisemeToRoot(scene.root, 0);
      expect(influences[pursing!], `${asset} scalar 0 mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} scalar 0 mouth-protusion`).toBe(0);
      applyNamedSpeechVisemes({ root: scene.root });
    }
  }, 180_000);

  it("CW-DYN O->E dynamics transition purses from post-dynamics weights", () => {
    // source: HANDBACK-6 A1 (cap56 R10 C2) — production media path with baked
    // O->E cues and mediaPositionSeconds stepping across the boundary; per
    // frame the purse must equal clamp(0.5 x lipRoundingScales(driven).O),
    // where driven is the post-dynamics weights the lip bones read.
    const cues = [
      { phoneme: "O", atSecond: 0, durationSeconds: 0.5 },
      { phoneme: "E", atSecond: 0.5, durationSeconds: 0.5 },
    ];
    const frames = Array.from({ length: 30 }, (_, n) => (n + 0.5) / 30);
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      const pursing = dict["mouth-pursing"];
      const protusion = dict["mouth-protusion"];
      expect(typeof pursing, `${asset} body mesh carries mouth-pursing`).toBe("number");
      expect(typeof protusion, `${asset} body mesh carries mouth-protusion`).toBe("number");
      let blend = 0;
      frames.forEach((mediaS, n) => {
        const driven = applyNamedSpeechVisemes({
          root: scene.root,
          activeSpeech: { phonemeSequence: ["sil"], startedAtMs: 0, durationMs: 1000, bakedCues: cues },
          mediaPositionSeconds: () => mediaS,
        });
        const scales = lipRoundingScales(driven.weights);
        const expected = Math.min(1, Math.max(0, 0.5 * scales.O));
        const actual: number = influences[pursing!]!;
        expect(
          Math.abs(actual - expected),
          `${asset} frame ${n} mediaS ${mediaS.toFixed(4)} mouth-pursing actual ${actual} expected ${expected}`,
        ).toBeLessThanOrEqual(1e-6);
        expect(influences[protusion!]!, `${asset} frame ${n} mouth-protusion`).toBe(0);
        if (actual > 0 && actual < 0.5) blend += 1;
        if (asset === ASSETS[0]) {
          // eslint-disable-next-line no-console
          console.log(
            `CW-DYN ${asset} n=${n} mediaS=${mediaS.toFixed(4)} scalesO=${scales.O.toFixed(6)} expected=${expected.toFixed(6)} actual=${actual.toFixed(6)} protusion=${influences[protusion!]!}`,
          );
        }
      });
      // eslint-disable-next-line no-console
      console.log(`CW-DYN ${asset} blend frames 0<pursing<0.5: ${blend}`);
      expect(blend, `${asset} blend frames 0 < pursing < 0.5`).toBeGreaterThanOrEqual(3);
      applyNamedSpeechVisemes({ root: scene.root });
    }
  }, 180_000);

  it("CW-TABLE LIP_PURSE_TABLE is the cap55 pick (pursing 0.5, protusion 0)", () => {
    // source: pick.json a3b531cb table; WHY:: protusion 0.05 clears every
    // geometric gate (Codex measured), so only an exact-table assertion holds the pick.
    expect(LIP_PURSE_TABLE).toHaveLength(4);
    expect(Object.fromEntries(LIP_PURSE_TABLE.map((row) => [`${row.viseme}:${row.key}`, row.weight]))).toEqual({
      "O:mouth-pursing": 0.5,
      "O:mouth-protusion": 0,
      "U:mouth-pursing": 0.5,
      "U:mouth-protusion": 0,
    });
  });

  it("instrument assertPositiveSpan and pickLateral10 distinctness stay in force", () => {
    // source: C1 crossed-corner probe (kevin U -21.69 mm); lateral-10 needs 10 distinct ids per side
    expect(assertPositiveSpan(46.6)).toBe(46.6);
    expect(() => assertPositiveSpan(-21.69)).toThrow("not a positive finite width");
    for (const asset of ASSETS) {
      const { lateral } = setup(asset);
      expect(new Set(lateral.lo).size).toBe(10);
      expect(new Set(lateral.hi).size).toBe(10);
      expect(lateral.lo.some((v) => lateral.hi.includes(v))).toBe(false);
    }
  });
});
