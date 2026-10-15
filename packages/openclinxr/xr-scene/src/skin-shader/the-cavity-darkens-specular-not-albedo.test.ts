import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Arch: this gate test imports exactly zero entrypoint-reachable modules —
// only ./png-crop.js (unreachable from the entrypoint) plus node builtins —
// so testInternalImports holds at 10 with no new public exports. The
// hook-level cavity asserts live in the-skin-shader-flag-is-read-back.test.ts,
// which already pays that file's single reachable import.
import { countChangedPx, decodePngFile, type CropRect } from "./png-crop.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "specular-report.json");
const shadeReportPath = join(here, "shader-report.json");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  g1: { rows: Record<string, { r15: number; r45: number; maxAbs: number }>; gate: string };
  g2: { worst: number };
  g3: { served_sha256: string; max_abs_error: number };
  g4: {
    seam: { mouth_seam1: { baked_over: number; spec_over: number }; nose: { baked_over: number; spec_over: number } };
    dilatedContext: { mouth_dil3: { baked_over: number; spec_over: number } };
  };
  cw2: { witness: string };
  sheet: { dir: string; cells: string[]; crops: Record<string, [number, number, number, number]> };
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/skin-specular/h1";
const SHADE_STORE = "/Volumes/files/openclinxr-assets/store/skin-shade/h1";
const SCRATCH = "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/skinspec";
const storeExists = existsSync(STORE);

describe("the cavity darkens specular, not albedo", () => {
  it("G1: replay-clean max|r| <= untouched CC0 max|r| (same script numbers)", () => {
    const { rows } = report.g1;
    expect(rows["clean-h1"]!.maxAbs).toBeLessThanOrEqual(rows["cc0-untouched"]!.maxAbs);
    expect(rows["clean-h1"]!.maxAbs).toBeCloseTo(0.3018, 4);
    expect(rows["cc0-untouched"]!.maxAbs).toBeCloseTo(0.4749, 4);
    expect(rows["baked-occ-only-h1"]!.maxAbs).toBeCloseTo(0.3691, 4);
    expect(report.g1.gate).toMatch(/^PASS/);
  });

  it("G2: worst regional |dLab| within the face-core within-3 bound", () => {
    expect(report.g2.worst).toBeLessThanOrEqual(3.0);
    expect(report.g2.worst).toBeCloseTo(2.29, 2);
  });

  it("G3: served clean is the chain pre-apply_occ output, byte-exact", () => {
    expect(report.g3.max_abs_error).toBe(0);
    expect(report.g3.served_sha256).toBe(
      "f5e0551ceeb8fad061a6887bbd854bfa44ab46bbb43a2652800d7947124f2224",
    );
    if (!existsSync(join(SCRATCH, "chain-input-2048.png"))) return;
    expect(sha256File(join(SCRATCH, "chain-input-2048.png"))).toBe(report.g3.served_sha256);
  });

  it("G4: zero over-cheek-p99 pixels on both seam loci in both builds", () => {
    expect(report.g4.seam.mouth_seam1.baked_over).toBe(0);
    expect(report.g4.seam.mouth_seam1.spec_over).toBe(0);
    expect(report.g4.seam.nose.baked_over).toBe(0);
    expect(report.g4.seam.nose.spec_over).toBe(0);
  });

  it(storeExists ? "sheet cells + native crops exist in store/skin-specular/h1" : "store absent — sheet check skipped", () => {
    if (!storeExists) return;
    for (const cell of report.sheet.cells) {
      const p = join(STORE, cell);
      expect(existsSync(p), `cell present: ${cell}`).toBe(true);
      const png = decodePngFile(p);
      expect(png.w).toBe(1280);
    }
    for (const cell of ["h1-baked-key0", "h1-baked-key30", "h1-spec-key0", "h1-spec-key30"]) {
      for (const crop of ["cheek", "nasolabial", "eyecorner", "mouthseam", "nostrilseam"]) {
        const p = join(STORE, `${cell}-${crop}.png`);
        expect(existsSync(p), `crop present: ${cell}-${crop}`).toBe(true);
      }
    }
    const cheek = decodePngFile(join(STORE, "h1-spec-key0-cheek.png"));
    expect([cheek.w, cheek.h]).toEqual([180, 150]);
    const mouthseam = decodePngFile(join(STORE, "h1-spec-key0-mouthseam.png"));
    expect([mouthseam.w, mouthseam.h]).toEqual([203, 7]);
    // Specular build differs from the albedo build in every sheet crop.
    const baked = decodePngFile(join(STORE, "h1-baked-key0-front.png"));
    const spec = decodePngFile(join(STORE, "h1-spec-key0-front.png"));
    for (const [name, r] of Object.entries(report.sheet.crops)) {
      const rect = { x0: r[0], y0: r[1], x1: r[2], y1: r[3] } as CropRect;
      expect(countChangedPx(baked, spec, rect), `${name} crop differs`).toBeGreaterThan(0);
    }
  });

  it(storeExists ? "CW2: flag-off render matches the origin/main witness up to rerun noise" : "store absent — CW2 skipped", () => {
    if (!storeExists) return;
    // Same witness as skin-shade CW1: the off2 re-render pinned in
    // shader-report.json cw1.originMainSha256.
    const shadeReport = JSON.parse(readFileSync(shadeReportPath, "utf8")) as {
      cw1: { originMainSha256: string };
    };
    const witness = join(SHADE_STORE, "skinshade-off2-front.png");
    expect(sha256File(witness)).toBe(shadeReport.cw1.originMainSha256);
    expect(sha256File(witness)).toBe(report.cw2.witness);
    const now = decodePngFile(
      "/Volumes/files/openclinxr-assets/store/skin-specular/spk-off2-front.png",
    );
    const ref = decodePngFile(witness);
    let total = 0;
    const c = Math.min(now.chans, ref.chans, 3);
    for (let k = 0; k < now.w * now.h; k += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        if (Math.abs(now.data[k * now.chans + ch]! - ref.data[k * ref.chans + ch]!) > 0) {
          total += 1;
          break;
        }
      }
    }
    // h1 same-tree rerun noise was 19px silhouette (max abs 30); this run 16px.
    expect(total).toBeLessThanOrEqual(64);
    for (const r of Object.values({
      cheek: { x0: 700, y0: 690, x1: 880, y1: 840 },
      lip: { x0: 520, y0: 860, x1: 760, y1: 980 },
      nostril: { x0: 555, y0: 730, x1: 725, y1: 850 },
    } as Record<string, CropRect>)) {
      expect(countChangedPx(now, ref, r), "face crops hold zero").toBe(0);
    }
  });

  it("combined RG texture carries curvature in R and cavity in G", () => {
    for (const f of [
      join(SCRATCH, "aisha-curv-cav-1024.png"),
      "/Volumes/files/openclinxr-assets/store/skin-maps/aisha-curvature-1024.png",
      "/Volumes/files/openclinxr-assets/store/skin-maps/aisha-cavity-1024.png",
    ]) {
      if (!existsSync(f)) return;
    }
    const rg = decodePngFile(join(SCRATCH, "aisha-curv-cav-1024.png"));
    const curv = decodePngFile("/Volumes/files/openclinxr-assets/store/skin-maps/aisha-curvature-1024.png");
    const cav = decodePngFile("/Volumes/files/openclinxr-assets/store/skin-maps/aisha-cavity-1024.png");
    expect([rg.w, rg.h]).toEqual([1024, 1024]);
    expect(rg.chans).toBeGreaterThanOrEqual(3);
    let rEq = 0, gEq = 0;
    for (let k = 0; k < 1024 * 1024; k += 1) {
      if (rg.data[k * rg.chans]! === curv.data[k * curv.chans]!) rEq += 1;
      if (rg.data[k * rg.chans + 1]! === cav.data[k * cav.chans]!) gEq += 1;
    }
    expect(rEq).toBe(1024 * 1024);
    expect(gEq).toBe(1024 * 1024);
  });
});
