/**
 * #76 shoulder coverage — body surface vs garment surface over the shoulder.
 *
 * Metric (no band or tolerance search): the highest body surface in the shoulder
 * region must not sit above the highest garment surface over it.
 *
 * claimScope: geometric shoulder coverage of real-garment shells on shipped GLBs.
 * notEvidenceFor: clinical costume appropriateness, drape quality, fabric realism,
 * production readiness, lower-body garments, Quest performance.
 *
 * Independence: samples are read from mesh positions in the GLB (body vs garment
 * name split). No bone joints, no generator placement constants, no synthetic
 * `_arm_p` fractions. Lateral shoulder is defined from the body AABB only
 * (half-width + upper-half lateral verts) — not from a Y band chosen after
 * inspecting current assets.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_ANY_RE = /openclinxr_declared_upper_layers__/i;

type Vec3 = { x: number; y: number; z: number };

export type ShoulderCoverageFacts = {
  shoulderTopY: number;
  garmentMaxYOverShoulder: number;
  covered: boolean;
};

/**
 * Pure verdict: garment surface over the shoulder must reach at least the body
 * shoulder top. No epsilon — if you need one, the FIXED block must say why.
 */
export function shoulderCoverageVerdict(facts: {
  shoulderTopY: number;
  garmentMaxYOverShoulder: number;
}): boolean {
  return facts.garmentMaxYOverShoulder >= facts.shoulderTopY;
}

/**
 * Measure shoulder coverage from a shipped humanoid GLB.
 */
export async function assessShoulderCoverage(input: {
  glbPath: string;
}): Promise<ShoulderCoverageFacts> {
  const abs = path.isAbsolute(input.glbPath)
    ? input.glbPath
    : path.resolve(process.cwd(), input.glbPath);
  if (!existsSync(abs)) {
    throw new Error(`assessShoulderCoverage: GLB not found: ${abs}`);
  }

  const document = await new NodeIO().read(abs);
  const body: Vec3[] = [];
  const garment: Vec3[] = [];

  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (DECLARED_ANY_RE.test(name)) continue;
    const isGarment = GARMENT_MESH_RE.test(name);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        const v = {
          x: Number(pos[i]),
          y: Number(pos[i + 1]),
          z: Number(pos[i + 2]),
        };
        if (isGarment) garment.push(v);
        else body.push(v);
      }
    }
  }

  if (body.length === 0) {
    return {
      shoulderTopY: 0,
      garmentMaxYOverShoulder: 0,
      covered: false,
    };
  }

  const minY = Math.min(...body.map((v) => v.y));
  const maxY = Math.max(...body.map((v) => v.y));
  const minX = Math.min(...body.map((v) => v.x));
  const maxX = Math.max(...body.map((v) => v.x));
  const cx = (minX + maxX) * 0.5;
  const height = Math.max(maxY - minY, 0.001);
  const halfW = Math.max((maxX - minX) * 0.5, 0.001);

  // Shoulder region of the BODY: lateral verts in the upper half of the figure.
  // Lateral = outer portion of body half-width (deltoid/acromion, not sternum/head).
  // Upper half = above mid-height (excludes hips/legs). Head crown is near center-X
  // so it is excluded by the lateral cut — not by a post-hoc Y band.
  const LATERAL = 0.32; // fraction of half-width; fixed geometric cut, not a tuned band
  const UPPER = 0.5; // mid-height floor from body AABB
  const shoulderBody = body.filter((v) => {
    const yn = (v.y - minY) / height;
    if (yn < UPPER) return false;
    return Math.abs(v.x - cx) >= halfW * LATERAL;
  });

  const shoulderTopY =
    shoulderBody.length > 0
      ? Math.max(...shoulderBody.map((v) => v.y))
      : 0;

  // Garment over the same lateral footprint (not mid-X collar max — that was #73).
  // Same LATERAL fraction so "over it" means over the shoulder region, not over the neck.
  const garmentOverShoulder = garment.filter(
    (v) => Math.abs(v.x - cx) >= halfW * LATERAL,
  );
  const garmentMaxYOverShoulder =
    garmentOverShoulder.length > 0
      ? Math.max(...garmentOverShoulder.map((v) => v.y))
      : garment.length > 0
        ? Math.max(...garment.map((v) => v.y))
        : 0;

  const covered = shoulderCoverageVerdict({
    shoulderTopY,
    garmentMaxYOverShoulder,
  });

  return {
    shoulderTopY: round4(shoulderTopY),
    garmentMaxYOverShoulder: round4(garmentMaxYOverShoulder),
    covered,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
