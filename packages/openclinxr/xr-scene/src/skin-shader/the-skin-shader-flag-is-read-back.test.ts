import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TextureLoader,
} from "three";
// Arch D2: the gate test imports exactly one entrypoint-reachable module
// (the portrait flag path it must exercise) plus ./png-crop.js (unreachable
// from the entrypoint, so it does not count). The pre-existing
// encounter-actor-framing test was routed through the entrypoint in the same
// commit, so testInternalImports holds at 10 with no new public exports.
import {
  applyMaterialOverrides,
  applySkinOverride,
  collectMaterialInventory,
  SKIN_IOR,
} from "../isolated-subject-material-variants.js";
import { countChangedPx, decodePngFile, sobelEnergy, type CropRect } from "./png-crop.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "shader-report.json");
const modulePath = join(here, "skin-shade.ts");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  renders: Record<string, { png: string; sha256: string }>;
  crops: Record<string, CropRect>;
  cw1: { originMainSha256: string };
  changedPx: { onVsOff: Record<string, number> };
  f1: {
    off: Record<string, number>;
    on: Record<string, number>;
    off2: Record<string, number>;
    noiseRatio: number;
    factor: number;
  };
  tcoef: Record<string, number>;
  storeShas: Record<string, string>;
  moduleSha256: string;
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/skin-shade";
const storeExists = existsSync(STORE);
const CURV_URL = "https://example.invalid/aisha-curvature-1024.png";

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
      "#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>\n#include <emissivemap_fragment>",
  };
}

/**
 * Stand in for the portrait path's TextureLoader (node has no image
 * decoder): every curvature URL resolves to a mid-grey DataTexture.
 */
async function withCurvatureTexture<T>(run: (tex: DataTexture) => Promise<T>): Promise<T> {
  const fake = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const orig = TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync = (async () => fake) as never;
  try {
    return await run(fake);
  } finally {
    TextureLoader.prototype.loadAsync = orig;
  }
}

async function portraitMaterialWithFlag(
  skinShade: unknown,
  curvatureUrl: string | null = CURV_URL,
): Promise<{ mat: MeshStandardMaterial; readback: Record<string, unknown> }> {
  const mat = new MeshStandardMaterial({ name: "mpfb_skin_ob_patient_aisha_v1", roughness: 0.78 });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
  mesh.name = "body";
  const root = new Group();
  root.add(mesh);
  const override: Record<string, unknown> = { match: "mpfb_skin", skinShade };
  if (curvatureUrl !== null) override.skinShadeCurvatureUrl = curvatureUrl;
  const applied = await applyMaterialOverrides(root, [override as never]);
  return { mat, readback: (applied[0]?.readback[0] ?? {}) as Record<string, unknown> };
}

describe("the skin shader flag is read back", () => {
  it("G1: the portrait material runs the shader when the flag is on (hook readback, not JSON)", async () => {
    await withCurvatureTexture(async (fake) => {
      const { mat, readback } = await portraitMaterialWithFlag({ tZoneStrength: 1 });
      expect(readback.skinShade, "readback skinShade must be true (hook-installed, not a JSON field)").toBe(true);
      expect(readback.skinShadeCurvature, "live record must show the curvature map bound").toBe(true);
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
      // 0.08 = build_roughness.py --tcoef default; strength 1 in this case.
      expect(shader.uniforms["uSkinTCoef"]?.value).toBeCloseTo(0.08, 10);
      expect(shader.uniforms["uSkinCurvMap"]?.value, "curvature texture bound through the flag path").toBe(fake);
      // Landmark numerals: derive/A/landmarks-uv.json (nose-tip; forehead = build_roughness.py mirror).
      expect(shader.uniforms["uSkinNoseUv"]?.value).toEqual([0.86579, 0.51683]);
      const fh = shader.uniforms["uSkinForeheadUv"]?.value as [number, number];
      expect(fh[0]).toBeCloseTo(0.80619, 4);
      expect(fh[1]).toBeCloseTo(0.51678, 4);
      for (const u of [
        "uSkinBlurMix",
        "uSkinScatterCvx",
        "uSkinScatterCav",
        "uSkinScatterNos",
        "uSkinScatterLip",
        "uSkinChinUv",
        "uSkinLipUv",
        "uSkinNosLUv",
        "uSkinNosRUv",
      ]) {
        expect(shader.uniforms[u], `uniform ${u} set`).toBeDefined();
      }
      expect(shader.vertexShader).toMatch(/vSkinSmoothN/);
      expect(shader.fragmentShader).toMatch(/texture2D\(uSkinCurvMap, skinUv\)/);
      expect(shader.fragmentShader).toMatch(/skinConvex/);
      expect(shader.fragmentShader).toMatch(/skinCav/);
      expect(shader.fragmentShader).toMatch(/0\.62/);
      expect(shader.fragmentShader).toMatch(/0\.45/);
      expect(shader.fragmentShader).toMatch(/roughnessFactor/);
      expect(shader.fragmentShader).toMatch(/totalEmissiveRadiance/);
      expect(shader.fragmentShader, "D1: no screen derivative may remain").not.toMatch(/fwidth|dFdx|dFdy/);
      expect(shader.fragmentShader).not.toMatch(/transmission/i);
      expect(mat.customProgramCacheKey?.()).toMatch(/^openclinxr-skin-shade:t1:/);
      expect(report.tcoef["on"], "report tcoef.on cites the sweep strength").toBeCloseTo(0.08, 10);
    });
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

  it("garbage strengths and a missing curvature URL refuse (fail-closed)", async () => {
    await withCurvatureTexture(async () => {
      await expect(portraitMaterialWithFlag({ tZoneStrength: Number.NaN })).rejects.toThrow();
      await expect(portraitMaterialWithFlag({ tZoneStrength: -1 })).rejects.toThrow();
      // tsk_8bbeb141d792bdcb: the specular-occlusion strength is fail-closed too.
      await expect(portraitMaterialWithFlag({ specularOcclusion: Number.NaN })).rejects.toThrow();
      await expect(portraitMaterialWithFlag({ specularOcclusion: -1 })).rejects.toThrow();
    });
    await expect(portraitMaterialWithFlag(true, null)).rejects.toThrow(/skinShadeCurvatureUrl/);
  });

  it("G-cavity: the flag path occludes specular and lifts roughness, never the albedo", async () => {
    await withCurvatureTexture(async () => {
      const { mat } = await portraitMaterialWithFlag(true);
      const shader = stubShader();
      mat.onBeforeCompile(shader as never, {} as never);
      // Default strength 1 (recorded constant, mirrors aoMap intensity-1).
      expect(shader.uniforms["uSkinSpecOccl"]?.value).toBe(1);
      // Cavity field rides the combined texture's G channel (R = curvature).
      expect(shader.fragmentShader).toMatch(/texture2D\(uSkinCurvMap, skinUv\)\.g/);
      // +0.08*C: build_roughness.py:114, baked into the roughness chunk.
      expect(shader.fragmentShader).toMatch(/roughnessFactor \+ 0\.08 \* skinCavTex/);
      // Specular-only occlusion after lights_fragment_end (diffuse untouched).
      expect(shader.fragmentShader).toMatch(
        /reflectedLight\.directSpecular \*= \(1\.0 - uSkinSpecOccl \* skinCavTex\)/,
      );
      expect(shader.fragmentShader).toMatch(
        /reflectedLight\.indirectSpecular \*= \(1\.0 - uSkinSpecOccl \* skinCavTex\)/,
      );
      // CW1 at hook level: diffuseColor is never assigned (the scatter lift
      // only READS it into totalEmissiveRadiance).
      expect(shader.fragmentShader).not.toMatch(/diffuseColor\s*(\.rgb)?\s*[*+\-]?=/);
      expect(shader.fragmentShader).not.toMatch(/fwidth|dFdx|dFdy/);
      // tsk_44e25e12108c307e: the key gains a :l<lutStrength|0> suffix
      // (l0 = wrap path, unchanged program); the :s1 anchor moves inside.
      expect(mat.customProgramCacheKey?.()).toMatch(/:s1:l0$/);
    });
  });

  it(storeExists ? "F1: no seams — on edge energy within noise of off in every crop" : "store absent — F1 skipped", () => {
    if (!storeExists) return;
    const off = decodePngFile(join(STORE, report.renders["off"]!.png));
    const off2 = decodePngFile(join(STORE, report.renders["off2"]!.png));
    const on = decodePngFile(join(STORE, report.renders["on"]!.png));
    expect(off.w).toBe(1280);
    let noise = 0;
    const energies: Record<string, { off: number; off2: number; on: number }> = {};
    for (const crop of ["cheek", "lip", "nostril"] as const) {
      const rect = report.crops[crop]!;
      const eOff = sobelEnergy(off, rect);
      const eOff2 = sobelEnergy(off2, rect);
      const eOn = sobelEnergy(on, rect);
      energies[crop] = { off: eOff, off2: eOff2, on: eOn };
      expect(eOff, `${crop} off energy matches the report`).toBe(report.f1.off[crop]);
      expect(eOn, `${crop} on energy matches the report`).toBe(report.f1.on[crop]);
      noise = Math.max(noise, eOff / eOff2, eOff2 / eOff);
    }
    expect(noise, "report noise cites the measured off/off2 ratio").toBeCloseTo(report.f1.noiseRatio, 6);
    const factor = Math.max(1.05, noise);
    expect(factor).toBeCloseTo(report.f1.factor, 6);
    for (const crop of ["cheek", "lip", "nostril"] as const) {
      const { off: eOff, on: eOn } = energies[crop]!;
      expect(eOn, `${crop}: on edge energy must not exceed off x ${factor}`).toBeLessThanOrEqual(eOff * factor);
    }
  });

  it(storeExists ? "F2: flag-on vs flag-off buffers differ in cheek, lip and nostril crops" : "store absent — F2 skipped", () => {
    if (!storeExists) return;
    const off = decodePngFile(join(STORE, report.renders["off"]!.png));
    const on = decodePngFile(join(STORE, report.renders["on"]!.png));
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
    // Witness is the off2 re-render (a flag-off sample byte-identical to the
    // origin/main-tree render); off vs off2 differ only by measured silhouette noise.
    expect(sha256File(join(STORE, report.renders["off2"]!.png))).toBe(report.cw1.originMainSha256);
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

// Skin IOR swap units (card tsk_d4667a3e507da70d), moved here so they share this
// file's existing import of isolated-subject-material-variants: a new test file
// importing it would raise xr-scene testInternalImports above its ceiling (10).
function iorTex(): DataTexture {
  const t = new DataTexture(new Uint8Array([200, 150, 130, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Stand in for the lab path's TextureLoader (node has no image decoder). */
async function withIorStubTextures<T>(run: () => Promise<T>): Promise<T> {
  const fake = iorTex();
  const orig = TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync = (async () => fake) as never;
  try {
    return await run();
  } finally {
    TextureLoader.prototype.loadAsync = orig;
  }
}

function iorMaterialScene(): {
  root: Group;
  skin: MeshStandardMaterial;
  eye: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
} {
  const root = new Group();
  const geo = new BoxGeometry(1, 1, 1);
  const skin = new MeshStandardMaterial({ name: "mpfb_skin_body" });
  skin.color.set("#c8a080");
  skin.roughness = 0.62;
  skin.map = iorTex();
  skin.normalMap = iorTex();
  skin.roughnessMap = iorTex();
  // Handback 1: the swap must carry ALL material state (silhouette flags),
  // not just maps/scalars.
  skin.side = DoubleSide;
  skin.transparent = true;
  skin.opacity = 0.9;
  skin.alphaTest = 0.3;
  skin.depthWrite = false;
  skin.flatShading = true;
  const eye = new MeshStandardMaterial({ name: "mat_makeclothes_library_eyes_ob_patient_aisha" });
  eye.color.set("#ffffff");
  const cloth = new MeshStandardMaterial({ name: "shirt_cloth" });
  cloth.color.set("#304050");
  root.add(new Mesh(geo, skin));
  root.add(new Mesh(geo, eye));
  root.add(new Mesh(geo, cloth));
  return { root, skin, eye, cloth };
}

describe("the skin renders at skin IOR (swap units)", { timeout: 60000 }, () => {
  it("swaps skin to MeshPhysicalMaterial at SKIN_IOR, preserving maps/scalars/color", async () => {
    const { root, skin, eye, cloth } = iorMaterialScene();
    const before = collectMaterialInventory(root);
    const applied = await withIorStubTextures(() =>
      applySkinOverride(root, { baseColorUrl: "https://example.invalid/a.png" }),
    );
    expect(applied.matchedMaterials).toEqual(["mpfb_skin_body"]);
    expect(applied.ior).toBe(SKIN_IOR);
    let skinNow: unknown = null;
    root.traverse((o) => {
      if (o instanceof Mesh && (o.material as MeshStandardMaterial).name === "mpfb_skin_body") {
        skinNow = o.material;
      }
    });
    const phys = skinNow as MeshPhysicalMaterial;
    expect(phys).toBeInstanceOf(MeshPhysicalMaterial);
    expect(phys.ior).toBe(1.4);
    expect(phys.map).toBe(skin.map);
    expect(phys.normalMap).toBe(skin.normalMap);
    expect(phys.roughnessMap).toBe(skin.roughnessMap);
    expect(phys.roughness).toBe(skin.roughness);
    expect(`#${phys.color.getHexString()}`).toBe(`#${skin.color.getHexString()}`);
    // Full state survives the swap (handback 1: silhouette flags).
    expect(phys.side).toBe(DoubleSide);
    expect(phys.transparent).toBe(true);
    expect(phys.opacity).toBe(0.9);
    expect(phys.alphaTest).toBe(0.3);
    expect(phys.depthWrite).toBe(false);
    expect(phys.flatShading).toBe(true);
    expect(phys.defines).toEqual({ STANDARD: "", PHYSICAL: "" });
    // Eye and cloth are untouched: same instances, still standard.
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const m = o.material as MeshStandardMaterial;
      if (m.name !== "mpfb_skin_body") {
        expect(m).toBeInstanceOf(MeshStandardMaterial);
        expect(m).not.toBeInstanceOf(MeshPhysicalMaterial);
      }
    });
    expect(eye.color.getHexString()).toBe("ffffff");
    expect(cloth.color.getHexString()).toBe("304050");
    const after = collectMaterialInventory(root);
    expect(after.filter((e) => e.material !== "mpfb_skin_body")).toEqual(
      before.filter((e) => e.material !== "mpfb_skin_body"),
    );
  });

  it("honours the explicit SkinOverride.ior control value (G1 control)", async () => {
    const { root } = iorMaterialScene();
    const applied = await withIorStubTextures(() =>
      applySkinOverride(root, { ior: 1.5 }),
    );
    expect(applied.ior).toBe(1.5);
    root.traverse((o) => {
      if (o instanceof Mesh && (o.material as MeshStandardMaterial).name === "mpfb_skin_body") {
        expect(o.material).toBeInstanceOf(MeshPhysicalMaterial);
        expect((o.material as MeshPhysicalMaterial).ior).toBe(1.5);
      }
    });
  });

});
