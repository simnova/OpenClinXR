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
  JAW_OPEN_TEETH_CLEAR_RADIANS,
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

/** Synthetic contact track: 62.5 ms TH between vowels (TH is absent from step3). */
const thCues: Step3Cue[] = [
  { phoneme: "sil", atSecond: 0, durationSeconds: 0.5, intensity: 0.4 },
  { phoneme: "E", atSecond: 0.5, durationSeconds: 0.5, intensity: 0.8 },
  { phoneme: "TH", atSecond: 1.0, durationSeconds: 0.0625, intensity: 0.1 },
  { phoneme: "E", atSecond: 1.0625, durationSeconds: 0.5, intensity: 0.8 },
  { phoneme: "sil", atSecond: 1.5625, durationSeconds: 0.5, intensity: 0.01 },
];

/** Synthetic contact track: 62.5 ms FF between vowels (the step3 /b/ is a PP closure since the acoustic correction). Binary-exact boundaries (halves/sixteenths): the FF cue starts at 1.0625 s so its sub-frame phase (0.875) matches the step3 2.48 s cue (0.4): a frame-aligned 1.0 s start reads the 200 ms anticipatory envelope a full frame early. */
const ffCues: Step3Cue[] = [
  { phoneme: "sil", atSecond: 0, durationSeconds: 0.5, intensity: 0.4 },
  { phoneme: "E", atSecond: 0.5, durationSeconds: 0.5625, intensity: 0.8 },
  { phoneme: "FF", atSecond: 1.0625, durationSeconds: 0.0625, intensity: 0.1 },
  { phoneme: "E", atSecond: 1.125, durationSeconds: 0.5, intensity: 0.8 },
  { phoneme: "sil", atSecond: 1.625, durationSeconds: 0.5, intensity: 0.01 },
];

/** Contact-free vowel track for the bit-equal gate (binary-exact boundaries). */
const vowelCues: Step3Cue[] = [
  { phoneme: "sil", atSecond: 0, durationSeconds: 0.5, intensity: 0.4 },
  { phoneme: "aa", atSecond: 0.5, durationSeconds: 0.5, intensity: 0.77 },
  { phoneme: "E", atSecond: 1.0, durationSeconds: 0.5, intensity: 0.68 },
  { phoneme: "O", atSecond: 1.5, durationSeconds: 0.5, intensity: 0.82 },
];

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

type Step3Drive = { weights: Record<string, number>; jawFraction: number; jawOpenRadians: number; tag: unknown };

/** Full prepared-audio-clock runtime drive at one media instant. */
function driveTrackAt(cues: Step3Cue[], mediaS: number, durationMs: number): Step3Drive {
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
    activeSpeech: { phonemeSequence: ["sil"], startedAtMs: 0, durationMs, bakedCues: cues },
    mediaPositionSeconds: () => mediaS,
  });
  const tag = root.userData.openClinXrNamedVisemeDrive as
    | { weights?: Record<string, number>; jawFraction?: number; jawOpenRadians?: number }
    | undefined;
  return {
    weights: { ...(tag?.weights ?? {}) },
    jawFraction: tag?.jawFraction ?? NaN,
    jawOpenRadians: tag?.jawOpenRadians ?? NaN,
    tag,
  };
}

function driveAt(mediaS: number): Step3Drive {
  return driveTrackAt(step3Cues, mediaS, 4130);
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

    it("per-channel cue leads put FF drive onset within one frame of its cue", () => {
      // U1 K = 0: no PP seal rides the FF cue — the drive onset IS the FF
      // morph (capped at 1 - PP = 1), reaching contact weight within one
      // frame of cue onset. Synthetic FF: the step3 /b/ is a PP closure
      // since the bilabial-stop acoustic correction.
      const ff = ffCues.find((entry) => entry.phoneme === "FF");
      if (!ff) throw new Error("synthetic track has no FF cue");
      const drive = (mediaS: number): Step3Drive => driveTrackAt(ffCues, mediaS, 2130);
      const cueFrame = Math.floor(ff.atSecond * 30);
      const reached = 0.9;
      let onset = -1;
      for (let n = cueFrame - 10; n <= cueFrame + 10; n += 1) {
        if ((drive(frameMediaS(n)).weights.viseme_FF ?? 0) >= reached) { onset = n; break; }
      }
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      expect(drive(frameMediaS(cueFrame - 1)).weights.viseme_FF ?? 0).toBeLessThan(reached);
      const centreS = ff.atSecond + (ff.durationSeconds ?? 0) / 2;
      expect(drive(centreS).weights.viseme_FF ?? 0).toBeCloseTo(1, 5);
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

  describe("#contact-envelope — anticipatory symmetric contact envelope (no snap)", () => {
    // Contact snaps (lip + jaw PP assignment) and the deadline hurry are
    // retired: contact visemes rise, hold, and release through
    // u(t) = S((t-(s-A))/A) * (1-S((t-e)/R)), A = R = 200 ms, evaluated in
    // media time. Steepest smoothstep slope (1.5/unit) over 200 ms gives at
    // most 1.5*(1/30)/0.2 = 0.25 applied change per 30 fps frame.
    const CONTACT_BOUND = 0.25;
    const CONTACT_REACHED = 0.9;

    function maxStep(weights: { weights: Record<string, number> }[], key: string): { max: number; at: number } {
      let max = 0;
      let at = -1;
      for (let n = 1; n < weights.length; n += 1) {
        const step = Math.abs((weights[n]?.weights[key] ?? 0) - (weights[n - 1]?.weights[key] ?? 0));
        if (step > max) { max = step; at = n; }
      }
      return { max, at };
    }

    function contactOnset(
      drive: (mediaS: number) => { weights: Record<string, number> },
      key: string,
      cueStartS: number,
    ): { cueFrame: number; onset: number } {
      const cueFrame = Math.floor(cueStartS * 30);
      let onset = -1;
      for (let n = cueFrame - 10; n <= cueFrame + 10; n += 1) {
        if ((drive(frameMediaS(n)).weights[key] ?? 0) >= CONTACT_REACHED) { onset = n; break; }
      }
      return { cueFrame, onset };
    }

    it("caps PP per-frame weight change at 0.25 on the step3 track", () => {
      const series = Array.from({ length: 124 }, (_, n) => driveAt(frameMediaS(n)));
      const { max, at } = maxStep(series, "viseme_PP");
      expect(max, `PP max|dw| at frame ${at}`).toBeLessThanOrEqual(CONTACT_BOUND);
    });

    it("caps FF per-frame weight change at 0.25 on the step3 track", () => {
      const series = Array.from({ length: 124 }, (_, n) => driveAt(frameMediaS(n)));
      const { max, at } = maxStep(series, "viseme_FF");
      expect(max, `FF max|dw| at frame ${at}`).toBeLessThanOrEqual(CONTACT_BOUND);
    });

    it("caps TH per-frame weight change at 0.25 on a synthetic cue", () => {
      // Step3 carries no TH cue; synthetic 62.5 ms contact between vowels.
      // Binary-exact boundaries (halves/sixteenths): cue-boundary floats must
      // chain exactly or bakedCuesAdmissible drops the track (1.3+0.4 > 1.7).
      const series = Array.from({ length: 62 }, (_, n) => driveTrackAt(thCues, frameMediaS(n), 2130));
      const { max, at } = maxStep(series, "viseme_TH");
      expect(max, `TH max|dw| at frame ${at}`).toBeLessThanOrEqual(CONTACT_BOUND);
    });

    it("caps jaw per-frame aperture change at 0.25 on the step3 track", () => {
      const series = Array.from({ length: 124 }, (_, n) => driveAt(frameMediaS(n)));
      let max = 0;
      let at = -1;
      for (let n = 1; n < series.length; n += 1) {
        const step = Math.abs((series[n]?.jawFraction ?? 0) - (series[n - 1]?.jawFraction ?? 0));
        if (step > max) { max = step; at = n; }
      }
      expect(max, `jaw max|dw| at frame ${at}`).toBeLessThanOrEqual(CONTACT_BOUND);
    });

    it("reaches PP >= 0.9 within one frame of cue onset", () => {
      const pp = step3Cue("PP");
      const { cueFrame, onset } = contactOnset((mediaS) => driveAt(mediaS), "viseme_PP", pp.atSecond);
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      expect(driveAt(frameMediaS(cueFrame - 1)).weights.viseme_PP ?? 0).toBeLessThan(CONTACT_REACHED);
      expect(driveAt((pp.atSecond + pp.atSecond + (pp.durationSeconds ?? 0)) / 2).weights.viseme_PP ?? 0).toBeGreaterThanOrEqual(CONTACT_REACHED);
    });

    it("drives pure FF with the pair bounded at K = 0 (synthetic)", () => {
      // Synthetic FF: the step3 /b/ is a PP closure since the
      // bilabial-stop acoustic correction. U1 K = 0: no PP rides the FF
      // cue; the FF morph carries at 1 - PP = 1, so the pair never exceeds 1.
      const ff = ffCues.find((entry) => entry.phoneme === "FF");
      if (!ff) throw new Error("synthetic track has no FF cue");
      const { cueFrame, onset } = contactOnset(
        (mediaS) => driveTrackAt(ffCues, mediaS, 2130),
        "viseme_FF",
        ff.atSecond,
      );
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      const centre = driveTrackAt(ffCues, ff.atSecond + (ff.durationSeconds ?? 0) / 2, 2130);
      expect(centre.weights.viseme_PP ?? 0).toBe(0);
      expect(centre.weights.viseme_FF ?? 0).toBeCloseTo(1, 5);
      expect((centre.weights.viseme_PP ?? 0) + (centre.weights.viseme_FF ?? 0)).toBeLessThanOrEqual(1 + 1e-9);
    });

    it("reaches TH >= 0.9 within one frame of cue onset (synthetic)", () => {
      const th = thCues.find((entry) => entry.phoneme === "TH");
      if (!th) throw new Error("synthetic track has no TH cue");
      const { cueFrame, onset } = contactOnset(
        (mediaS) => driveTrackAt(thCues, mediaS, 2130),
        "viseme_TH",
        th.atSecond,
      );
      expect(onset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(onset - cueFrame)).toBeLessThanOrEqual(1);
      const centreS = th.atSecond + (th.durationSeconds ?? 0) / 2;
      expect(driveTrackAt(thCues, centreS, 2130).weights.viseme_TH ?? 0).toBeGreaterThanOrEqual(CONTACT_REACHED);
    });

    it("releases PP and FF within the per-frame bound", () => {
      // PP rides the step3 track; FF rides the synthetic contact (the
      // step3 /b/ is a PP closure since the bilabial-stop acoustic
      // correction).
      const pp = step3Cue("PP");
      const ff = ffCues.find((entry) => entry.phoneme === "FF");
      if (!ff) throw new Error("synthetic track has no FF cue");
      for (
        const entry of [
          { phoneme: "PP" as const, cue: pp, drive: driveAt },
          {
            phoneme: "FF" as const,
            cue: ff,
            drive: (mediaS: number): Step3Drive => driveTrackAt(ffCues, mediaS, 2130),
          },
        ]
      ) {
        const key = `viseme_${entry.phoneme}`;
        const endFrame = Math.floor((entry.cue.atSecond + (entry.cue.durationSeconds ?? 0)) * 30);
        let max = 0;
        let at = -1;
        for (let n = endFrame - 2; n <= endFrame + 10; n += 1) {
          const step = Math.abs(
            (entry.drive(frameMediaS(n)).weights[key] ?? 0) - (entry.drive(frameMediaS(n - 1)).weights[key] ?? 0),
          );
          if (step > max) { max = step; at = n; }
        }
        expect(max, `${entry.phoneme} release max|dw| at frame ${at}`).toBeLessThanOrEqual(CONTACT_BOUND);
      }
    });

    it("holds the jaw shut through every PP media frame", () => {
      const pp = step3Cue("PP");
      const endS = pp.atSecond + (pp.durationSeconds ?? 0);
      const shut: number[] = [];
      for (let n = 0; n < 124; n += 1) {
        const mediaS = frameMediaS(n);
        if (mediaS >= pp.atSecond && mediaS < endS) shut.push(n);
      }
      expect(shut.length).toBeGreaterThan(0);
      for (const n of shut) expect(driveAt(frameMediaS(n)).jawFraction).toBe(0);
    });

    it("bounds live jaw radians below the teeth-clear aperture on vowels and seals PP exactly", () => {
      // Prepared step3 track through the prepared-audio clock path: the live
      // prepared-jaw-dynamics output opens the jaw partway on an open vowel
      // (never reaching the teeth-clear aperture) and reads exactly 0
      // through the PP closure. The longest open-vowel cue keeps the sample
      // clear of neighbouring contact.
      const clear = JAW_OPEN_TEETH_CLEAR_RADIANS * JAW_TEETH_GAIN;
      const vowel = step3Cues
        .filter((cue) => JAW_VOWELS.has(cue.phoneme))
        .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];
      expect(vowel).toBeDefined();
      const open = driveAt(vowel!.atSecond + (vowel!.durationSeconds ?? 0) / 2);
      expect(open.jawOpenRadians).toBeGreaterThan(0);
      expect(open.jawOpenRadians).toBeLessThan(clear);
      const pp = step3Cue("PP");
      const shut = driveAt(pp.atSecond + (pp.durationSeconds ?? 0) / 2);
      expect(shut.jawOpenRadians).toBe(0);
    });

    it("keeps vowel weights bit-equal on a contact-free track", () => {
      // HEAD (f0e5a5968) reference rows: no contact cue anywhere, so the
      // envelope, snap-removal, hurry-removal, and prefetch changes never
      // engage and every float must reproduce exactly.
      const expected: Record<number, { weights: Record<string, number>; jawFraction: number }> = {
        0: {
          weights: { viseme_DD: 0, viseme_E: 0, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.6603444828686549 },
          jawFraction: 0,
        },
        10: {
          weights: { viseme_DD: 0, viseme_E: 0, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.9903439620537463 },
          jawFraction: 0.2377557968686226,
        },
        16: {
          weights: { viseme_DD: 0, viseme_E: 0, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.7548930541249602, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.2440783486928386 },
          jawFraction: 0.5186163779985098,
        },
        20: {
          weights: { viseme_DD: 0, viseme_E: 0, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.9394604058475537, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.0603099009589921 },
          jawFraction: 0.6261972734177524,
        },
        30: {
          weights: { viseme_DD: 0, viseme_E: 0.6603444828686549, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.33815992466517364, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.0014902058418147122 },
          jawFraction: 0.45033032864452954,
        },
        32: {
          weights: { viseme_DD: 0, viseme_E: 0.8252643436536765, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.17402840296353336, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.0007047109301922053 },
          jawFraction: 0.4164219186644419,
        },
        40: {
          weights: { viseme_DD: 0, viseme_E: 0.9903439620537463, viseme_FF: 0, viseme_O: 0, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.009620849949304342, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.00003506183208392017 },
          jawFraction: 0.4605208035538193,
        },
        46: {
          weights: { viseme_DD: 0, viseme_E: 0.2440783486928386, viseme_FF: 0, viseme_O: 0.7548930541249602, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.0010248964630081823, viseme_nn: 0, viseme_sil: 0, viseme_silence: 0.0000036874549232199447 },
          jawFraction: 0.5823576564709882,
        },
        50: {
          weights: { viseme_DD: 0, viseme_E: 0.0603099009589921, viseme_FF: 0, viseme_O: 0.9394604058475537, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.00022886878578936526, viseme_nn: 0, viseme_sil: 0, viseme_silence: 8.214529786530825e-7 },
          jawFraction: 0.6321428394256398,
        },
        59: {
          weights: { viseme_DD: 0, viseme_E: 0.00216611469321202, viseme_FF: 0, viseme_O: 0.46049465927602695, viseme_PP: 0, viseme_SS: 0, viseme_TH: 0, viseme_aa: 0.000007812396648985716, viseme_nn: 0, viseme_sil: 0, viseme_silence: 2.8003330821145872e-8 },
          jawFraction: 0.6809562942464291,
        },
      };
      for (const [frame, reference] of Object.entries(expected)) {
        const actual = driveTrackAt(vowelCues, frameMediaS(Number(frame)), 2000);
        expect(actual.weights, `frame ${frame} weights`).toEqual(reference.weights);
        expect(actual.jawFraction, `frame ${frame} jaw`).toBe(reference.jawFraction);
      }
    });
  });
});
