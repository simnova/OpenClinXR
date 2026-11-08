import { readFileSync } from "node:fs";
import { BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { tintGeneratedSceneMaterials } from "./material-tint.js";

const AISHA_GLB = new URL("../../../../apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb", import.meta.url);
const ROLE_TINT = 0x8fb9aa;

type GltfMaterial = {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
};

type GltfJson = {
  materials?: GltfMaterial[];
};

function readGltfJsonChunk(path: URL): GltfJson {
  const glb = readFileSync(path);
  expect(glb.toString("utf8", 0, 4), "the shipped actor fixture must be a binary glTF").toBe("glTF");
  let offset = 12;
  while (offset < glb.length) {
    const chunkLength = glb.readUInt32LE(offset);
    const chunkType = glb.readUInt32LE(offset + 4);
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(glb.toString("utf8", offset + 8, offset + 8 + chunkLength).trim()) as GltfJson;
    }
    offset += 8 + chunkLength;
  }
  throw new Error(`GLB JSON chunk missing from ${path.pathname}`);
}

function shippedMaterials(): MeshStandardMaterial[] {
  const definitions = readGltfJsonChunk(AISHA_GLB).materials ?? [];
  return definitions.map((definition, index) => {
    const pbr = definition.pbrMetallicRoughness;
    const factor = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    const material = new MeshStandardMaterial({
      color: new Color().fromArray(factor),
      metalness: pbr?.metallicFactor ?? 1,
      roughness: pbr?.roughnessFactor ?? 1,
    });
    material.name = definition.name ?? `unnamed_material_${index}`;
    return material;
  });
}

function isVisibleShippedMpfbMaterial(name: string): boolean {
  return name.startsWith("mpfb_skin_")
    || name.startsWith("mat_makeclothes_library_")
    || name.startsWith("openclinxr_fitted_")
    || name.startsWith("mat_openclinxr_hm08_");
}

function materialState(material: MeshStandardMaterial): { color: number; roughness: number; policy: unknown } {
  return {
    color: material.color.getHex(),
    roughness: material.roughness,
    policy: material.userData["openClinXrMaterialPolicy"],
  };
}

describe("shipped MPFB materials keep their authored colour", () => {
  it("T1 reads Aisha's real GLB material table and preserves every visible authored material", () => {
    const materials = shippedMaterials();
    const requiredMaterialKinds = [
      ["skin", (name: string) => name.startsWith("mpfb_skin_")],
      ["hair", (name: string) => name.startsWith("openclinxr_fitted_hair_")],
      ["eyes", (name: string) => name.startsWith("mat_makeclothes_library_eyes_")],
      ["eyebrow", (name: string) => name.startsWith("openclinxr_fitted_eyebrow_")],
      ["eyelash", (name: string) => name.startsWith("openclinxr_fitted_eyelash_")],
      ["t-shirt", (name: string) => name.includes("t_shirt")],
    ] as const;
    const missingKinds = requiredMaterialKinds
      .filter(([, matches]) => !materials.some((material) => matches(material.name)))
      .map(([kind]) => kind);
    expect(missingKinds, `real GLB parse missed required material kinds: ${missingKinds.join(", ")}`).toEqual([]);

    const authored = materials.filter((material) => isVisibleShippedMpfbMaterial(material.name));
    const coloursBeforeTint = new Map(authored.map((material) => [material.name, material.color.getHex()]));
    const root = new Group();
    const meshes = materials.map((material) => new Mesh(new BufferGeometry(), material));
    root.add(...meshes);

    tintGeneratedSceneMaterials(root, ROLE_TINT, "patient_aisha_khan_v1");

    const mismatches = authored.flatMap((source) => {
      const mesh = meshes[materials.indexOf(source)];
      const output = mesh?.material;
      if (!(output instanceof MeshStandardMaterial)) return [`${source.name}: output was not MeshStandardMaterial`];
      const failures: string[] = [];
      if (output.color.getHex() !== coloursBeforeTint.get(source.name)) {
        failures.push(`${source.name}: ${output.color.getHexString()} != ${source.color.getHexString()}`);
      }
      if (output.userData["openClinXrMaterialPolicy"] !== "preserve_shipped_mpfb_makeclothes_authored_material_colour") {
        failures.push(`${source.name}: missing shipped-MPFB authored-colour policy`);
      }
      return failures;
    });
    expect(mismatches, `authored colours changed:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("CW1 still lerps an unrelated generated material by exactly 0.18", () => {
    const material = new MeshStandardMaterial({ color: 0xffffff });
    material.name = "generic_generated_panel";
    const mesh = new Mesh(new BufferGeometry(), material);
    const root = new Group();
    root.add(mesh);

    tintGeneratedSceneMaterials(root, ROLE_TINT, "patient_aisha_khan_v1");

    expect((mesh.material as MeshStandardMaterial).color.getHex()).toBe(0xf0f4f3);
  });

  it("CW2 clones tinted materials without changing the source colour", () => {
    const source = new MeshStandardMaterial({ color: 0x456789 });
    source.name = "generic_generated_panel";
    const mesh = new Mesh(new BufferGeometry(), source);
    const root = new Group();
    root.add(mesh);

    tintGeneratedSceneMaterials(root, ROLE_TINT, "patient_aisha_khan_v1");

    expect(mesh.material).not.toBe(source);
    expect(source.color.getHex()).toBe(0x456789);
  });

  it("CW3 keeps every existing anny and review branch byte-for-byte compatible", () => {
    const cases = [
      {
        name: "anny_authored_clothing",
        expected: { color: 0x234567, roughness: 0.63, policy: "preserve_anny_authored_skin_face_clothing_contrast" },
      },
      {
        name: "authored_face_review",
        expected: { color: 0x234567, roughness: 0.63, policy: "preserve_anny_authored_skin_face_clothing_contrast" },
      },
      {
        name: "anny_mesh_skin_warm_review",
        expected: { color: 0xd3a184, roughness: 0.82, policy: "runtime_warm_skin_tone_for_generated_anny_humanoid" },
      },
      {
        name: "anny_mesh_lip_region_review",
        expected: { color: 0x9f5f57, roughness: 0.76, policy: "runtime_subtle_lip_region_contrast_for_generated_anny_humanoid" },
      },
      {
        name: "anny_mesh_nose_mouth_shadow_review",
        expected: { color: 0x8f695a, roughness: 0.88, policy: "runtime_subtle_nose_mouth_shadow_for_generated_anny_humanoid" },
      },
    ] as const;

    for (const testCase of cases) {
      const source = new MeshStandardMaterial({ color: 0x234567, roughness: 0.63 });
      source.name = testCase.name;
      const mesh = new Mesh(new BufferGeometry(), source);
      const root = new Group();
      root.add(mesh);
      tintGeneratedSceneMaterials(root, ROLE_TINT, "patient_aisha_khan_v1");
      expect(materialState(mesh.material as MeshStandardMaterial), testCase.name).toEqual(testCase.expected);
    }
  });
});
