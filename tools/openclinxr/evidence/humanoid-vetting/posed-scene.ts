/**
 * posed-scene.ts — CPU-posed raycast scene (promoted from the kevin-collar
 * p7b probe for the S7 visibility-selection card; formula verified against
 * three.js SkinnedMesh.getVertexPosition, maxDiff 1.04e-07 m).
 * Builds a raycast scene with CPU-posed geometry in glTF NodeIO mesh/prim
 * order (NOT GLTFLoader order).
 *
 * Skinning formula is three.js SkinnedMesh.applyBoneTransform exactly:
 *   skinVertex = bindMatrix * position
 *   skinned   += w_k * (boneWorld_k * IBM_k) * skinVertex
 *   posed     = bindMatrixInverse * skinned
 * with bindMatrix = mesh-node world matrix (verified numerically against
 * GLTFLoader's mesh.bindMatrix in p7b-a0).
 * Normals: n_posed = normalize( sum w_k * linear(M_k) * n ),
 *   M_k = bindMatrixInverse * boneWorld_k * IBM_k * bindMatrix.
 * World bake + DoubleSide inspection material + BVH mirror loadScene
 * (see-through-pixels.ts) so rays/camera match p7; only positions (and
 * shading normals) differ by the pose.
 */
import { NodeIO } from "@gltf-transform/core";
import type { Node } from "@gltf-transform/core";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";

export type PosedPrimStats = {
  mesh: string;
  prim: number;
  skinned: boolean;
  bones: number;
  verts: number;
  maxDelta: number;
  meanDelta: number;
};

export type JointOffBind = {
  joint: number;
  name: string;
  transDev: number;
  rotDevDeg: number;
};

function parentOf(nodes: Node[], child: Node): Node | null {
  for (const node of nodes) {
    if ((node.listChildren() as unknown[]).includes(child)) return node;
  }
  return null;
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function worldMatrixOf(nodes: Node[], node: Node): number[] {
  const local = [...node.getMatrix()];
  const parent = parentOf(nodes, node);
  return parent === null ? local : multiply(worldMatrixOf(nodes, parent), local);
}

export async function loadPosedModel(glbPath: string): Promise<{
  model: Group;
  stats: PosedPrimStats[];
  jointOffBind: JointOffBind[];
  breastJoints: Array<{ joint: number; name: string }>;
  skinJointNames: string[];
}> {
  const doc = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const skins = root.listSkins();

  // Joint world matrices + IBMs per skin index.
  type SkinInfo = { joints: Node[]; jw: Matrix4[]; ibm: Matrix4[] };
  const skinInfos: SkinInfo[] = [];
  for (const skin of skins) {
    const joints = skin.listJoints();
    const jw = joints.map((j) => new Matrix4().fromArray(worldMatrixOf(nodes, j)));
    const ibmAcc = skin.getInverseBindMatrices();
    const ibmArr = ibmAcc ? (Array.from(ibmAcc.getArray() as ArrayLike<number>) as number[]) : [];
    const ibm: Matrix4[] = [];
    for (let i = 0; i < joints.length; i++) {
      ibm.push(new Matrix4().fromArray(ibmArr.slice(i * 16, i * 16 + 16)));
    }
    skinInfos.push({ joints, jw, ibm });
  }
  const nodeSkinIdx = new Map<Node, number>();
  nodes.forEach((n) => {
    const s = n.getSkin();
    if (s) {
      const idx = (skins as unknown[]).indexOf(s);
      if (idx >= 0) nodeSkinIdx.set(n, idx);
    }
  });

  const jointNames: string[] = [];
  const jointOffBind: JointOffBind[] = [];
  const breastJoints: Array<{ joint: number; name: string }> = [];
  if (skinInfos.length > 0) {
    const si = skinInfos[0]!;
    for (let j = 0; j < si.joints.length; j++) {
      const joint = si.joints[j] as Node;
      const nm: string = joint.getName?.() ?? `joint${j}`;
      jointNames.push(nm);
      if (/breast/i.test(nm)) breastJoints.push({ joint: j, name: nm });
      // Off-bind deviation of D = JW * IBM from identity.
      const D = new Matrix4().multiplyMatrices(si.jw[j]!, si.ibm[j]!);
      const t = new Vector3().setFromMatrixPosition(D);
      const transDev = t.length();
      const e = new Matrix4().extractRotation(D);
      const tr = Math.min(1, Math.max(-1, (e.elements[0]! + e.elements[5]! + e.elements[10]! - 1) / 2));
      const rotDevDeg = (Math.acos(tr) * 180) / Math.PI;
      jointOffBind.push({ joint: j, name: nm, transDev, rotDevDeg });
    }
  }

  const model = new Group();
  const inspection = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const stats: PosedPrimStats[] = [];
  const tmpV = new Vector3();
  const tmpS = new Vector3();
  const tmpA = new Vector3();
  const tmpM = new Matrix4();

  for (const node of nodes) {
    const mesh = node.getMesh?.();
    if (!mesh) continue;
    const meshName: string = mesh.getName?.() || node.getName?.() || "mesh";
    const world = worldMatrixOf(nodes, node);
    const worldM = new Matrix4().fromArray(world);
    const [w0 = 0, w1 = 0, w2 = 0, , w4 = 0, w5 = 0, w6 = 0, , w8 = 0, w9 = 0, w10 = 0] = world;
    const c0 = Math.hypot(w0, w1, w2) || 1;
    const c1 = Math.hypot(w4, w5, w6) || 1;
    const c2 = Math.hypot(w8, w9, w10) || 1;
    const skinIdx = nodeSkinIdx.get(node);
    const si = skinIdx !== undefined ? skinInfos[skinIdx] : undefined;
    let primI = 0;
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute("POSITION");
      const arr = posAcc?.getArray();
      if (!arr) {
        primI++;
        continue;
      }
      const n = arr.length / 3;
      const jointArr = prim.getAttribute("JOINTS_0")?.getArray() as ArrayLike<number> | undefined;
      const weightArr = prim.getAttribute("WEIGHTS_0")?.getArray() as ArrayLike<number> | undefined;
      const skinned = !!si && !!jointArr && !!weightArr;
      const bindM = worldM.clone();
      const bindInv = worldM.clone().invert();
      // Per-joint posed matrices M_k = bindInv * JW * IBM * bind.
      let posedMats: Matrix4[] | null = null;
      if (skinned && si) {
        posedMats = si.joints.map((_, j) =>
          new Matrix4()
            .multiplyMatrices(si.jw[j]!, si.ibm[j]!)
            .premultiply(bindInv)
            .multiply(bindM),
        );
      }
      const positions = new Float32Array(arr.length);
      const disp = new Float32Array(n);
      let maxDelta = 0;
      let sumDelta = 0;
      for (let i = 0; i < n; i++) {
        const x = Number(arr[i * 3]);
        const y = Number(arr[i * 3 + 1]);
        const z = Number(arr[i * 3 + 2]);
        let lx = x;
        let ly = y;
        let lz = z;
        if (skinned && posedMats) {
          tmpS.set(x, y, z);
          tmpA.set(0, 0, 0);
          for (let k = 0; k < 4; k++) {
            const w = Number(weightArr![i * 4 + k]);
            if (w === 0) continue;
            const b = Math.round(Number(jointArr![i * 4 + k]));
            if (b < 0 || b >= posedMats.length) continue;
            tmpV.copy(tmpS).applyMatrix4(posedMats[b]!);
            tmpA.addScaledVector(tmpV, w);
          }
          lx = tmpA.x;
          ly = tmpA.y;
          lz = tmpA.z;
        }
        const dx = lx - x;
        const dy = ly - y;
        const dz = lz - z;
        const d = Math.hypot(dx, dy, dz);
        if (d > maxDelta) maxDelta = d;
        sumDelta += d;
        disp[i] = d;
        positions[i * 3] = world[0]! * lx + world[4]! * ly + world[8]! * lz + world[12]!;
        positions[i * 3 + 1] = world[1]! * lx + world[5]! * ly + world[9]! * lz + world[13]!;
        positions[i * 3 + 2] = world[2]! * lx + world[6]! * ly + world[10]! * lz + world[14]!;
      }
      const geom = new BufferGeometry();
      geom.setAttribute("position", new BufferAttribute(positions, 3));
      const nor = prim.getAttribute("NORMAL")?.getArray();
      if (nor && nor.length === arr.length) {
        const normals = new Float32Array(nor.length);
        for (let i = 0; i < n; i++) {
          let nx = Number(nor[i * 3]);
          let ny = Number(nor[i * 3 + 1]);
          let nz = Number(nor[i * 3 + 2]);
          if (skinned && posedMats) {
            // Linear part of M_k applied per weight, then normalize.
            let ax = 0;
            let ay = 0;
            let az = 0;
            for (let k = 0; k < 4; k++) {
              const w = Number(weightArr![i * 4 + k]);
              if (w === 0) continue;
              const b = Math.round(Number(jointArr![i * 4 + k]));
              if (b < 0 || b >= posedMats.length) continue;
              const e = posedMats[b]!.elements;
              ax += w * (e[0]! * nx + e[4]! * ny + e[8]! * nz);
              ay += w * (e[1]! * nx + e[5]! * ny + e[9]! * nz);
              az += w * (e[2]! * nx + e[6]! * ny + e[10]! * nz);
            }
            const l = Math.hypot(ax, ay, az);
            if (l > 1e-18) {
              nx = ax / l;
              ny = ay / l;
              nz = az / l;
            }
          }
          normals[i * 3] = nx / c0;
          normals[i * 3 + 1] = ny / c1;
          normals[i * 3 + 2] = nz / c2;
        }
        geom.setAttribute("normal", new BufferAttribute(normals, 3));
      }
      const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
      if (uv && uv.length === n * 2) {
        const uvs = new Float32Array(uv.length);
        for (let i = 0; i < uv.length; i++) uvs[i] = Number(uv[i]);
        geom.setAttribute("uv", new BufferAttribute(uvs, 2));
      }
      const idx = prim.getIndices()?.getArray();
      if (idx) geom.setIndex(Array.from(idx, (v) => Number(v)));
      const mat = prim.getMaterial();
      const obj = new Mesh(geom, inspection);
      obj.name = `${meshName}#${primI}`;
      obj.userData = {
        matName: mat?.getName?.() ?? "",
        matIndex: -1,
        alphaMode: mat?.getAlphaMode?.() ?? "OPAQUE",
        meshName,
        primIndex: primI,
        disp,
      };
      obj.frustumCulled = false;
      geom.boundsTree = new MeshBVH(geom, { verbose: false, indirect: true });
      obj.raycast = acceleratedRaycast;
      model.add(obj);
      stats.push({
        mesh: meshName,
        prim: primI,
        skinned,
        bones: si ? si.joints.length : 0,
        verts: n,
        maxDelta,
        meanDelta: n > 0 ? sumDelta / n : 0,
      });
      void tmpM;
      primI++;
    }
  }
  return { model, stats, jointOffBind, breastJoints, skinJointNames: jointNames };
}
