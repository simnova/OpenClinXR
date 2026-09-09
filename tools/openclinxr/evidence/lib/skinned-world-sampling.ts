/**
 * Browser-side skinning math, shared as SOURCE because it runs inside `page.evaluate`.
 *
 * WHY A STRING. These functions execute in the page, not in node, so they cannot be imported
 * by the instrument that uses them — they have to arrive as text and be interpolated into the
 * evaluate body. Exporting them from one module is still the point: two instruments that each
 * carry their own copy of a 100-line CPU-skinning routine will drift, and the drift is silent
 * because both would keep returning plausible numbers.
 *
 * WHAT IT COMPUTES. `skinnedWorldAabb(mesh)` returns the WORLD-space axis-aligned bounds of a
 * skinned mesh after CPU-skinning its vertices through the live skeleton — bind matrix, bone
 * matrixWorld, bone inverses, four weights per vertex. It is the posed, skinned figure, not the
 * container that holds it. That distinction is the whole reason it exists: an actor slot Group
 * can move while its humanoid child compensates in local space, and only the skinned bounds
 * show which of the two actually happened.
 *
 * It strides the position attribute to at most ~4,000 samples, so it is an approximation of the
 * bounds and not a hull. Adequate for a metre-scale placement delta; not a collision test.
 *
 * Extracted verbatim from tools/openclinxr/evidence/inpatient-supine-staging.ts, which was its
 * only caller. That instrument still consumes it, so its own suite is the extraction's proof.
 */
export const SKINNED_WORLD_SAMPLING_SOURCE = String.raw`
    function mulMat4Vec3(e, x, y, z) {
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
      return [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
      ];
    }

    function mulMat4(ae, be) {
      const te = new Float64Array(16);
      const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
      const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
      const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
      const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
      const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
      const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
      const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
      const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
      te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
      te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
      te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
      te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
      te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
      te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
      te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
      te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
      te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
      te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
      te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
      te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
      te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
      return te;
    }

    function skinnedWorldAabb(mesh) {
      if (typeof mesh.updateMatrixWorld === "function") mesh.updateMatrixWorld(true);
      if (mesh.skeleton && typeof mesh.skeleton.update === "function") mesh.skeleton.update();
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos || pos.count === 0) return null;
      const skinIndex = mesh.geometry.attributes.skinIndex;
      const skinWeight = mesh.geometry.attributes.skinWeight;
      const skeleton = mesh.skeleton;
      const bindMatrix = mesh.bindMatrix && mesh.bindMatrix.elements;
      const bindMatrixInverse = mesh.bindMatrixInverse && mesh.bindMatrixInverse.elements;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const stride = Math.max(1, Math.floor(pos.count / 4000));
      function acc(x, y, z) {
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }
      if (skinIndex && skinWeight && skeleton && skeleton.bones && skeleton.bones.length && bindMatrix && bindMatrixInverse) {
        const bones = skeleton.bones;
        const inverses = skeleton.boneInverses;
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const bound = mulMat4Vec3(bindMatrix, vx, vy, vz);
          let sx = 0, sy = 0, sz = 0;
          for (let k = 0; k < 4; k++) {
            const weight = k === 0 ? skinWeight.getX(i) : k === 1 ? skinWeight.getY(i) : k === 2 ? skinWeight.getZ(i) : (skinWeight.getW ? skinWeight.getW(i) : 0);
            if (weight === 0) continue;
            const boneIdx = k === 0 ? skinIndex.getX(i) : k === 1 ? skinIndex.getY(i) : k === 2 ? skinIndex.getZ(i) : (skinIndex.getW ? skinIndex.getW(i) : 0);
            const bone = bones[boneIdx];
            const inv = inverses[boneIdx];
            if (!bone || !bone.matrixWorld || !bone.matrixWorld.elements || !inv || !inv.elements) continue;
            const boneMat = mulMat4(bone.matrixWorld.elements, inv.elements);
            const p = mulMat4Vec3(boneMat, bound[0], bound[1], bound[2]);
            sx += p[0] * weight; sy += p[1] * weight; sz += p[2] * weight;
          }
          const invP = mulMat4Vec3(bindMatrixInverse, sx, sy, sz);
          const weightSum = skinWeight.getX(i) + skinWeight.getY(i) + skinWeight.getZ(i) + (skinWeight.getW ? skinWeight.getW(i) : 0);
          let fx, fy, fz;
          if (weightSum > 1e-6) {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, invP[0], invP[1], invP[2])
              : invP;
            fx = w[0]; fy = w[1]; fz = w[2];
          } else {
            const w = mesh.matrixWorld && mesh.matrixWorld.elements
              ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
              : [vx, vy, vz];
            fx = w[0]; fy = w[1]; fz = w[2];
          }
          acc(fx, fy, fz);
        }
      } else {
        for (let i = 0; i < pos.count; i += stride) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const w = mesh.matrixWorld && mesh.matrixWorld.elements
            ? mulMat4Vec3(mesh.matrixWorld.elements, vx, vy, vz)
            : [vx, vy, vz];
          acc(w[0], w[1], w[2]);
        }
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
      return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    }
`;
