export const POSED_WORLD_BOX_SOURCE = String.raw`    function worldBox(obj) {
      if (!obj || typeof obj.updateWorldMatrix !== "function") return null;
      obj.updateWorldMatrix(true, true);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      obj.traverse(function (child) {
        if (!child || !child.isMesh || !child.geometry) return;
        if (child.visible === false) return;
        if (child.isSkinnedMesh && typeof child.getVertexPosition === "function") {
          const pos = child.geometry.attributes && child.geometry.attributes.position;
          if (!pos) return;
          child.updateWorldMatrix(true, false);
          const v = child.position.clone();
          for (let vi = 0; vi < pos.count; vi++) {
            child.getVertexPosition(vi, v);
            v.applyMatrix4(child.matrixWorld);
            minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
            maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
            any = true;
          }
          v.set(0, 0, 0);
          return;
        }
        if (child.geometry.computeBoundingBox) child.geometry.computeBoundingBox();
        const bb = child.geometry.boundingBox;
        if (!bb) return;
        child.updateWorldMatrix(true, false);
        const m = child.matrixWorld.elements;
        const xs = [bb.min.x, bb.max.x];
        const ys = [bb.min.y, bb.max.y];
        const zs = [bb.min.z, bb.max.z];
        for (let ix = 0; ix < 2; ix++) {
          for (let iy = 0; iy < 2; iy++) {
            for (let iz = 0; iz < 2; iz++) {
              const x = xs[ix], y = ys[iy], z = zs[iz];
              const wx = m[0]*x + m[4]*y + m[8]*z + m[12];
              const wy = m[1]*x + m[5]*y + m[9]*z + m[13];
              const wz = m[2]*x + m[6]*y + m[10]*z + m[14];
              minX = Math.min(minX, wx); minY = Math.min(minY, wy); minZ = Math.min(minZ, wz);
              maxX = Math.max(maxX, wx); maxY = Math.max(maxY, wy); maxZ = Math.max(maxZ, wz);
              any = true;
            }
          }
        }
      });
      if (!any) return null;
      return { minX: minX, minY: minY, minZ: minZ, maxX: maxX, maxY: maxY, maxZ: maxZ };
    }

`;
