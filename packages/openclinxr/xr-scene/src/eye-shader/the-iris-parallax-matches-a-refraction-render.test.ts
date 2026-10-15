import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MeshPhysicalMaterial } from "three";
import {
  applyEyeShader,
  applyPupilScale,
  EYE_CORNEA_IOR,
  EYE_IRIS_RADIUS_UV,
  EYE_LIMBUS_WIDTH_UV,
  eyeParallaxGlsl,
  irisCenterForUv,
  limbusMask,
  predictApparentPx,
} from "./eye-parallax.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "eye-shader-report.json");
const modulePath = join(here, "eye-parallax.ts");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  parallax: {
    tsPredictionPx: Record<string, number>;
    perViewErrPx2D: Record<string, number>;
  };
  pupilIdentity: Record<string, string>;
  storeShas: Record<string, string>;
  cyclesRef: { centres: Record<string, [number, number]> };
};
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/eye-shader";
const storeExists = existsSync(STORE);

describe("the iris parallax matches a refraction render", () => {
  it("G1 analytic: TS plane-hit prediction matches Cycles within 2px at 1280", () => {
    const c0 = report.cyclesRef.centres["0"];
    if (!c0) throw new Error("report cyclesRef.centres[0] missing");
    for (const yaw of [25, -25, 40, -40]) {
      const c = report.cyclesRef.centres[String(yaw)];
      if (!c) throw new Error(`report cyclesRef.centres[${yaw}] missing`);
      const dx = c[0] - c0[0];
      const pred = predictApparentPx(yaw);
      expect(
        Math.abs(pred - dx),
        `yaw ${yaw}: predicted ${pred.toFixed(2)}px vs Cycles ${dx.toFixed(2)}px`,
      ).toBeLessThanOrEqual(2);
      expect(pred, `report tsPredictionPx[${yaw}] must equal live prediction`).toBeCloseTo(
        report.parallax.tsPredictionPx[String(yaw)] ?? NaN,
        2,
      );
    }
  });

  it("G1 rendered: Blender approximation renders match Cycles within 2px", () => {
    for (const yaw of ["0", "25", "-25", "40", "-40"]) {
      const err = report.parallax.perViewErrPx2D[yaw];
      if (err === undefined) throw new Error(`perViewErrPx2D[${yaw}] missing`);
      expect(err, `yaw ${yaw}: approx-vs-ref centre error`).toBeLessThanOrEqual(2);
    }
  });

  it("G2: pupil scale 1 reproduces the iris (max abs error 0)", () => {
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        const rel = [i / 40 - 0.5, j / 40 - 0.5] as const;
        const out = applyPupilScale(rel, 1);
        worst = Math.max(worst, Math.abs(out[0] - rel[0]), Math.abs(out[1] - rel[1]));
      }
    }
    expect(worst).toBe(0);
    expect(report.pupilIdentity["ts"]).toMatch(/max abs err 0/);
  });

  it("limbus mask is 0 inside, 1 at the edge, monotone", () => {
    expect(limbusMask(0)).toBe(0);
    expect(limbusMask(EYE_IRIS_RADIUS_UV)).toBe(1);
    expect(limbusMask(EYE_IRIS_RADIUS_UV + 0.05)).toBe(1);
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const v = limbusMask((k / 20) * (EYE_IRIS_RADIUS_UV + 0.02));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(EYE_LIMBUS_WIDTH_UV).toBeGreaterThan(0);
  });

  it("shader is a no-transmission plane-hit: refract present, transmission/emissive absent, no Unity 0.02", () => {
    const glsl = eyeParallaxGlsl();
    expect(glsl).toMatch(/refract\(/);
    expect(glsl).toMatch(/smoothstep/);
    expect(glsl).not.toMatch(/transmission/i);
    expect(glsl).not.toMatch(/emissive/i);
    expect(glsl).toMatch(/uPupilScale == 1\.0/);
    const src = readFileSync(modulePath, "utf8");
    expect(src, "Unity 0.02 iris-plane offset must not appear").not.toMatch(/0\.02/);
    expect(EYE_CORNEA_IOR).toBe(1.376);
  });

  it("applyEyeShader hooks the globe material and leaves transmission at 0", () => {
    const mat = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 1 });
    mat.transmission = 0;
    let chained = false;
    mat.onBeforeCompile = () => {
      chained = true;
    };
    applyEyeShader(mat);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main() {}\n#include <fog_vertex>",
      fragmentShader: "#include <common>\nvoid main() {}\n#include <map_fragment>",
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(chained, "existing onBeforeCompile must chain").toBe(true);
    for (const u of [
      "uIrisCenterL",
      "uIrisCenterR",
      "uIrisRadiusU",
      "uPupilScale",
      "uCorneaIOR",
      "uCorneaRM",
      "uChamberM",
      "uUvPerMetre",
    ]) {
      expect(shader.uniforms[u], `uniform ${u} set`).toBeDefined();
    }
    expect(shader.uniforms["uCorneaIOR"]?.value).toBe(1.376);
    expect(shader.vertexShader).toMatch(/vEyePosOS/);
    expect(shader.fragmentShader).toMatch(/refract\(/);
    expect(mat.transmission, "no transmission pass on Quest").toBe(0);
    expect(irisCenterForUv([0.29, 0.3])).toBe("L");
    expect(irisCenterForUv([0.71, 0.7])).toBe("R");
  });

  it(storeExists ? "store shas verify (assets:eye-shader/)" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    const names = Object.keys(report.storeShas);
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const n of names) {
      const p = join(STORE, n);
      expect(existsSync(p), `store file present: ${n}`).toBe(true);
      expect(sha256File(p), `sha of ${n}`).toBe(report.storeShas[n]);
    }
  });

  it("report module sha matches the shipped source", () => {
    const full = JSON.parse(readFileSync(reportPath, "utf8")) as { moduleSha256: string };
    expect(sha256File(modulePath)).toBe(full.moduleSha256);
  });
});
