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
 * RED: the upper lip covers the upper incisors at held viseme_E.
 *
 * Floor 0 mm = the sign of every cited speech mean (Rao 2021 PMC7848132
 * Table 1, as in the aa sibling). Cells and pre-fix values from store
 * upper-lip-spread/pre-fix.json sha256[:16] 928df536274654d7. I cells
 * excluded by cap54 ruling 2026-11-22 (A2 STOP: at mouth-elevation 1 held I
 * stays -0.41/-1.55/-0.92 mm, sweep.json 3a89b094cc3cf372). The fix commit
 * converts every it.fails here to it( and an unconverted it.fails at land
 * is a contract failure.
 */
const CELLS: Array<{ asset: string; viseme: string; preFixCentralDisplayMm: number }> = [
  { asset: "mpfb-ob-patient-aisha", viseme: "E", preFixCentralDisplayMm: -3.725 },
  { asset: "mpfb-peds-nurse-kevin", viseme: "E", preFixCentralDisplayMm: -6.489 },
  { asset: "mpfb-clinical-physician-adult", viseme: "E", preFixCentralDisplayMm: -4.788 },
];

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
    it.fails(`${cell.asset}: held E central display > 0`, async () => {
      const scene = await loadHeadlessScene(GLBS[cell.asset]!);
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["E"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(measured.centralDisplayMm).toBeGreaterThan(0);
    });
  }
});
