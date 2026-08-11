/**
 * issue-307 idle calibration — replicate the runtime's three.js pose convention on the
 * exported mixamo-rigged library GLB and search eulers that reproduce a clinical hang.
 *
 * The runtime `applyBoneEuler` REPLACES a bone's local rotation with Euler(x,y,z) in
 * the parent frame (three.js `.rotation.set` → `quaternion.setFromEuler`). We mirror
 * that exactly here: for a posed bone, localMatrix = T(restTranslation) * R(euler) *
 * S(restScale); all other bones keep their rest transforms. Score = hand-bone
 * horizontal distance from the root (the finish-parity metric) + hand below shoulder.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/probe-307-calibrate-idle.ts <glb> [--dump]
 */
import { NodeIO } from "@gltf-transform/core";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const glbPath =
  process.argv[2] ??
  `${REPO_ROOT}/apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb`;
const dump = process.argv.includes("--dump");

type M4 = number[]; // column-major 16

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

function mat4(
  tx: number,
  ty: number,
  tz: number,
  q: [number, number, number, number],
  sx = 1,
  sy = 1,
  sz = 1,
): M4 {
  const [qx, qy, qz, qw] = q;
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
    tx, ty, tz, 1,
  ];
}

function eulerToQuat(x: number, y: number, z: number): [number, number, number, number] {
  // three.js Euler order XYZ (intrinsic): quaternion = qx * qy * qz
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

function transformPoint(m: M4, p: [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

async function main(): Promise<void> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error("no skin");
  const joints = skin.listJoints();

  const parents = new Map<string, string | null>();
  for (const j of joints) parents.set(j.getName(), null);
  for (const j of joints) {
    for (const child of j.listChildren()) {
      if (!parents.has(child.getName())) parents.set(child.getName(), j.getName());
    }
  }

  const restTRS = new Map<string, { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] }>();
  for (const j of joints) {
    const t = j.getTranslation();
    const r = j.getRotation();
    const s = j.getScale();
    restTRS.set(j.getName(), { t: [t[0], t[1], t[2]], r: [r[0], r[1], r[2], r[3]], s: [s[0], s[1], s[2]] });
  }

  /** world matrix of `name`, applying euler overrides (parent-frame, rest-rotation replaced). */
  function worldMatrix(name: string, overrides: ReadonlyMap<string, [number, number, number]>): M4 {
    const chain: string[] = [];
    let cur: string | null = name;
    while (cur) {
      chain.unshift(cur);
      cur = parents.get(cur) ?? null;
    }
    let m = mat4(0, 0, 0, [0, 0, 0, 1]);
    for (const cn of chain) {
      const trs = restTRS.get(cn);
      if (!trs) continue;
      const ov = overrides.get(cn);
      const q = ov ? eulerToQuat(ov[0], ov[1], ov[2]) : trs.r;
      m = mul(m, mat4(trs.t[0], trs.t[1], trs.t[2], q, trs.s[0], trs.s[1], trs.s[2]));
    }
    return m;
  }

  const origin = transformPoint(worldMatrix("mixamorig:Root", new Map()), [0, 0, 0]);
  const shoulder = transformPoint(worldMatrix("mixamorig:LeftShoulder", new Map()), [0, 0, 0]);
  const restHand = transformPoint(worldMatrix("mixamorig:LeftHand", new Map()), [0, 0, 0]);
  const lateral = (p: [number, number, number]) => Math.hypot(p[0] - origin[0], p[2] - origin[2]);

  if (dump) {
    console.log(
      JSON.stringify(
        {
          glb: glbPath,
          jointCount: joints.length,
          origin: origin.map((v) => +v.toFixed(4)),
          shoulderWorld: shoulder.map((v) => +v.toFixed(4)),
          restHand: restHand.map((v) => +v.toFixed(4)),
          restHandLateralM: +lateral(restHand).toFixed(4),
        },
        null,
        2,
      ),
    );
  }

  type Eulers = { arm: [number, number, number]; fore: [number, number, number]; hand: [number, number, number] };

  function posedHand(e: Eulers): [number, number, number] {
    const ov = new Map<string, [number, number, number]>([
      ["mixamorig:LeftArm", e.arm],
      ["mixamorig:LeftForeArm", e.fore],
      ["mixamorig:LeftHand", e.hand],
    ]);
    return transformPoint(worldMatrix("mixamorig:LeftHand", ov), [0, 0, 0]);
  }

  // Stage 1: LeftArm only, coarse.
  let best: { score: number; arm: [number, number, number]; hand: [number, number, number] } | null = null;
  for (let xi = -24; xi <= 32; xi++) {
    const x = xi * 0.05;
    for (let yi = -16; yi <= 16; yi++) {
      const y = yi * 0.05;
      for (let zi = -16; zi <= 16; zi++) {
        const z = zi * 0.05;
        const hand = posedHand({ arm: [x, y, z], fore: [0, 0, 0], hand: [0, 0, 0] });
        const lat = lateral(hand);
        const score =
          Math.abs(lat - 0.34) * 2 +
          Math.max(hand[1] - shoulder[1], 0) * 4 + // hand above shoulder: bad
          Math.max(shoulder[1] - hand[1] - 0.5, 0) * 0.5 + // prefer hand >= 0.5 below shoulder
          (hand[0] < origin[0] ? 3 : 0) + // crossed midline
          Math.max(Math.abs(hand[2] - origin[2]) - 0.6, 0) * 1; // too far forward/back
        if (!best || score < best.score) best = { score, arm: [x, y, z], hand };
      }
    }
  }

  const result: Record<string, unknown> = {
    glb: glbPath,
    restHandLateralM: +lateral(restHand).toFixed(4),
    bestArmOnly:
      best === null
        ? null
        : {
            armEulers: best.arm.map((v) => +v.toFixed(3)),
            hand: best.hand.map((v) => +v.toFixed(4)),
            lateralM: +lateral(best.hand).toFixed(4),
            belowShoulderM: +(shoulder[1] - best.hand[1]).toFixed(4),
          },
  };

  // Stage 2: refine forearm + hand around the best arm.
  if (best) {
    let best2: { score: number; fore: [number, number, number]; handE: [number, number, number]; hand: [number, number, number] } | null = null;
    for (let fxi = -14; fxi <= 14; fxi++) {
      const fx = fxi * 0.05;
      for (let fyi = -10; fyi <= 10; fyi++) {
        const fy = fyi * 0.05;
        for (let fzi = -10; fzi <= 10; fzi++) {
          const fz = fzi * 0.05;
          for (let hxi = -8; hxi <= 8; hxi++) {
            const hx = hxi * 0.05;
            const hand = posedHand({ arm: best.arm, fore: [fx, fy, fz], hand: [hx, 0, 0] });
            const lat = lateral(hand);
            const score =
              Math.abs(lat - 0.34) * 2 +
              Math.max(hand[1] - shoulder[1], 0) * 4 +
              Math.max(shoulder[1] - hand[1] - 0.5, 0) * 0.5 +
              (hand[0] < origin[0] ? 3 : 0) +
              Math.max(Math.abs(hand[2] - origin[2]) - 0.6, 0);
            if (!best2 || score < best2.score) best2 = { score, fore: [fx, fy, fz], handE: [hx, 0, 0], hand };
          }
        }
      }
    }
    result.bestWithForearm =
      best2 === null
        ? null
        : {
            armEulers: best.arm.map((v) => +v.toFixed(3)),
            foreEulers: best2.fore.map((v) => +v.toFixed(3)),
            handEulers: best2.handE.map((v) => +v.toFixed(3)),
            hand: best2.hand.map((v) => +v.toFixed(4)),
            lateralM: +lateral(best2.hand).toFixed(4),
            belowShoulderM: +(shoulder[1] - best2.hand[1]).toFixed(4),
          };
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
