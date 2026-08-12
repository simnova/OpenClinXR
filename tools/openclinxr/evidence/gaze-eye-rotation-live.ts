/**
 * #337 — LIVE three.js runtime probe (ground truth, §6v: measure with the instrument the
 * runtime uses). Loads the shipped MPFB GLB with the SAME three.js + GLTFLoader the ui-xr
 * app uses, and measures how far the eye-mesh iris verts move when the eye bones are
 * rotated. Reports BOTH mechanisms:
 *
 *   SHIPPED — `bone.rotation.y = gaze * 0.7` (gaze-drives-eyes.ts pre-#337)
 *   FIXED   — `bone.rotateOnWorldAxis(worldUp, gaze * 0.7)` (gaze-drives-eyes.ts #337)
 *
 * The skinning uses the EXACT shader path: `Skeleton.update()` writes
 * `boneMatrices[i] = bones[i].matrixWorld * boneInverses[i]` (three.js r184 — note the
 * order; `boneInverse * matrixWorld` rotates about the skeleton origin and is WRONG), and
 * the vertex = `bindMatrixInverse * Σ w * boneMatrices[j] * bindMatrix * position`.
 *
 * MEASURED 2026-08-11 (gaze=1, yaw=0.7 rad) at the iris (front verts of the left eye):
 *   SHIPPED: 5.13 mm mean, direction x -2.24 / y +4.49 / z +1.07  -> mostly VERTICAL
 *   FIXED:  12.77 mm mean, direction x -12.06 / y -2.23 / z -3.55 -> 94% LATERAL
 * The shipped mechanism rolls the eye UP (the eye bone's rest euler composition turns the
 * local-Y yaw into a world-vertical axis on this rig); the fixed mechanism is a horizontal
 * look-away. Both numbers are iris displacement in mm.
 *
 * Text-only probe: numbers, never an image.
 */
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GLB = `${REPO_ROOT}/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb`;
const THREE_MODULE = pathToFileURL(
  `${REPO_ROOT}/apps/ui-xr/node_modules/three/build/three.module.js`,
).href;
const LOADER_MODULE = pathToFileURL(
  `${REPO_ROOT}/apps/ui-xr/node_modules/three/examples/jsm/loaders/GLTFLoader.js`,
).href;

const GAZE_YAW_SCALE = 0.7;
const GAZE = 1.0;

async function main() {
  const THREE = await import(THREE_MODULE);
  const { GLTFLoader } = await import(LOADER_MODULE);
  const data = readFileSync(GLB);
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Scene }>((resolveP, rejectP) => {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    loader.parse(buf, "", (parsed) => resolveP(parsed as { scene: THREE.Scene }), rejectP);
  });
  const root = gltf.scene;
  const sanitise = (n: string) => n.replaceAll(".", "");

  const load = async () => {
    // re-parse fresh for each mechanism so no reset bookkeeping can contaminate
    const loader2 = new GLTFLoader();
    const gltf2 = await new Promise<{ scene: THREE.Scene }>((resolveP, rejectP) => {
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      loader2.parse(buf, "", (parsed) => resolveP(parsed as { scene: THREE.Scene }), rejectP);
    });
    const r = gltf2.scene;
    r.updateMatrixWorld(true);
    let eyeMesh: any;
    r.traverse((o: any) => {
      if (o.isSkinnedMesh && /low-poly/i.test(o.name)) eyeMesh = o;
    });
    let idxL = -1, idxR = -1;
    eyeMesh.skeleton.bones.forEach((b: any, i: number) => {
      if (sanitise(b.name) === "eyeL") idxL = i;
      if (sanitise(b.name) === "eyeR") idxR = i;
    });
    return { root: r, eyeMesh, idxL, idxR };
  };

  const skinPositions = (eyeMesh: any) => {
    const skel = eyeMesh.skeleton;
    const pos = eyeMesh.geometry.attributes.position;
    const skinIdx = eyeMesh.geometry.attributes.skinIndex;
    const skinW = eyeMesh.geometry.attributes.skinWeight;
    const bind = eyeMesh.bindMatrix, bindInv = eyeMesh.bindMatrixInverse;
    const tmp = new (THREE as any).Vector3(), out = new (THREE as any).Vector4();
    const res: [number, number, number][] = [];
    skel.update(); // writes boneMatrices = matrixWorld * boneInverse (the shader input)
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(bind);
      out.set(0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const j = skinIdx.getComponent(i, k), w = skinW.getComponent(i, k);
        if (w <= 1e-6) continue;
        const m = new (THREE as any).Matrix4().fromArray(skel.boneMatrices, j * 16);
        const v = tmp.clone().applyMatrix4(m);
        out.x += w * v.x; out.y += w * v.y; out.z += w * v.z;
      }
      out.applyMatrix4(bindInv);
      res.push([out.x, out.y, out.z]);
    }
    return res;
  };

  const measure = async (label: string, rotate: (s: { eyeMesh: any; idxL: number; idxR: number; root: any }) => void) => {
    const { eyeMesh, idxL, idxR, root: r } = await load();
    const rest = skinPositions(eyeMesh);
    // iris verts: front-most (max z) verts of the LEFT eye (x > 0)
    let maxZ = -1e9;
    for (const p of rest) if (p[0] > 0.005) maxZ = Math.max(maxZ, p[2]);
    const irisIdx = rest
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p[0] > 0.005 && Math.abs(p[2] - maxZ) < 1e-4)
      .map(({ i }) => i);
    rotate({ eyeMesh, idxL, idxR, root: r });
    r.updateMatrixWorld(true);
    const moved = skinPositions(eyeMesh);
    let dx = 0, dy = 0, dz = 0, maxD = 0, sumD = 0;
    for (let i = 0; i < rest.length; i++) {
      const d = Math.hypot(moved[i][0] - rest[i][0], moved[i][1] - rest[i][1], moved[i][2] - rest[i][2]);
      maxD = Math.max(maxD, d);
      sumD += d;
    }
    for (const i of irisIdx) {
      dx += moved[i][0] - rest[i][0];
      dy += moved[i][1] - rest[i][1];
      dz += moved[i][2] - rest[i][2];
    }
    dx /= irisIdx.length; dy /= irisIdx.length; dz /= irisIdx.length;
    const mag = Math.hypot(dx, dy, dz) * 1000;
    console.log("EYE_ROTATION_MECHANISM", JSON.stringify({
      mechanism: label,
      yawRad: +(GAZE * GAZE_YAW_SCALE).toFixed(4),
      irisVerts: irisIdx.length,
      irisMeanDeltaMm: { x: +(dx * 1000).toFixed(2), y: +(dy * 1000).toFixed(2), z: +(dz * 1000).toFixed(2) },
      irisMeanMagMm: +mag.toFixed(2),
      lateralFraction: +((Math.abs(dx) * 1000) / (mag || 1)).toFixed(2),
      verticalFraction: +((Math.abs(dy) * 1000) / (mag || 1)).toFixed(2),
      allVertsMaxMm: +(maxD * 1000).toFixed(2),
      allVertsMeanMm: +((sumD / rest.length) * 1000).toFixed(2),
      method: "three.js r" + THREE.REVISION + " Skeleton.update boneMatrices (matrixWorld * boneInverse) + bindMatrixInverse*bind, the exact shader path",
    }));
  };

  await measure("SHIPPED_rotation.y=yaw", ({ eyeMesh, idxL, idxR }) => {
    eyeMesh.skeleton.bones[idxL].rotation.y = GAZE * GAZE_YAW_SCALE;
    eyeMesh.skeleton.bones[idxR].rotation.y = GAZE * GAZE_YAW_SCALE;
  });
  await measure("FIXED_rotateOnWorldAxis", ({ eyeMesh, idxL, idxR }) => {
    const up = new (THREE as any).Vector3(0, 1, 0);
    for (const i of [idxL, idxR]) eyeMesh.skeleton.bones[i].rotateOnWorldAxis(up, GAZE * GAZE_YAW_SCALE);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
