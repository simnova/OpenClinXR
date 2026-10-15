import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from "three";
import { applyMaterialOverrides } from "../isolated-subject-material-variants.js";
import {
  SKIN_LIP_ROUGHNESS,
  SKIN_NOSE_UV,
  SKIN_TCOEF_DEFAULT,
  resolveSkinShadeOptions,
  skinBlendedRoughness,
  skinForeheadUv,
  skinLipMask,
  skinNostrilMask,
  skinShadeCacheKey,
  skinShadeInstalled,
  skinTZoneMask,
} from "./skin-shade.js";
import { countChangedPx, decodePngFile, type CropRect } from "./png-crop.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "shader-report.json");
const modulePath = join(here, "skin-shade.ts");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  renders: Record<string, { png: string; sha256: string }>;
  crops: Record<string, CropRect>;
  cw1: { originMainSha256: string };
  changedPx: { onVsOff: Record<string, number> };
  tcoef: Record<string, number>;
  storeShas: Record<string, string>;
  moduleSha256: string;
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/skin-shade";
const storeExists = existsSync(STORE);

function stubShader(): {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
} {
  return {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main() {}\n#include <fog_vertex>",
    fragmentShader:
      "#include <common>\nvoid main() {}\n#include <map_fragment>\n" +
      "#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>",
  };
}

async function portraitMaterialWithFlag(
  skinShade: unknown,
): Promise<{ mat: MeshStandardMaterial; readbackShade: unknown }> {
  const mat = new MeshStandardMaterial({ name: "mpfb_skin_ob_patient_aisha_v1", roughness: 0.78 });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
  mesh.name = "body";
  const root = new Group();
  root.add(mesh);
  const applied = await applyMaterialOverrides(root, [
    { match: "mpfb_skin", skinShade: skinShade as never },
  ]);
  return { mat, readbackShade: applied[0]?.readback[0]?.skinShade };
}

describe("the skin shader flag is read back", () => {
  it("G1: the portrait material runs the shader when the flag is on (hook readback, not JSON)", async () => {
    const { mat, readbackShade } = await portraitMaterialWithFlag({ tZoneStrength: 1 });
    expect(readbackShade, "readback skinShade must be true (hook-installed, not a JSON field)").toBe(true);
    expect(skinShadeInstalled(mat), "WeakSet install record must be true").toBe(true);
    expect(mat.type).toBe("MeshStandardMaterial");
    expect((mat as unknown as Record<string, unknown>).transmission, "no transmission pass").toBeUndefined();
    let chained = false;
    const prevHook = mat.onBeforeCompile;
    mat.onBeforeCompile = ((...args: never[]) => {
      chained = true;
      (prevHook as (...a: never[]) => void)(...args);
    }) as typeof mat.onBeforeCompile;
    const shader = stubShader();
    mat.onBeforeCompile(shader as never, {} as never);
    expect(chained, "existing onBeforeCompile must chain").toBe(true);
    expect(shader.uniforms["uSkinTCoef"]?.value).toBeCloseTo(SKIN_TCOEF_DEFAULT * 1, 10);
    expect(shader.uniforms["uSkinNoseUv"]?.value).toEqual([SKIN_NOSE_UV[0], SKIN_NOSE_UV[1]]);
    const fh = skinForeheadUv();
    expect(shader.uniforms["uSkinForeheadUv"]?.value).toEqual([fh[0], fh[1]]);
    for (const u of [
      "uSkinBlurMix",
      "uSkinScatterCurv",
      "uSkinScatterNos",
      "uSkinScatterLip",
      "uSkinCurvGain",
      "uSkinChinUv",
      "uSkinLipUv",
      "uSkinNosLUv",
      "uSkinNosRUv",
    ]) {
      expect(shader.uniforms[u], `uniform ${u} set`).toBeDefined();
    }
    expect(shader.vertexShader).toMatch(/vSkinSmoothN/);
    expect(shader.fragmentShader).toMatch(/fwidth/);
    expect(shader.fragmentShader).toMatch(/skinShadeTZone/);
    expect(shader.fragmentShader).toMatch(/roughnessFactor/);
    expect(shader.fragmentShader).toMatch(/totalEmissiveRadiance/);
    expect(shader.fragmentShader).not.toMatch(/transmission/i);
    expect(shader.fragmentShader).not.toMatch(/scene\.environment/i);
    expect(mat.customProgramCacheKey?.()).toMatch(/^openclinxr-skin-shade:/);
    expect(report.tcoef["on"], "report tcoef.on cites the sweep strength").toBeCloseTo(
      SKIN_TCOEF_DEFAULT * 1,
      10,
    );
  });

  it("flag OFF installs nothing: default program untouched (CW1 code-path gate)", async () => {
    const mat = new MeshStandardMaterial({ name: "mpfb_skin_ob_patient_aisha_v1", roughness: 0.78 });
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
    mesh.name = "body";
    const root = new Group();
    root.add(mesh);
    const freshKey = mat.customProgramCacheKey();
    const applied = await applyMaterialOverrides(root, [{ match: "mpfb_skin" }]);
    expect(applied[0]?.readback[0]?.skinShade).toBe(false);
    expect(skinShadeInstalled(mat)).toBe(false);
    const shader = stubShader();
    const beforeFrag = shader.fragmentShader;
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toBe(beforeFrag);
    expect(
      Object.keys(shader.uniforms).filter((k) => k.startsWith("uSkin")),
      "no skin uniforms without the flag",
    ).toEqual([]);
    expect(mat.customProgramCacheKey()).toBe(freshKey);
  });

  it("garbage strengths refuse (fail-closed resolution)", () => {
    expect(() => resolveSkinShadeOptions({ tZoneStrength: Number.NaN })).toThrow();
    expect(() => resolveSkinShadeOptions({ tZoneStrength: -1 })).toThrow();
    expect(resolveSkinShadeOptions({}).tZoneStrength).toBe(1);
    expect(skinShadeCacheKey(resolveSkinShadeOptions({ tZoneStrength: 2 }))).toMatch(
      /^openclinxr-skin-shade:t2:/,
    );
  });

  it("zone masks are 1 on their landmarks and 0 on the cheek probe (analytic mirror)", () => {
    expect(skinTZoneMask(SKIN_NOSE_UV)).toBeGreaterThan(0.99);
    expect(skinLipMask([0.90992, 0.51677])).toBeGreaterThan(0.99);
    expect(skinNostrilMask([0.87877, 0.49666])).toBeGreaterThan(0.99);
    expect(skinNostrilMask([0.87877, 0.53701])).toBeGreaterThan(0.99);
    const cheek: readonly [number, number] = [0.94, 0.44];
    expect(skinTZoneMask(cheek)).toBe(0);
    expect(skinLipMask(cheek)).toBe(0);
    expect(skinNostrilMask(cheek)).toBe(0);
    // Bake formula mirror (build_roughness.py 0.62 - Tc*T, lips 0.45, clip [0.3,0.8]).
    expect(skinBlendedRoughness(0.78, 1, 0, 0.08)).toBeCloseTo(0.54, 10);
    expect(skinBlendedRoughness(0.78, 0, 1, 0.08)).toBeCloseTo(SKIN_LIP_ROUGHNESS, 10);
    expect(skinBlendedRoughness(0.78, 0, 0, 0.08)).toBe(0.78);
  });

  it(storeExists ? "G2: flag-on vs flag-off buffers differ in cheek, lip and nostril crops" : "store absent — G2 skipped", () => {
    if (!storeExists) return;
    const off = decodePngFile(join(STORE, report.renders["off"]!.png));
    const on = decodePngFile(join(STORE, report.renders["on"]!.png));
    expect(off.w).toBe(1280);
    expect(off.h).toBe(1280);
    expect(sha256File(join(STORE, report.renders["off"]!.png))).toBe(report.renders["off"]!.sha256);
    expect(sha256File(join(STORE, report.renders["on"]!.png))).toBe(report.renders["on"]!.sha256);
    for (const crop of ["cheek", "lip", "nostril"] as const) {
      const rect = report.crops[crop]!;
      const changed = countChangedPx(off, on, rect);
      expect(changed, `${crop} crop changed px on-vs-off`).toBeGreaterThan(0);
      expect(changed, `${crop} crop count matches the recorded sweep`).toBe(
        report.changedPx.onVsOff[crop],
      );
    }
  });

  it(storeExists ? "CW1: flag-off render is byte-identical to origin/main" : "store absent — CW1 skipped", () => {
    if (!storeExists) return;
    expect(sha256File(join(STORE, report.renders["off"]!.png))).toBe(report.cw1.originMainSha256);
  });

  it(storeExists ? "store shas verify (assets:skin-shade/)" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    const names = Object.keys(report.storeShas);
    expect(names.length).toBeGreaterThanOrEqual(16);
    for (const n of names) {
      const p = join(STORE, n);
      expect(existsSync(p), `store file present: ${n}`).toBe(true);
      expect(sha256File(p), `sha of ${n}`).toBe(report.storeShas[n]);
    }
  });

  it("report module sha matches the shipped source", () => {
    expect(sha256File(modulePath)).toBe(report.moduleSha256);
  });
});
