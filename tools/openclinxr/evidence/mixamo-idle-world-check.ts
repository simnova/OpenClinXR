/**
 * issue-307 durable instrument: what does the runtime clinical idle do to a mixamo-rigged
 * library body, measured in the exact three.js pose convention on the exported GLB?
 *
 * The runtime `applyBoneEuler` REPLACES a bone's local rotation with Euler(x,y,z) in the
 * parent frame (three.js `.rotation.set` → `quaternion.setFromEuler`). This script walks
 * the exported GLB's joint hierarchy in that convention (validated against
 * gltf-transform's own `getWorldTranslation` — error < 1e-6) and reports the LeftHand
 * bone's world position under the library idle eulers plus the rest position. The
 * finish-parity metric (#219) is the hand bone's horizontal distance from the root
 * (Anny-derived band 0.22–0.46 m).
 *
 * Used to calibrate `MIXAMO_CLINICAL_IDLE_ARM_HANG` in
 * `apps/ui-xr/src/clinical-idle-posture.ts` (measured: the old AABB-rig z-flip lifts the
 * hand above the shoulder on the mixamo rig; the calibrated eulers land it at 0.34 m
 * lateral, 0.42 m below the shoulder).
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/mixamo-idle-world-check.ts <glb>
 */
import { NodeIO } from "@gltf-transform/core";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const glbPath =
  process.argv[2] ??
  `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb`;

type M4 = number[];

function mul(a: M4, b: M4): M4 {
  const out = new Array(16).fill(0) as M4;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function mat4(tx: number, ty: number, tz: number, q: [number, number, number, number], sx = 1, sy = 1, sz = 1): M4 {
  const [qx, qy, qz, qw] = q;
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
    tx, ty, tz, 1,
  ];
}

function eulerToQuat(x: number, y: number, z: number): [number, number, number, number] {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

async function main(): Promise<void> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();

  const parents = new Map<string, string | null>();
  const jointNames = new Set(joints.map((j) => j.getName()));
  for (const j of joints) {
    const parent = j.listParents().find((p) => jointNames.has(p.getName()));
    parents.set(j.getName(), parent ? parent.getName() : null);
  }

  const rest = new Map<string, { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] }>();
  for (const j of joints) {
    const t = j.getTranslation();
    const r = j.getRotation();
    const s = j.getScale();
    rest.set(j.getName(), { t: [t[0], t[1], t[2]], r: [r[0], r[1], r[2], r[3]], s: [s[0], s[1], s[2]] });
  }

  function worldMatrix(name: string, overrides: ReadonlyMap<string, [number, number, number]>): M4 {
    const chain: string[] = [];
    let cur: string | null = name;
    while (cur) {
      chain.unshift(cur);
      cur = parents.get(cur) ?? null;
    }
    let m = mat4(0, 0, 0, [0, 0, 0, 1]);
    for (const cn of chain) {
      const trs = rest.get(cn);
      if (!trs) continue;
      const ov = overrides.get(cn);
      const q = ov ? eulerToQuat(ov[0], ov[1], ov[2]) : trs.r;
      m = mul(m, mat4(trs.t[0], trs.t[1], trs.t[2], q, trs.s[0], trs.s[1], trs.s[2]));
    }
    return m;
  }

  const pt = (m: M4): [number, number, number] => [m[12], m[13], m[14]];

  // validate the walk against gltf-transform's own world translation
  const handNode = joints.find((j) => j.getName() === "mixamorig:LeftHand")!;
  const mine = pt(worldMatrix("mixamorig:LeftHand", new Map()));
  const theirs = handNode.getWorldTranslation();
  const err = Math.hypot(mine[0] - theirs[0], mine[1] - theirs[1], mine[2] - theirs[2]);

  const origin = pt(worldMatrix("mixamorig:Root", new Map()));
  const shoulder = pt(worldMatrix("mixamorig:LeftShoulder", new Map()));
  const restHand = pt(worldMatrix("mixamorig:LeftHand", new Map()));
  const restLateral = Math.hypot(restHand[0] - origin[0], restHand[2] - origin[2]);

  // runtime library idle (LIBRARY_CLINICAL_IDLE_ARM_HANG) — arm/fore/hand eulers, absolute
  const LIBRARY_IDLE = new Map<string, [number, number, number]>([
    ["mixamorig:LeftArm", [-0.22, 0.06, 1.12]],
    ["mixamorig:LeftForeArm", [-0.18, -0.1, 0.22]],
    ["mixamorig:LeftHand", [0.04, 0.06, -0.06]],
  ]);
  const idleHand = pt(worldMatrix("mixamorig:LeftHand", LIBRARY_IDLE));
  const idleLateral = Math.hypot(idleHand[0] - origin[0], idleHand[2] - origin[2]);

  // anny-sense variant (z sign flipped) for comparison
  const ANNY_IDLE = new Map<string, [number, number, number]>([
    ["mixamorig:LeftArm", [-0.22, 0.06, -1.12]],
    ["mixamorig:LeftForeArm", [-0.18, -0.1, 0.22]],
    ["mixamorig:LeftHand", [0.04, 0.06, -0.06]],
  ]);
  const annyHand = pt(worldMatrix("mixamorig:LeftHand", ANNY_IDLE));
  const annyLateral = Math.hypot(annyHand[0] - origin[0], annyHand[2] - origin[2]);

  console.log(
    JSON.stringify(
      {
        glb: glbPath,
        walkErrorVsGltfTransform: +err.toFixed(6),
        root: origin.map((v) => +v.toFixed(3)),
        shoulderY: +shoulder[1].toFixed(3),
        restHand: restHand.map((v) => +v.toFixed(3)),
        restLateralM: +restLateral.toFixed(3),
        libraryIdleHand: idleHand.map((v) => +v.toFixed(3)),
        libraryIdleLateralM: +idleLateral.toFixed(3),
        libraryIdleBelowShoulderM: +(shoulder[1] - idleHand[1]).toFixed(3),
        annySenseHand: annyHand.map((v) => +v.toFixed(3)),
        annySenseLateralM: +annyLateral.toFixed(3),
        finishParityBand: [0.22, 0.46],
        verdict: idleLateral >= 0.22 && idleLateral <= 0.46 ? "in_band" : "OUT_OF_BAND",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
