/**
 * Lip-rounding B2 honest close (card tsk_b9bd157966e5efb4, aisha-parity).
 *
 * honest close: cap56 pick s=1 (b2/pick.json sha256 prefix 68bdb2c2), no table change;
 * G1/CW-DROP/CW-RISE/CW-E at the unchanged table are proven by lip-rounding-b1.test.ts.
 * HB1 review hardening: protusion seeding (F1), positive E/silence-path output
 * asserts (F2), all-mesh leak snapshot (F3), toStrictEqual arrays (F4), full
 * viseme_* CW-ROWS sweep (F5).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyGeneratedScalarVisemeToRoot,
  applyNamedSpeechVisemes,
  LIP_PURSE_TABLE,
  LIP_ROUNDING_TABLE,
  lipPurseWeights,
} from "@openclinxr/xr-dialogue/package-viseme";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type HeadlessScene, loadHeadlessScene } from "./headless-scene.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const ASSETS = [
  "mpfb-peds-parent-aisha",
  "mpfb-ob-patient-aisha",
  "mpfb-peds-nurse-kevin",
  "mpfb-clinical-physician-adult",
] as const;

// source: b2/pick.json sha256 68bdb2c2 (cap56 2026-11-22)
const PICK_S = 1;

// source: LIP_ROUNDING_TABLE at 994236365
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

beforeAll(async () => {
  for (const asset of ASSETS) {
    const scene = await loadHeadlessScene(
      join(REPO_ROOT, `apps/ui-xr/public/generated-humanoids/${asset}.glb`),
    );
    scenes.set(asset, scene);
  }
}, 180_000);

function setup(asset: string): { scene: HeadlessScene } {
  const scene = scenes.get(asset);
  expect(scene, `no scene for ${asset}`).toBeDefined();
  return { scene: scene! };
}

type MorphCarrierState = {
  dict: Record<string, number> | undefined;
  values: number[];
};

/**
 * F3: snapshot EVERY mesh under the root carrying morphTargetInfluences
 * (body + teeth + the parent-Aisha tongue, which carries viseme_TH and is
 * visited by the runtime), keyed by mesh name + occurrence index.
 */
function snapshotAllMorphs(scene: HeadlessScene): Map<string, MorphCarrierState> {
  const out = new Map<string, MorphCarrierState>();
  const seen = new Map<string, number>();
  scene.root.traverse((object) => {
    const mesh = object as {
      name?: string;
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    } | null;
    if (!Array.isArray(mesh?.morphTargetInfluences)) return;
    const name = typeof mesh?.name === "string" && mesh.name ? mesh.name : "unnamed";
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    out.set(`${name}#${n}`, {
      dict: mesh?.morphTargetDictionary,
      values: [...(mesh?.morphTargetInfluences ?? [])],
    });
  });
  return out;
}

const influenceSnapshots = new Map<string, Map<string, MorphCarrierState>>();

/** The silence drive every test ends with: restores purse/viseme/bone/jaw writes. */
function silenceScene(asset: string): HeadlessScene {
  const scene = scenes.get(asset);
  expect(scene, `no scene for ${asset}`).toBeDefined();
  applyNamedSpeechVisemes({ root: scene!.root });
  return scene!;
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
    influenceSnapshots.set(asset, snapshotAllMorphs(cleaned));
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
    const now = snapshotAllMorphs(scene);
    for (const [key, prev] of before) {
      const cur = now.get(key);
      if (!cur) {
        leaks.push(`${asset} ${key}: mesh present at snapshot, missing after test`);
        continue;
      }
      try {
        // F4: strict array equality — a missing array or sparse slot must fail.
        expect(cur.values).toStrictEqual(prev.values);
      } catch {
        if (cur.values.length !== prev.values.length) {
          leaks.push(`${asset} ${key}: length ${cur.values.length} != snapshot ${prev.values.length}`);
          continue;
        }
        cur.values.forEach((value, index) => {
          if (value !== prev.values[index]) {
            leaks.push(
              `${asset} ${key} index ${index} key ${influenceKeyNameOf(cur.dict, index)}: before=${prev.values[index]} after=${value}`,
            );
          }
        });
      }
    }
    for (const key of now.keys()) {
      if (!before.has(key)) leaks.push(`${asset} ${key}: mesh appeared after test`);
    }
  }
  expect(leaks, leaks.length > 0 ? `morph influence leak:\n${leaks.join("\n")}` : "no morph influence leaks").toEqual([]);
});

describe("lip rounding b2 honest close", () => {
  it("CW-TABLE-OU O/U oris04 x rows pin the s=1 pick", () => {
    const failMsg =
      "B2 graded s=1.5/2.0 as midline collapse (philtrum diamond hole parent-aisha O, midline fold kevin U; b2/pick.json 68bdb2c2). Do not widen the O/U oris04 x rows without a new graded sweep.";
    for (const ph of ["O", "U"] as const) {
      const rowL = LIP_ROUNDING_TABLE.find((row) => row.viseme === ph && row.bone === "oris04.L" && row.channel === "x");
      const rowR = LIP_ROUNDING_TABLE.find((row) => row.viseme === ph && row.bone === "oris04.R" && row.channel === "x");
      expect(rowL, `${ph} oris04.L x row present. ${failMsg}`).toBeDefined();
      expect(rowR, `${ph} oris04.R x row present. ${failMsg}`).toBeDefined();
      expect(rowL!.fullMm, `${ph} oris04.L x fullMm. ${failMsg}`).toBe(6 * PICK_S);
      expect(rowR!.fullMm, `${ph} oris04.R x fullMm. ${failMsg}`).toBe(-6 * PICK_S);
    }
  });

  it("CW-TABLE-FROZEN bone and purse tables are unchanged at the s=1 pick", () => {
    expect([...LIP_ROUNDING_TABLE]).toEqual([...FROZEN_LIP_ROUNDING_ROWS]);
    expect(LIP_PURSE_TABLE).toHaveLength(4);
    expect(Object.fromEntries(LIP_PURSE_TABLE.map((row) => [`${row.viseme}:${row.key}`, row.weight]))).toEqual({
      "O:mouth-pursing": 0.5,
      "O:mouth-protusion": 0,
      "U:mouth-pursing": 0.5,
      "U:mouth-protusion": 0,
    });
  });

  it("CW-ROWS non-O/U drives write nothing", () => {
    for (const weights of [{ viseme_CH: 1 }, { viseme_RR: 1 }, { viseme_PP: 1 }, { viseme_FF: 1 }, { viseme_E: 1 }]) {
      expect(lipPurseWeights(weights, LIP_PURSE_TABLE)).toEqual({});
    }
    // F5: every other viseme_* key the parent-Aisha body carries, each at
    // weight 1, writes nothing. Excluded: O/U and the lipRoundingScales
    // rounded aliases (lipRoundingScales in lip-bone-rounding.ts groups o/oh, u/ou, ch, rr).
    const parent = scenes.get("mpfb-peds-parent-aisha");
    expect(parent, "no scene for mpfb-peds-parent-aisha").toBeDefined();
    const dict = parent!.body.skinned.morphTargetDictionary ?? {};
    const rounded = new Set(["o", "oh", "u", "ou", "ch", "rr"]);
    const others = Object.keys(dict).filter((name) => {
      const lower = name.toLowerCase();
      if (!lower.startsWith("viseme_")) return false;
      return !rounded.has(lower.slice("viseme_".length));
    });
    expect(others.length, "parent-Aisha non-rounding viseme_* keys").toBeGreaterThan(5);
    for (const key of others) {
      expect(lipPurseWeights({ [key]: 1 }, LIP_PURSE_TABLE), `lipPurseWeights({${key}:1})`).toEqual({});
    }
  });

  it("P3-a U->E direct clears a stale named-U purse", () => {
    // source: B1 Codex pass 3 P3-a, PROOF-REPORT-b1.md: CW-WIRE drove E only after silence cleared U
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      const pursing = dict["mouth-pursing"];
      const protusion = dict["mouth-protusion"];
      const visemeE = dict["viseme_E"];
      expect(typeof pursing, `${asset} body mesh carries mouth-pursing`).toBe("number");
      expect(typeof protusion, `${asset} body mesh carries mouth-protusion`).toBe("number");
      expect(typeof visemeE, `${asset} body mesh carries viseme_E`).toBe("number");
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["U"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      expect(influences[pursing!], `${asset} U mouth-pursing`).toBeGreaterThan(0);
      // F1 (seed so the clear is observable): the U row leaves protusion at 0,
      // so a runtime that skips the protusion write would still pass without this.
      influences[protusion!] = 0.3;
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      // F2: the E frame itself must be live on the mesh (rules out an E drive
      // that falls back to silence — silence also clears the purse).
      expect(influences[visemeE!], `${asset} U->E live viseme_E`).toBeGreaterThan(0);
      expect(influences[pursing!], `${asset} U->E mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} U->E mouth-protusion`).toBe(0);
      applyNamedSpeechVisemes({ root: scene.root });
    }
  }, 180_000);

  it("P3-b scalar 0 direct clears a stale named-U purse", () => {
    // source: B1 Codex pass 3 P3-b: CW-SCALAR ran scalar 0 only after 0.6 had cleared U
    for (const asset of ASSETS) {
      const { scene } = setup(asset);
      const dict = scene.body.skinned.morphTargetDictionary ?? {};
      const influences = scene.body.skinned.morphTargetInfluences ?? [];
      const pursing = dict["mouth-pursing"];
      const protusion = dict["mouth-protusion"];
      const visemeSil = dict["viseme_sil"];
      const visemeAa = dict["viseme_aa"];
      expect(typeof pursing, `${asset} body mesh carries mouth-pursing`).toBe("number");
      expect(typeof protusion, `${asset} body mesh carries mouth-protusion`).toBe("number");
      expect(typeof visemeSil, `${asset} body mesh carries viseme_sil`).toBe("number");
      expect(typeof visemeAa, `${asset} body mesh carries viseme_aa`).toBe("number");
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["U"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      expect(influences[pursing!], `${asset} named U mouth-pursing`).toBeGreaterThan(0);
      // F1 (seed so the clear is observable): the U row leaves protusion at 0,
      // so a runtime that skips the protusion write would still pass without this.
      influences[protusion!] = 0.3;
      applyGeneratedScalarVisemeToRoot(scene.root, 0);
      // F2: scalar 0 takes the unscaled branch (applyGeneratedScalarVisemeToRoot in viseme-runtime-wire.ts):
      // phoneme "sil" carries no O/U so the purse write clears, and the
      // written frame is viseme_sil at the mesh half gain (0.5), viseme_aa 0.
      expect(influences[visemeSil!], `${asset} scalar 0 live viseme_sil`).toBeCloseTo(0.5, 6);
      expect(influences[visemeAa!], `${asset} scalar 0 viseme_aa`).toBe(0);
      expect(influences[pursing!], `${asset} scalar 0 mouth-pursing`).toBe(0);
      expect(influences[protusion!], `${asset} scalar 0 mouth-protusion`).toBe(0);
      applyNamedSpeechVisemes({ root: scene.root });
    }
  }, 180_000);
});
