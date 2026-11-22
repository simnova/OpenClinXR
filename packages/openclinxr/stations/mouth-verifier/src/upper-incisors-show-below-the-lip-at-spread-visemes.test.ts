import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyNamedSpeechVisemes } from "@openclinxr/xr-dialogue/package-viseme";
import { loadHeadlessScene, measureUpperIncisorDisplay } from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const GLBS: Record<string, string> = {
  "mpfb-peds-nurse-kevin": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb"),
  "mpfb-clinical-physician-adult": join(
    REPO_ROOT,
    "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb",
  ),
  "mpfb-ob-patient-aisha": join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb"),
};

/**
 * FIXED: the upper lip clears the upper incisors at held viseme_E.
 *
 * Floor 0 mm = the sign of every cited speech mean (Rao 2021 PMC7848132
 * Table 1, as in the aa sibling). Cells and pre-fix values from store
 * upper-lip-spread/pre-fix.json sha256[:16] 928df536274654d7. I cells
 * excluded by cap54 ruling 2026-11-22 (A2 STOP: at mouth-elevation 1 held I
 * stays -0.41/-1.55/-0.92 mm, sweep.json 3a89b094cc3cf372). The fix commit
 * converted every it.fails here to it( and an unconverted it.fails at land
 * is a contract failure.
 */
const CELLS: Array<{ asset: string; viseme: string; preFixCentralDisplayMm: number }> = [
  { asset: "mpfb-ob-patient-aisha", viseme: "E", preFixCentralDisplayMm: -3.725 },
  { asset: "mpfb-peds-nurse-kevin", viseme: "E", preFixCentralDisplayMm: -6.489 },
  { asset: "mpfb-clinical-physician-adult", viseme: "E", preFixCentralDisplayMm: -4.788 },
];

/** Per-actor expectations from store upper-lip-spread/pre-fix.json. */
const ACTORS = [
  {
    asset: "mpfb-ob-patient-aisha",
    aaCentralMm: 2.57,
    edgeYMm: -33.287,
    edgeZMm: 93.152,
    crownHeightMm: 11.18,
    expectedECentralMm: 1.211,
  },
  {
    asset: "mpfb-peds-nurse-kevin",
    aaCentralMm: 1.444,
    edgeYMm: -26.95,
    edgeZMm: 87.381,
    crownHeightMm: 10.192,
    expectedECentralMm: 0.39,
  },
  {
    asset: "mpfb-clinical-physician-adult",
    aaCentralMm: 2.06,
    edgeYMm: -26.756,
    edgeZMm: 89.961,
    crownHeightMm: 11.755,
    expectedECentralMm: 1.013,
  },
] as const;

const JAW_OPEN_RADIANS_AT_E = 0.0339435;

describe("upper incisors show below the lip at spread visemes", () => {
  for (const cell of CELLS) {
    it(`${cell.asset}: held E drives viseme_E`, async () => {
      const scene = await loadHeadlessScene(GLBS[cell.asset]!);
      const drive = applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      expect(drive.activeTargetName).toBe("viseme_E");
    });
    it(`${cell.asset}: held E central display > 0`, async () => {
      const scene = await loadHeadlessScene(GLBS[cell.asset]!);
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(measured.centralDisplayMm).toBeGreaterThan(0);
    });
  }

  for (const actor of ACTORS) {
    it(`CW1 ${actor.asset}: held AA central within 0.05 of ${actor.aaCentralMm}`, async () => {
      const scene = await loadHeadlessScene(GLBS[actor.asset]!);
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["AA"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(Math.abs((measured.centralDisplayMm ?? NaN) - actor.aaCentralMm)).toBeLessThanOrEqual(0.05);
    });

    it(`CW4 ${actor.asset}: teeth/jaw do not move at held E`, async () => {
      const scene = await loadHeadlessScene(GLBS[actor.asset]!);
      const drive = applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(Math.abs(measured.upperEdgeYMm - actor.edgeYMm)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(measured.upperEdgeZMm - actor.edgeZMm)).toBeLessThanOrEqual(0.001);
      expect(drive.jawOpenRadians).toBeCloseTo(JAW_OPEN_RADIANS_AT_E, 9);
    });

    it(`CW5 ${actor.asset}: no gum show at held E (central < crown ${actor.crownHeightMm})`, async () => {
      const scene = await loadHeadlessScene(GLBS[actor.asset]!);
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(measured.centralDisplayMm).toBeGreaterThan(0);
      expect(measured.centralDisplayMm!).toBeLessThan(measured.crownHeightMm);
      expect(measured.crownHeightMm).toBeCloseTo(actor.crownHeightMm, 6);
    });

    it(`CW8 ${actor.asset}: removing the raise returns the display to the pre-fix sign, the drive restores it`, async () => {
      const scene = await loadHeadlessScene(GLBS[actor.asset]!);
      const speech = { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 };
      applyNamedSpeechVisemes({ root: scene.root, activeSpeech: speech }, 500);
      expect(measureUpperIncisorDisplay(scene).centralDisplayMm).toBeGreaterThan(0);
      // g_E = 0 equivalent: zero mouth-elevation on every host (the gains override itself is unit-tested in xr-dialogue).
      let zeroed = 0;
      scene.root.traverse((object: unknown) => {
        const mesh = object as { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] };
        const index = mesh.morphTargetDictionary?.["mouth-elevation"];
        if (index === undefined || !mesh.morphTargetInfluences) return;
        mesh.morphTargetInfluences[index] = 0;
        zeroed += 1;
      });
      expect(zeroed).toBeGreaterThan(0);
      expect(measureUpperIncisorDisplay(scene).centralDisplayMm!).toBeLessThanOrEqual(0);
      applyNamedSpeechVisemes({ root: scene.root, activeSpeech: speech }, 500);
      expect(measureUpperIncisorDisplay(scene).centralDisplayMm).toBeGreaterThan(0);
    });
  }
});
