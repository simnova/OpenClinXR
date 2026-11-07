/**
 * RED for tsk_f5a7cf0e6653968c: detail normals follow bind-pose object-space
 * triplanar coordinates. The UV-anisotropy fade is retired; an inverted
 * guard below rejects its return and names the triplanar replacement.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Primitive } from "@gltf-transform/core";
import {
  BoxGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderLib,
  TextureLoader,
} from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMaterialOverrides } from "../isolated-subject-material-variants.js";
import { measureShippedBodyTilePeriod } from "./measure-body-tile-period.js";
import { measureTriplanarFrequency } from "./measure-triplanar-frequency.js";
import {
  dominantSkinTriplanarPlane,
  SKIN_BODY_CELL_AREA_MM2,
  SKIN_BODY_DETAIL_TILES_PER_METRE,
  SKIN_BODY_TILE_PEAK_CYCLES,
  SKIN_FACE_DETAIL_TILES_PER_METRE,
  type SkinVec2,
  type SkinVec3,
  skinDetailObjectDeviation,
  skinTriplanarPlaneCoordinate,
} from "./skin-shade-triplanar.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const partnerGlb = resolve(
  repoRoot,
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
);
const streetGlb = resolve(
  repoRoot,
  "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb",
);
const triplanarSource = readFileSync(resolve(here, "skin-shade-triplanar.ts"), "utf8");

let vertexShader = "";
let fragmentShader = "";

async function compiledDetailShader(
  useSkinning = false,
): Promise<{ vertexShader: string; fragmentShader: string }> {
  const texture = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const material = new MeshStandardMaterial({ name: "mpfb_skin_triplanar_probe" });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(1, 1, 1), material));
  const originalLoadAsync = TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync = (async () => texture) as never;
  try {
    await applyMaterialOverrides(root, [
      {
        match: "mpfb_skin",
        skinShadeCurvatureUrl: "https://example.invalid/curvature.png",
        skinShade: {
          detailNormalMap: texture,
          detailNormalStrength: 0.15,
          bodyDetailNormalMap: texture,
          bodyDetailNormalStrength: 0.3,
        },
      },
    ]);
  } finally {
    TextureLoader.prototype.loadAsync = originalLoadAsync;
  }
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return {
    ...shader,
    vertexShader: `${useSkinning ? "#define USE_SKINNING\n" : ""}${shader.vertexShader}`,
  };
}

function detailUvViolations(source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(
    /(?:texture2D|textureGrad)\(\s*(uSkin(?:Body)?DetailNormalMap)\s*,\s*([^,\n)]+)/g,
  )) {
    if (match[2]!.includes("vMapUv")) violations.push(match[0]);
  }
  for (const line of source.split("\n")) {
    if (/skin(?:Face|Body)(?:Detail)?Uv(?:[XYZ])?.*=.*vMapUv/.test(line)) violations.push(line.trim());
  }
  return violations;
}

function assertDetailSamplesDoNotUseMapUv(source: string): void {
  expect(
    detailUvViolations(source),
    "R1 detail-normal samples must derive from bind-pose triplanar coordinates, never vMapUv",
  ).toEqual([]);
  expect(source).toContain("skinTriplanarUvX(vSkinBindPos");
  expect(source).toContain("skinTriplanarUvY(vSkinBindPos");
  expect(source).toContain("skinTriplanarUvZ(vSkinBindPos");
}

function assertRawBindPositionOrder(source: string): void {
  const begin = source.indexOf("#include <begin_vertex>");
  const assignment = source.indexOf("vSkinBindPos = position;");
  const morph = source.indexOf("#include <morphtarget_vertex>");
  const skinning = source.indexOf("#include <skinning_vertex>");
  expect(
    { begin, assignment, morph, skinning },
    "R2 vSkinBindPos must be assigned from raw position after begin_vertex and before morph/skinning",
  ).toSatisfy(
    (indices: { begin: number; assignment: number; morph: number; skinning: number }) =>
      indices.begin >= 0 &&
      indices.assignment > indices.begin &&
      indices.assignment < indices.morph &&
      indices.assignment < indices.skinning,
  );
  expect(source).toContain("vSkinBindN = normal;");
}

function assertDetailPerturbsIncomingNormal(source: string): void {
  expect(
    source,
    "T5 detail must add its view-space deviation to the incoming glTF/blur normal",
  ).toContain("normal = normalize(normal + skinDetailViewDeviation);");
  expect(source).not.toContain("normal = normalize(normalMatrix *");
}

function skinAxisBranches(source: string): { skinned: string; unskinned: string } {
  const skinningChunk = source.indexOf("#include <skinning_vertex>");
  const condition = source.indexOf("#ifdef USE_SKINNING", skinningChunk);
  const otherwise = source.indexOf("#else", condition);
  const end = source.indexOf("#endif", otherwise);
  expect(
    { skinningChunk, condition, otherwise, end },
    "T6 skin-axis conditional must follow Three's skinning_vertex chunk",
  ).toSatisfy(
    (indices: { skinningChunk: number; condition: number; otherwise: number; end: number }) =>
      indices.skinningChunk >= 0 &&
      indices.condition > indices.skinningChunk &&
      indices.otherwise > indices.condition &&
      indices.end > indices.otherwise,
  );
  return {
    skinned: source.slice(condition, otherwise),
    unskinned: source.slice(otherwise, end),
  };
}

function replaceOnce(source: string, from: string, to: string, probe: string): string {
  const matches = source.split(from).length - 1;
  expect(matches, `${probe} substitution must match exactly once`).toBe(1);
  return source.replace(from, to);
}

function assertPhysicalBodyFrequencySource(source: string): void {
  expect(
    source,
    "T10 body frequency must remain the physical cell-spacing / measured tile-period derivation",
  ).toContain(
    "(1 / Math.sqrt(SKIN_BODY_CELL_AREA_MM2 * 1e-6)) / SKIN_BODY_TILE_PEAK_CYCLES",
  );
}

type Triangle = {
  positions: readonly [SkinVec3, SkinVec3, SkinVec3];
  normals: readonly [SkinVec3, SkinVec3, SkinVec3];
  uvs: readonly [SkinVec2, SkinVec2, SkinVec2];
  dominantJoints: readonly [string, string, string];
};

function skinPrimitive(document: Awaited<ReturnType<NodeIO["read"]>>): {
  primitive: Primitive;
  jointNames: string[];
} {
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (
        skin &&
        primitive.getMaterial()?.getName().startsWith("mpfb_skin_") &&
        primitive.getAttribute("TEXCOORD_0")
      ) {
        return { primitive, jointNames: skin.listJoints().map((joint) => joint.getName()) };
      }
    }
  }
  throw new Error("actor has no indexed UV-mapped mpfb skin primitive");
}

async function triangleAt(glb: string, triangleIndex: number): Promise<Triangle> {
  const { primitive, jointNames } = skinPrimitive(await new NodeIO().read(glb));
  const indices = primitive.getIndices()!.getArray()!;
  const positions = primitive.getAttribute("POSITION")!.getArray()!;
  const normals = primitive.getAttribute("NORMAL")!.getArray()!;
  const uvs = primitive.getAttribute("TEXCOORD_0")!.getArray()!;
  const joints = primitive.getAttribute("JOINTS_0")!.getArray()!;
  const weights = primitive.getAttribute("WEIGHTS_0")!.getArray()!;
  const vertices = [
    indices[triangleIndex * 3]!,
    indices[triangleIndex * 3 + 1]!,
    indices[triangleIndex * 3 + 2]!,
  ] as const;
  return {
    positions: vertices.map((vertex) => [
      positions[vertex * 3]!,
      positions[vertex * 3 + 1]!,
      positions[vertex * 3 + 2]!,
    ]) as unknown as Triangle["positions"],
    normals: vertices.map((vertex) => [
      normals[vertex * 3]!,
      normals[vertex * 3 + 1]!,
      normals[vertex * 3 + 2]!,
    ]) as unknown as Triangle["normals"],
    uvs: vertices.map((vertex) => [uvs[vertex * 2]!, uvs[vertex * 2 + 1]!]) as unknown as Triangle["uvs"],
    dominantJoints: vertices.map((vertex) => {
      let slot = 0;
      for (let candidate = 1; candidate < 4; candidate += 1) {
        if (weights[vertex * 4 + candidate]! > weights[vertex * 4 + slot]!) slot = candidate;
      }
      return jointNames[joints[vertex * 4 + slot]!]!;
    }) as unknown as Triangle["dominantJoints"],
  };
}

/** Principal-stretch ratio of the position-from-sampled-coordinate Jacobian. */
function coordinateAnisotropy(positions: Triangle["positions"], coordinates: Triangle["uvs"]): number {
  const edge1 = positions[1].map((value, axis) => value - positions[0][axis]!) as number[];
  const edge2 = positions[2].map((value, axis) => value - positions[0][axis]!) as number[];
  const du1 = coordinates[1][0] - coordinates[0][0];
  const dv1 = coordinates[1][1] - coordinates[0][1];
  const du2 = coordinates[2][0] - coordinates[0][0];
  const dv2 = coordinates[2][1] - coordinates[0][1];
  const determinant = du1 * dv2 - dv1 * du2;
  if (Math.abs(determinant) < 1e-12) return Number.POSITIVE_INFINITY;
  const ju = edge1.map((value, axis) => (value * dv2 - edge2[axis]! * dv1) / determinant);
  const jv = edge1.map((value, axis) => (-value * du2 + edge2[axis]! * du1) / determinant);
  const aa = ju.reduce((sum, value) => sum + value * value, 0);
  const ab = ju.reduce((sum, value, axis) => sum + value * jv[axis]!, 0);
  const bb = jv.reduce((sum, value) => sum + value * value, 0);
  const discriminant = Math.sqrt((aa - bb) ** 2 + 4 * ab * ab);
  return Math.sqrt((aa + bb + discriminant) / (aa + bb - discriminant));
}

function dominantPlaneCoordinates(triangle: Triangle): Triangle["uvs"] {
  const averageNormal = [0, 1, 2].map(
    (axis) =>
      (triangle.normals[0][axis]! + triangle.normals[1][axis]! + triangle.normals[2][axis]!) / 3,
  ) as unknown as SkinVec3;
  const plane = dominantSkinTriplanarPlane(averageNormal);
  return triangle.positions.map((position) =>
    skinTriplanarPlaneCoordinate(position, plane, SKIN_FACE_DETAIL_TILES_PER_METRE),
  ) as unknown as Triangle["uvs"];
}

beforeAll(async () => {
  ({ vertexShader, fragmentShader } = await compiledDetailShader());
});

describe("skin detail follows the bind-pose surface instead of stretched UVs", () => {
  it("R1: face and body detail-map samples do not derive coordinates from vMapUv", () => {
    assertDetailSamplesDoNotUseMapUv(fragmentShader);
    expect(
      fragmentShader,
      "the retired UV-anisotropy fade must not return; bind-pose triplanar sampling replaces it",
    ).not.toMatch(/skinStretchFade|skinStretchAnisotropy|skinStretchUvDx/);
  });

  it("R2: bind position is captured from the raw attribute before morphing and skinning", () => {
    assertRawBindPositionOrder(vertexShader);
  });

  it("R3a PLANTED: putting a face sample back on vMapUv makes R1 fail", () => {
    const from = "texture2D(uSkinDetailNormalMap, skinFaceUvX)";
    const before = fragmentShader.slice(fragmentShader.indexOf(from) - 40, fragmentShader.indexOf(from) + from.length + 40);
    const planted = replaceOnce(
      fragmentShader,
      from,
      "texture2D(uSkinDetailNormalMap, vMapUv)",
      "R3a vMapUv plant",
    );
    const afterNeedle = "texture2D(uSkinDetailNormalMap, vMapUv)";
    const after = planted.slice(planted.indexOf(afterNeedle) - 40, planted.indexOf(afterNeedle) + afterNeedle.length + 40);
    console.log("R3a BEFORE\n" + before + "\nR3a AFTER\n" + after);
    expect(() => assertDetailSamplesDoNotUseMapUv(planted)).toThrow(/R1 detail-normal samples/);
  });

  it("R3b PLANTED: assigning transformed after skinning makes R2 fail", () => {
    let planted = replaceOnce(vertexShader, "vSkinBindPos = position;", "", "R3b raw assignment plant");
    planted = replaceOnce(
      planted,
      "#include <skinning_vertex>",
      "#include <skinning_vertex>\nvSkinBindPos = transformed;",
      "R3b post-skin assignment plant",
    );
    const before = vertexShader.slice(vertexShader.indexOf("vSkinBindPos = position;") - 40, vertexShader.indexOf("vSkinBindPos = position;") + 70);
    const needle = "#include <skinning_vertex>\nvSkinBindPos = transformed;";
    const after = planted.slice(planted.indexOf(needle) - 40, planted.indexOf(needle) + needle.length + 40);
    console.log("R3b BEFORE\n" + before + "\nR3b AFTER\n" + after);
    expect(() => assertRawBindPositionOrder(planted)).toThrow(/R2 vSkinBindPos/);
  });

  it("R4: the partner defect and a known-good street jaw stay below the cutoff", async () => {
    const partner = await triangleAt(partnerGlb, 6626);
    expect(partner.dominantJoints).toEqual(["oris07.L", "oris07.L", "jaw"]);
    expect(coordinateAnisotropy(partner.positions, partner.uvs)).toBeCloseTo(17.7646, 3);
    expect(coordinateAnisotropy(partner.positions, dominantPlaneCoordinates(partner))).toBeLessThanOrEqual(4.0);

    const street = await triangleAt(streetGlb, 748);
    expect(street.dominantJoints).toEqual(["oris01", "jaw", "jaw"]);
    expect(coordinateAnisotropy(street.positions, street.uvs)).toBeLessThan(4.0);
    expect(coordinateAnisotropy(street.positions, dominantPlaneCoordinates(street))).toBeLessThanOrEqual(4.0);
    expect(SKIN_FACE_DETAIL_TILES_PER_METRE).toBe(80.14228915458304);
    expect(SKIN_BODY_DETAIL_TILES_PER_METRE).toBeCloseTo(185.1851851851852, 12);
  });

  it("T5: detail perturbs the incoming normal instead of replacing it", () => {
    assertDetailPerturbsIncomingNormal(fragmentShader);
  });

  it("T6: the view-space bind axes follow skinMatrix only when skinning is enabled", async () => {
    const skinnedProgram = (await compiledDetailShader(true)).vertexShader;
    const unskinnedProgram = (await compiledDetailShader(false)).vertexShader;
    expect(skinnedProgram).toMatch(/^#define USE_SKINNING\n/);
    expect(unskinnedProgram).not.toContain("#define USE_SKINNING");

    const skinned = skinAxisBranches(skinnedProgram);
    const unskinned = skinAxisBranches(unskinnedProgram);
    for (const axis of ["X", "Y", "Z"]) {
      expect(skinned.skinned).toMatch(
        new RegExp(`vSkinAxis${axis} = normalize\\(normalMatrix \\* \\(skinMatrix \\* vec4`),
      );
      expect(unskinned.unskinned).toMatch(
        new RegExp(`vSkinAxis${axis} = normalize\\(normalMatrix \\* vec3`),
      );
    }
    expect(unskinned.unskinned).not.toContain("skinMatrix");
  });

  it("T7 PLANTED: restoring the r1 overwrite makes T5 fail", () => {
    const from = "normal = normalize(normal + skinDetailViewDeviation);";
    const to = "normal = normalize(normalMatrix * skinDetailObjectNormal);";
    const before = fragmentShader.slice(fragmentShader.indexOf(from) - 80, fragmentShader.indexOf(from) + from.length + 40);
    const planted = replaceOnce(fragmentShader, from, to, "T7 r1 overwrite plant");
    const after = planted.slice(planted.indexOf(to) - 80, planted.indexOf(to) + to.length + 40);
    console.log("T7 BEFORE\n" + before + "\nT7 AFTER\n" + after);
    expect(() => assertDetailPerturbsIncomingNormal(planted)).toThrow(/T5 detail must add/);
  });

  it("T8: zero object-space detail deviation leaves the incoming normal unchanged", () => {
    const bindNormal = [0.267261, 0.534522, 0.801784] as const;
    expect(skinDetailObjectDeviation(bindNormal, bindNormal)).toEqual([0, 0, 0]);
    expect(fragmentShader).toContain(
      "vec3 skinDetailObjectDeviation = skinDetailObjectNormal - skinBindNormal;",
    );
    expect(fragmentShader).toContain(
      "normal = normalize(normal + skinDetailViewDeviation);",
    );
  });

  it("T9: the shipped body's measured tile period reproduces the pinned body frequency", async () => {
    const measurement = await measureShippedBodyTilePeriod();
    expect(measurement.imageSha256.slice(0, 8)).toBe("0d7f18ff");
    expect([measurement.width, measurement.height]).toEqual([256, 256]);
    expect(measurement.peaks.map((peak) => peak.frequencyCyclesPerTile)).toEqual([18, 21, 24]);
    expect(measurement.peaks[0].frequencyCyclesPerTile).toBe(SKIN_BODY_TILE_PEAK_CYCLES);
    const measuredTilesPerMetre =
      (1 / Math.sqrt(SKIN_BODY_CELL_AREA_MM2 * 1e-6)) /
      measurement.peaks[0].frequencyCyclesPerTile;
    expect(Math.abs(measuredTilesPerMetre - SKIN_BODY_DETAIL_TILES_PER_METRE)).toBeLessThanOrEqual(
      1e-9,
    );
  });

  it("T11: re-measuring the shipped street face reproduces the pinned face frequency", async () => {
    const measurement = await measureTriplanarFrequency();
    expect(measurement.face.triangleCount).toBe(5460);
    expect(measurement.face.edgeCount).toBe(16380);
    expect(Math.abs(measurement.face.tilesPerMetre - SKIN_FACE_DETAIL_TILES_PER_METRE)).toBeLessThanOrEqual(
      1e-9,
    );
  });

  it("T10 PLANTED: the body frequency is physically derived from cell area and tile period", () => {
    const expected =
      (1 / Math.sqrt(SKIN_BODY_CELL_AREA_MM2 * 1e-6)) / SKIN_BODY_TILE_PEAK_CYCLES;
    expect(SKIN_BODY_CELL_AREA_MM2).toBe(0.09);
    expect(SKIN_BODY_DETAIL_TILES_PER_METRE).toBe(expected);
    assertPhysicalBodyFrequencySource(triplanarSource);

    const physicalFormula =
      "(1 / Math.sqrt(SKIN_BODY_CELL_AREA_MM2 * 1e-6)) / SKIN_BODY_TILE_PEAK_CYCLES";
    const planted = replaceOnce(
      triplanarSource,
      physicalFormula,
      "66.4658384337814",
      "T10 old UV-derived body-frequency plant",
    );
    const beforeStart = triplanarSource.indexOf(physicalFormula);
    const afterStart = planted.indexOf("66.4658384337814");
    console.log(
      "T10 BEFORE\n" +
        triplanarSource.slice(beforeStart - 80, beforeStart + physicalFormula.length + 30) +
        "\nT10 AFTER\n" +
        planted.slice(afterStart - 80, afterStart + 66),
    );
    expect(() => assertPhysicalBodyFrequencySource(planted)).toThrow(/T10 body frequency/);
  });
});
