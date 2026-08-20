import { describe, expect, it } from "vitest";
import {
  applyDialogueVisemeTimelineToRoot,
  applyGeneratedScalarVisemeToRoot,
  applyNamedSpeechVisemes,
  collectMorphTargetNames,
  mapDialoguePhonemeToArkit,
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

describe("viseme runtime wire (#63) — driver → applier → mesh", () => {
  it("maps dialogue vowels to ARKit tokens that land on real viseme_* targets", () => {
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
});
