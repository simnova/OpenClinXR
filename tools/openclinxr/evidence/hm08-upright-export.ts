/**
 * #156 — hm08 candidate must export upright (mesh + joints same frame).
 *
 * claimScope: evidence-path upright export of hm08 rig-carry candidate only.
 * notEvidenceFor: production promotion, morph parity, weight quality, Quest readiness,
 * clinical realism, adoption into generated-humanoids/.
 *
 * Measurements: exported glTF via NodeIO, joint names as three.js sees them
 * (PropertyBinding.sanitizeNodeName — dots stripped). §6v.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_134 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-134");
const EVIDENCE_156 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-156");
const PRE_FIX_PATH = path.join(EVIDENCE_156, "pre-fix.json");
const ORIGINAL_CANDIDATE = path.join(EVIDENCE_134, "hm08-rig-carry-candidate.glb");
/** Upright re-export lives alongside; original #134 candidate is preserved for calibration. */
const UPRIGHT_CANDIDATE = path.join(EVIDENCE_156, "hm08-rig-carry-candidate-upright.glb");
const BLENDER_STAGE = path.join(HERE, "blender/hm08_rig_carry_stage.py");
const TREATMENTS_DIR = path.join(EVIDENCE_156, "treatments");
const TREATMENT_TABLE_PATH = path.join(EVIDENCE_156, "treatment-table.json");

const MH_BASE_OBJ = path.join(
  process.env.HOME ?? "",
  "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
);

export type AxisMeasure = {
  assetPath: string;
  meshWidth: number;
  meshHeight: number;
  meshDepth: number;
  meshMinY: number;
  meshLongestAxis: string;
  jointLongestAxis: string;
  jointSpanY: number;
  rootIsIdentity: boolean;
  runtimeJointNames: string[];
  triangleCount: number;
};

export type Treatment = AxisMeasure & {
  treatment: string;
  exportYup: boolean;
  forceZUpStanding: boolean;
};

export type InspectReport = {
  current: AxisMeasure;
  treatments: Treatment[];
  chosen: string;
  preFixPath: string;
  claimScope: string;
  notEvidenceFor: string[];
  exportMorph: false;
  notes: string[];
};

const CLAIM_SCOPE = "hm08_export_upright_axis_only_no_promotion";
const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "learner_readiness",
  "b_plus_visual_realism_gate",
  "mpfb2_gpl3_licence_resolution",
  "adoption_into_orchestrate_character_or_generated_humanoids",
  "morph_target_viseme_parity",
  "auto_weight_deformation_quality",
];

function jointNameAsThreeJsSeesIt(fileSideName: string): string {
  return fileSideName.replace(/\./g, "").replace(/[\[\]]/g, "_");
}

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  const ox = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const oy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const oz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  return [ox, oy, oz];
}

function longestAxis(w: number, h: number, d: number): "x" | "y" | "z" {
  const m = Math.max(w, h, d);
  if (m === h) return "y";
  if (m === w) return "x";
  return "z";
}

function isNearIdentityRotation(r: readonly number[]): boolean {
  // quaternion [x,y,z,w]
  return (
    Math.abs(r[0] ?? 0) < 1e-5 &&
    Math.abs(r[1] ?? 0) < 1e-5 &&
    Math.abs(r[2] ?? 0) < 1e-5 &&
    Math.abs((r[3] ?? 1) - 1) < 1e-5
  );
}

export async function measureGlbAxes(glbPath: string): Promise<AxisMeasure> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  return measureDocumentAxes(doc, path.relative(REPO_ROOT, glbPath).replace(/\\/g, "/"));
}

async function measureDocumentAxes(doc: Document, assetPath: string): Promise<AxisMeasure> {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let hasMesh = false;

  const visitMesh = (node: GltfNode): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        hasMesh = true;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [x, y, z] = transformPoint(
            Number(arr[i]),
            Number(arr[i + 1]),
            Number(arr[i + 2]),
            world,
          );
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    for (const child of node.listChildren()) visitMesh(child);
  };

  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) visitMesh(root);
  }
  if (!hasMesh) {
    for (const node of doc.getRoot().listNodes()) visitMesh(node);
  }
  if (!hasMesh) {
    throw new Error(`no mesh POSITION found in ${assetPath}`);
  }

  const meshWidth = maxX - minX;
  const meshHeight = maxY - minY;
  const meshDepth = maxZ - minZ;

  const jointNames: string[] = [];
  let jMinX = Infinity;
  let jMinY = Infinity;
  let jMinZ = Infinity;
  let jMaxX = -Infinity;
  let jMaxY = -Infinity;
  let jMaxZ = -Infinity;
  let hasJoint = false;

  for (const skin of doc.getRoot().listSkins()) {
    for (const joint of skin.listJoints()) {
      jointNames.push(jointNameAsThreeJsSeesIt(joint.getName() ?? ""));
      const m = joint.getWorldMatrix();
      const x = m[12]!;
      const y = m[13]!;
      const z = m[14]!;
      hasJoint = true;
      jMinX = Math.min(jMinX, x);
      jMinY = Math.min(jMinY, y);
      jMinZ = Math.min(jMinZ, z);
      jMaxX = Math.max(jMaxX, x);
      jMaxY = Math.max(jMaxY, y);
      jMaxZ = Math.max(jMaxZ, z);
    }
  }

  const jointSpanX = hasJoint ? jMaxX - jMinX : 0;
  const jointSpanY = hasJoint ? jMaxY - jMinY : 0;
  const jointSpanZ = hasJoint ? jMaxZ - jMinZ : 0;

  let rootIsIdentity = true;
  const scenes = doc.getRoot().listScenes();
  const roots = scenes[0]?.listChildren() ?? [];
  for (const n of roots) {
    if (!isNearIdentityRotation(n.getRotation())) {
      rootIsIdentity = false;
      break;
    }
  }

  let triangleCount = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) {
        triangleCount += Math.floor(idx.getCount() / 3);
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) triangleCount += Math.floor(pos.getCount() / 3);
      }
    }
  }

  return {
    assetPath,
    meshWidth: round3(meshWidth),
    meshHeight: round3(meshHeight),
    meshDepth: round3(meshDepth),
    meshMinY: round3(minY),
    meshLongestAxis: longestAxis(meshWidth, meshHeight, meshDepth),
    jointLongestAxis: hasJoint
      ? longestAxis(jointSpanX, jointSpanY, jointSpanZ)
      : "y",
    jointSpanY: round3(jointSpanY),
    rootIsIdentity,
    runtimeJointNames: [...new Set(jointNames)].sort(),
    triangleCount,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function findBlender(): string {
  for (const c of ["blender", "/opt/homebrew/bin/blender", "/usr/local/bin/blender"]) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  throw new Error("blender not found on PATH");
}

function treatmentPasses(m: AxisMeasure): boolean {
  const horizontal = Math.max(m.meshWidth, m.meshDepth);
  if (horizontal <= 0) return false;
  if (m.meshHeight / horizontal <= 1.5) return false;
  if (m.meshLongestAxis !== "y") return false;
  if (m.meshHeight < 1.0) return false;
  if (m.jointLongestAxis !== m.meshLongestAxis) return false;
  if (m.jointSpanY <= m.meshHeight * 0.6) return false;
  return true;
}

type TreatmentSpec = {
  name: string;
  exportYup: boolean;
  forceZUp: boolean;
};

/** Control/treatment table — every row is attempted and recorded (pass or fail). */
const TREATMENT_SPECS: TreatmentSpec[] = [
  // Baseline: #134 shipped settings (known FAIL from calibration).
  { name: "baseline_export_yup_false_no_force_z", exportYup: false, forceZUp: false },
  // Flag flip alone — may upright mesh while joints stay wrong (#67 trap class).
  { name: "export_yup_true_alone", exportYup: true, forceZUp: false },
  // force_z alone with Anny export flag — unlikely to fix glTF axis if already Z-up.
  { name: "force_z_up_alone_export_yup_false", exportYup: false, forceZUp: true },
  // Working MPFB path: both.
  { name: "force_z_up_plus_export_yup_true", exportYup: true, forceZUp: true },
];

function runExport(
  spec: TreatmentSpec,
  outGlb: string,
  reportPath: string,
  weightMode: "auto" | "envelope" = "envelope",
): Record<string, unknown> {
  // #134: heat auto-weight failed (Bone Heat Weighting); envelope succeeded on attempt 2.
  // Default envelope so axis treatments are not blocked by the same heat failure.
  const blender = findBlender();
  const args = [
    "--background",
    "--python",
    BLENDER_STAGE,
    "--",
    "--mh-base-obj",
    MH_BASE_OBJ,
    "--output-glb",
    outGlb,
    "--report",
    reportPath,
    "--attempt",
    weightMode === "auto" ? "1" : "2",
    "--weight-mode",
    weightMode,
    "--export-yup",
    spec.exportYup ? "true" : "false",
    "--force-z-up",
    spec.forceZUp ? "true" : "false",
  ];
  const r = spawnSync(blender, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    cwd: REPO_ROOT,
  });
  let report: Record<string, unknown> = {
    exitCode: r.status,
    stderrTail: (r.stderr ?? "").slice(-2000),
    stdoutTail: (r.stdout ?? "").slice(-1000),
  };
  if (existsSync(reportPath)) {
    try {
      report = { ...JSON.parse(readFileSync(reportPath, "utf8")), exitCode: r.status };
    } catch {
      /* keep shell report */
    }
  }
  return report;
}

/**
 * Ensure pre-fix exists with the CURRENT #134 candidate as row 0.
 * Does not re-export. Calibration stop: meshW/H/D must match orchestrator numbers.
 */
export async function ensurePreFix(): Promise<AxisMeasure> {
  mkdirSync(EVIDENCE_156, { recursive: true });
  if (!existsSync(ORIGINAL_CANDIDATE)) {
    throw new Error(
      `missing #134 candidate at ${ORIGINAL_CANDIDATE} — copy from a complete checkout before measuring`,
    );
  }
  const current = await measureGlbAxes(ORIGINAL_CANDIDATE);
  const row = {
    treatment: "current_candidate_as_shipped_by_134",
    export_yup: false,
    force_z_up: false,
    rootIsIdentity: current.rootIsIdentity,
    meshW: current.meshWidth,
    meshH: current.meshHeight,
    meshD: current.meshDepth,
    meshMinY: current.meshMinY,
    meshLongestAxis: current.meshLongestAxis,
    jointLongestAxis: current.jointLongestAxis,
    jointSpanY: current.jointSpanY,
    triangleCount: current.triangleCount,
    jointCount: current.runtimeJointNames.length,
    assetPath: current.assetPath,
    verdict: treatmentPasses(current) ? "PASS" : "FAIL_lying_or_misaligned",
  };

  // Hard stop if calibration does not reproduce orchestrator numbers.
  if (
    Math.abs(row.meshW - 0.995) > 0.02 ||
    Math.abs(row.meshH - 0.436) > 0.02 ||
    Math.abs(row.meshD - 1.695) > 0.02
  ) {
    throw new Error(
      `CALIBRATION MISMATCH vs orchestrator W=0.995 H=0.436 D=1.695 — measured ` +
        `W=${row.meshW} H=${row.meshH} D=${row.meshD}. STOP before product edit.`,
    );
  }

  if (!existsSync(PRE_FIX_PATH)) {
    const payload = {
      schemaVersion: "openclinxr.hm08-upright.pre-fix.v1",
      generatedAt: new Date().toISOString(),
      note: "Calibration BEFORE product edit. First row is CURRENT #134 candidate.",
      claimScope: CLAIM_SCOPE,
      notEvidenceFor: NOT_EVIDENCE_FOR,
      rows: [row],
    };
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  return current;
}

/**
 * Core inspect for planted contracts. Runs the treatment table once (cached to disk),
 * picks the first full-column pass (or the MPFB both-true treatment as preferred),
 * writes the upright candidate, and returns current + full table.
 */
export async function inspectHm08UprightExport(): Promise<InspectReport> {
  await ensurePreFix();
  mkdirSync(TREATMENTS_DIR, { recursive: true });

  let treatments: Treatment[] = [];
  if (existsSync(TREATMENT_TABLE_PATH) && existsSync(UPRIGHT_CANDIDATE)) {
    try {
      const cached = JSON.parse(readFileSync(TREATMENT_TABLE_PATH, "utf8")) as {
        treatments: Treatment[];
        chosen: string;
      };
      if (Array.isArray(cached.treatments) && cached.treatments.length > 0) {
        treatments = cached.treatments;
        const current = await measureGlbAxes(UPRIGHT_CANDIDATE);
        return {
          current,
          treatments,
          chosen: cached.chosen,
          preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH).replace(/\\/g, "/"),
          claimScope: CLAIM_SCOPE,
          notEvidenceFor: NOT_EVIDENCE_FOR,
          exportMorph: false,
          notes: [
            "export_morph left False — #134 scoped morph parity out deliberately",
            "treatment table loaded from disk cache",
          ],
        };
      }
    } catch {
      /* re-run */
    }
  }

  if (!existsSync(MH_BASE_OBJ)) {
    throw new Error(`hm08 base.obj not found at ${MH_BASE_OBJ}`);
  }

  // Always include the calibrated original as the first measured treatment row (no re-export).
  const baseline = await measureGlbAxes(ORIGINAL_CANDIDATE);
  treatments.push({
    ...baseline,
    treatment: "baseline_export_yup_false_no_force_z",
    exportYup: false,
    forceZUpStanding: false,
  });

  for (const spec of TREATMENT_SPECS) {
    if (spec.name === "baseline_export_yup_false_no_force_z") {
      // already measured from preserved #134 candidate
      continue;
    }
    const outGlb = path.join(TREATMENTS_DIR, `${spec.name}.glb`);
    const reportPath = path.join(TREATMENTS_DIR, `${spec.name}.json`);
    const shell = runExport(spec, outGlb, reportPath);
    if (!existsSync(outGlb) || shell.ok === false) {
      treatments.push({
        treatment: spec.name,
        exportYup: spec.exportYup,
        forceZUpStanding: spec.forceZUp,
        assetPath: path.relative(REPO_ROOT, outGlb).replace(/\\/g, "/"),
        meshWidth: 0,
        meshHeight: 0,
        meshDepth: 0,
        meshMinY: 0,
        meshLongestAxis: "z",
        jointLongestAxis: "z",
        jointSpanY: 0,
        rootIsIdentity: false,
        runtimeJointNames: [],
        triangleCount: 0,
      });
      continue;
    }
    const m = await measureGlbAxes(outGlb);
    treatments.push({
      ...m,
      treatment: spec.name,
      exportYup: spec.exportYup,
      forceZUpStanding: spec.forceZUp,
    });
  }

  // Prefer the working MPFB path if it passes; else first full pass; else best-effort both-true.
  const preferredName = "force_z_up_plus_export_yup_true";
  const preferred = treatments.find((t) => t.treatment === preferredName);
  const firstPass = treatments.find((t) => treatmentPasses(t));
  const chosenRow =
    (preferred && treatmentPasses(preferred) ? preferred : undefined) ??
    firstPass ??
    preferred ??
    treatments[treatments.length - 1]!;

  const chosen = chosenRow.treatment;
  // Copy chosen treatment GLB to the upright candidate path.
  // NEVER overwrite the #134 lying candidate — it is the pre-fix calibration anchor.
  const chosenGlb =
    chosen === "baseline_export_yup_false_no_force_z"
      ? ORIGINAL_CANDIDATE
      : path.join(TREATMENTS_DIR, `${chosen}.glb`);
  if (!existsSync(chosenGlb)) {
    throw new Error(`chosen treatment GLB missing: ${chosenGlb}`);
  }
  copyFileSync(chosenGlb, UPRIGHT_CANDIDATE);

  const current = await measureGlbAxes(UPRIGHT_CANDIDATE);

  const table = {
    generatedAt: new Date().toISOString(),
    chosen,
    treatments,
    columns:
      "treatment | export_yup | force_z_up | rootIsIdentity | meshW/H/D | jointSpanUpAxis | meshLongest | jointLongest | pass",
    rows: treatments.map((t) => ({
      treatment: t.treatment,
      export_yup: t.exportYup,
      force_z_up: t.forceZUpStanding,
      rootIsIdentity: t.rootIsIdentity,
      meshW: t.meshWidth,
      meshH: t.meshHeight,
      meshD: t.meshDepth,
      jointSpanY: t.jointSpanY,
      meshLongestAxis: t.meshLongestAxis,
      jointLongestAxis: t.jointLongestAxis,
      pass: treatmentPasses(t),
    })),
  };
  writeFileSync(TREATMENT_TABLE_PATH, `${JSON.stringify(table, null, 2)}\n`, "utf8");

  // Append treatment rows to pre-fix artifact for durability (keep original first row immutable).
  try {
    const pre = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as {
      rows: Array<Record<string, unknown>>;
    };
    const existing = new Set(pre.rows.map((r) => String(r.treatment ?? "")));
    for (const t of treatments) {
      if (existing.has(t.treatment)) continue;
      pre.rows.push({
        treatment: t.treatment,
        export_yup: t.exportYup,
        force_z_up: t.forceZUpStanding,
        rootIsIdentity: t.rootIsIdentity,
        meshW: t.meshWidth,
        meshH: t.meshHeight,
        meshD: t.meshDepth,
        meshLongestAxis: t.meshLongestAxis,
        jointLongestAxis: t.jointLongestAxis,
        jointSpanY: t.jointSpanY,
        triangleCount: t.triangleCount,
        verdict: treatmentPasses(t) ? "PASS" : "FAIL",
      });
    }
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(pre, null, 2)}\n`, "utf8");
  } catch {
    /* non-fatal */
  }

  return {
    current,
    treatments,
    chosen,
    preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH).replace(/\\/g, "/"),
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
    exportMorph: false,
    notes: [
      "export_morph left False — #134 scoped morph parity out deliberately",
      "original lying #134 candidate preserved at .openclinxr/evidence/issue-134/hm08-rig-carry-candidate.glb",
      "upright candidate at .openclinxr/evidence/issue-156/hm08-rig-carry-candidate-upright.glb",
      `chosen treatment: ${chosen}`,
    ],
  };
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/hm08-upright-export.ts
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("hm08-upright-export.ts")) {
  inspectHm08UprightExport()
    .then((r) => {
      console.log(
        JSON.stringify(
          {
            chosen: r.chosen,
            current: {
              meshW: r.current.meshWidth,
              meshH: r.current.meshHeight,
              meshD: r.current.meshDepth,
              meshLongest: r.current.meshLongestAxis,
              jointLongest: r.current.jointLongestAxis,
              jointSpanY: r.current.jointSpanY,
              rootIsIdentity: r.current.rootIsIdentity,
              tris: r.current.triangleCount,
              joints: r.current.runtimeJointNames.length,
            },
            treatments: r.treatments.map((t) => ({
              treatment: t.treatment,
              exportYup: t.exportYup,
              forceZUp: t.forceZUpStanding,
              meshLongest: t.meshLongestAxis,
              jointLongest: t.jointLongestAxis,
              H: t.meshHeight,
              pass: treatmentPasses(t),
            })),
            notes: r.notes,
          },
          null,
          2,
        ),
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
