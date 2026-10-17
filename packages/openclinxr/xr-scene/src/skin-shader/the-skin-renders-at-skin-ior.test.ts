/**
 * The skin renders at skin IOR (card tsk_d4667a3e507da70).
 *
 * WHY: three.js MeshStandardMaterial hardcodes dielectric F0 0.04
 * (IOR 1.5). Skin IOR is ~1.4 (F0 = ((1.4-1)/(1.4+1))^2 = 0.0278);
 * source cited beside SKIN_IOR in
 * packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts.
 * Decision (forehead-sheen-report.json, commit 66dc54f6c): skin colour /
 * sheen gates are measured on the product room rig (ob_triage_room_v1),
 * never the studio rig.
 *
 * Node unit (no browser): a skin-named MeshStandardMaterial plus an eye
 * and a cloth material -> skin becomes MeshPhysicalMaterial at SKIN_IOR
 * with maps/scalars/color preserved; the others are untouched; the
 * explicit SkinOverride.ior control value is honoured (G1 control).
 * Plus report validation: G0-G5 present with threshold sources, and
 * render shas recomputed when the store exists.
 */
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
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TextureLoader,
} from "three";
import {
  applySkinOverride,
  collectMaterialInventory,
  SKIN_IOR,
} from "../isolated-subject-material-variants.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPORT = join(
  here,
  "..", "..", "..", "..", "..",
  "tools", "openclinxr", "asset-pipeline", "skin", "face-replay",
  "room-rig-remeasure-report.json",
);
const STORE = "/Volumes/files/openclinxr-assets/store/skin-ior-room";

function tex(): DataTexture {
  const t = new DataTexture(new Uint8Array([200, 150, 130, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** Stand in for the lab path's TextureLoader (node has no image decoder). */
async function withStubTextures<T>(run: () => Promise<T>): Promise<T> {
  const fake = tex();
  const orig = TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync = (async () => fake) as never;
  try {
    return await run();
  } finally {
    TextureLoader.prototype.loadAsync = orig;
  }
}

function threeMaterialScene(): {
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
  skin.map = tex();
  skin.normalMap = tex();
  skin.roughnessMap = tex();
  const eye = new MeshStandardMaterial({ name: "mat_makeclothes_library_eyes_ob_patient_aisha" });
  eye.color.set("#ffffff");
  const cloth = new MeshStandardMaterial({ name: "shirt_cloth" });
  cloth.color.set("#304050");
  root.add(new Mesh(geo, skin));
  root.add(new Mesh(geo, eye));
  root.add(new Mesh(geo, cloth));
  return { root, skin, eye, cloth };
}

describe("the skin renders at skin IOR", { timeout: 60000 }, () => {
  it("exports SKIN_IOR 1.4 with F0 = ((n-1)/(n+1))^2 beside it", () => {
    expect(SKIN_IOR).toBe(1.4);
    const f0 = ((SKIN_IOR - 1) / (SKIN_IOR + 1)) ** 2;
    expect(f0).toBeCloseTo(0.0278, 3);
    const src = readFileSync(
      join(here, "..", "isolated-subject-material-variants.ts"),
      "utf8",
    );
    expect(src).toMatch(/Donner|GPU Gems|Tuchin/);
  });

  it("swaps skin to MeshPhysicalMaterial at SKIN_IOR, preserving maps/scalars/color", async () => {
    const { root, skin, eye, cloth } = threeMaterialScene();
    const before = collectMaterialInventory(root);
    const applied = await withStubTextures(() =>
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
    const { root } = threeMaterialScene();
    const applied = await withStubTextures(() =>
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

  it("room-rig-remeasure report carries G0-G5 with sources; render shas recompute", () => {
    expect(existsSync(REPORT)).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      gates: Record<string, { threshold_source?: unknown } | null>;
      renders: Array<{ path: string; sha256: string }>;
    };
    for (const g of ["G0", "G1", "G2", "G3", "G4", "G5"]) {
      expect(report.gates[g], g).toBeTruthy();
      expect(typeof (report.gates[g] as { threshold_source?: unknown }).threshold_source, `${g}.threshold_source`).toBe("string");
    }
    expect(report.gates["G6"]).toBeTruthy();
    if (existsSync(STORE)) {
      for (const r of report.renders) {
        const abs = r.path.startsWith("/") ? r.path : join("/", r.path);
        expect(existsSync(abs), abs).toBe(true);
        expect(createHash("sha256").update(readFileSync(abs)).digest("hex")).toBe(r.sha256);
      }
    }
  });
});
