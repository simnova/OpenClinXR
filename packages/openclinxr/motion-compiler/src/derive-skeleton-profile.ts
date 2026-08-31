/**
 * M1b: derive a skeleton profile's RIG HALF from a SHIPPED GLB, not from a constructed table.
 *
 * Card tsk_3778b159cf72414d. The contract is `the-skeleton-profile-comes-from-a-real-rig.test.ts`:
 * every `SkeletonProfile` in this package used to be CONSTRUCTED (its fixtures said so in their own
 * header), and this module is the deriver that replaces the construction. The companion card
 * tsk_e5b1a3efad002aef consumes this module and adds `regionAnchors` on top of the record.
 *
 * DECODE ROUTE — the node hierarchy, not the inverse bind matrices. A joint's bind world matrix is
 * its node's TRS accumulated down the hierarchy from the root. The contract's oracle deliberately
 * reads the SAME file by the OTHER route (inverting `skins[0].inverseBindMatrices`), so the two
 * decodes are checked against each other instead of agreeing by construction. Header (d) of the
 * contract measured the two routes agreeing to 7.037e-7 m / 2.627e-3 rad on the three shipped rigs;
 * the contract's tolerances are 1e-4 m / 1e-2 rad.
 *
 * LANDMARK RESOLUTION — identity-then-alias through `resolvePoseBone` in asset-registry's
 * pose-bone-resolver.ts, the SINGLE declared map. This module adds no second declaration: a
 * landmark key is resolved against the rig's own sanitised joint set, and a landmark the rig
 * cannot carry is REFUSED, never defaulted.
 *
 * notEvidenceFor: clinical_validity, biomechanical_validity, production_animation_quality,
 * exam_equivalence, scoring, learner_readiness. Only `skins[0]` and the node hierarchy are read;
 * a rig whose weights are all zero passes every check this module participates in. `jointLimits`
 * are conservative symmetric placeholders that include the bind pose (rest angle 0 by the
 * contract's convention) — they are NOT claimed anatomical.
 */
import { readFileSync } from "node:fs";

import { resolvePoseBone } from "@openclinxr/asset-registry";
import { REGION_ANCHOR_SPACE } from "./plant-motion-regions.js";

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** One landmark of the derived profile. Every vector is in `bindSpace`. */
export type DerivedLandmark = {
  /** The bone actually addressed ON THIS RIG, three.js-sanitised (dots stripped). */
  boneName: string;
  /** The bone's parent, or `null` where the parent node is not a joint of this skin. */
  parentBoneName: string | null;
  bindWorldPosition: Vec3;
  bindWorldQuaternion: Quat;
  /** Unit. The hinge axis, perpendicular to the segments it bends. */
  primaryBendAxis: Vec3;
  /** Unit. Along the distal segment. */
  twistAxis: Vec3;
  /** Radians about `primaryBendAxis`, RELATIVE TO THE BIND POSE, so 0 is the rest angle. */
  jointLimits: { minRad: number; maxRad: number };
};

/** A joint of the rig in the shape `RigAsset` already uses, so the records compose. */
export type DerivedJoint = {
  boneName: string;
  parentBoneName?: string;
  bindLocalPosition: Vec3;
  bindLocalQuaternion: Quat;
};

export type DerivedSkeletonProfile = {
  rigFingerprint: string;
  /** Governs every vector in this record, positions AND axes. */
  bindSpace: string;
  /** Every joint of `skins[0]`, sanitised. */
  jointNames: readonly string[];
  joints: readonly DerivedJoint[];
  /** Bind WORLD position per bone name — the same map `RigAsset.bindFrame` carries. */
  bindFrame: Readonly<Record<string, Vec3>>;
  landmarks: Readonly<Record<string, DerivedLandmark>>;
};

/** three.js `PropertyBinding.sanitizeNodeName` strips dots; colons survive. */
const sanitise = (name: string): string => name.replace(/\./g, "");

// -- GLB shape (JSON chunk only: the TRS route never reads the binary) ---------------------------

type GltfNode = {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
};
type GltfSkin = { joints: number[] };
type GltfJson = { nodes?: GltfNode[]; skins?: GltfSkin[] };

function readGlbJson(path: string): GltfJson {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`deriveSkeletonProfileFromRigAsset: not a GLB: ${path}`);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const kind = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) return JSON.parse(body.toString("utf8")) as GltfJson;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`deriveSkeletonProfileFromRigAsset: no JSON chunk in ${path}`);
}

// -- column-major 4x4 matrix math -----------------------------------------------------------------

const IDENTITY4: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Node local matrix: the `matrix` property when present, else T * R * S from TRS. */
function nodeLocalMatrix(node: GltfNode): number[] {
  if (node.matrix) return [...node.matrix];
  const t = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const x = rotation[0] ?? 0;
  const y = rotation[1] ?? 0;
  const z = rotation[2] ?? 0;
  const w = rotation[3] ?? 1;
  const s = node.scale ?? [1, 1, 1];
  // glTF quaternions are [x, y, z, w]; the matrix below is the standard quaternion rotation,
  // stored column-major with the translation in the last column.
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, 1,
  ];
  for (let c = 0; c < 3; c += 1) {
    const scale = s[c] ?? 1;
    m[c * 4] = (m[c * 4] ?? 0) * scale;
    m[c * 4 + 1] = (m[c * 4 + 1] ?? 0) * scale;
    m[c * 4 + 2] = (m[c * 4 + 2] ?? 0) * scale;
  }
  return m;
}

/** Column-major multiply: out = a * b (apply b's frame first, then a's). */
function mul4(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 4; i += 1) {
      let v = 0;
      for (let k = 0; k < 4; k += 1) v += a[4 * k + i]! * b[4 * j + k]!;
      out[4 * j + i] = v;
    }
  }
  return out;
}

/** Accumulate node TRS from the root down to `index` — the bind world matrix of that node. */
function nodeWorldMatrix(
  nodes: readonly GltfNode[],
  parentOf: ReadonlyMap<number, number>,
  index: number,
): number[] {
  const chain: number[] = [];
  let cursor: number | undefined = index;
  while (cursor !== undefined) {
    chain.unshift(cursor);
    cursor = parentOf.get(cursor);
  }
  let world = [...IDENTITY4];
  for (const nodeIndex of chain) world = mul4(world, nodeLocalMatrix(nodes[nodeIndex] ?? {}));
  return world;
}

/** Quaternion from the 3x3 of a column-major 4x4. Same element reads as the contract's oracle. */
function quaternionFromMatrix(m: readonly number[]): Quat {
  const g = (i: number): number => m[i]!;
  const trace = g(0) + g(5) + g(10);
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { x: (g(6) - g(9)) / s, y: (g(8) - g(2)) / s, z: (g(1) - g(4)) / s, w: 0.25 * s };
  }
  if (g(0) > g(5) && g(0) > g(10)) {
    const s = Math.sqrt(1 + g(0) - g(5) - g(10)) * 2;
    return { x: 0.25 * s, y: (g(4) + g(1)) / s, z: (g(8) + g(2)) / s, w: (g(6) - g(9)) / s };
  }
  if (g(5) > g(10)) {
    const s = Math.sqrt(1 + g(5) - g(0) - g(10)) * 2;
    return { x: (g(4) + g(1)) / s, y: 0.25 * s, z: (g(9) + g(6)) / s, w: (g(8) - g(2)) / s };
  }
  const s = Math.sqrt(1 + g(10) - g(0) - g(5)) * 2;
  return { x: (g(8) + g(2)) / s, y: (g(9) + g(6)) / s, z: 0.25 * s, w: (g(1) - g(4)) / s };
}

/** A TRS-accumulated matrix may carry scale; the contract requires unit-length quaternions. */
function normaliseQuaternion(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  if (n === 0) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// -- vector helpers ---------------------------------------------------------------------------------

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

function normaliseDirection(v: Vec3, fallback: Vec3): Vec3 {
  const n = norm3(v);
  return n > 1e-8 ? { x: v.x / n, y: v.y / n, z: v.z / n } : fallback;
}

/** Any unit vector perpendicular to `v`. Used only where the contract asserts nothing. */
function anyPerpendicular(v: Vec3): Vec3 {
  const ref = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normaliseDirection(cross3(v, ref), { x: 1, y: 0, z: 0 });
}

// -- fingerprint ------------------------------------------------------------------------------------

/**
 * FNV-1a over the decoded skeleton: joint names and quantised bind positions. A byte-identical copy
 * decodes identically and fingerprints identically; the three rig families differ in joint sets, so
 * their fingerprints differ. Keyed on the SKELETON, never on the path or the filename.
 */
function computeRigFingerprint(entries: readonly { boneName: string; world: readonly number[] }[]): string {
  const parts = [...entries]
    .sort((a, b) => a.boneName.localeCompare(b.boneName))
    .map((e) => `${e.boneName}|${e.world[12]!.toFixed(6)},${e.world[13]!.toFixed(6)},${e.world[14]!.toFixed(6)}`);
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `rig-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// -- the deriver -------------------------------------------------------------------------------------

/**
 * Conservative symmetric placeholder range about the bind pose (rest angle 0). The contract only
 * requires the bind pose to lie inside and the span to be at most a full turn; anatomical limits
 * are a separate concern (notEvidenceFor, see the module header).
 */
const PLACEHOLDER_JOINT_LIMITS = { minRad: -1.0, maxRad: 1.0 };

export function deriveSkeletonProfileFromRigAsset(
  glbPath: string,
  landmarks: readonly string[],
): DerivedSkeletonProfile {
  const json = readGlbJson(glbPath);
  const nodes = json.nodes ?? [];
  const skin = json.skins?.[0];
  if (!skin) {
    throw new Error(`deriveSkeletonProfileFromRigAsset: ${glbPath} carries no skin — it is not a rig`);
  }

  const parentOf = new Map<number, number>();
  nodes.forEach((node, index) => (node.children ?? []).forEach((child) => parentOf.set(child, index)));
  const jointSet = new Set(skin.joints);

  // Every joint of `skins[0]`, in file order, with its TRS-accumulated bind world matrix.
  const entries = skin.joints.map((nodeIndex) => {
    const node = nodes[nodeIndex] ?? {};
    const world = nodeWorldMatrix(nodes, parentOf, nodeIndex);
    const local = nodeLocalMatrix(node);
    const parentIndex = parentOf.get(nodeIndex);
    const parentIsJoint = parentIndex !== undefined && jointSet.has(parentIndex);
    return {
      boneName: sanitise(node.name ?? `node_${nodeIndex}`),
      parentBoneName:
        parentIsJoint ? sanitise(nodes[parentIndex!]?.name ?? `node_${parentIndex}`) : undefined,
      world,
      local,
    };
  });

  const jointNames = entries.map((e) => e.boneName);
  const byBone = new Map(entries.map((e) => [e.boneName, e]));
  const jointNameSet = new Set(jointNames);
  const bindFrame: Record<string, Vec3> = {};
  for (const e of entries) {
    bindFrame[e.boneName] = { x: e.world[12]!, y: e.world[13]!, z: e.world[14]! };
  }

  const joints: DerivedJoint[] = entries.map((e) => ({
    boneName: e.boneName,
    ...(e.parentBoneName === undefined ? {} : { parentBoneName: e.parentBoneName }),
    bindLocalPosition: { x: e.local[12]!, y: e.local[13]!, z: e.local[14]! },
    bindLocalQuaternion: normaliseQuaternion(quaternionFromMatrix(e.local)),
  }));

  // Resolve every requested landmark against THIS rig, refusing what it cannot carry.
  const resolved: { key: string; boneName: string; position: Vec3; parentBoneName: string | null }[] = [];
  for (const key of landmarks) {
    const boneName = resolvePoseBone(key, jointNameSet);
    if (boneName === null) {
      throw new Error(`deriveSkeletonProfileFromRigAsset: landmark "${key}" does not resolve to a bone on ${glbPath}`);
    }
    const entry = byBone.get(boneName);
    if (!entry) {
      throw new Error(`deriveSkeletonProfileFromRigAsset: landmark "${key}" resolved to "${boneName}", which is not a joint of ${glbPath}`);
    }
    resolved.push({
      key,
      boneName,
      parentBoneName: entry.parentBoneName ?? null,
      position: bindFrame[boneName]!,
    });
  }

  // Axes from the rig's OWN segment directions, in the order the caller asked for the landmarks.
  // For a three-landmark arm chain the middle landmark's bend is the plane normal
  // cross(proximal, distal) — perpendicular to BOTH segments, which is clause (6) of the contract.
  const landmarkRecords: Record<string, DerivedLandmark> = {};
  for (let i = 0; i < resolved.length; i += 1) {
    const current = resolved[i]!;
    const proximalDir =
      i > 0 ? normaliseDirection(
        { x: current.position.x - resolved[i - 1]!.position.x, y: current.position.y - resolved[i - 1]!.position.y, z: current.position.z - resolved[i - 1]!.position.z },
        { x: 0, y: 1, z: 0 },
      ) : null;
    const distalDir =
      i < resolved.length - 1 ? normaliseDirection(
        { x: resolved[i + 1]!.position.x - current.position.x, y: resolved[i + 1]!.position.y - current.position.y, z: resolved[i + 1]!.position.z - current.position.z },
        { x: 0, y: 1, z: 0 },
      ) : null;

    const twist = distalDir ?? proximalDir ?? { x: 0, y: 0, z: 1 };
    const bend =
      proximalDir && distalDir
        ? normaliseDirection(cross3(proximalDir, distalDir), anyPerpendicular(distalDir))
        : anyPerpendicular(twist);

    landmarkRecords[current.key] = {
      boneName: current.boneName,
      parentBoneName: current.parentBoneName,
      bindWorldPosition: current.position,
      bindWorldQuaternion: normaliseQuaternion(quaternionFromMatrix(byBone.get(current.boneName)!.world)),
      primaryBendAxis: bend,
      twistAxis: twist,
      jointLimits: PLACEHOLDER_JOINT_LIMITS,
    };
  }

  return {
    rigFingerprint: computeRigFingerprint(entries),
    bindSpace: REGION_ANCHOR_SPACE,
    jointNames,
    joints,
    bindFrame,
    landmarks: landmarkRecords,
  };
}
