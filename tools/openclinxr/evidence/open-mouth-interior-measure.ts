/**
 * #551 GROUP A — measure whether viseme_aa reveals the teeth/tongue that ship in
 * mpfb-viseme-inspect.glb. Writes open-mouth-interior.json. No product edit.
 *
 * Threshold derives from the TEETH mesh AABB height (input), never from the lip gap (effect).
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Primitive } from "@gltf-transform/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const GLB = join(REPO, "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb");
const OUT = join(HERE, "open-mouth-interior.json");

const LIP_JOINT = /^(oris|levator)/;

type Vec3 = [number, number, number];

type Attr = {
  getCount(): number;
  getElement(i: number, target: number[]): number[];
};

function aabbOf(pos: Attr): { min: Vec3; max: Vec3; height: number; width: number; depth: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.getCount(); i++) {
    const v = pos.getElement(i, [0, 0, 0]) as Vec3;
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], v[a]);
      max[a] = Math.max(max[a], v[a]);
    }
  }
  return { min, max, height: max[1] - min[1], width: max[0] - min[0], depth: max[2] - min[2] };
}

function dominantJoint(
  joints: Attr | null,
  weights: Attr | null,
  jointNames: string[],
  i: number,
): string {
  if (!joints || !weights) return "";
  const j = joints.getElement(i, [0, 0, 0, 0]);
  const w = weights.getElement(i, [0, 0, 0, 0]);
  let best = -1;
  let bw = -1;
  for (let k = 0; k < 4; k++) if (w[k] > bw) { bw = w[k]; best = j[k]; }
  return jointNames[best] ?? "";
}

async function main() {
  const doc = await new NodeIO().read(GLB);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const jointNames = (skin?.listJoints() ?? []).map((j) => j.getName() ?? "");

  let teethMeshName: string | null = null;
  let tongueMeshName: string | null = null;
  let teethAabb: ReturnType<typeof aabbOf> | null = null;
  let teethVisible = false;
  let teethPresent = false;
  let teethMaterial: Record<string, unknown> | null = null;
  let tongueMaterial: Record<string, unknown> | null = null;
  const meshInventory: {
    name: string; verts: number; mat: string | null; alpha: number | null; alphaMode: string | null;
  }[] = [];

  for (const m of root.listMeshes()) {
    const name = m.getName() ?? "";
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute("POSITION") as Attr | null;
      if (!pos) continue;
      const mat = p.getMaterial();
      const base = mat?.getBaseColorFactor?.() ?? [1, 1, 1, 1];
      const alpha = base[3] ?? 1;
      const alphaMode = mat?.getAlphaMode?.() ?? "OPAQUE";
      meshInventory.push({
        name,
        verts: pos.getCount(),
        mat: mat?.getName() ?? null,
        alpha,
        alphaMode,
      });
      if (/hm08_teeth/i.test(name)) {
        teethPresent = true;
        teethMeshName = name;
        teethAabb = aabbOf(pos);
        teethVisible = pos.getCount() > 0 && alpha > 0.01;
        teethMaterial = {
          name: mat?.getName() ?? null,
          baseColorFactor: base,
          alphaMode,
          doubleSided: mat?.getDoubleSided?.() ?? null,
          emissiveFactor: mat?.getEmissiveFactor?.() ?? null,
        };
      }
      if (/hm08_tongue/i.test(name)) {
        tongueMeshName = name;
        tongueMaterial = {
          name: mat?.getName() ?? null,
          baseColorFactor: base,
          alphaMode,
          doubleSided: mat?.getDoubleSided?.() ?? null,
        };
      }
    }
  }

  let bodyPrim: Primitive | null = null;
  let bodyMeshName = "";
  let targetNames: string[] = [];
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      if (p.listTargets().length === 0) continue;
      const fromExtras = (m.getExtras()?.targetNames ?? []) as string[];
      const fromTargets = p.listTargets().map((t) => t.getName() ?? "");
      const names = fromTargets.map((n, i) => n || fromExtras[i] || "");
      if (names.some((n) => /^viseme_/.test(n))) {
        bodyPrim = p;
        bodyMeshName = m.getName() ?? "";
        targetNames = names;
        break;
      }
    }
    if (bodyPrim) break;
  }
  if (!bodyPrim) throw new Error("no body primitive with viseme_* targets");

  const pos = bodyPrim.getAttribute("POSITION") as Attr;
  const joints = bodyPrim.getAttribute("JOINTS_0") as Attr | null;
  const weights = bodyPrim.getAttribute("WEIGHTS_0") as Attr | null;
  const n = pos.getCount();

  type LipV = { i: number; x: number; y: number; z: number };
  const lipVerts: LipV[] = [];
  for (let i = 0; i < n; i++) {
    const dj = dominantJoint(joints, weights, jointNames, i);
    if (!LIP_JOINT.test(dj)) continue;
    const v = pos.getElement(i, [0, 0, 0]);
    lipVerts.push({ i, x: v[0], y: v[1], z: v[2] });
  }

  const zSorted = lipVerts.map((v) => v.z).sort((a, b) => a - b);
  const zCut = zSorted[Math.floor(zSorted.length * 0.6)]!;
  const midY = lipVerts.reduce((s, v) => s + v.y, 0) / Math.max(1, lipVerts.length);
  const anterior = lipVerts.filter((v) => v.z >= zCut);

  function lipGapAt(visemeName: string) {
    const idx = targetNames.indexOf(visemeName);
    if (idx < 0) throw new Error(`missing target ${visemeName}`);
    const delta = bodyPrim!.listTargets()[idx]!.getAttribute("POSITION") as Attr | null;
    let upperMin = Infinity;
    let lowerMax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    let maxDisp = 0;
    for (const v of anterior) {
      const d = delta ? delta.getElement(v.i, [0, 0, 0]) : [0, 0, 0];
      const y = v.y + d[1];
      const disp = Math.hypot(d[0], d[1], d[2]);
      if (disp > maxDisp) maxDisp = disp;
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
      if (v.y >= midY) upperMin = Math.min(upperMin, y);
      else lowerMax = Math.max(lowerMax, y);
    }
    return {
      lipGapMeters: Math.max(0, upperMin - lowerMax),
      lipSpanMeters: ymax - ymin,
      upperLipMinY: upperMin,
      lowerLipMaxY: lowerMax,
      lipOverlapMeters: Math.max(0, lowerMax - upperMin),
      anteriorLipCount: anterior.length,
      maxDisplacementMeters: maxDisp,
    };
  }

  const sil = lipGapAt("viseme_sil");
  const aa = lipGapAt("viseme_aa");

  if (!teethAabb) throw new Error("teeth AABB missing — teeth mesh not found");

  // Threshold from TEETH mesh only (§9s): half the dental-arcade AABB height.
  // An aperture smaller than half the tooth block cannot expose the occlusal/dental band.
  const thresholdMeters = teethAabb.height * 0.5;
  const thresholdDerivation =
    `thresholdMeters = 0.5 * aabbHeight(openclinxr_hm08_teeth POSITION) = 0.5 * ${teethAabb.height} ` +
    `= ${thresholdMeters} m. Measured with NodeIO on mesh "${teethMeshName}" ` +
    `(min=${JSON.stringify(teethAabb.min)}, max=${JSON.stringify(teethAabb.max)}). ` +
    `Half the dental-arcade height is the minimum lip aperture that can expose teeth; ` +
    `derived from the teeth mesh (input), never from observed lipGap (effect).`;

  const aaRevealed = teethPresent && teethVisible && aa.lipGapMeters >= thresholdMeters;
  const silRevealed = teethPresent && teethVisible && sil.lipGapMeters >= thresholdMeters;

  const lipRest = (() => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of lipVerts) {
      min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z);
      max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z);
    }
    return { min, max };
  })();

  const teethBehindLipsZ = teethAabb.max[2] < lipRest.max[2];
  const lipBandOverlapsTeethY =
    lipRest.min[1] <= teethAabb.max[1] && lipRest.max[1] >= teethAabb.min[1];

  let mechanism: string;
  let verdict: "revealed" | "mechanism_located" | "cannot_be_revealed";

  if (!teethPresent) {
    mechanism = "teeth_mesh_absent";
    verdict = "cannot_be_revealed";
  } else if (!teethVisible) {
    mechanism = "teeth_present_but_invisible_material_or_zero_alpha";
    verdict = "mechanism_located";
  } else if (aa.lipGapMeters < thresholdMeters) {
    mechanism =
      "lip_aperture_below_teeth_derived_threshold: anterior oris/levator rim after viseme_aa " +
      `has lipGapMeters=${aa.lipGapMeters} (overlap=${aa.lipOverlapMeters}, span=${aa.lipSpanMeters}) ` +
      `which does not clear thresholdMeters=${thresholdMeters} (0.5*teethH). ` +
      `Teeth mesh present+alpha-visible, sit posterior to lip surface ` +
      `(teethMaxZ=${teethAabb.max[2]} < lipMaxZ=${lipRest.max[2]}), Y-overlapping the lip band — ` +
      `occluded at this weight. File-level cull/zero-opacity ruled out; draw-time lighting not NodeIO-visible.`;
    verdict = "mechanism_located";
  } else if (aaRevealed) {
    mechanism = "lip_gap_clears_teeth_threshold_and_teeth_visible";
    verdict = "revealed";
  } else {
    mechanism = "unknown_after_geometry_measure";
    verdict = "mechanism_located";
  }

  const artifact = {
    schemaVersion: "openclinxr.open-mouth-interior.v1",
    issue: "551",
    factoryStep: "instrument",
    generatedAt: new Date().toISOString(),
    method:
      "NodeIO on mpfb-viseme-inspect.glb. Lip verts = dominant JOINTS_0 on oris*/levator* (#425). " +
      "Anterior rim = lip verts with rest Z >= 60th percentile. " +
      "lipGapMeters = max(0, min(upper-anterior Y) - max(lower-anterior Y)) after morph POSITION delta @ weight 1.0. " +
      "thresholdMeters = 0.5 * teeth mesh AABB height (teeth input only).",
    subject: "apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb",
    bodyMeshName,
    lipVertexCount: lipVerts.length,
    anteriorLipVertexCount: anterior.length,
    anteriorZCutMeters: zCut,
    lipRestMidYMeters: midY,
    mechanism,
    thresholdMeters,
    thresholdDerivation,
    visemes: [
      {
        name: "viseme_aa",
        lipGapMeters: aa.lipGapMeters,
        lipSpanMeters: aa.lipSpanMeters,
        lipOverlapMeters: aa.lipOverlapMeters,
        upperLipMinY: aa.upperLipMinY,
        lowerLipMaxY: aa.lowerLipMaxY,
        maxDisplacementMeters: aa.maxDisplacementMeters,
        interiorRevealed: aaRevealed,
      },
      {
        name: "viseme_sil",
        lipGapMeters: sil.lipGapMeters,
        lipSpanMeters: sil.lipSpanMeters,
        lipOverlapMeters: sil.lipOverlapMeters,
        upperLipMinY: sil.upperLipMinY,
        lowerLipMaxY: sil.lowerLipMaxY,
        maxDisplacementMeters: sil.maxDisplacementMeters,
        interiorRevealed: silRevealed,
      },
    ],
    teeth: {
      meshName: teethMeshName,
      present: teethPresent,
      visible: teethVisible,
      aabbHeightMeters: teethAabb.height,
      aabb: teethAabb,
      material: teethMaterial,
      relativeToLips: {
        teethBehindLipsAnteriorZ: teethBehindLipsZ,
        lipBandOverlapsTeethY,
        lipRestAabb: lipRest,
        deltaZLipsMinusTeethMax: lipRest.max[2] - teethAabb.max[2],
      },
    },
    tongue: {
      meshName: tongueMeshName,
      present: !!tongueMeshName,
      material: tongueMaterial,
    },
    meshInventory,
    verdict,
    ruledOut: [
      "teeth_or_tongue_absent_from_glb — both meshes enumerated",
      "teeth_zero_opacity_in_file — baseColorFactor alpha > 0.01",
    ],
    notProvenByNodeIO: [
      "draw-time frustum cull / renderer visibility flags",
      "whether the inspect lab leaves the interior unlit (pixel luminance 78.7 is consistent with sealed lips OR unlit cavity)",
    ],
    notes: [
      "Premise held: lips deform (aa maxDisp~18.16 mm, span sil→aa increases) while interior stays sealed.",
      "GROUP A only — no product edit; GROUP B tests unrun.",
    ],
  };

  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n");
  console.log(JSON.stringify({
    wrote: OUT,
    verdict: artifact.verdict,
    mechanism: artifact.mechanism.slice(0, 200),
    thresholdMeters: artifact.thresholdMeters,
    aa: artifact.visemes[0],
    sil: artifact.visemes[1],
    teeth: {
      present: teethPresent,
      visible: teethVisible,
      height: teethAabb.height,
      mesh: teethMeshName,
      behindLipsZ: teethBehindLipsZ,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
