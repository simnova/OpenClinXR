import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#45) — nothing has ever proved a face moves.
 *
 * The pieces are all present. The humanoid GLBs carry viseme shape keys (measured:
 * `peds_patient_child.glb` has 26 shape keys, 9 viseme-named). The registry declares
 * `lipSync: ["viseme_phoneme_map"]` (`asset-registry/src/index.ts:618`). `main.ts` models a viseme
 * timeline (`visemeSequence` :1528, `morphTargetAppliedTargetCount` :1571,
 * `morphTargetPlaybackMode` :1572).
 *
 * What is missing is evidence that any of it produces a changed mouth. `voice-gateway` carries only
 * Mock and Local adapters, so no real speech has driven these shapes — and that is fine, because NO
 * TTS IS NEEDED to prove the rig works. A hardcoded phoneme timeline is enough.
 *
 * THIS IS NOT A CAGEMATCH, which is how the issue was originally filed. The peer round agreed: a
 * bake-off over phoneme sources (TTS metadata vs audio analysis vs hardcoded) is only required once
 * production lip-sync QUALITY is the claim. "Our rigs' mouths move" needs no comparison.
 *
 * THE TWO CONTRACTS PULL APART so neither is satisfiable cheaply.
 *
 * The first demands the weights actually CHANGE across the timeline — a single held pose, or every
 * viseme at zero, fails it. The second demands the changing weights land on the viseme targets the
 * mesh really has, by name — animating some unrelated morph, or a target that does not exist, fails
 * it. Together they require a real shape key to really move.
 *
 * NOT ASSERTED, and deliberately outside this slice: which phoneme source to adopt, audio
 * synchronisation accuracy, or whether the motion looks natural. Those are separate and at least one
 * of them needs a clinician rather than a test.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `driveVisemeTimeline({ phonemes, availableTargets })`
 * returning `{ frames }` where each frame carries `{ atSecond, weights }`. Change the call sites and
 * say why if a different shape is better. What must not change: weights vary over time, and they
 * name real viseme targets.
 */

const load = async () => import("./viseme-timeline-drive.js") as Promise<Record<string, unknown>>;

type Frame = { atSecond: number; weights: Record<string, number> };
type Drive = (input: {
  phonemes: ReadonlyArray<{ phoneme: string; atSecond: number }>;
  availableTargets: readonly string[];
}) => { frames: Frame[] };

/** Measured from the shipped GLB, not invented. */
const REAL_TARGETS = [
  "viseme_silence", "viseme_AA", "viseme_E", "viseme_IH",
  "viseme_OH", "viseme_OU", "viseme_FV", "viseme_L",
];

const PHONEMES = [
  { phoneme: "sil", atSecond: 0.0 },
  { phoneme: "AA", atSecond: 0.2 },
  { phoneme: "IH", atSecond: 0.4 },
  { phoneme: "OU", atSecond: 0.6 },
  { phoneme: "sil", atSecond: 0.8 },
];

describe("a phoneme timeline actually moves the mouth (#45)", () => {
  it("produces viseme weights that change over the timeline", async () => {
    const mod = await load();
    const drive = mod["driveVisemeTimeline"] as Drive | undefined;
    expect(drive).toBeTypeOf("function");

    const { frames } = drive!({ phonemes: PHONEMES, availableTargets: REAL_TARGETS });
    expect(frames.length).toBeGreaterThan(1);

    // A held pose is not lip-sync: some target must differ between two frames.
    const signature = (f: Frame) => JSON.stringify(Object.entries(f.weights).sort());
    expect(new Set(frames.map(signature)).size).toBeGreaterThan(1);

    // And something must actually be non-zero — all-zero weights "change" nothing visible.
    expect(frames.some((f) => Object.values(f.weights).some((w) => w > 0.1))).toBe(true);
  });

  it("drives only viseme targets the mesh really has", async () => {
    // Kills the other cheat: animating an invented or unrelated morph would satisfy the test above.
    const mod = await load();
    const drive = mod["driveVisemeTimeline"] as Drive | undefined;
    expect(drive).toBeTypeOf("function");

    const { frames } = drive!({ phonemes: PHONEMES, availableTargets: REAL_TARGETS });
    const driven = new Set(frames.flatMap((f) => Object.keys(f.weights)));
    expect(driven.size).toBeGreaterThan(0);
    for (const target of driven) {
      expect(REAL_TARGETS, `drove a target the mesh does not have: ${target}`).toContain(target);
    }
  });
});
