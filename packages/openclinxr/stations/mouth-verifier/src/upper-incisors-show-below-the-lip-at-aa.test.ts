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
 * RED: upper incisors stay hidden behind the upper lip at aa.
 *
 * Floor 0 mm is the sign of every cited speech mean: Rao 2021 (PMC7848132)
 * Table 1 reports maximum upper incisal exposure in speech 7.76 +- 1.75 mm (all means
 * positive = edge below the lip). Pre-fix aa central display is negative on
 * all three actors (-2.8 Aisha / -5.5 Kevin / -3.8 physician, S0
 * measure.json): the edge sits above the upper-lip low point, i.e. no crown
 * shows. These it.fails blocks PASS while the defect is present and FAIL
 * once a fix pushes central display above 0.
 */
describe("upper incisors show below the lip at aa", () => {
  for (const asset of Object.keys(GLBS)) {
    it.fails(`${asset}: aa central display > 0`, async () => {
      const scene = await loadHeadlessScene(GLBS[asset]!);
      applyNamedSpeechVisemes(
        { root: scene.root, activeSpeech: { phonemeSequence: ["AA"], startedAtMs: 0, durationMs: 1000 } },
        500,
      );
      const measured = measureUpperIncisorDisplay(scene);
      expect(measured.centralDisplayMm).toBeGreaterThan(0);
    });
  }
});
