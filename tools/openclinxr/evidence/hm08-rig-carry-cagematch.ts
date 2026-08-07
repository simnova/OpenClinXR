/**
 * #134 Lane C cagematch — can hm08 topology carry the 23-bone runtime rig?
 *
 * DELIVERABLE IS A DECISION WITH EVIDENCE, not working code.
 * `verdict: reject_measured` is a successful close.
 *
 * CONTRACT (1) ORDER: measure bake vs base OBJ first using POSITION-MERGED
 * continuity (not index-per-primitive). Multi-material glTF splits duplicate
 * boundary verts; index connectivity is not surface continuity (§6t / #121).
 *
 * claimScope: local bake-vs-base inventory + hm08 rig-carry probe on evidence path.
 * notEvidenceFor: production adoption, Quest readiness, MPFB GPL resolution,
 * garment fit (#131), clinical realism, promotion of any candidate.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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

const HUMANOID_DIR = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-134");
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
const REPORT_PATH = path.join(EVIDENCE_DIR, "probe-report.json");
const CANDIDATE_GLB = path.join(EVIDENCE_DIR, "hm08-rig-carry-candidate.glb");
const BLENDER_STAGE = path.join(HERE, "blender/hm08_rig_carry_stage.py");

const MH_BASE_OBJ = path.join(
  process.env.HOME ?? "",
  "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
);

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
  /** Side-by-side diagnostic: index-based (misleading for multi-material). */
  indexBasedBodyComponents?: number;
  /** Side-by-side: unique vertex positions after 5dp quantisation. */
  uniqueVertPositions?: number;
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
  /** Index-based sum of per-primitive components (material-split artefact). */
  bodyIndexBasedComponents: number;
  /** Position-merged (5dp) components across all body primitives. */
  bodyPositionMergedComponents: number;
  baseConnectedComponents: number;
  uniqueVertPositions: number;
  baseVertCount: number;
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
  /** Present when hm08 export was attempted. */
  exportAttempts?: Array<Record<string, unknown>>;
};

const CLAIM_SCOPE =
  "hm08_rig_carry_cagematch_bake_first_position_merged_then_rig_probe_no_promotion";

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

/** Primary bake measure — answers surface continuity, not material-split index islands. */
const MEASURE_NAME = "body_mesh_position_merged_connected_components";

function listShippedHumanoidGlbs(): string[] {
  if (!existsSync(HUMANOID_DIR)) return [];
  return readdirSync(HUMANOID_DIR)
    .filter((f: string) => f.endsWith(".glb"))
    .map((f: string) => path.join(HUMANOID_DIR, f))
    .sort();
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
  for (const f of faces) triangles += Math.max(0, f.length - 2);
  return {
    vertCount,
    faceCount: faces.length,
    triangles,
    connectedComponents: countConnectedComponents(vertCount, faces),
  };
}

function primitiveFaces(prim: Primitive): {
  vertCount: number;
  faces: number[][];
  tris: number;
  positions: Float32Array | null;
  indices: number[];
} {
  const pos = prim.getAttribute("POSITION");
  const vertCount = pos?.getCount() ?? 0;
  const positions = pos ? new Float32Array(pos.getArray() as ArrayLike<number>) : null;
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
  return { vertCount, faces, tris, positions, indices };
}

function quantKey(x: number, y: number, z: number, dp = 5): string {
  return `${x.toFixed(dp)},${y.toFixed(dp)},${z.toFixed(dp)}`;
}

/**
 * Merge vertices by quantised position across ALL primitives of a mesh, then
 * count connected components. This is surface continuity, not material-island
 * index continuity.
 */
function positionMergedComponents(
  prims: Array<{ positions: Float32Array | null; indices: number[]; vertCount: number }>,
  dp = 5,
): { uniqueVertPositions: number; components: number; tris: number; rawVerts: number } {
  const keyToId = new Map<string, number>();
  const faces: number[][] = [];
  let tris = 0;
  let rawVerts = 0;
  for (const prim of prims) {
    if (!prim.positions) continue;
    rawVerts += prim.vertCount;
    const localToGlobal = new Int32Array(prim.vertCount);
    for (let i = 0; i < prim.vertCount; i += 1) {
      const k = quantKey(
        prim.positions[i * 3]!,
        prim.positions[i * 3 + 1]!,
        prim.positions[i * 3 + 2]!,
        dp,
      );
      let id = keyToId.get(k);
      if (id === undefined) {
        id = keyToId.size;
        keyToId.set(k, id);
      }
      localToGlobal[i] = id;
    }
    for (let i = 0; i + 2 < prim.indices.length; i += 3) {
      faces.push([
        localToGlobal[prim.indices[i]!]!,
        localToGlobal[prim.indices[i + 1]!]!,
        localToGlobal[prim.indices[i + 2]!]!,
      ]);
      tris += 1;
    }
  }
  return {
    uniqueVertPositions: keyToId.size,
    components: countConnectedComponents(keyToId.size, faces),
    tris,
    rawVerts,
  };
}

function bodyMeshAnalysis(doc: Document): {
  name: string;
  triangles: number;
  verts: number;
  indexBasedComponents: number;
  positionMergedComponents: number;
  uniqueVertPositions: number;
  morphTargetCount: number;
  primCount: number;
} | null {
  const root = doc.getRoot();
  let best: Mesh | null = null;
  for (const mesh of root.listMeshes()) {
    if (/anny_base/i.test(mesh.getName() ?? "")) {
      best = mesh;
      break;
    }
  }
  if (!best) return null;

  let triangles = 0;
  let verts = 0;
  let indexBased = 0;
  let morphTargetCount = 0;
  const primPayload: Array<{
    positions: Float32Array | null;
    indices: number[];
    vertCount: number;
  }> = [];

  for (const prim of best.listPrimitives()) {
    const pf = primitiveFaces(prim);
    triangles += pf.tris;
    verts += pf.vertCount;
    indexBased += countConnectedComponents(pf.vertCount, pf.faces);
    morphTargetCount += prim.listTargets().length;
    primPayload.push({
      positions: pf.positions,
      indices: pf.indices,
      vertCount: pf.vertCount,
    });
  }
  const posM = positionMergedComponents(primPayload, 5);
  return {
    name: best.getName() ?? "",
    triangles,
    verts,
    indexBasedComponents: indexBased,
    positionMergedComponents: posM.components,
    uniqueVertPositions: posM.uniqueVertPositions,
    morphTargetCount,
    primCount: best.listPrimitives().length,
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
  // Also collect armature node children if no skin yet
  if (names.size === 0) {
    for (const node of doc.getRoot().listNodes()) {
      const n = node.getName() ?? "";
      if (n && !node.getMesh()) {
        // skip pure mesh nodes; joints may appear as nodes without mesh
      }
    }
  }
  return [...names].sort();
}

function materialRegionCount(doc: Document): number {
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

function sha256Prefix(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").slice(0, 16);
}

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
    const body = bodyMeshAnalysis(doc);
    if (!body) throw new Error(`no anny_base body mesh in ${glbPath}`);
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
      bodyIndexBasedComponents: body.indexBasedComponents,
      bodyPositionMergedComponents: body.positionMergedComponents,
      baseConnectedComponents: obj.connectedComponents,
      uniqueVertPositions: body.uniqueVertPositions,
      baseVertCount: obj.vertCount,
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
      "PRIMARY: position-merged connected components (5dp quantised verts across all body " +
      "primitives). Index-based per-primitive components are a multi-material glTF split " +
      "artefact (boundary verts duplicated) and do NOT answer surface continuity. " +
      "Withdrawn prior measure: body_mesh_connected_components as sum of per-prim index islands.",
    subjects,
    notes: {
      jointNameConvention:
        "jointNamesAsThreeJsSeesThem use PropertyBinding.sanitizeNodeName (dots stripped)",
      weightSourceNote:
        "#126 / automate_blender.ensure_deterministic_skinning_fallback — not MPFB heat weights",
      nonManifoldBlenderNote:
        "Blender non-manifold edge count on imported multi-material body (~1050) collapses to 0 " +
        "after remove_doubles at 1e-5; that figure measured material-split duplicates, not holes.",
    },
  };

  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path: outPath, subjects };
}

function buildBakeComparisons(subjects: PreFixSubject[]): BakeComparison[] {
  return subjects.map((s) => {
    const baseValue = s.baseConnectedComponents;
    const bakedValue = s.bodyPositionMergedComponents;
    return {
      assetPath: s.assetPath,
      baseObjTriangles: s.baseObjTris,
      glbTriangles: s.glbTris,
      measureName: MEASURE_NAME,
      baseValue,
      bakedValue,
      bakeDegrades: bakedValue > baseValue,
      indexBasedBodyComponents: s.bodyIndexBasedComponents,
      uniqueVertPositions: s.uniqueVertPositions,
    };
  });
}

function findBlender(): string {
  for (const c of ["blender", "/opt/homebrew/bin/blender", "/usr/local/bin/blender"]) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  throw new Error("blender not found on PATH");
}

function runHm08ExportAttempt(
  attempt: number,
  weightMode: "auto" | "envelope",
): Record<string, unknown> {
  const attemptReport = path.join(EVIDENCE_DIR, `hm08-export-attempt-${attempt}.json`);
  const blender = findBlender();
  const args = [
    "--background",
    "--python",
    BLENDER_STAGE,
    "--",
    "--mh-base-obj",
    MH_BASE_OBJ,
    "--output-glb",
    CANDIDATE_GLB,
    "--report",
    attemptReport,
    "--attempt",
    String(attempt),
    "--weight-mode",
    weightMode,
  ];
  const r = spawnSync(blender, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    cwd: REPO_ROOT,
  });
  let report: Record<string, unknown> = {
    attempt,
    weightMode,
    exitCode: r.status,
    stderrTail: (r.stderr ?? "").slice(-2000),
    stdoutTail: (r.stdout ?? "").slice(-1000),
  };
  if (existsSync(attemptReport)) {
    try {
      report = {
        ...JSON.parse(readFileSync(attemptReport, "utf8")),
        exitCode: r.status,
      };
    } catch {
      /* keep shell report */
    }
  }
  return report;
}

async function inspectCandidateGlb(glbPath: string): Promise<{
  runtimeJointNames: string[];
  missingCanonicalJoints: string[];
  triangleCount: number;
  morphTargetCount: number;
  hasSkin: boolean;
}> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const joints = jointsAsThreeJs(doc);
  const missing = CANONICAL_JOINTS_AS_THREE_JS.filter((j) => !joints.includes(j));
  let morphTargetCount = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      morphTargetCount += prim.listTargets().length;
    }
  }
  return {
    runtimeJointNames: joints,
    missingCanonicalJoints: [...missing],
    triangleCount: totalGlbTriangles(doc),
    morphTargetCount,
    hasSkin: doc.getRoot().listSkins().length > 0,
  };
}

/**
 * Core inspect entrypoint for planted contracts.
 * Bake comparison first (position-merged); only then hm08 export (≤2 attempts).
 */
export async function inspectHm08RigCarry(): Promise<InspectReport> {
  const { path: preFixPath, subjects } = await writePreFixInventory(PRE_FIX_PATH);
  const bake = buildBakeComparisons(subjects);
  const anyBakeDegrades = bake.some((b) => b.bakeDegrades);

  // Contract (1): only stop if POSITION-MERGED continuity degrades.
  if (anyBakeDegrades) {
    const rejectReason =
      `Position-merged body continuity degrades on ${bake.filter((b) => b.bakeDegrades).length}/${bake.length} ` +
      `shipped humanoids (measure=${MEASURE_NAME}). MPFB2 candidate not attempted.`;
    return finishReport({
      bake,
      preFixPath,
      rig: emptyRig(rejectReason, 0),
      verdict: "reject_measured",
      visual: {
        base_obj_vs_shipped_glb: "base_better",
        where_they_differ: "position-merged body surface continuity",
        hm08_candidate_loads: "not_attempted",
        hm08_figure_intact: "not_attempted",
      },
    });
  }

  // Bake surface intact — proceed under hard freeze (≤2 export attempts).
  if (!existsSync(MH_BASE_OBJ)) {
    return finishReport({
      bake,
      preFixPath,
      rig: emptyRig(
        `hm08 base.obj not found at ${MH_BASE_OBJ}; cannot attempt rig carry`,
        0,
      ),
      verdict: "inconclusive_blocked",
      visual: {
        base_obj_vs_shipped_glb: "same",
        where_they_differ:
          "none under position-merged components (index-based multi-material islands are not surface breaks)",
        hm08_candidate_loads: "not_attempted",
        hm08_figure_intact: "not_attempted",
      },
    });
  }

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const attempts: Array<Record<string, unknown>> = [];

  // Attempt 1: ARMATURE_AUTO heat weights
  attempts.push(runHm08ExportAttempt(1, "auto"));
  let candidateOk = Boolean(attempts[0]?.ok) && existsSync(CANDIDATE_GLB);

  // Attempt 2 only if first failed
  if (!candidateOk) {
    attempts.push(runHm08ExportAttempt(2, "envelope"));
    candidateOk = Boolean(attempts[1]?.ok) && existsSync(CANDIDATE_GLB);
  }

  if (!candidateOk) {
    const rejectReason =
      `hm08 rig not named-and-skinned after ${attempts.length} export attempt(s) (stop rule max 2). ` +
      `Attempt errors: ${attempts.map((a, i) => `#${i + 1}:${a.error ?? a.exitCode}`).join("; ")}. ` +
      `Bake position-merged continuity was intact; rejection is rig-bind failure, not bake degradation.`;
    return finishReport({
      bake,
      preFixPath,
      rig: emptyRig(rejectReason, attempts.length),
      verdict: "reject_measured",
      visual: {
        base_obj_vs_shipped_glb: "same",
        where_they_differ:
          "none under position-merged components; index-based multi-material islands withdrawn as degradation signal",
        hm08_candidate_loads: "no",
        hm08_figure_intact: "no",
      },
      exportAttempts: attempts,
    });
  }

  const inspected = await inspectCandidateGlb(CANDIDATE_GLB);
  const relCandidate = path.relative(REPO_ROOT, CANDIDATE_GLB).replace(/\\/g, "/");

  if (inspected.missingCanonicalJoints.length > 0 || !inspected.hasSkin) {
    const rejectReason =
      `Candidate exported but runtime joint resolution incomplete: missing=[${inspected.missingCanonicalJoints.join(",")}] ` +
      `hasSkin=${inspected.hasSkin} jointCount=${inspected.runtimeJointNames.length}. attempts=${attempts.length}`;
    return finishReport({
      bake,
      preFixPath,
      rig: {
        candidatePath: relCandidate,
        runtimeJointNames: inspected.runtimeJointNames,
        canonicalJointNames: [...CANONICAL_JOINTS_AS_THREE_JS],
        missingCanonicalJoints: inspected.missingCanonicalJoints,
        triangleCount: inspected.triangleCount,
        morphTargetCount: inspected.morphTargetCount,
        rejectReason,
        attempts: attempts.length,
      },
      verdict: "reject_measured",
      visual: {
        base_obj_vs_shipped_glb: "same",
        where_they_differ: "none under position-merged components",
        hm08_candidate_loads: "yes",
        hm08_figure_intact: "no",
      },
      exportAttempts: attempts,
    });
  }

  // adopt_hm08 for RIG CARRY only (not production promotion; morphs gap recorded as number).
  return finishReport({
    bake,
    preFixPath,
    rig: {
      candidatePath: relCandidate,
      runtimeJointNames: inspected.runtimeJointNames,
      canonicalJointNames: [...CANONICAL_JOINTS_AS_THREE_JS],
      missingCanonicalJoints: [],
      triangleCount: inspected.triangleCount,
      morphTargetCount: inspected.morphTargetCount,
      rejectReason: null,
      attempts: attempts.length,
    },
    verdict: "adopt_hm08",
    visual: {
      base_obj_vs_shipped_glb: "same",
      where_they_differ:
        "none under position-merged body continuity; raw-index multi-material split is export encoding not surface break",
      hm08_candidate_loads: "yes",
      hm08_figure_intact: "yes",
    },
    exportAttempts: attempts,
  });
}

function emptyRig(rejectReason: string, attempts: number): RigCarry {
  return {
    candidatePath: "",
    runtimeJointNames: [],
    canonicalJointNames: [...CANONICAL_JOINTS_AS_THREE_JS],
    missingCanonicalJoints: [...CANONICAL_JOINTS_AS_THREE_JS],
    triangleCount: 0,
    morphTargetCount: 0,
    rejectReason,
    attempts,
  };
}

function finishReport(input: {
  bake: BakeComparison[];
  preFixPath: string;
  rig: RigCarry;
  verdict: InspectReport["verdict"];
  visual: InspectReport["inScopeVisual"];
  exportAttempts?: Array<Record<string, unknown>>;
}): InspectReport {
  const report: InspectReport = {
    bake: input.bake,
    rig: input.rig,
    verdict: input.verdict,
    preFixPath: path.relative(REPO_ROOT, input.preFixPath).replace(/\\/g, "/"),
    inScopeVisual: input.visual,
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
    exportAttempts: input.exportAttempts,
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    REPORT_PATH,
    `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return report;
}

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
        measureName: report.bake[0]?.measureName,
        sampleIndexVsPosition: report.bake[0]
          ? {
              indexBased: report.bake[0].indexBasedBodyComponents,
              positionMerged: report.bake[0].bakedValue,
              uniqueVerts: report.bake[0].uniqueVertPositions,
            }
          : null,
        preFixPath: report.preFixPath,
        candidatePath: report.rig.candidatePath,
        missingJoints: report.rig.missingCanonicalJoints,
        attempts: report.rig.attempts,
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
