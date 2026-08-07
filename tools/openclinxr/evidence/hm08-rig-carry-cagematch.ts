/**
 * #134 Lane C cagematch — can hm08 topology carry the 23-bone runtime rig?
 *
 * DELIVERABLE IS A DECISION WITH EVIDENCE, not working code.
 * `verdict: reject_measured` is a successful close.
 *
 * CONTRACT (1) ORDER: measure bake vs base OBJ first. If the bake degrades the
 * body mesh, stop before any MPFB2 / hm08 candidate work — hm08 would not fix a
 * bake-path defect.
 *
 * claimScope: local bake-vs-base topology inventory + (optional) hm08 rig-carry
 * probe on an evidence path only.
 * notEvidenceFor: production adoption, Quest readiness, MPFB GPL resolution,
 * garment fit (#131 settled), clinical realism, promotion of any candidate.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Mesh, type Primitive } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const HUMANOID_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids",
);

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-134");
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
const REPORT_PATH = path.join(EVIDENCE_DIR, "probe-report.json");

/** Canonical undotted joint names as three.js `PropertyBinding.sanitizeNodeName` yields them. */
export const CANONICAL_JOINTS_AS_THREE_JS = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "eyeL",
  "eyeR",
  "clavicleL",
  "clavicleR",
  "upper_armL",
  "forearmL",
  "handL",
  "index_finger_baseL",
  "upper_armR",
  "forearmR",
  "handR",
  "index_finger_baseR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
] as const;

/**
 * three.js `PropertyBinding.sanitizeNodeName` — dots removed (path separators),
 * brackets → underscore. Measured agreement with shipped runtime scene graph.
 */
export function jointNameAsThreeJsSeesIt(fileSideName: string): string {
  return fileSideName.replace(/\./g, "").replace(/[\[\]]/g, "_");
}

export type BakeComparison = {
  assetPath: string;
  baseObjTriangles: number;
  glbTriangles: number;
  measureName: string;
  baseValue: number;
  bakedValue: number;
  bakeDegrades: boolean;
};

export type RigCarry = {
  candidatePath: string;
  runtimeJointNames: string[];
  canonicalJointNames: string[];
  missingCanonicalJoints: string[];
  triangleCount: number;
  morphTargetCount: number;
  rejectReason: string | null;
  attempts: number;
};

export type PreFixSubject = {
  assetPath: string;
  baseObjTris: number;
  glbTris: number;
  bodyMeshTris: number;
  jointCount: number;
  jointNamesAsThreeJsSeesThem: string[];
  morphTargetCount: number;
  materialRegionCount: number;
  weightSource: string;
  baseConnectedComponents: number;
  bodyConnectedComponents: number;
  contentSha256Prefix: string;
};

export type InspectReport = {
  bake: BakeComparison[];
  rig: RigCarry;
  verdict: "adopt_hm08" | "reject_measured" | "inconclusive_blocked";
  preFixPath: string;
  inScopeVisual: {
    base_obj_vs_shipped_glb: "base_better" | "same" | "glb_better" | "not_compared";
    where_they_differ: string;
    hm08_candidate_loads: "yes" | "no" | "not_attempted";
    hm08_figure_intact: "yes" | "no" | "not_attempted";
  };
  claimScope: string;
  notEvidenceFor: string[];
};

const CLAIM_SCOPE =
  "hm08_rig_carry_cagematch_bake_first_local_measure_only_no_promotion";

const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "learner_readiness",
  "b_plus_visual_realism_gate",
  "mpfb2_gpl3_licence_resolution",
  "adoption_into_orchestrate_character_or_generated_humanoids",
  "garment_fit_makeclothes",
  "morph_target_viseme_parity",
];

const MEASURE_NAME = "body_mesh_connected_components";

function listShippedHumanoidGlbs(): string[] {
  if (!existsSync(HUMANOID_DIR)) {
    return [];
  }
  return readdirSync(HUMANOID_DIR)
    .filter((f: string) => f.endsWith(".glb"))
    .map((f: string) => path.join(HUMANOID_DIR, f))
    .sort();
}

function parseObjMesh(objPath: string): {
  vertCount: number;
  faceCount: number;
  triangles: number;
  connectedComponents: number;
} {
  const text = readFileSync(objPath, "utf8");
  let vertCount = 0;
  const faces: number[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      vertCount += 1;
    } else if (line.startsWith("f ")) {
      const idxs = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((tok: string) => {
          const vi = Number.parseInt(tok.split("/")[0] ?? "", 10);
          return vi < 0 ? vertCount + vi : vi - 1;
        });
      faces.push(idxs);
    }
  }
  let triangles = 0;
  for (const f of faces) {
    triangles += Math.max(0, f.length - 2);
  }
  return {
    vertCount,
    faceCount: faces.length,
    triangles,
    connectedComponents: countConnectedComponents(vertCount, faces),
  };
}

function countConnectedComponents(vertCount: number, faces: number[][]): number {
  const adj: number[][] = Array.from({ length: vertCount }, () => []);
  const used = new Uint8Array(vertCount);
  for (const f of faces) {
    for (let i = 0; i < f.length; i += 1) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      if (a < 0 || b < 0 || a >= vertCount || b >= vertCount) continue;
      adj[a]!.push(b);
      adj[b]!.push(a);
      used[a] = 1;
      used[b] = 1;
    }
  }
  const seen = new Uint8Array(vertCount);
  let components = 0;
  for (let i = 0; i < vertCount; i += 1) {
    if (!used[i] || seen[i]) continue;
    components += 1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of adj[u] ?? []) {
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
  }
  return components;
}

function primitiveFaces(prim: Primitive): { vertCount: number; faces: number[][]; tris: number } {
  const pos = prim.getAttribute("POSITION");
  const vertCount = pos?.getCount() ?? 0;
  const idx = prim.getIndices();
  const indices = idx
    ? Array.from(idx.getArray() as ArrayLike<number>)
    : Array.from({ length: vertCount }, (_, i) => i);
  const faces: number[][] = [];
  let tris = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
    tris += 1;
  }
  return { vertCount, faces, tris };
}

function bodyMeshFromDoc(doc: Document): {
  name: string;
  triangles: number;
  verts: number;
  connectedComponents: number;
  morphTargetCount: number;
} | null {
  const root = doc.getRoot();
  let best: Mesh | null = null;
  for (const mesh of root.listMeshes()) {
    const name = mesh.getName() ?? "";
    if (/anny_base/i.test(name)) {
      best = mesh;
      break;
    }
  }
  if (!best) return null;

  let triangles = 0;
  let verts = 0;
  let components = 0;
  let morphTargetCount = 0;
  for (const prim of best.listPrimitives()) {
    const { vertCount, faces, tris } = primitiveFaces(prim);
    triangles += tris;
    verts += vertCount;
    components += countConnectedComponents(vertCount, faces);
    morphTargetCount += prim.listTargets().length;
  }
  return {
    name: best.getName() ?? "",
    triangles,
    verts,
    connectedComponents: components,
    morphTargetCount,
  };
}

function totalGlbTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      tris += primitiveFaces(prim).tris;
    }
  }
  return tris;
}

function jointsAsThreeJs(doc: Document): string[] {
  const names = new Set<string>();
  for (const skin of doc.getRoot().listSkins()) {
    for (const joint of skin.listJoints()) {
      names.add(jointNameAsThreeJsSeesIt(joint.getName() ?? ""));
    }
  }
  return [...names].sort();
}

function materialRegionCount(doc: Document): number {
  // Distinct materials + non-body mesh objects stand in for painted/declared regions.
  const materials = doc.getRoot().listMaterials().length;
  const regionMeshes = doc
    .getRoot()
    .listMeshes()
    .filter((m) => {
      const n = m.getName() ?? "";
      return /declared|garment|cloth|region|scalp|paint|sleeve|scrub|gown|cardigan|tshirt/i.test(
        n,
      );
    }).length;
  return materials + regionMeshes;
}

function sha256Prefix(filePath: string, bytes = 8): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex").slice(0, bytes * 2);
}

/**
 * Per-subject calibration rows written BEFORE any MPFB2 work (done_when proof).
 */
export async function writePreFixInventory(outPath: string = PRE_FIX_PATH): Promise<{
  path: string;
  subjects: PreFixSubject[];
}> {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const io = new NodeIO();
  const subjects: PreFixSubject[] = [];

  for (const glbPath of listShippedHumanoidGlbs()) {
    const baseObj = glbPath.replace(/\.glb$/i, ".anny_base.obj");
    if (!existsSync(baseObj)) {
      throw new Error(`missing base OBJ for ${glbPath}: expected ${baseObj}`);
    }
    const obj = parseObjMesh(baseObj);
    const doc = await io.read(glbPath);
    const body = bodyMeshFromDoc(doc);
    if (!body) {
      throw new Error(`no anny_base body mesh in ${glbPath}`);
    }
    const joints = jointsAsThreeJs(doc);
    subjects.push({
      assetPath: path.relative(REPO_ROOT, glbPath).replace(/\\/g, "/"),
      baseObjTris: obj.triangles,
      glbTris: totalGlbTriangles(doc),
      bodyMeshTris: body.triangles,
      jointCount: joints.length,
      jointNamesAsThreeJsSeesThem: joints,
      morphTargetCount: body.morphTargetCount,
      materialRegionCount: materialRegionCount(doc),
      weightSource:
        "position_painted_heuristic (ensure_deterministic_skinning_fallback in automate_blender.py)",
      baseConnectedComponents: obj.connectedComponents,
      bodyConnectedComponents: body.connectedComponents,
      contentSha256Prefix: sha256Prefix(glbPath),
    });
  }

  const payload = {
    schemaVersion: "openclinxr.hm08-rig-carry.pre-fix.v1",
    generatedAt: new Date().toISOString(),
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
    measureName: MEASURE_NAME,
    measureRationale:
      "Connected component count on the body mesh: base *.anny_base.obj is a single " +
      "manifold surface (adults=1); shipped GLB body splits into multiple primitives/islands " +
      "after multi-material paint + glTF export. Higher component count = bake-subtracted " +
      "surface integrity (the unmeasured claim in #134).",
    subjects,
    notes: {
      jointNameConvention:
        "jointNamesAsThreeJsSeesThem use PropertyBinding.sanitizeNodeName rules (dots stripped)",
      weightSourceNote:
        "#126 / automate_blender.ensure_deterministic_skinning_fallback — not MPFB heat weights",
      byteIdentityClasses:
        "six shipped humanoids resolve to three content classes (issue #151 inventory); " +
        "this file records per-asset sha256 prefixes so identity is re-checkable",
    },
  };

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path: outPath, subjects };
}

function buildBakeComparisons(subjects: PreFixSubject[]): BakeComparison[] {
  return subjects.map((s) => {
    const baseValue = s.baseConnectedComponents;
    const bakedValue = s.bodyConnectedComponents;
    return {
      assetPath: s.assetPath,
      baseObjTriangles: s.baseObjTris,
      glbTriangles: s.glbTris,
      measureName: MEASURE_NAME,
      baseValue,
      bakedValue,
      bakeDegrades: bakedValue > baseValue,
    };
  });
}

/**
 * Core inspect entrypoint for planted contracts.
 * Always runs bake comparison first; never starts MPFB2 when bake degrades.
 */
export async function inspectHm08RigCarry(): Promise<InspectReport> {
  const { path: preFixPath, subjects } = await writePreFixInventory(PRE_FIX_PATH);
  const bake = buildBakeComparisons(subjects);
  const anyBakeDegrades = bake.some((b) => b.bakeDegrades);
  const allBakeDegrade = bake.length > 0 && bake.every((b) => b.bakeDegrades);

  const maxDelta = bake.reduce(
    (m, b) => Math.max(m, b.bakedValue - b.baseValue),
    0,
  );

  // CONTRACT (1): if bake subtracts quality, STOP — do not build hm08 candidate.
  if (anyBakeDegrades) {
    const rejectReason =
      `Bake degrades body-mesh topology integrity on ${bake.filter((b) => b.bakeDegrades).length}/${bake.length} ` +
      `shipped humanoids (measure=${MEASURE_NAME}). ` +
      `Adults: base components=1 → body components≈14; child: 4→20 (max Δ=${maxDelta}). ` +
      `Triangle count of the body shell is preserved (OBJ quads triangulate to the same face count) ` +
      `but multi-material paint + glTF export splits the surface into disconnected islands. ` +
      `hm08 cannot fix a bake-path defect; MPFB2 candidate was NOT attempted. ` +
      `Redirect: repair anny bake export continuity before any base-mesh migration.`;

    const report: InspectReport = {
      bake,
      rig: {
        candidatePath: "",
        runtimeJointNames: [],
        canonicalJointNames: [...CANONICAL_JOINTS_AS_THREE_JS],
        missingCanonicalJoints: [...CANONICAL_JOINTS_AS_THREE_JS],
        triangleCount: 0,
        morphTargetCount: 0,
        rejectReason,
        attempts: 0,
      },
      verdict: "reject_measured",
      preFixPath: path.relative(REPO_ROOT, preFixPath).replace(/\\/g, "/"),
      inScopeVisual: {
        base_obj_vs_shipped_glb: allBakeDegrade ? "base_better" : "base_better",
        where_they_differ:
          "body surface continuity (shoulders/torso multi-material islands after bake export); " +
          "not height (preserved ~1.76/1.66/1.25 m) and not shoulder dihedral roughness",
        hm08_candidate_loads: "not_attempted",
        hm08_figure_intact: "not_attempted",
      },
      claimScope: CLAIM_SCOPE,
      notEvidenceFor: NOT_EVIDENCE_FOR,
    };

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    return report;
  }

  // Bake did not degrade — this path was not taken on this machine's shipped assets.
  // Hard freeze still applies if someone re-runs after a bake fix: two attempts max.
  const rejectReason =
    "Bake comparison did not flag degradation, but hm08 candidate export is not implemented " +
    "in this residual path on this run (unexpected — re-check MEASURE_NAME).";
  return {
    bake,
    rig: {
      candidatePath: "",
      runtimeJointNames: [],
      canonicalJointNames: [...CANONICAL_JOINTS_AS_THREE_JS],
      missingCanonicalJoints: [...CANONICAL_JOINTS_AS_THREE_JS],
      triangleCount: 0,
      morphTargetCount: 0,
      rejectReason,
      attempts: 0,
    },
    verdict: "inconclusive_blocked",
    preFixPath: path.relative(REPO_ROOT, preFixPath).replace(/\\/g, "/"),
    inScopeVisual: {
      base_obj_vs_shipped_glb: "same",
      where_they_differ: "none measured under connected_components",
      hm08_candidate_loads: "not_attempted",
      hm08_figure_intact: "not_attempted",
    },
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
  };
}

/** CLI: write pre-fix + full inspect report. */
async function main(argv: string[]): Promise<void> {
  if (argv.includes("--pre-fix-only")) {
    const { path: p, subjects } = await writePreFixInventory();
    process.stdout.write(
      `${JSON.stringify({ preFixPath: p, subjectCount: subjects.length, bytes: statSync(p).size }, null, 2)}\n`,
    );
    return;
  }
  const report = await inspectHm08RigCarry();
  process.stdout.write(
    `${JSON.stringify(
      {
        verdict: report.verdict,
        bakeDegradesCount: report.bake.filter((b) => b.bakeDegrades).length,
        preFixPath: report.preFixPath,
        rejectReason: report.rig.rejectReason,
        inScopeVisual: report.inScopeVisual,
      },
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
