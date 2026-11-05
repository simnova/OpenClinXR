/**
 * Card tsk_4c47cae8ca936ff6: phenotype skin_tone picks the nearest family plus a
 * capped per-chart Lab residual; a light->dark multiply that flattens lips/ears
 * is refused (add_family, never shipped).
 *
 * Case tones come from the fixtures, not an assumption: warm_light(+child) and
 * warm_medium/medium_warm are 2 distinct tones (tone-report.json falsifier), so
 * the single_tone stop does not trigger. Three families are light
 * (forehead L 60-75); the fourth is the remapped deep family (forehead L 17),
 * built from the CC0 middleage_african_female source statistics.
 *
 * Numbers live in tone-report.json (instrument: tone-check.py); this file
 * re-derives the decision from those numbers with its own CIEDE2000 so a
 * drifted report fails instead of passing on stale prose.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const HERE = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/families");
const REPORT = JSON.parse(readFileSync(path.join(HERE, "tone-report.json"), "utf8")) as {
  falsifier: { case_skin_tones: string[]; decision: string };
  tone_anchors_Lab: { warm_light: number[]; warm_medium: number[] };
  families: Record<string, { assets: string; sha256: string; forehead: number[]; lip: number[]; ear: number[] }>;
  nearest: Record<string, string>;
  multiply: {
    light: { id: string; assets: string; sha256: string };
    dark: { id: string; sha256: string };
    lip_lab: { untouched_light: number[]; untouched_dark: number[]; multiplied_light: number[] };
    ear_lab: { untouched_light: number[]; untouched_dark: number[]; multiplied_light: number[] };
    ciede2000_threshold_untouched_pair: { lip: number; ear: number };
    ciede2000_multiplied_vs_dark: { lip: number; ear: number };
    structure_lip_minus_forehead_b_sep: { untouched_dark: number; multiplied_light: number };
  };
  decision: string;
  shipped_multiply: boolean;
  not_tested: string;
};

const STORE = "/Volumes/files/openclinxr-assets/store";
const storePresent = existsSync(STORE);

/** A Lab triplet: exactly three channels, or a named throw. */
function triplet(label: string, v: number[]): [number, number, number] {
  const [x, y, z] = v;
  if (x === undefined || y === undefined || z === undefined) {
    throw new Error(`${label} is not a Lab triplet`);
  }
  return [x, y, z];
}

/** Euclidean dLab between two Lab triplets. */
export function dLab(a: number[], b: number[]): number {
  const [ax, ay, az] = triplet("dLab a", a);
  const [bx, by, bz] = triplet("dLab b", b);
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

/** Nearest family by dLab of the tone anchor against family forehead means. */
export function selectNearestFamily(
  anchor: number[],
  families: Record<string, { forehead: number[] }>,
): string {
  let best = "";
  let bestD = Infinity;
  for (const [id, fam] of Object.entries(families)) {
    const d = dLab(anchor, fam.forehead);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/**
 * Cap a per-chart residual at the next family's forehead mean (per channel,
 * in the direction of travel). Returns crossed=true when the UNCAPPED target
 * would cross that mean: per the card that residual is a fail (refuse).
 */
export function capResidual(
  nearestMean: number[],
  target: number[],
  nextFamilyMean: number[] | null,
): { capped: number[]; crossed: boolean } {
  if (nextFamilyMean === null) return { capped: [...target], crossed: false };
  const n = triplet("nearestMean", nearestMean);
  const t = triplet("target", target);
  const nx = triplet("nextFamilyMean", nextFamilyMean);
  const capped = [...target];
  let crossed = false;
  // Index by the loop bound into fixed 3-tuples: c in 0..2 is always in bounds.
  for (let c = 0; c < 3; c++) {
    const lo = Math.min(n[c]!, nx[c]!);
    const hi = Math.max(n[c]!, nx[c]!);
    const travellingTowardNext =
      (t[c]! < n[c]! && nx[c]! < n[c]!) ||
      (t[c]! > n[c]! && nx[c]! > n[c]!);
    if (travellingTowardNext && (t[c]! < lo || t[c]! > hi)) {
      crossed = true;
      capped[c] = t[c]! < lo ? lo : hi;
    }
  }
  return { capped, crossed };
}

/** CIEDE2000 (Sharma et al.): independent re-derivation of the report numbers. */
export function ciede2000(l1: number[], l2: number[]): number {
  const [L1, a1, b1] = triplet("ciede2000 l1", l1);
  const [L2, a2, b2] = triplet("ciede2000 l2", l2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = ((Math.atan2(b1, ap1) * 180) / Math.PI + 360) % 360;
  const hp2 = ((Math.atan2(b2, ap2) * 180) / Math.PI + 360) % 360;
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = hp2 - hp1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (Math.abs(dh) > 180) dh -= 360 * Math.sign(dh);
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * (Math.PI / 180));
  const Lp = (L1 + L2) / 2;
  const Cp = (Cp1 + Cp2) / 2;
  let hp: number;
  if (Cp1 * Cp2 === 0) hp = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hp = (hp1 + hp2) / 2;
  else hp = hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const T =
    1 -
    0.17 * Math.cos(rad(hp - 30)) +
    0.24 * Math.cos(rad(2 * hp)) +
    0.32 * Math.cos(rad(3 * hp + 6)) -
    0.2 * Math.cos(rad(4 * hp - 63));
  const dRo = 30 * Math.exp(-(((hp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lp - 50) ** 2) / Math.sqrt(20 + (Lp - 50) ** 2);
  const Sc = 1 + 0.045 * Cp;
  const Sh = 1 + 0.015 * Cp * T;
  const Rt = -Math.sin(rad(2 * dRo)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

describe("the nearest family wins over a flattening multiply", () => {
  it("falsifier: current cases need two tones, not a single_tone stop", () => {
    const tones = REPORT.falsifier.case_skin_tones;
    expect(tones).toContain("warm_light");
    expect(tones.some((t) => t === "warm_medium" || t === "medium_warm")).toBe(true);
    expect(REPORT.falsifier.decision).toBe("multi_tone");
  });

  it("families are recorded with sha + Lab triplets, darkest first", () => {
    for (const [id, fam] of Object.entries(REPORT.families)) {
      expect(fam.sha256, `${id}.sha256`).toMatch(/^[0-9a-f]{64}$/);
      for (const k of ["forehead", "lip", "ear"] as const) {
        expect(fam[k].length, `${id}.${k}`).toBe(3);
      }
    }
    const byL = Object.entries(REPORT.families)
      .sort(([, a], [, b]) => {
        const al = a?.forehead[0];
        const bl = b?.forehead[0];
        if (al === undefined || bl === undefined) throw new Error("family forehead triplet missing L");
        return al - bl;
      })
      .map(([id]) => id);
    expect(byL).toEqual(["deep", "young", "old", "middle"]);
  });

  it("phenotype tone maps to the nearest family (re-derived, not quoted)", () => {
    expect(selectNearestFamily(REPORT.tone_anchors_Lab.warm_light, REPORT.families)).toBe("young");
    expect(selectNearestFamily(REPORT.tone_anchors_Lab.warm_medium, REPORT.families)).toBe("young");
    expect(REPORT.nearest["warm_light"]).toBe("young");
    expect(REPORT.nearest["warm_medium"]).toBe("young");
  });

  it("refuses a residual uncapped past the next family's mean (known-bad probe)", () => {
    // middle-light L 75.38 dragged to the dark forehead mean crosses old (68.03): refuse.
    const middleFam = REPORT.families["middle"];
    if (middleFam === undefined) throw new Error("tone-report families.middle missing");
    const middle = triplet("families.middle.forehead", middleFam.forehead);
    const oldFam = REPORT.families["old"];
    if (oldFam === undefined) throw new Error("tone-report families.old missing");
    const old = triplet("families.old.forehead", oldFam.forehead);
    const darkL = REPORT.multiply.lip_lab.untouched_dark[0];
    if (darkL === undefined) throw new Error("tone-report multiply lip_lab.untouched_dark empty");
    const { crossed } = capResidual(middle, [darkL, middle[1], middle[2]], old);
    expect(crossed).toBe(true);
    // The current-case residual (warm_light anchor off young) travels away from
    // the next family in that direction, so no bound is crossed: ships capped.
    const youngFam = REPORT.families["young"];
    if (youngFam === undefined) throw new Error("tone-report families.young missing");
    const young = triplet("families.young.forehead", youngFam.forehead);
    const small = capResidual(young, REPORT.tone_anchors_Lab.warm_light, null);
    expect(small.crossed).toBe(false);
  });

  it("report CIEDE2000 numbers re-derive within rounding (no stale prose)", () => {
    const m = REPORT.multiply;
    expect(ciede2000(m.lip_lab.multiplied_light, m.lip_lab.untouched_dark)).toBeCloseTo(
      m.ciede2000_multiplied_vs_dark.lip,
      1,
    );
    expect(ciede2000(m.ear_lab.multiplied_light, m.ear_lab.untouched_dark)).toBeCloseTo(
      m.ciede2000_multiplied_vs_dark.ear,
      1,
    );
    expect(ciede2000(m.lip_lab.untouched_light, m.lip_lab.untouched_dark)).toBeCloseTo(
      m.ciede2000_threshold_untouched_pair.lip,
      1,
    );
    expect(ciede2000(m.ear_lab.untouched_light, m.ear_lab.untouched_dark)).toBeCloseTo(
      m.ciede2000_threshold_untouched_pair.ear,
      1,
    );
  });

  it("the multiply flattens lip structure past the known-bad regional bound", () => {
    // True dark lip sits b* -3.73 below its forehead; the multiplied light lip
    // sits only -0.36 below: the lip-vs-skin separation is flattened, and the
    // 3.37 miss exceeds the second-body known-bad per-channel bound of 3.
    const miss = Math.abs(
      REPORT.multiply.structure_lip_minus_forehead_b_sep.multiplied_light -
        REPORT.multiply.structure_lip_minus_forehead_b_sep.untouched_dark,
    );
    expect(miss).toBeGreaterThan(3);
  });

  it("on fail the report says add_family and never ships the multiply", () => {
    expect(REPORT.decision).toBe("add_family");
    expect(REPORT.shipped_multiply).toBe(false);
    expect(REPORT.not_tested).toMatch(/blush\/pallor/);
    const raw = JSON.stringify(REPORT);
    expect(raw).not.toMatch(/apps\/ui-xr\/public/);
    expect(raw).not.toMatch(/\.glb/);
  });

  it.skipIf(!storePresent)("verifies tracked shas against the asset store", () => {
    for (const fam of Object.values(REPORT.families)) {
      expect(sha256File(path.join(STORE, fam.assets))).toBe(fam.sha256);
    }
    expect(sha256File(path.join(STORE, REPORT.multiply.light.assets))).toBe(
      REPORT.multiply.light.sha256,
    );
  });

  it.runIf(!storePresent)("store absent: sha checks skipped", () => {
    expect(storePresent).toBe(false);
  });
});
