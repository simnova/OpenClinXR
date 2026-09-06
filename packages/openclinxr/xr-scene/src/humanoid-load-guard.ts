/**
 * Runtime humanoid load guard (#67).
 *
 * A generator fix with no consumer is this project's most repeated failure class.
 * After load, refuse a humanoid whose armature root carries a non-identity rotation
 * (the #58 leftover +90° X that hung six of seven shipped assets head-down).
 *
 * claimScope: armature root rotation identity only.
 * notEvidenceFor: face/garment quality, clinical validity, production readiness.
 */

export const CANONICAL_HUMANOID_ARMATURE_NAME = "openclinxr_canonical_humanoid_armature";

const IDENTITY_EPS = 1e-3;

type QuatLike = { x: number; y: number; z: number; w: number };

type NodeLike = {
  name?: string;
  quaternion?: QuatLike;
  children?: readonly NodeLike[];
};

function isIdentityQuat(q: QuatLike, eps = IDENTITY_EPS): boolean {
  return (
    Math.abs(q.x) < eps &&
    Math.abs(q.y) < eps &&
    Math.abs(q.z) < eps &&
    Math.abs(Math.abs(q.w) - 1) < eps
  );
}

function findArmatureRoot(node: NodeLike): NodeLike | null {
  const name = node.name ?? "";
  if (
    name === CANONICAL_HUMANOID_ARMATURE_NAME ||
    name.includes("canonical_humanoid_armature")
  ) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findArmatureRoot(child);
    if (found) return found;
  }
  return null;
}

/**
 * Throw if the loaded humanoid scene has an armature root whose quaternion is
 * not identity. Call after GLTFLoader resolves, before the figure is shown.
 */
export function assertHumanoidRootUpright(scene: unknown): void {
  if (scene == null || typeof scene !== "object") {
    throw new Error("assertHumanoidRootUpright: scene is missing");
  }
  const root = scene as NodeLike;
  const arm = findArmatureRoot(root);
  if (!arm) {
    // No canonical armature — nothing to refuse. Neutral/variant assets may not
    // carry this name; the guard is specific to the factory humanoid path.
    return;
  }
  const q = arm.quaternion;
  if (!q || typeof q.x !== "number") {
    throw new Error(
      `assertHumanoidRootUpright: armature "${arm.name ?? "?"}" has no quaternion`,
    );
  }
  if (!isIdentityQuat(q)) {
    throw new Error(
      `assertHumanoidRootUpright: armature root rotation is not identity ` +
        `(got ${q.x.toFixed(4)},${q.y.toFixed(4)},${q.z.toFixed(4)},${q.w.toFixed(4)}); ` +
        `refusing #58-class off-axis humanoid (see issue #67)`,
    );
  }
}
