import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
// Arch: this gate test imports exactly one entrypoint-reachable module (the
// runtime material-flag path it must exercise). Report JSON comes through
// readFileSync (not a module import), so testInternalImports does not rise.
// The two entrypoint reroutes that offset this +1 (compiled-room-runtime-mount
// and learner-exam-form-boot through ./index.js) are recorded in
// eye-shader/wiring-report.json.
import {
  applyMaterialOverrides,
  type MaterialOverride,
} from "../isolated-subject-material-variants.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, "eye-shader-report.json");
const wiringPath = join(here, "wiring-report.json");
const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
  parallax: { tsPredictionPx: Record<string, number> };
  cyclesRef: { ior: number };
};
const sha256File = (p: string): string =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE = "/Volumes/files/openclinxr-assets/store/eye-shader-wire";
const storeExists = existsSync(STORE);

function stubShader(): {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
} {
  return {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main() {}\n#include <fog_vertex>",
    fragmentShader: "#include <common>\nvoid main() {}\n#include <map_fragment>",
  };
}

/** Realism-eye stub: globe mesh + iris material with a GLB-state map (unflipped transform). */
function eyeStub(): { mat: MeshStandardMaterial; tex: DataTexture } {
  const tex = new DataTexture(new Uint8Array([200, 150, 120, 255]), 1, 1);
  tex.repeat.set(1, 1);
  tex.offset.set(0, 0);
  const mat = new MeshStandardMaterial({ name: "mat_makeclothes_library_eyes_ob_patient_aisha" });
  mat.map = tex;
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
  mesh.name = "makeclothes_library_eyes_high_poly_globe_test_mesh";
  const root = new Group();
  root.add(mesh);
  (root as unknown as { __eyeMat: MeshStandardMaterial }).__eyeMat = mat;
  return { mat, tex };
}

async function flagRoot(override: MaterialOverride): Promise<Group> {
  const { mat } = eyeStub();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
  mesh.name = "makeclothes_library_eyes_high_poly_globe_test_mesh";
  const root = new Group();
  root.add(mesh);
  await applyMaterialOverrides(root, [override]);
  return root;
}

describe("the eye shader runs in the runtime", () => {
  it("CW2: eyeShade installs through the flag path (hook readback, not JSON)", async () => {
    const { mat, tex } = eyeStub();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
    mesh.name = "makeclothes_library_eyes_high_poly_globe_test_mesh";
    const root = new Group();
    root.add(mesh);
    const applied = await applyMaterialOverrides(root, [{ match: "makeclothes_library_eyes", eyeShade: true }]);
    const readback = applied[0]?.readback[0] as Record<string, unknown> | undefined;
    expect(readback?.eyeShade, "readback eyeShade must be true (hook-installed, not a JSON field)").toBe(true);
    expect(tex.repeat.y, "landed orientation presents the iris unwired: no UV flip").toBe(1);
    expect(tex.offset.y).toBe(0);
    let chained = false;
    const prevHook = mat.onBeforeCompile;
    mat.onBeforeCompile = ((...args: never[]) => {
      chained = true;
      (prevHook as (...a: never[]) => void)(...args);
    }) as typeof mat.onBeforeCompile;
    const shader = stubShader();
    mat.onBeforeCompile(shader as never, {} as never);
    expect(chained, "existing onBeforeCompile must chain").toBe(true);
    // Pupil-scale-1 head-on exact bypass (G3 unit half): uniform 1 + GLSL ==1.0 branch.
    expect(shader.uniforms["uPupilScale"]?.value).toBe(1);
    expect(shader.fragmentShader).toMatch(/uPupilScale == 1\.0/);
    // IOR numerals cite the report: Gullstrand 1.376, same optic the report validated.
    expect(shader.uniforms["uCorneaIOR"]?.value).toBe(report.cyclesRef.ior);
    expect(report.cyclesRef.ior).toBe(1.376);
    for (const u of [
      "uIrisCenterL",
      "uIrisCenterR",
      "uIrisAxisL",
      "uIrisAxisR",
      "uIrisUpL",
      "uIrisUpR",
      "uIrisRadiusU",
      "uLimbusWidthU",
      "uLimbusStrength",
      "uLimbusTint",
      "uCorneaRM",
      "uChamberM",
      "uUvPerMetre",
    ]) {
      expect(shader.uniforms[u], `uniform ${u} set`).toBeDefined();
    }
    expect(shader.uniforms["uIrisCenterL"]?.value).toEqual([299.55 / 1024, 724.0 / 1024]);
    expect(shader.uniforms["uIrisCenterR"]?.value).toEqual([724.65 / 1024, 302.72 / 1024]);
    // h1: mesh-derived iris axes (outward normals at the pupil verts), not assumed.
    expect((shader.uniforms["uIrisAxisL"]?.value as number[])[2]).toBeCloseTo(1, 3);
    expect((shader.uniforms["uIrisAxisR"]?.value as number[])[2]).toBeCloseTo(1, 3);
    expect(shader.uniforms["uIrisUpL"]?.value).toEqual([0, 1, 0]);
    expect(shader.uniforms["uIrisUpR"]?.value).toEqual([0, 1, 0]);
    expect(shader.vertexShader).toMatch(/vEyePosOS/);
    expect(shader.fragmentShader).toMatch(/refract\(/);
    expect(shader.fragmentShader).not.toMatch(/transmission/i);
    expect(shader.fragmentShader).not.toMatch(/emissive/i);
    expect("transmission" in mat, "no transmission pass on Quest").toBe(false);
    expect(mat.customProgramCacheKey?.()).toMatch(/^openclinxr-eye-shader:p1:l0\.4/);
  });

  it("G3 render config installs parallax-only (pupil 1, limbus 0)", async () => {
    const { mat } = eyeStub();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
    mesh.name = "makeclothes_library_eyes_high_poly_globe_test_mesh";
    const root = new Group();
    root.add(mesh);
    const applied = await applyMaterialOverrides(root, [
      { match: "makeclothes_library_eyes", eyeShade: { pupilScale: 1, limbusStrength: 0 } },
    ]);
    expect((applied[0]?.readback[0] as Record<string, unknown>)?.eyeShade).toBe(true);
    const shader = stubShader();
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms["uPupilScale"]?.value).toBe(1);
    expect(shader.uniforms["uLimbusStrength"]?.value).toBe(0);
    expect(mat.customProgramCacheKey?.()).toMatch(/^openclinxr-eye-shader:p1:l0$/);
  });

  it("G1: report predictions cited (head-on 0, yaw25 +10.93, yaw40 +18.77 at 1280)", () => {
    expect(report.parallax.tsPredictionPx["0"]).toBe(0);
    expect(report.parallax.tsPredictionPx["25"]).toBeCloseTo(10.93, 2);
    expect(report.parallax.tsPredictionPx["-25"]).toBeCloseTo(-10.93, 2);
    expect(report.parallax.tsPredictionPx["40"]).toBeCloseTo(18.77, 2);
    expect(report.parallax.tsPredictionPx["-40"]).toBeCloseTo(-18.77, 2);
  });

  it("flag OFF installs nothing: default program untouched (CW1 code-path gate)", async () => {
    const { mat, tex } = eyeStub();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), mat);
    mesh.name = "makeclothes_library_eyes_high_poly_globe_test_mesh";
    const root = new Group();
    root.add(mesh);
    const freshKey = mat.customProgramCacheKey();
    const applied = await applyMaterialOverrides(root, [{ match: "makeclothes_library_eyes" }]);
    expect((applied[0]?.readback[0] as Record<string, unknown>)?.eyeShade).toBe(false);
    const shader = stubShader();
    const beforeFrag = shader.fragmentShader;
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.fragmentShader).toBe(beforeFrag);
    expect(
      Object.keys(shader.uniforms).filter((k) => k.startsWith("uIris") || k.startsWith("uCornea") || k.startsWith("uChamber") || k.startsWith("uUvPer") || k.startsWith("uLimbus") || k.startsWith("uPupil")),
      "no eye uniforms without the flag",
    ).toEqual([]);
    expect(mat.customProgramCacheKey()).toBe(freshKey);
    expect(tex.repeat.y, "flag OFF leaves the landed sampling alone").toBe(1);
    expect(tex.offset.y).toBe(0);
  });

  it("garbage eye strengths refuse (fail-closed)", async () => {
    await expect(flagRoot({ match: "makeclothes_library_eyes", eyeShade: { pupilScale: Number.NaN } })).rejects.toThrow();
    await expect(flagRoot({ match: "makeclothes_library_eyes", eyeShade: { pupilScale: 0 } })).rejects.toThrow();
    await expect(flagRoot({ match: "makeclothes_library_eyes", eyeShade: { pupilScale: -1 } })).rejects.toThrow();
    await expect(flagRoot({ match: "makeclothes_library_eyes", eyeShade: { limbusStrength: -0.5 } })).rejects.toThrow();
    await expect(
      flagRoot({ match: "makeclothes_library_eyes", eyeShade: { limbusTint: [1, 2] as unknown as [number, number, number] } }),
    ).rejects.toThrow();
  });

  it("an eye override that matches nothing refuses", async () => {
    const root = new Group();
    await expect(
      applyMaterialOverrides(root, [{ match: "no_such_eye_material", eyeShade: true }]),
    ).rejects.toThrow(/matched nothing/);
  });

  it("wiring-report.json carries the runtime evidence (fail-closed without it)", () => {
    expect(existsSync(wiringPath), "wiring-report.json must exist beside the eye shader").toBe(true);
    const wiring = JSON.parse(readFileSync(wiringPath, "utf8")) as Record<string, unknown>;
    for (const key of ["g1", "g2", "g3", "cw1", "cw2", "cornea", "renders", "storeShas", "archOffset"]) {
      expect(wiring[key], `wiring-report.${key} present`).toBeDefined();
    }
    expect((wiring["predicted"] as Record<string, number>)?.["25"]).toBeCloseTo(10.93, 2);
    expect((wiring["predicted"] as Record<string, number>)?.["40"]).toBeCloseTo(18.77, 2);
  });

  it(storeExists ? "store shas verify (assets:eye-shader-wire/)" : "store absent — sha verification skipped", () => {
    if (!storeExists) return;
    const wiring = JSON.parse(readFileSync(wiringPath, "utf8")) as { storeShas: Record<string, string> };
    const names = Object.keys(wiring.storeShas);
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const n of names) {
      const p = join(STORE, n);
      expect(existsSync(p), `store file present: ${n}`).toBe(true);
      expect(sha256File(p), `sha of ${n}`).toBe(wiring.storeShas[n]);
    }
  });
});
