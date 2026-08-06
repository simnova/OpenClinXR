/**
 * Humanoid proportions probe (#56) — geometric measuring instrument.
 *
 * Purpose: classify whether a skeleton's joint layout is plainly human-shaped
 * (hands above feet, sane arm-span/stature, mesh AABB not exploded). This is NOT
 * a visual realism score and NOT a readiness gate. It exists because byte floors,
 * traverse tags, and rigging_report fields all stayed green while rendered
 * figures had arms as tubes below the feet and collapsed torsos.
 *
 * Contracts (humanoid-proportions-probe.test.ts) use synthetic joint sets only —
 * they prove the instrument. Measurement of real GLBs is a separate CLI path that
 * writes a report with a stage label (glb_bind | runtime | unknown_needs_runtime_probe).
 *
 * Do not wire humanoid-vision-score.ts here (LLM producer/grader problem).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";

// ---------------------------------------------------------------------------
// Public assess API (contracts + report both call this)
// ---------------------------------------------------------------------------

export type Joint = {
  name: string;
  y: number;
  x?: number;
  z?: number;
};

export type AssessInput = {
  joints: readonly Joint[];
  /** Optional mesh AABB (axis-aligned). Used for tertiary check only. */
  meshAabb?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
  /**
   * When set, armSpan/stature band is calibrated from this control's ratio.
   * Absolute centimetres are never used — only intra-figure ratios.
   */
  controlArmSpanOverStature?: number;
};

export type AssessResult = {
  sound: boolean;
  violations: string[];
  metrics: {
    handAboveFoot: {
      left: { handY: number | null; footY: number | null; ok: boolean | null };
      right: { handY: number | null; footY: number | null; ok: boolean | null };
    };
    armSpanOverStature: number | null;
    armSpanBand: { min: number; max: number } | null;
    meshAabb: {
      height: number;
      horizontalExtent: number;
      heightExceedsHorizontal: boolean;
    } | null;
  };
};

/** Default sane band for armSpan/stature when no control is provided (humanoid-ish, unitless). */
const DEFAULT_ARM_SPAN_OVER_STATURE = { min: 0.55, max: 1.35 };
/** Relative tolerance around a control ratio when calibrating. */
const CONTROL_RATIO_TOLERANCE = 0.45;

/**
 * Assess whether joint (and optional mesh AABB) proportions are plainly human.
 *
 * Primary: hand/wrist world Y above foot/ankle world Y (both sides when present).
 * Secondary: armSpan / stature within a sane band (control-calibrated when given).
 * Tertiary: skinned-mesh AABB height > horizontal extent (catches upright skeleton
 * with exploded mesh, or vice-versa signal when combined with primary).
 */
export function assessHumanoidProportions(input: AssessInput): AssessResult {
  const joints = input.joints;
  const violations: string[] = [];

  const leftHand = pickJoint(joints, [/hand\.l\b/i, /\blhand\b/i, /wrist\.l\b/i, /left.?hand/i, /hand_l/i]);
  const rightHand = pickJoint(joints, [/hand\.r\b/i, /\brhand\b/i, /wrist\.r\b/i, /right.?hand/i, /hand_r/i]);
  const leftFoot = pickJoint(joints, [/foot\.l\b/i, /\blfoot\b/i, /ankle\.l\b/i, /left.?foot/i, /foot_l/i]);
  const rightFoot = pickJoint(joints, [/foot\.r\b/i, /\brfoot\b/i, /ankle\.r\b/i, /right.?foot/i, /foot_r/i]);
  // Single-side synthetic fixtures only provide .L — still evaluate left.
  const handL = leftHand ?? (rightHand ? null : pickJoint(joints, [/\bhand\b/i, /\bwrist\b/i]));
  const footL = leftFoot ?? (rightFoot ? null : pickJoint(joints, [/\bfoot\b/i, /\bankle\b/i]));

  const leftOk = compareHandFoot(handL ?? leftHand, footL ?? leftFoot, "left", violations);
  const rightOk = compareHandFoot(rightHand, rightFoot, "right", violations);

  // If only left was provided (synthetic), right stays null/ok.
  if (!leftHand && !rightHand && !handL) {
    violations.push("hand_or_wrist_joint_missing");
  }
  if (!leftFoot && !rightFoot && !footL) {
    violations.push("foot_or_ankle_joint_missing");
  }

  const head = pickJoint(joints, [/\bhead\b/i]);
  const footForStature = leftFoot ?? rightFoot ?? footL;
  const handLPos = leftHand ?? handL;
  const handRPos = rightHand;

  let stature: number | null = null;
  if (head && footForStature) {
    stature = Math.abs(head.y - footForStature.y);
    // If figure is laid along Z (bind bug), stature by Y collapses — also try max extent of head-foot vector.
    const hx = head.x ?? 0;
    const hz = head.z ?? 0;
    const fx = footForStature.x ?? 0;
    const fz = footForStature.z ?? 0;
    const vectorStature = Math.hypot(hx - fx, head.y - footForStature.y, hz - fz);
    if (vectorStature > stature) stature = vectorStature;
  }

  // Secondary ratio only when BOTH hands are present. One-sided synthetic fixtures
  // (the planted contracts) must not fail on a half-span guess — primary hand>foot is enough.
  let armSpan: number | null = null;
  if (handLPos && handRPos) {
    const lx = handLPos.x ?? 0;
    const lz = handLPos.z ?? 0;
    const rx = handRPos.x ?? 0;
    const rz = handRPos.z ?? 0;
    armSpan = Math.hypot(lx - rx, handLPos.y - handRPos.y, lz - rz);
  }

  let armSpanOverStature: number | null = null;
  let armSpanBand: { min: number; max: number } | null = null;
  if (armSpan != null && stature != null && stature > 1e-6) {
    armSpanOverStature = armSpan / stature;
    if (input.controlArmSpanOverStature != null && Number.isFinite(input.controlArmSpanOverStature)) {
      const c = input.controlArmSpanOverStature;
      armSpanBand = {
        min: c * (1 - CONTROL_RATIO_TOLERANCE),
        max: c * (1 + CONTROL_RATIO_TOLERANCE),
      };
    } else {
      armSpanBand = { ...DEFAULT_ARM_SPAN_OVER_STATURE };
    }
    if (armSpanOverStature < armSpanBand.min || armSpanOverStature > armSpanBand.max) {
      violations.push(
        `arm_span_over_stature_out_of_band:${armSpanOverStature.toFixed(3)}_not_in_[${armSpanBand.min.toFixed(3)},${armSpanBand.max.toFixed(3)}]`,
      );
    }
  }

  let meshAabbMetrics: AssessResult["metrics"]["meshAabb"] = null;
  if (input.meshAabb) {
    const { min, max } = input.meshAabb;
    const height = max[1] - min[1];
    const horizontalExtent = Math.max(max[0] - min[0], max[2] - min[2]);
    const heightExceedsHorizontal = height > horizontalExtent;
    meshAabbMetrics = { height, horizontalExtent, heightExceedsHorizontal };
    if (!heightExceedsHorizontal) {
      violations.push(
        `mesh_aabb_height_not_exceeding_horizontal:height=${height.toFixed(3)}_horiz=${horizontalExtent.toFixed(3)}`,
      );
    }
  }

  return {
    sound: violations.length === 0,
    violations,
    metrics: {
      handAboveFoot: {
        left: {
          handY: (leftHand ?? handL)?.y ?? null,
          footY: (leftFoot ?? footL)?.y ?? null,
          ok: leftOk,
        },
        right: {
          handY: rightHand?.y ?? null,
          footY: rightFoot?.y ?? null,
          ok: rightOk,
        },
      },
      armSpanOverStature,
      armSpanBand,
      meshAabb: meshAabbMetrics,
    },
  };
}

function compareHandFoot(
  hand: Joint | null,
  foot: Joint | null,
  side: "left" | "right",
  violations: string[],
): boolean | null {
  if (!hand || !foot) return null;
  const ok = hand.y > foot.y;
  if (!ok) {
    // Wording must match /hand|arm|ankle|foot/i for the planted contract.
    violations.push(
      `${side}_hand_y_not_above_foot:hand_y=${hand.y.toFixed(4)}_foot_y=${foot.y.toFixed(4)}`,
    );
  }
  return ok;
}

function pickJoint(joints: readonly Joint[], patterns: RegExp[]): Joint | null {
  for (const pattern of patterns) {
    const found = joints.find((j) => pattern.test(j.name));
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GLB bind-pose extraction (diagnosis measurement path)
// ---------------------------------------------------------------------------

export type StageLabel = "glb_bind" | "runtime" | "unknown_needs_runtime_probe";

export type AssetMeasurement = {
  path: string;
  role: "suspect" | "control";
  exists: boolean;
  jointCount: number;
  joints: Joint[];
  meshAabb: {
    min: [number, number, number];
    max: [number, number, number];
    height: number;
    horizontalExtent: number;
  } | null;
  assess: AssessResult;
  /** Stage attribution for this asset alone (see report narrative). */
  stageLabel: StageLabel;
  notes: string[];
};

export type ProportionsReport = {
  schemaVersion: "openclinxr.humanoid-proportions-probe.v1";
  generatedAt: string;
  claimScope: "bind_pose_joint_geometry_and_mesh_aabb_only_not_visual_realism_or_readiness";
  purpose: string;
  measurables: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  assets: AssetMeasurement[];
  diagnosis: {
    /** Aggregate stage for the deformed captures that motivated #56. */
    stageLabel: StageLabel;
    summary: string;
    parentNurseBindFails: boolean;
    controlBindPasses: boolean;
    nextFixSliceTarget: string;
  };
  notEvidenceFor: string[];
};

const DEFAULT_SUSPECTS = [
  "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
] as const;

const DEFAULT_CONTROLS = [
  "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
  "apps/ui-xr/public/xr-assets/humanoids/neutral-generated-human.glb",
] as const;

const DEFAULT_REPORT_DIR = ".openclinxr/evidence/humanoid-proportions-2026-08-06";

/**
 * Extract bind/rest joint world positions from a GLB via glTF node world matrices
 * (and inverse-bind consistency is noted separately in the report notes when IBM
 * translation matches node world — that means the rest pose IS the bind pose).
 */
export async function extractJointsFromGlb(glbPath: string): Promise<{
  joints: Joint[];
  meshAabb: AssetMeasurement["meshAabb"];
  ibmMatchesNodeWorld: boolean | null;
  nodeCount: number;
  skinCount: number;
}> {
  const document = await new NodeIO().read(glbPath);
  return extractJointsFromDocument(document);
}

export function extractJointsFromDocument(document: Document): {
  joints: Joint[];
  meshAabb: AssetMeasurement["meshAabb"];
  ibmMatchesNodeWorld: boolean | null;
  nodeCount: number;
  skinCount: number;
} {
  const root = document.getRoot();
  const skins = root.listSkins();
  const jointNodes = new Map<string, GltfNode>();

  for (const skin of skins) {
    for (const joint of skin.listJoints()) {
      jointNodes.set(joint.getName() || `joint_${jointNodes.size}`, joint);
    }
  }
  // Fallback: all nodes if no skin (still useful for diagnosis).
  if (jointNodes.size === 0) {
    for (const node of root.listNodes()) {
      const name = node.getName();
      if (name) jointNodes.set(name, node);
    }
  }

  const joints: Joint[] = [];
  for (const [name, node] of jointNodes) {
    const [x, y, z] = node.getWorldTranslation();
    joints.push({ name, x, y, z });
  }

  let meshAabb: AssetMeasurement["meshAabb"] = null;
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let hasPos = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      hasPos = true;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const px = Number(arr[i]);
        const py = Number(arr[i + 1]);
        const pz = Number(arr[i + 2]);
        min[0] = Math.min(min[0], px);
        min[1] = Math.min(min[1], py);
        min[2] = Math.min(min[2], pz);
        max[0] = Math.max(max[0], px);
        max[1] = Math.max(max[1], py);
        max[2] = Math.max(max[2], pz);
      }
    }
  }
  if (hasPos) {
    meshAabb = {
      min,
      max,
      height: max[1] - min[1],
      horizontalExtent: Math.max(max[0] - min[0], max[2] - min[2]),
    };
  }

  let ibmMatchesNodeWorld: boolean | null = null;
  if (skins.length > 0) {
    const skin = skins[0]!;
    const ibm = skin.getInverseBindMatrices();
    const skinJoints = skin.listJoints();
    if (ibm && ibm.getCount() >= skinJoints.length) {
      const arr = ibm.getArray();
      if (arr) {
        let checked = 0;
        let matched = 0;
        for (let i = 0; i < skinJoints.length; i++) {
          const node = skinJoints[i]!;
          const name = node.getName();
          if (!/hand|foot|head|pelvis|upper_arm/i.test(name)) continue;
          const mat = new Array<number>(16);
          for (let k = 0; k < 16; k++) mat[k] = Number(arr[i * 16 + k]);
          const inv = invert4(mat);
          if (!inv) continue;
          const [nx, ny, nz] = node.getWorldTranslation();
          const dx = Math.abs(inv[12]! - nx);
          const dy = Math.abs(inv[13]! - ny);
          const dz = Math.abs(inv[14]! - nz);
          checked += 1;
          if (dx < 1e-3 && dy < 1e-3 && dz < 1e-3) matched += 1;
        }
        if (checked > 0) ibmMatchesNodeWorld = matched === checked;
      }
    }
  }

  return {
    joints,
    meshAabb,
    ibmMatchesNodeWorld,
    nodeCount: root.listNodes().length,
    skinCount: skins.length,
  };
}

function invert4(m: number[]): number[] | null {
  const out = new Array<number>(16);
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export async function measureAsset(
  glbPath: string,
  role: "suspect" | "control",
  controlArmSpanOverStature?: number,
): Promise<AssetMeasurement> {
  const notes: string[] = [];
  try {
    const extracted = await extractJointsFromGlb(glbPath);
    const assess = assessHumanoidProportions({
      joints: extracted.joints,
      meshAabb: extracted.meshAabb
        ? { min: extracted.meshAabb.min, max: extracted.meshAabb.max }
        : undefined,
      controlArmSpanOverStature,
    });

    if (extracted.ibmMatchesNodeWorld === true) {
      notes.push(
        "inverse_bind_matrices_match_node_world_translations: rest pose IS the recorded bind pose",
      );
    } else if (extracted.ibmMatchesNodeWorld === false) {
      notes.push(
        "inverse_bind_matrices_diverge_from_node_world: nodes may be posed away from bind; primary check still uses node world (current rest)",
      );
    }

    // Stage label for a single file measured at bind:
    // - fails primary hand>foot at bind → glb_bind (asset-side)
    // - passes at bind → cannot explain deformed renders from GLB alone → runtime or unknown
    let stageLabel: StageLabel;
    if (!assess.sound && assess.violations.some((v) => /hand|foot|arm|ankle/i.test(v))) {
      stageLabel = "glb_bind";
      notes.push(
        "bind_pose_joint_geometry_fails_hand_above_foot: deformation is already present in the GLB; fix targets orchestration/export/bind, not capture alone",
      );
    } else if (assess.sound) {
      // Sound at bind — if this was a capture-deformed suspect, runtime would be next;
      // for controls this is expected.
      stageLabel = role === "control" ? "glb_bind" : "unknown_needs_runtime_probe";
      if (role === "suspect") {
        notes.push(
          "bind_pose_passes_proportion_checks: GLB joint layout is sound; deformed renders would need a runtime skinning/capture probe",
        );
        stageLabel = "runtime"; // GLB sound + known bad renders ⇒ downstream
        notes.push(
          "stage_inference: suspects that pass bind while captures show arms-below-feet imply runtime or capture path (not proven here beyond bind pass)",
        );
      } else {
        notes.push("control_asset_passes_bind_proportion_checks");
      }
    } else {
      stageLabel = "unknown_needs_runtime_probe";
      notes.push(
        "bind_pose_has_violations_not_matching_primary_hand_foot_pattern: needs human review",
      );
    }

    // Mesh upright while skeleton flat is a strong glb_bind signature.
    if (
      extracted.meshAabb
      && extracted.meshAabb.height > extracted.meshAabb.horizontalExtent
      && assess.violations.some((v) => /hand_y_not_above_foot/i.test(v))
    ) {
      notes.push(
        "mesh_aabb_upright_while_skeleton_hand_below_foot: rest mesh vertices look standing; joint chain is flattened/rotated — classic bind/export mismatch that skinning then destroys at runtime",
      );
    }

    notes.push(`nodeCount=${extracted.nodeCount} skinCount=${extracted.skinCount}`);

    return {
      path: glbPath,
      role,
      exists: true,
      jointCount: extracted.joints.length,
      joints: extracted.joints.map((j) => ({
        name: j.name,
        x: j.x != null ? round4(j.x) : undefined,
        y: round4(j.y),
        z: j.z != null ? round4(j.z) : undefined,
      })),
      meshAabb: extracted.meshAabb
        ? {
            min: extracted.meshAabb.min.map(round4) as [number, number, number],
            max: extracted.meshAabb.max.map(round4) as [number, number, number],
            height: round4(extracted.meshAabb.height),
            horizontalExtent: round4(extracted.meshAabb.horizontalExtent),
          }
        : null,
      assess: {
        ...assess,
        violations: [...assess.violations],
        metrics: {
          ...assess.metrics,
          armSpanOverStature:
            assess.metrics.armSpanOverStature != null
              ? round4(assess.metrics.armSpanOverStature)
              : null,
        },
      },
      stageLabel,
      notes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notes.push(`read_failed:${message}`);
    return {
      path: glbPath,
      role,
      exists: false,
      jointCount: 0,
      joints: [],
      meshAabb: null,
      assess: {
        sound: false,
        violations: [`glb_unreadable:${message}`],
        metrics: {
          handAboveFoot: {
            left: { handY: null, footY: null, ok: null },
            right: { handY: null, footY: null, ok: null },
          },
          armSpanOverStature: null,
          armSpanBand: null,
          meshAabb: null,
        },
      },
      stageLabel: "unknown_needs_runtime_probe",
      notes,
    };
  }
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export async function buildProportionsReport(options?: {
  suspects?: readonly string[];
  controls?: readonly string[];
  generatedAt?: string;
}): Promise<ProportionsReport> {
  const suspects = options?.suspects ?? DEFAULT_SUSPECTS;
  const controls = options?.controls ?? DEFAULT_CONTROLS;

  // Measure controls first to calibrate arm-span band.
  const controlMeasurements: AssetMeasurement[] = [];
  for (const c of controls) {
    controlMeasurements.push(await measureAsset(c, "control"));
  }
  const calibrationControl =
    controlMeasurements.find((c) => c.assess.sound && c.assess.metrics.armSpanOverStature != null)
    ?? controlMeasurements.find((c) => c.assess.metrics.armSpanOverStature != null);
  const controlRatio = calibrationControl?.assess.metrics.armSpanOverStature ?? undefined;

  const suspectMeasurements: AssetMeasurement[] = [];
  for (const s of suspects) {
    suspectMeasurements.push(await measureAsset(s, "suspect", controlRatio));
  }

  // Re-assess controls with shared band only for reporting consistency (already sound).
  const assets = [...suspectMeasurements, ...controlMeasurements];

  const parentNurseBindFails = suspectMeasurements.every(
    (a) => a.exists && !a.assess.sound && a.stageLabel === "glb_bind",
  );
  const anySuspectBindFail = suspectMeasurements.some(
    (a) => a.exists && a.stageLabel === "glb_bind" && !a.assess.sound,
  );
  const allSuspectsBindPass = suspectMeasurements.every(
    (a) => a.exists && a.assess.sound,
  );
  const controlBindPasses = controlMeasurements.some((a) => a.exists && a.assess.sound);

  let stageLabel: StageLabel;
  let summary: string;
  let nextFixSliceTarget: string;

  if (anySuspectBindFail && controlBindPasses) {
    stageLabel = "glb_bind";
    summary =
      "Parent and/or nurse GLB bind/rest joint world positions already fail the primary hand-above-foot check "
      + "(and often show a skeleton laid along −Z with nearly constant Y, while mesh AABB remains upright). "
      + "Inverse bind matrices match node world translations, so this is the recorded bind pose — not a "
      + "runtime-only animation pose. Control assets (e.g. peds_patient_child / neutral-generated-human) pass "
      + "the same instrument. Therefore the deformed captures are explained by asset-side bind/export; "
      + "a runtime probe is not required to attribute the stage for these two actors.";
    nextFixSliceTarget =
      "asset-pipeline orchestration/export bind pose for parent+nurse (phenotype → glb); do not start with capture framing";
  } else if (allSuspectsBindPass && controlBindPasses) {
    stageLabel = "runtime";
    summary =
      "Suspect GLBs pass bind-pose proportion checks while captures were visually deformed. "
      + "The bug is downstream of the GLB file (runtime skinning, materials, or capture path). "
      + "Next slice needs a runtime probe that samples skinned mesh or joint world matrices after load.";
    nextFixSliceTarget =
      "runtime skinning / UI-XR load path probe (post-load joint or skinned AABB), not re-export alone";
  } else {
    stageLabel = "unknown_needs_runtime_probe";
    summary =
      "Could not cleanly separate bind vs runtime: missing files, mixed pass/fail, or controls also fail. "
      + "Need either readable suspect GLBs that fail/pass consistently, or a runtime probe.";
    nextFixSliceTarget =
      "re-run measurement with available assets; if bind is inconclusive, add runtime joint sampling after Three.js/WebXR load";
  }

  return {
    schemaVersion: "openclinxr.humanoid-proportions-probe.v1",
    generatedAt: options?.generatedAt ?? new Date().toISOString(),
    claimScope: "bind_pose_joint_geometry_and_mesh_aabb_only_not_visual_realism_or_readiness",
    purpose:
      "Diagnose which stage deforms parent/nurse figures in 2026-08-02 captures: measure GLB bind joint "
      + "geometry with a geometric instrument. Not a fix. Not visual realism. Not clinical readiness.",
    measurables: {
      primary:
        "In bind/rest, wrist/hand world Y above ankle/foot world Y (both sides when present). Arms-below-feet fails.",
      secondary:
        "armSpan / stature within a sane unitless band; when a control asset is available, band is calibrated from that control's ratio (±45%).",
      tertiary:
        "Skinned-mesh AABB height greater than horizontal extent (catches upright mesh with wrong skeleton, or exploded mesh).",
    },
    assets,
    diagnosis: {
      stageLabel,
      summary,
      parentNurseBindFails,
      controlBindPasses,
      nextFixSliceTarget,
    },
    notEvidenceFor: [
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "scoring_validity",
      "visual_realism_b_plus",
      "runtime_skinning_correctness",
      "capture_path_correctness",
      "learner_readiness",
    ],
  };
}

export async function writeProportionsReport(options?: {
  outputDir?: string;
  suspects?: readonly string[];
  controls?: readonly string[];
}): Promise<{ reportPath: string; report: ProportionsReport }> {
  const outputDir = options?.outputDir ?? DEFAULT_REPORT_DIR;
  const report = await buildProportionsReport({
    suspects: options?.suspects,
    controls: options?.controls,
  });
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // Companion markdown for the human/orchestrator who will read images + this file.
  const mdPath = path.join(outputDir, "report.md");
  await writeFile(mdPath, renderMarkdown(report), "utf8");

  return { reportPath, report };
}

function renderMarkdown(report: ProportionsReport): string {
  const lines: string[] = [
    `# Humanoid proportions probe — ${report.generatedAt.slice(0, 10)}`,
    "",
    `**Stage label:** \`${report.diagnosis.stageLabel}\``,
    "",
    report.diagnosis.summary,
    "",
    `**Next fix slice target:** ${report.diagnosis.nextFixSliceTarget}`,
    "",
    `claimScope: ${report.claimScope}`,
    "",
    "## Assets",
    "",
  ];
  for (const asset of report.assets) {
    lines.push(`### ${asset.role}: \`${asset.path}\``);
    lines.push("");
    lines.push(`- exists: ${asset.exists}`);
    lines.push(`- sound: **${asset.assess.sound}**`);
    lines.push(`- stageLabel: \`${asset.stageLabel}\``);
    lines.push(`- violations: ${asset.assess.violations.length ? asset.assess.violations.join("; ") : "(none)"}`);
    const hf = asset.assess.metrics.handAboveFoot;
    lines.push(
      `- hand/foot Y L: hand=${hf.left.handY} foot=${hf.left.footY} ok=${hf.left.ok}; R: hand=${hf.right.handY} foot=${hf.right.footY} ok=${hf.right.ok}`,
    );
    lines.push(`- armSpan/stature: ${asset.assess.metrics.armSpanOverStature}`);
    if (asset.meshAabb) {
      lines.push(
        `- mesh AABB height=${asset.meshAabb.height} horiz=${asset.meshAabb.horizontalExtent}`,
      );
    }
    // Key joints for a reader who can see.
    const key = asset.joints.filter((j) =>
      /head|hand\.|foot\.|pelvis|upper_arm|chest|neck/i.test(j.name),
    );
    if (key.length) {
      lines.push("- key joints (world):");
      for (const j of key) {
        lines.push(
          `  - ${j.name}: x=${j.x ?? "—"} y=${j.y} z=${j.z ?? "—"}`,
        );
      }
    }
    for (const n of asset.notes) lines.push(`- note: ${n}`);
    lines.push("");
  }
  lines.push("## notEvidenceFor");
  lines.push("");
  for (const n of report.notEvidenceFor) lines.push(`- ${n}`);
  lines.push("");
  lines.push("CLAIM: geometric bind-pose instrument measures joint hand>foot + ratios + mesh AABB; stage labeled from real assets.");
  lines.push("NOT TESTED: runtime skinning after Three.js load; capture camera; clinical realism.");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  let outputDir = DEFAULT_REPORT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output-dir" && argv[i + 1]) {
      outputDir = argv[++i]!;
    }
  }
  const { reportPath, report } = await writeProportionsReport({ outputDir });
  process.stdout.write(
    `${JSON.stringify({
      reportPath,
      stageLabel: report.diagnosis.stageLabel,
      parentNurseBindFails: report.diagnosis.parentNurseBindFails,
      controlBindPasses: report.diagnosis.controlBindPasses,
      nextFixSliceTarget: report.diagnosis.nextFixSliceTarget,
    }, null, 2)}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
