import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jawOpenRadiansForPhoneme } from "./viseme-timeline.js";
import {
  applyDialogueVisemeTimelineToRoot,
  applyGeneratedScalarVisemeToRoot,
  applyNamedSpeechVisemes,
  collectMorphTargetNames,
  JAW_TEETH_GAIN,
  LIP_VISEME_GAIN,
  mapDialoguePhonemeToArkit,
  mouthCuesToPhonemeCues,
  sampleLiveVisemeInfluencesFromRoot,
} from "./viseme-runtime-wire.js";

/** Mirrors shipped peds_patient_child.glb: viseme_* not at index 0. */
function meshLike() {
  return {
    name: "Body",
    morphTargetDictionary: {
      basis_neutral: 0,
      openclinxr_mouth_open: 1,
      viseme_silence: 2,
      viseme_AA: 3,
      viseme_E: 4,
      viseme_OH: 5,
      viseme_OU: 6,
    },
    morphTargetInfluences: [0, 0, 0, 0, 0, 0, 0],
  };
}

function rootWith(mesh: {
  name: string;
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
}) {
  return {
    userData: {} as Record<string, unknown>,
    traverse(callback: (object: unknown) => void) {
      callback(mesh);
    },
  };
}

type Step3Cue = { phoneme: string; atSecond: number; durationSeconds: number; intensity: number };

/** Canonical step3 cue track (docs/openclinxr/mouth-dynamics/step3/metrics.json). */
const step3Cues: Step3Cue[] = (() => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../docs/openclinxr/mouth-dynamics/step3/metrics.json",
  );
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    canonicalTrack: { startS: number; endS: number; viseme: string; intensity: number }[];
  };
  return raw.canonicalTrack.map((cue) => ({
    phoneme: cue.viseme,
    atSecond: cue.startS,
    durationSeconds: cue.endS - cue.startS,
    intensity: cue.intensity,
  }));
})();

function step3Cue(phoneme: string): Step3Cue {
  const cue = step3Cues.find((entry) => entry.phoneme === phoneme);
  if (!cue) throw new Error(`step3 track has no ${phoneme} cue`);
  return cue;
}

/** 30 fps frame-centre media instant, matching the followers' mid-tick convention. */
function frameMediaS(n: number): number {
  return (n + 0.5) / 30;
}

/** Jaw vowel set (viseme-jaw-dynamics.ts VOWELS, OVR spellings). */
const JAW_VOWELS = new Set(["aa", "E", "I", "O", "U"]);

/** Fixture mesh carrying every step3 viseme target (never a viseme at index 0). */
function step3MeshLike() {
  const names = [
    "basis_neutral",
    "viseme_silence",
    "viseme_sil",
    "viseme_aa",
    "viseme_DD",
    "viseme_nn",
    "viseme_E",
    "viseme_PP",
    "viseme_FF",
    "viseme_O",
    "viseme_SS",
    "viseme_TH",
  ];
  return {
    name: "Body",
    morphTargetDictionary: Object.fromEntries(names.map((name, index) => [name, index])),
    morphTargetInfluences: names.map(() => 0),
  };
}

type Step3Drive = { weights: Record<string, number>; jawFraction: number; tag: unknown };

/** Full prepared-audio-clock runtime drive at one media instant. */
function driveAt(mediaS: number): Step3Drive {
  const mesh = step3MeshLike();
  const jaw = { name: "jaw", isBone: true, rotation: { x: 0 }, userData: {} as Record<string, unknown> };
  const root = {
    userData: {} as Record<string, unknown>,
    traverse(callback: (object: unknown) => void) {
      callback(mesh);
      callback(jaw);
    },
  };
  applyNamedSpeechVisemes({
    root,
    activeSpeech: { phonemeSequence: ["sil"], startedAtMs: 0, durationMs: 4130, bakedCues: step3Cues },
    mediaPositionSeconds: () => mediaS,
  });
  const tag = root.userData.openClinXrNamedVisemeDrive as
    | { weights?: Record<string, number>; jawFraction?: number }
    | undefined;
  return { weights: { ...(tag?.weights ?? {}) }, jawFraction: tag?.jawFraction ?? NaN, tag };
}

describe("viseme runtime wire (#63) — driver → applier → mesh", () => {  it("maps dialogue vowels to ARKit tokens that land on real viseme_* targets", () => {
    expect(mapDialoguePhonemeToArkit("a")).toBe("AA");
    expect(mapDialoguePhonemeToArkit("e")).toBe("E");
    expect(mapDialoguePhonemeToArkit("sil")).toBe("sil");
  });

  it("applies changing named viseme weights across a phoneme timeline (not index 0)", () => {
    const mesh = meshLike();
    const root = rootWith(mesh);
    const phonemes = ["sil", "a", "e", "o", "sil"];

    const mid = applyDialogueVisemeTimelineToRoot(root, {
      phonemeSequence: phonemes,
      progress: 0.3,
    });
    expect(mid.activeTargetName).toMatch(/^viseme_/);
    expect(mid.influence).toBeGreaterThanOrEqual(0.5);
    expect(mesh.morphTargetInfluences[0]).toBe(0);

    const later = applyDialogueVisemeTimelineToRoot(root, {
      phonemeSequence: phonemes,
      progress: 0.55,
    });
    expect(later.activeTargetName).toMatch(/^viseme_/);
    expect(later.activeTargetName).not.toBe(mid.activeTargetName);

    const live = sampleLiveVisemeInfluencesFromRoot(root);
    const hot = live.filter((s) => s.influence >= 0.5);
    expect(hot.length).toBeGreaterThan(0);
    expect(hot[0]?.targetName.startsWith("viseme_")).toBe(true);
  });

  it("plays body visemes, teeth visemes, and the jaw bone at half strength", () => {
    const body = meshLike();
    const teeth = {
      name: "openclinxr_fitted_teeth_mpfb",
      morphTargetDictionary: { viseme_AA: 0, viseme_E: 1 },
      morphTargetInfluences: [0, 0],
    };
    const jaw = {
      name: "jaw",
      isBone: true,
      rotation: { x: 0.1 },
      userData: {} as Record<string, unknown>,
    };
    const root = {
      userData: {} as Record<string, unknown>,
      traverse(callback: (object: unknown) => void) {
        callback(body);
        callback(teeth);
        callback(jaw);
      },
    };
    const result = applyDialogueVisemeTimelineToRoot(root, {
      phonemeSequence: ["AA"],
      progress: 0,
    });
    const drivenJaw = Number(jawOpenRadiansForPhoneme("AA").toFixed(6));
    expect(body.morphTargetInfluences[body.morphTargetDictionary.viseme_AA]!).toBe(LIP_VISEME_GAIN);
    expect(teeth.morphTargetInfluences[0]).toBe(JAW_TEETH_GAIN);
    expect(result.jawOpenRadians).toBeCloseTo(drivenJaw * JAW_TEETH_GAIN, 5);
    expect(jaw.rotation.x).toBeCloseTo(0.1 + drivenJaw * JAW_TEETH_GAIN, 5);
  });

  it("generated scalar path uses named AA, not influences[0]", () => {
    const mesh = meshLike();
    const root = rootWith(mesh);
    applyGeneratedScalarVisemeToRoot(root, 0.8);
    expect(mesh.morphTargetInfluences[0]).toBe(0);
    expect(mesh.morphTargetInfluences[3]).toBeCloseTo(0.8);
  });

  it("named speech path advances with progress and collects mesh target names", () => {
    const mesh = meshLike();
    const root = rootWith(mesh);
    const names = collectMorphTargetNames(root);
    expect(names).toContain("viseme_AA");

    const result = applyNamedSpeechVisemes(
      {
        root,
        activeSpeech: {
          phonemeSequence: ["a", "e", "o", "u"],
          startedAtMs: 0,
          durationMs: 1000,
        },
      },
      600,
    );
    expect(result.frameCount).toBe(4);
    expect(result.activeTargetName).toMatch(/^viseme_/);
    expect(result.influence).toBeGreaterThanOrEqual(0.5);
  });

  /** MPFB FACS rail: no `viseme_*` names, mouth action units only (mirrors the shipped actors, #353). */
  function mpfbMeshLike() {
    return {
      name: "Body",
      morphTargetDictionary: {
        "mouth-compression": 0,
        "mouth-open": 1,
        "mouth-retraction": 2,
        "mouth-part-later": 3,
        "mouth-eversion": 4,
        "mouth-protusion": 5,
        "mouth-elevation": 6,
        "mouth-parling": 7,
      },
      morphTargetInfluences: [0, 0, 0, 0, 0, 0, 0, 0],
    };
  }

  it("drives an MPFB FACS-only body through the alias map — no viseme_* names on the mesh (#353)", () => {
    const mesh = mpfbMeshLike();
    const root = rootWith(mesh);
    const phonemes = ["sil", "a", "e", "o", "u", "sil"];

    // frame 1 of 6 -> "a" -> AA -> mouth-open via the FACS alias map
    const aa = applyDialogueVisemeTimelineToRoot(root, {
      phonemeSequence: phonemes,
      progress: 0.3,
    });
    expect(aa.activeTargetName).toBe("viseme_AA");
    expect(aa.influence).toBeGreaterThanOrEqual(0.5);
    // #460: the parent carries no viseme_AA, so AA maps onto mouth-open — capped at 0.3, the
    // last weight where the face survives (#459 sweep: 0.6 DEGRADING, 1.0 UNACCEPTABLE).
    expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary["mouth-open"]!]).toBe(0.3);

    // frame 3 of 6 -> "o" -> OH -> mouth-eversion; the previous viseme's target returns to 0
    const oh = applyDialogueVisemeTimelineToRoot(root, {
      phonemeSequence: phonemes,
      progress: 0.55,
    });
    expect(oh.activeTargetName).toBe("viseme_OH");
    expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary["mouth-open"]!]).toBe(0);
    expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary["mouth-eversion"]!]).toBe(1);
  });

  describe("#722 — baked Rhubarb cue timeline drives the same wire", () => {
    /** Representative slice of the baked ed_stroke_alert_handoff_v1 timeline (25 cues, 3.71 s). */
    const bakedDoc = {
      metadata: { duration: 3.71 },
      mouthCues: [
        { start: 0.0, end: 0.04, value: "X" },
        { start: 0.04, end: 0.12, value: "A" },
        { start: 0.12, end: 0.18, value: "C" },
        { start: 0.18, end: 0.31, value: "B" },
        { start: 0.31, end: 0.38, value: "C" },
        { start: 0.38, end: 0.45, value: "B" },
      ],
    };

    it("mouthCuesToPhonemeCues preserves the bake's real timing and maps Rhubarb shapes", () => {
      // Old pin (A->AA, B->E) encoded the misread Rhubarb table; the README reads A closed
      // lips (PP), B clenched teeth (SS), C open mouth (E).
      const cues = mouthCuesToPhonemeCues(bakedDoc);
      expect(cues).toHaveLength(6);
      expect(cues[0]).toMatchObject({ phoneme: "sil", atSecond: 0, durationSeconds: 0.04 });
      expect(cues[1]).toMatchObject({ phoneme: "PP", atSecond: 0.04, durationSeconds: 0.08 });
      expect(cues[2]).toMatchObject({ phoneme: "E", atSecond: 0.12 });
      expect(cues[3]).toMatchObject({ phoneme: "SS", atSecond: 0.18, durationSeconds: 0.13 });
    });

    it("applyDialogueVisemeTimelineToRoot with bakedCues plays the baked frame count on named targets", () => {
      // Old pin (B->viseme_E) encoded the misread Rhubarb table. Under the README map the bake
      // is sil,PP,E,SS,E,SS; the fixture mesh carries viseme_silence/AA/E/OH/OU only, so the C
      // (E) frame drives viseme_E and the B (SS) frame honestly resolves to nothing on this mesh.
      const mesh = meshLike();
      const root = rootWith(mesh);
      const cues = mouthCuesToPhonemeCues(bakedDoc);
      const eFrame = applyDialogueVisemeTimelineToRoot(root, {
        phonemeSequence: ["sil"],
        progress: 0.3, // t = 0.3 * 0.45 s -> the C frame (E) is active
        bakedCues: cues,
      });
      expect(eFrame.frameCount).toBe(6);
      expect(eFrame.activeTargetName).toBe("viseme_E");
      expect(mesh.morphTargetInfluences[mesh.morphTargetDictionary.viseme_E!]).toBe(LIP_VISEME_GAIN);
      const ssFrame = applyDialogueVisemeTimelineToRoot(root, {
        phonemeSequence: ["sil"],
        progress: 0.5, // t = 0.5 * 0.45 s -> the B frame (SS); no SS target on this mesh
        bakedCues: cues,
      });
      expect(ssFrame.activeTargetName).toBeNull();
      const later = applyDialogueVisemeTimelineToRoot(root, {
        phonemeSequence: ["sil"],
        progress: 0.75, // t = 0.75 * 0.45 s -> the second C (E) frame per the bake
        bakedCues: cues,
      });
      expect(later.activeTargetName).toBe("viseme_E");
    });

    it("applyNamedSpeechVisemes prefers bakedCues over the text-derived timeline", () => {
      // Old pin sampled nowMs 500 (the B frame, then viseme_E). Under the README map the bake
      // is sil,PP,E,SS,E,SS over 0.45 s; nowMs 300 lands on the C (E) frame, which this mesh
      // carries, so the wire still drives a named target from baked timing, not text dwell.
      const mesh = meshLike();
      const root = rootWith(mesh);
      const cues = mouthCuesToPhonemeCues(bakedDoc);
      const result = applyNamedSpeechVisemes(
        {
          root,
          activeSpeech: {
            phonemeSequence: ["a", "e", "o", "u"],
            startedAtMs: 0,
            durationMs: 1000,
            bakedCues: cues,
          },
        },
        300,
      );
      expect(result.frameCount).toBe(cues.length);
      expect(result.activeTargetName).toMatch(/^viseme_/);
      expect(mesh.morphTargetInfluences[0]).toBe(0); // never index 0
    });

    it("per-channel cue leads put PP closure onset within one frame of its cue", () => {
      // Step3 track (docs/openclinxr/mouth-dynamics/step3/metrics.json), driven
      // through the prepared-audio clock path (applyNamedSpeechVisemes with a
      // media clock), sampled at 30 fps frame centres (n+0.5)/30. Leads:
      // jaw 2/6 s, ordinary lip 2/14 s, PP snap 0, FF/TH deadline D/6.
      // Closure = PP applied weight >= 0.9 (snap writes exactly 1 = sealed).
      const pp = step3Cue("PP");
      const cueFrame = Math.floor(pp.atSecond * 30);
      let onset = -1;
      for (let n = cueFrame - 10; n <= cueFrame + 10; n += 1) {
        if ((driveAt(frameMediaS(n)).weights.viseme_PP ?? 0) >= 0.9) { onset = n; break; }
      }
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      expect(driveAt(frameMediaS(cueFrame - 1)).weights.viseme_PP ?? 0).toBeLessThan(0.9);
      expect(driveAt((pp.atSecond + pp.atSecond + (pp.durationSeconds ?? 0)) / 2).weights.viseme_PP ?? 0).toBeGreaterThanOrEqual(0.9);
    });

    it("per-channel cue leads put FF contact onset within one frame of its cue", () => {
      // Contact = FF applied weight >= 0.95, the 0.5 mm edge-gap proxy (x=5.5
      // centres at 0.947 with a 0.51 mm gap; x=6.0 centres at ~0.97 inside the
      // gate). Centre weight stays >= 0.9.
      const ff = step3Cue("FF");
      const cueFrame = Math.floor(ff.atSecond * 30);
      let onset = -1;
      for (let n = cueFrame - 10; n <= cueFrame + 10; n += 1) {
        if ((driveAt(frameMediaS(n)).weights.viseme_FF ?? 0) >= 0.95) { onset = n; break; }
      }
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      expect(driveAt(frameMediaS(cueFrame - 1)).weights.viseme_FF ?? 0).toBeLessThan(0.95);
      const centreS = ff.atSecond + (ff.durationSeconds ?? 0) / 2;
      expect(driveAt(centreS).weights.viseme_FF ?? 0).toBeGreaterThanOrEqual(0.9);
    });

    it("per-channel cue leads open the jaw within one frame of the first vowel after PP", () => {
      // Onset = jawFraction >= 0.05 at/after the vowel cue start. The jaw
      // reads 0 through both PP media frames, so it opens only after the
      // preceding closure ends: w stays 6.
      const pp = step3Cue("PP");
      const ppEnd = pp.atSecond + (pp.durationSeconds ?? 0);
      const vowel = step3Cues.find((cue) => cue.atSecond >= ppEnd - 1e-9 && JAW_VOWELS.has(cue.phoneme));
      expect(vowel).toBeDefined();
      const cueFrame = Math.floor((vowel?.atSecond ?? 0) * 30);
      expect(driveAt(frameMediaS(cueFrame - 1)).jawFraction ?? NaN).toBe(0);
      expect(driveAt(frameMediaS(cueFrame)).jawFraction ?? NaN).toBe(0);
      let onset = -1;
      for (let n = cueFrame; n <= cueFrame + 10; n += 1) {
        if ((driveAt(frameMediaS(n)).jawFraction ?? 0) >= 0.05) { onset = n; break; }
      }
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      expect(driveAt(1.4).tag).toMatchObject({ jawDynamics: "canonical_ovr_fixed_step_critical_spring", lipDynamics: "canonical_ovr_fixed_step_critical_follower" });
    });
  });
});
