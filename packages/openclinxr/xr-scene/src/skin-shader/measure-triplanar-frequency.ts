/**
 * Reproduce the bind-space triplanar frequencies pinned in
 * skin-shade-triplanar.ts.
 *
 * Usage from the repository root:
 *   pnpm exec tsx packages/openclinxr/xr-scene/src/skin-shader/measure-triplanar-frequency.ts
 *
 * Region assignment uses the triangle's dominant joint (the largest summed
 * WEIGHTS_0 contribution across all three vertices): literal `head` is face,
 * every other joint is body, as specified by the card. Only triangles below
 * the existing UV-anisotropy cutoff are admitted. The median is over every
 * |dUV| / |dPosition| edge measurement in the admitted triangles.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Primitive } from "@gltf-transform/core";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const actor = resolve(
  repoRoot,
  "apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb",
);

const FACE_UV_SCALE = 90;
const BODY_UV_SCALE = 128;
const MAX_UV_ANISOTROPY = 4;

type NumericArray = ArrayLike<number>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) throw new Error("cannot take median of an empty sample");
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function edgeDensity(
  positionValues: NumericArray,
  uvValues: NumericArray,
  a: number,
  b: number,
): number {
  const positionLength = Math.hypot(
    positionValues[b * 3]! - positionValues[a * 3]!,
    positionValues[b * 3 + 1]! - positionValues[a * 3 + 1]!,
    positionValues[b * 3 + 2]! - positionValues[a * 3 + 2]!,
  );
  const uvLength = Math.hypot(
    uvValues[b * 2]! - uvValues[a * 2]!,
    uvValues[b * 2 + 1]! - uvValues[a * 2 + 1]!,
  );
  return uvLength / positionLength;
}

function uvJacobianAnisotropy(
  positionValues: NumericArray,
  uvValues: NumericArray,
  vertices: readonly [number, number, number],
): number {
  const [a, b, c] = vertices;
  const e1 = [0, 1, 2].map(
    (axis) => positionValues[b * 3 + axis]! - positionValues[a * 3 + axis]!,
  );
  const e2 = [0, 1, 2].map(
    (axis) => positionValues[c * 3 + axis]! - positionValues[a * 3 + axis]!,
  );
  const du1 = uvValues[b * 2]! - uvValues[a * 2]!;
  const dv1 = uvValues[b * 2 + 1]! - uvValues[a * 2 + 1]!;
  const du2 = uvValues[c * 2]! - uvValues[a * 2]!;
  const dv2 = uvValues[c * 2 + 1]! - uvValues[a * 2 + 1]!;
  const determinant = du1 * dv2 - dv1 * du2;
  if (Math.abs(determinant) < 1e-12) return Number.POSITIVE_INFINITY;
  const ju = e1.map((value, axis) => (value * dv2 - e2[axis]! * dv1) / determinant);
  const jv = e1.map((value, axis) => (-value * du2 + e2[axis]! * du1) / determinant);
  const aa = ju.reduce((sum, value) => sum + value * value, 0);
  const ab = ju.reduce((sum, value, axis) => sum + value * jv[axis]!, 0);
  const bb = jv.reduce((sum, value) => sum + value * value, 0);
  const discriminant = Math.sqrt((aa - bb) ** 2 + 4 * ab * ab);
  const smaller = aa + bb - discriminant;
  return smaller <= 0
    ? Number.POSITIVE_INFINITY
    : Math.sqrt((aa + bb + discriminant) / smaller);
}

function skinPrimitive(sourceDocument: Awaited<ReturnType<NodeIO["read"]>>): {
  primitive: Primitive;
  jointNames: string[];
} {
  for (const node of sourceDocument.getRoot().listNodes()) {
    const skin = node.getSkin();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (
        skin &&
        primitive.getMaterial()?.getName().startsWith("mpfb_skin_") &&
        primitive.getAttribute("TEXCOORD_0")
      ) {
        return {
          primitive,
          jointNames: skin.listJoints().map((joint) => joint.getName()),
        };
      }
    }
  }
  throw new Error("measured actor has no UV-mapped mpfb_skin_ primitive");
}

/** Re-measure the face/body UV densities that pin the triplanar frequencies. */
export async function measureTriplanarFrequency() {
  const document = await new NodeIO().read(actor);
  const { primitive, jointNames } = skinPrimitive(document);
  const indices = primitive.getIndices()?.getArray();
  const positions = primitive.getAttribute("POSITION")?.getArray();
  const uvs = primitive.getAttribute("TEXCOORD_0")?.getArray();
  const joints = primitive.getAttribute("JOINTS_0")?.getArray();
  const weights = primitive.getAttribute("WEIGHTS_0")?.getArray();
  if (!indices || !positions || !uvs || !joints || !weights) {
    throw new Error("measured skin primitive is missing indexed position/UV/skinning data");
  }

  const faceDensities: number[] = [];
  const bodyDensities: number[] = [];
  let faceTriangles = 0;
  let bodyTriangles = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [indices[offset]!, indices[offset + 1]!, indices[offset + 2]!] as const;
    if (uvJacobianAnisotropy(positions, uvs, vertices) >= MAX_UV_ANISOTROPY) continue;
    const triangleJointWeights = new Float64Array(jointNames.length);
    for (const vertex of vertices) {
      for (let slot = 0; slot < 4; slot += 1) {
        triangleJointWeights[joints[vertex * 4 + slot]!]! += weights[vertex * 4 + slot]!;
      }
    }
    let triangleJoint = 0;
    for (let joint = 1; joint < triangleJointWeights.length; joint += 1) {
      if (triangleJointWeights[joint]! > triangleJointWeights[triangleJoint]!) triangleJoint = joint;
    }
    const sample = jointNames[triangleJoint] === "head" ? faceDensities : bodyDensities;
    if (sample === faceDensities) faceTriangles += 1;
    else bodyTriangles += 1;
    sample.push(
      edgeDensity(positions, uvs, vertices[0], vertices[1]),
      edgeDensity(positions, uvs, vertices[1], vertices[2]),
      edgeDensity(positions, uvs, vertices[2], vertices[0]),
    );
  }

  const faceMedian = median(faceDensities);
  const bodyMedian = median(bodyDensities);
  return {
    actor: "mpfb-street-adult-male.glb",
    filter: `UV Jacobian anisotropy < ${MAX_UV_ANISOTROPY}`,
    regionRule: "largest triangle-summed joint weight; face iff joint name is head",
    face: {
      triangleCount: faceTriangles,
      edgeCount: faceDensities.length,
      medianUvPerMetre: faceMedian,
      uvScale: FACE_UV_SCALE,
      tilesPerMetre: faceMedian * FACE_UV_SCALE,
    },
    body: {
      triangleCount: bodyTriangles,
      edgeCount: bodyDensities.length,
      medianUvPerMetre: bodyMedian,
      uvScale: BODY_UV_SCALE,
      tilesPerMetre: bodyMedian * BODY_UV_SCALE,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await measureTriplanarFrequency(), null, 2));
}
