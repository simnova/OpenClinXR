/**
 * Humanoid upright guard (#67) — catches the #58 regression class.
 *
 * #58 left a +90° X rotation on the armature root. Joint world-Y hand>foot still
 * passed (Y became old −Z). Mesh hung inverted. Geometry self-check agreed with
 * itself. Only looking at pixels caught it.
 *
 * Stack (not any single member):
 *   1. armature root rotation is identity
 *   2. head > hips > feet along the model's own up axis (survives root-local lies)
 *   3. (runtime) ui-xr refuses a non-identity root — see apps/ui-xr/src/humanoid-load-guard.ts
 *
 * claimScope: bind-pose upright geometry only.
 * notEvidenceFor: face quality, garment realism, clinical validity, production readiness.
 */

import { NodeIO } from "@gltf-transform/core";

export type Quat = readonly [number, number, number, number];

const ARMATURE_NAME = "openclinxr_canonical_humanoid_armature";
const IDENTITY_EPS = 1e-4;

/**
 * Read the armature root node rotation from a GLB (glTF-Transform NodeIO).
 * Returns null if no armature root is found.
 */
export async function armatureRootRotation(glbPath: string): Promise<Quat | null> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const arm =
    root.listNodes().find((n) => (n.getName() || "") === ARMATURE_NAME) ??
    root.listNodes().find((n) => {
      const name = (n.getName() || "").toLowerCase();
      return name.includes("canonical_humanoid_armature") || name.endsWith("_armature");
    });
  if (!arm) return null;
  const [x, y, z, w] = arm.getRotation();
  return [x, y, z, w];
}

export function isIdentityQuat(q: Quat, eps = IDENTITY_EPS): boolean {
  return (
    Math.abs(q[0]) < eps &&
    Math.abs(q[1]) < eps &&
    Math.abs(q[2]) < eps &&
    Math.abs(Math.abs(q[3]) - 1) < eps
  );
}

export type UprightJoint = {
  name: string;
  /** World position — either worldX/Y/Z or x/y/z (proportions-probe shape). */
  worldX?: number;
  worldY?: number;
  worldZ?: number;
  x?: number;
  y?: number;
  z?: number;
};

function jointPos(j: UprightJoint): { x: number; y: number; z: number } {
  return {
    x: j.worldX ?? j.x ?? 0,
    y: j.worldY ?? j.y ?? 0,
    z: j.worldZ ?? j.z ?? 0,
  };
}

function pickJoint(joints: readonly UprightJoint[], patterns: RegExp[]): UprightJoint | null {
  for (const pattern of patterns) {
    const found = joints.find((j) => pattern.test(j.name));
    if (found) return found;
  }
  return null;
}

/**
 * Assess head > hips > feet along the model's own up axis.
 *
 * "Own up axis" is derived from the joint cloud: the foot→head vector defines the
 * model's longitudinal axis. Ordering is evaluated on the scalar projection onto
 * that axis AND on world Y (the identity-root export frame). The planted inverted
 * synthetic flips world Y only — it must be refused. A pre-#58 lying skeleton
 * (height on −Z, near-constant Y) fails both. A correct identity-root export passes.
 *
 * Note: #58-class assets (rotated root, joints already standing on world Y) still
 * pass this ordering check; the identity-root contract is what refuses them. Both
 * must hold at once.
 */
export function assessUprightOrdering(input: {
  joints: readonly UprightJoint[];
}): { upright: boolean; violations: string[] } {
  const joints = input.joints;
  const violations: string[] = [];

  const head = pickJoint(joints, [/\bhead\b/i]);
  const hips =
    pickJoint(joints, [/\bpelvis\b/i, /\bhips?\b/i, /\bhip\b/i]) ??
    pickJoint(joints, [/\bspine\b/i]);
  const footL = pickJoint(joints, [/foot\.l\b/i, /\blfoot\b/i, /ankle\.l\b/i, /left.?foot/i, /foot_l/i]);
  const footR = pickJoint(joints, [/foot\.r\b/i, /\brfoot\b/i, /ankle\.r\b/i, /right.?foot/i, /foot_r/i]);
  const foot = footL ?? footR ?? pickJoint(joints, [/\bfoot\b/i, /\bankle\b/i]);

  if (!head) violations.push("head_joint_missing");
  if (!hips) violations.push("hips_or_pelvis_joint_missing");
  if (!foot) violations.push("foot_or_ankle_joint_missing");
  if (violations.length > 0) {
    return { upright: false, violations };
  }

  const headP = jointPos(head!);
  const hipsP = jointPos(hips!);
  const footPositions = [footL, footR].filter(Boolean).map((j) => jointPos(j!));
  if (footPositions.length === 0) footPositions.push(jointPos(foot!));
  const footCentroid = {
    x: footPositions.reduce((s, p) => s + p.x, 0) / footPositions.length,
    y: footPositions.reduce((s, p) => s + p.y, 0) / footPositions.length,
    z: footPositions.reduce((s, p) => s + p.z, 0) / footPositions.length,
  };

  // World-Y ordering (refuses the planted inverted synthetic; matches identity-root glTF +Y).
  if (!(headP.y > hipsP.y)) {
    violations.push(
      `head_y_not_above_hips_y:head_y=${headP.y.toFixed(4)}_hips_y=${hipsP.y.toFixed(4)}`,
    );
  }
  if (!(hipsP.y > footCentroid.y)) {
    violations.push(
      `hips_y_not_above_feet_y:hips_y=${hipsP.y.toFixed(4)}_feet_y=${footCentroid.y.toFixed(4)}`,
    );
  }

  // Model-own-axis: require head is the extreme in the direction of maximum joint
  // extent from the foot centroid (anatomical head-at-top of the figure's long axis).
  // For a lying pre-#58 skeleton, extent is on Z and head may still be extreme — but
  // world-Y already failed. For inverted synthetic, head is at the low Y extreme so
  // world-Y failed. This axis check mainly documents intent for rotated-but-standing.
  let ux = headP.x - footCentroid.x;
  let uy = headP.y - footCentroid.y;
  let uz = headP.z - footCentroid.z;
  const len = Math.hypot(ux, uy, uz);
  if (len < 1e-6) {
    violations.push("degenerate_head_to_foot_axis");
  } else {
    ux /= len;
    uy /= len;
    uz /= len;
    const project = (p: { x: number; y: number; z: number }) => p.x * ux + p.y * uy + p.z * uz;
    const headS = project(headP);
    const hipsS = project(hipsP);
    const footS = project(footCentroid);
    // By construction headS > footS; hips must sit strictly between them.
    if (!(headS > hipsS && hipsS > footS)) {
      violations.push(
        `hips_not_between_head_and_feet_on_model_up:head=${headS.toFixed(4)}_hips=${hipsS.toFixed(4)}_feet=${footS.toFixed(4)}`,
      );
    }
  }

  return { upright: violations.length === 0, violations };
}
