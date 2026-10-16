/**
 * Forehead sheen matches the goals (card tsk_dcb7bb6496ad3e36, handback 1).
 *
 * HB1 verdict: NO FIX. The ee14ddfd7 matte floor was reverted (gate-fitted
 * matte, T-zone exists because the forehead is the oiliest skin); F0 0.028
 * was tested directly via scratch physical-ior variants and is partial
 * (body2 0.9262->0.8898, Aisha 0.9508->0.9353, neither in band); key
 * intensity/elevation excluded; env IBL measured as the amplifier (fix
 * lives outside WRITE_ROOTS, recorded under needs_outside_roots, not
 * applied). Both highlight metrics are reported on all four images
 * because the metric choice decides the verdict.
 *
 * This test pins the HB1 record: both metric definitions present, goal
 * band, G1/G2 fail-as-written with values, G3 T-zone restored (no floor
 * in source + pre-card bake shas), G4 flag-off identical, G5 F0 transfer,
 * G6 not re-run (condition failed), fix null with outside-roots note.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPORT = path.join(DIR, "forehead-sheen-report.json");
const ROUGH_SRC = path.join(DIR, "build_roughness.py");

type Report = {
  card: string;
  metric: { cheek_definition: string; own_definition: string; tone_independent: boolean };
  band: [number, number];
  both_metrics: Record<string, { HL_cheek: number; HL_own: number; medL: number }>;
  fix: null;
  needs_outside_roots: { file: string; wiring: string };
  verdict: string;
  gates: {
    G1: { body2_F0_HL: number; in_band: boolean };
    G2: { aisha_F0_HL: number; in_band: boolean };
    G3: { forehead_in_tzone: boolean; no_floor: boolean; bake_sha_body2: string; bake_sha_aisha: string };
    G4: { variant: string; sha_before: string; sha_after: string; equal: boolean };
    G5: { albedo_delta_a_face_mean: number; transfer_ratio_a_F0: Record<string, number> };
    G6: { re_run: boolean };
    G7: { dir: string; grade: string };
  };
};

function readReport(): Report {
  return JSON.parse(fs.readFileSync(REPORT, "utf8")) as Report;
}

describe("the forehead sheen matches the goals (handback 1: no fix)", { timeout: 240000 }, () => {
  it("both metric definitions present, tone-independent, no fixed L cut", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_dcb7bb6496ad3e36");
    expect(r.metric.tone_independent).toBe(true);
    expect(r.metric.cheek_definition).toMatch(/cheekMedL \+ DL/);
    expect(r.metric.cheek_definition).toMatch(/DL=10\.0, K=0\.85/);
    expect(r.metric.own_definition).toMatch(/median L \+ 2\.0/);
    expect(r.metric.cheek_definition).not.toMatch(/L ?[>≥] ?70/);
    expect(r.metric.own_definition).not.toMatch(/L ?[>≥] ?70/);
  });

  it("goal band is [min, max] of the two goal cheek HLs; own band differs", () => {
    const r = readReport();
    expect(r.both_metrics["body2_goal"]!.HL_cheek).toBe(0.6054);
    expect(r.both_metrics["aisha_goal"]!.HL_cheek).toBe(0.0618);
    expect(r.band).toEqual([0.0618, 0.6054]);
    // Own-median passes both renders: the choice is load-bearing.
    expect(r.both_metrics["body2_render_before"]!.HL_own).toBe(0.0592);
    expect(r.both_metrics["aisha_render_before"]!.HL_own).toBe(0.1636);
  });

  it("G1 body2 F0 fails as written (F0 partial, no bake change)", () => {
    const r = readReport();
    expect(r.gates.G1.in_band).toBe(false);
    expect(r.gates.G1.body2_F0_HL).toBe(0.8898);
    expect(r.gates.G1.body2_F0_HL).toBeGreaterThan(r.band[1]);
  });

  it("G2 Aisha F0 fails as written", () => {
    const r = readReport();
    expect(r.gates.G2.in_band).toBe(false);
    expect(r.gates.G2.aisha_F0_HL).toBe(0.9353);
  });

  it("G3 forehead back in the T-zone: no floor in source, pre-card bake shas", () => {
    const r = readReport();
    expect(r.gates.G3.forehead_in_tzone).toBe(true);
    expect(r.gates.G3.no_floor).toBe(true);
    const src = fs.readFileSync(ROUGH_SRC, "utf8");
    expect(src).not.toMatch(/FOREHEAD_ROUGH_FLOOR/);
    expect(src).toMatch(/T\[disk\(\(S, S\), forehead\[0\], forehead\[1\], R_FOREHEAD \* S\)\] = 1\.0/);
    expect(r.gates.G3.bake_sha_body2).toBe(
      "958da152c077d582a76694122e278dd487964e7e66df02b2ba267fda8a2800d9",
    );
    expect(r.gates.G3.bake_sha_aisha).toBe(
      "f150fec7b87a05f84a05f2f18e259e14bc3ff00529ec18c4628b3ae1749b8572",
    );
  });

  it("G4 flag-off render byte-identical before/after", () => {
    const r = readReport();
    expect(r.gates.G4.equal).toBe(true);
    expect(r.gates.G4.sha_before).toBe(r.gates.G4.sha_after);
    expect(r.gates.G4.variant.length).toBeGreaterThan(0);
  });

  it("G5 F0 transfer measured: forehead 0.598, cheeks ~1.0", () => {
    const r = readReport();
    expect(r.gates.G5.albedo_delta_a_face_mean).toBe(3.828);
    expect(r.gates.G5.transfer_ratio_a_F0["forehead"]).toBe(0.598);
    expect(r.gates.G5.transfer_ratio_a_F0["L_cheek"]).toBe(1.001);
    expect(r.gates.G5.transfer_ratio_a_F0["R_cheek"]).toBe(0.998);
  });

  it("G6 not re-run (F0-into-band condition failed); nothing lands", () => {
    const r = readReport();
    expect(r.gates.G6.re_run).toBe(false);
  });

  it("no fix landed; outside-roots change specified with file:line", () => {
    const r = readReport();
    expect(r.fix).toBeNull();
    expect(r.needs_outside_roots.file).toBe(
      "packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts",
    );
    expect(r.needs_outside_roots.wiring).toMatch(/isolated-subject-material-variants\.ts:318/);
    expect(r.verdict).toMatch(/NO FIX/);
  });

  it("recorded F0 HLs recompute from the probe renders when present", () => {
    const probes: Array<[string, "body2_F0_HL" | "aisha_F0_HL"]> = [
      ["/Volumes/files/openclinxr-assets/store/forehead-sheen/hb1-body2-studio-F0.png", "body2_F0_HL"],
      ["/Volumes/files/openclinxr-assets/store/forehead-sheen/hb1-aisha-studio-F0.png", "aisha_F0_HL"],
    ];
    const r = readReport();
    for (const [png, key] of probes) {
      if (!fs.existsSync(png)) continue;
      const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(DIR)})
import numpy as np
from PIL import Image
from skimage.color import rgb2lab
import face_landmark_regions as FLR
import face_gate as FG
import cv2
pil = Image.open(${JSON.stringify(png)}).convert("RGB")
rgb = np.array(pil); lab = rgb2lab(rgb.astype(float) / 255.0)
m = ((rgb[...,0].astype(int) > 60) & (rgb[...,0].astype(int) > rgb[...,1].astype(int)) & (rgb[...,1].astype(int) > rgb[...,2].astype(int))).astype(np.uint8) * 255
m = cv2.erode(m, np.ones((7, 7), np.uint8)); gate = (m > 0).astype(np.uint8)
lm = FLR.create_landmarker()
regions, info, polys = FLR.polygon_regions(lab, gate, pil, lm)
w, h = pil.size; masks = FG.raster_masks(polys, w, h, erode_px=3)
smap = {mp: s for s, mp in info["cheek_mapping"].items()}
csel = ((masks[smap["L_cheek"]] > 0) | (masks[smap["R_cheek"]] > 0)) & (gate > 0)
cL = float(np.median(lab[..., 0][csel])); cC = float(np.median(np.sqrt(lab[..., 1][csel] ** 2 + lab[..., 2][csel] ** 2)))
sel = (masks["forehead"] > 0) & (gate > 0); L = lab[..., 0][sel]; C = np.sqrt(lab[..., 1][sel] ** 2 + lab[..., 2][sel] ** 2)
print(json.dumps({"HL": round(float(((L > cL + 10.0) & (C < 0.85 * cC)).mean()), 4)}))
`;
      const bin = execFileSync("python3", ["-c", "import sys;print(sys.executable)"], {
        encoding: "utf8",
      }).trim();
      const got = JSON.parse(execFileSync(bin, ["-c", py], { encoding: "utf8" })) as {
        HL: number;
      };
      const want = key === "body2_F0_HL" ? r.gates.G1.body2_F0_HL : r.gates.G2.aisha_F0_HL;
      expect(got.HL).toBeCloseTo(want, 1);
    }
  });
});
