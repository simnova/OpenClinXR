/**
 * Teeth-behind-face median instrument (MADR 0061 mouth executor).
 *
 * Moved verbatim from tools/openclinxr/asset-pipeline/makeclothes/face-median.ts.
 * The tools module re-exports this file; behavior is unchanged.
 *
 * This is the same computation as the #739 population gate
 * (tools/openclinxr/evidence/every-humanoids-teeth-stay-behind-its-own-face.test.ts),
 * factored so the producer imports it instead of reimplementing it: teeth AABB
 * (max z, y band, x half-width) over every teeth primitive, skin median z inside
 * that band with the `mouth-open` morph at weight w, margins median minus teeth
 * max z at rest (w = 0) and at the runtime cap weight read from
 * `MOUTH_OPEN_CAP`, tongue gap teeth max z minus tongue max z. The gate file
 * itself is untouched; a scratch cross-check verified this module reproduces
 * its margins exactly on every shipped mpfb asset before the producer used it.
 */
import { readFileSync } from "node:fs";
import { NodeIO, type Document } from "@gltf-transform/core";

const CAP_SOURCE = "packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts";

/** The runtime's morph weight, read from source so a re-sweep binds automatically. */
export function runtimeCap(repoRoot: string): number {
  const source = readFileSync(`${repoRoot}/${CAP_SOURCE}`, "utf8");
  const m = /MOUTH_OPEN_CAP\s*=\s*([0-9.]+)/.exec(source);
  if (!m) throw new Error(`MOUTH_OPEN_CAP not found in ${CAP_SOURCE}`);
  return Number(m[1]);
}

export type FaceMargins = {
  teethMaxZ: number;
  teethYLo: number;
  teethYHi: number;
  teethXHalf: number;
  medianAtRest: number;
  medianAtCap: number;
  marginAtRest: number;
  marginAtCap: number;
  tongueGap: number;
  skinned: boolean;
};

/** Face margins for a loaded GLB document. Returns null when it has no teeth or body mesh. */
export function measureFaceMarginsFromDoc(doc: Document, capWeight: number): FaceMargins | null {
  const meshes = doc.getRoot().listMeshes();
  const teeth = meshes.find((m) => /teeth/i.test(m.getName()));
  const tongue = meshes.find((m) => /tongue/i.test(m.getName()));
  const body = meshes.find((m) => /_body$/.test(m.getName()));
  if (!teeth || !body) return null;

  const v = [0, 0, 0];
  let tMaxZ = -Infinity, yLo = Infinity, yHi = -Infinity, xHalf = 0, skinned = true;
  for (const pr of teeth.listPrimitives()) {
    if (!pr.getAttribute("JOINTS_0") || !pr.getAttribute("WEIGHTS_0")) skinned = false;
    const p = pr.getAttribute("POSITION")!;
    for (let i = 0; i < p.getCount(); i++) {
      p.getElement(i, v);
      if (v[2]! > tMaxZ) tMaxZ = v[2]!;
      if (v[1]! < yLo) yLo = v[1]!;
      if (v[1]! > yHi) yHi = v[1]!;
      if (Math.abs(v[0]!) > xHalf) xHalf = Math.abs(v[0]!);
    }
  }
  let gMaxZ = -Infinity;
  if (tongue) for (const pr of tongue.listPrimitives()) {
    const p = pr.getAttribute("POSITION")!;
    for (let i = 0; i < p.getCount(); i++) { p.getElement(i, v); if (v[2]! > gMaxZ) gMaxZ = v[2]!; }
  }

  const names = (body.getExtras() as { targetNames?: string[] } | null)?.targetNames ?? [];
  const mi = names.indexOf("mouth-open");
  const prim = body.listPrimitives().find((pr) => /skin/i.test(pr.getMaterial()?.getName() ?? ""))
    ?? body.listPrimitives()[0]!;
  const pos = prim.getAttribute("POSITION")!;
  const delta = mi >= 0 ? prim.listTargets()[mi]?.getAttribute("POSITION") : undefined;

  const median = (w: number): number => {
    const zs: number[] = [];
    const d = [0, 0, 0];
    for (let k = 0; k < pos.getCount(); k++) {
      pos.getElement(k, v);
      if (delta) delta.getElement(k, d); else { d[0] = 0; d[1] = 0; d[2] = 0; }
      const y = v[1]! + w * d[1]!;
      if (y < yLo || y > yHi) continue;
      if (Math.abs(v[0]! + w * d[0]!) > xHalf) continue;
      zs.push(v[2]! + w * d[2]!);
    }
    zs.sort((a, b) => a - b);
    return zs[Math.floor(zs.length / 2)]!;
  };

  const medianAtRest = median(0);
  const medianAtCap = median(capWeight);
  return {
    teethMaxZ: tMaxZ,
    teethYLo: yLo,
    teethYHi: yHi,
    teethXHalf: xHalf,
    medianAtRest,
    medianAtCap,
    marginAtRest: medianAtRest - tMaxZ,
    marginAtCap: medianAtCap - tMaxZ,
    tongueGap: gMaxZ > -Infinity ? tMaxZ - gMaxZ : Number.NaN,
    skinned,
  };
}

/** Face margins for a GLB file. Returns null when it has no teeth or body mesh. */
export async function measureFaceMargins(glbPath: string, repoRoot: string): Promise<FaceMargins | null> {
  const doc = await new NodeIO().read(glbPath);
  return measureFaceMarginsFromDoc(doc, runtimeCap(repoRoot));
}
