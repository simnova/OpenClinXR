/**
 * After reframeCameraForRoom places the elevated interior camera, reject a
 * viewpoint whose standing actors clip any of the four NDC edges or whose
 * eye→actor ray hits a wall/door. Orbit around the actor union inside the
 * interior AABB.
 *
 * Does not move rooms, furniture, actors, or lights. Known-good viewpoints
 * that already contain standing actors unoccluded on all four edges are
 * left in place.
 */
import type { Page } from "playwright";

export async function refineCameraForOcclusionAndContainment(page: Page): Promise<string> {
  const note = (await page.evaluate(`(() => {
    const scene = globalThis.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return "refine=no-scene";
    scene.updateMatrixWorld(true);

    let camera = null;
    scene.traverse(function (o) {
      if (camera) return;
      if (o.isPerspectiveCamera || o.type === "PerspectiveCamera") camera = o;
    });
    if (!camera) return "refine=no-camera";

    const worldBoxOf = function (obj) {
      const geom = obj.geometry;
      if (!geom) return null;
      if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
      const bb = geom.boundingBox;
      const e = obj.matrixWorld && obj.matrixWorld.elements;
      if (!bb || !e) return null;
      const xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
      let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const x = xs[i], y = ys[j], z = zs[k];
        const p = [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14]
        ];
        for (let c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
      }
      return isFinite(a[0]) ? { min: a, max: b } : null;
    };
    const grow = function (acc, box) {
      if (!box) return acc;
      if (!acc) return { min: box.min.slice(), max: box.max.slice() };
      for (let c = 0; c < 3; c++) {
        if (box.min[c] < acc.min[c]) acc.min[c] = box.min[c];
        if (box.max[c] > acc.max[c]) acc.max[c] = box.max[c];
      }
      return acc;
    };
    const actorIdOf = function (mesh) {
      let p = mesh;
      let depth = 0;
      while (p && depth < 8) {
        const ud = p.userData;
        if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId.length > 0) {
          return ud.openClinXrActorId;
        }
        p = p.parent;
        depth += 1;
      }
      return mesh.uuid || "anon";
    };

    let roomRoot = null;
    scene.traverse(function (o) {
      if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o;
    });
    if (!roomRoot) return "refine=no-room";

    let interior = null;
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (/exterior/i.test(o.name || "")) return;
      interior = grow(interior, worldBoxOf(o));
    });
    if (!interior) return "refine=no-interior";

    const actorMap = {};
    scene.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      const box = worldBoxOf(o);
      if (!box) return;
      const id = actorIdOf(o);
      actorMap[id] = grow(actorMap[id] || null, box);
    });
    const standing = [];
    const ids = Object.keys(actorMap);
    for (let i = 0; i < ids.length; i++) {
      const box = actorMap[ids[i]];
      const height = box.max[1] - box.min[1];
      if (height >= 1.15) standing.push({ id: ids[i], box: box });
    }
    if (standing.length === 0) return "refine=no-standing";

    const wallBoxes = [];
    const doorBoxes = [];
    const roomSurfaceKind = function (mesh) {
      let p = mesh;
      while (p && p !== roomRoot) {
        const m = /(wall|floor|ceiling|exterior)/i.exec(p.name || "");
        if (m) return m[1].toLowerCase();
        p = p.parent;
      }
      return null;
    };
    roomRoot.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.visible === false) return;
      const kind = roomSurfaceKind(o);
      if (kind === "wall") {
        const box = worldBoxOf(o);
        if (box) wallBoxes.push(box);
      }
    });
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.visible === false) return;
      if (!/door_leaf|fixture-slot.door/i.test(o.name || "")) return;
      const box = worldBoxOf(o);
      if (box) doorBoxes.push(box);
    });

    const rayHitsBoxes = function (ox, oy, oz, dx, dy, dz, boxes) {
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        let tmin = 0, tmax = 1;
        let miss = false;
        for (let c = 0; c < 3 && !miss; c++) {
          const o = c === 0 ? ox : c === 1 ? oy : oz;
          const d = c === 0 ? dx : c === 1 ? dy : dz;
          const mn = box.min[c], mx = box.max[c];
          if (d > -1e-12 && d < 1e-12) {
            if (o < mn || o > mx) miss = true;
            continue;
          }
          let t1 = (mn - o) / d, t2 = (mx - o) / d;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmax < tmin) miss = true;
        }
        if (!miss && tmax > 1e-6 && tmin < 0.92) return true;
      }
      return false;
    };

    const cameraWorld = function () {
      camera.updateMatrixWorld(true);
      const e = camera.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    const boxContains = function (box, x, y, z) {
      return x >= box.min[0] && x <= box.max[0]
        && y >= box.min[1] && y <= box.max[1]
        && z >= box.min[2] && z <= box.max[2];
    };
    const partitionBoxesFrom = function (cam, boxes) {
      const out = [];
      for (let i = 0; i < boxes.length; i++) {
        if (!boxContains(boxes[i], cam[0], cam[1], cam[2])) out.push(boxes[i]);
      }
      return out;
    };
    const project = function (x, y, z) {
      camera.updateMatrixWorld(true);
      if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
      const e = camera.matrixWorldInverse.elements;
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const vw = e[3] * x + e[7] * y + e[11] * z + e[15];
      const p = camera.projectionMatrix.elements;
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
      const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
      const cz = p[2] * vx + p[6] * vy + p[10] * vz + p[14] * vw;
      const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
      if (cw > -1e-8 && cw < 1e-8) return null;
      return { x: cx / cw, y: cy / cw, z: cz / cw };
    };
    const crownOf = function (box) {
      return [
        (box.min[0] + box.max[0]) / 2,
        box.min[1] + 0.82 * (box.max[1] - box.min[1]),
        (box.min[2] + box.max[2]) / 2
      ];
    };
    const EDGE = 0.80;
    const MIN_NDC_HEIGHT = 0.36;
    const boxNdc = function (box) {
      const xs = [box.min[0], box.max[0]];
      const ys = [box.min[1], box.max[1]];
      const zs = [box.min[2], box.max[2]];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let ok = 0;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const ndc = project(xs[i], ys[j], zs[k]);
        if (!ndc) continue;
        if (ndc.z <= -1 || ndc.z >= 1) continue;
        ok += 1;
        if (ndc.x < minX) minX = ndc.x;
        if (ndc.x > maxX) maxX = ndc.x;
        if (ndc.y < minY) minY = ndc.y;
        if (ndc.y > maxY) maxY = ndc.y;
      }
      if (ok < 4) return null;
      return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    };
    let primary = standing[0];
    for (let i = 1; i < standing.length; i++) {
      const h = standing[i].box.max[1] - standing[i].box.min[1];
      const ph = primary.box.max[1] - primary.box.min[1];
      if (h > ph) primary = standing[i];
    }
    const actorWhole = function (box) {
      const extent = boxNdc(box);
      if (!extent) return false;
      if (extent.maxY - extent.minY < MIN_NDC_HEIGHT) return false;
      if (extent.minX < -EDGE || extent.maxX > EDGE || extent.minY < -EDGE || extent.maxY > EDGE) return false;
      const crown = crownOf(box);
      const cam = cameraWorld();
      const dx = crown[0] - cam[0], dy = crown[1] - cam[1], dz = crown[2] - cam[2];
      if (rayHitsBoxes(cam[0], cam[1], cam[2], dx, dy, dz, partitionBoxesFrom(cam, wallBoxes))) return false;
      if (rayHitsBoxes(cam[0], cam[1], cam[2], dx, dy, dz, doorBoxes)) return false;
      return true;
    };
    const scoreStanding = function () {
      const extent = boxNdc(primary.box);
      const whole = actorWhole(primary.box);
      let minMargin = -1;
      if (extent) {
        minMargin = Math.min(extent.minX + 1, 1 - extent.maxX, extent.minY + 1, 1 - extent.maxY);
      }
      return { n: whole ? 1 : 0, minMargin: minMargin };
    };

    const applyEyeLook = function (ex, ey, ez, lx, ly, lz) {
      camera.position.set(ex, ey, ez);
      const parent = camera.parent;
      if (parent && typeof parent.worldToLocal === "function") {
        parent.updateMatrixWorld(true);
        parent.worldToLocal(camera.position);
      }
      camera.lookAt(lx, ly, lz);
      if (typeof camera.fov === "number") {
        camera.fov = 70;
        if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
    };

    const lookX = (primary.box.min[0] + primary.box.max[0]) / 2;
    const lookY = (primary.box.min[1] + primary.box.max[1]) / 2;
    const lookZ = (primary.box.min[2] + primary.box.max[2]) / 2;
    const ceilingY = interior.max[1] - 0.45;
    const standoff = 0.22;
    const xMin = interior.min[0] + standoff;
    const xMax = interior.max[0] - standoff;
    const zMin = interior.min[2] + standoff;
    const zMax = interior.max[2] - standoff;
    const eyeYs = [1.52, 1.68, 1.84].map(function (y) {
      let ey = y;
      if (ey > ceilingY) ey = ceilingY;
      if (ey < 1.4) ey = 1.4;
      return ey;
    });

    const baseline = scoreStanding();
    if (baseline.n === 1) {
      return "refine=keep standing=1/" + String(standing.length);
    }

    const savedPx = camera.position.x, savedPy = camera.position.y, savedPz = camera.position.z;
    const savedQx = camera.quaternion.x, savedQy = camera.quaternion.y, savedQz = camera.quaternion.z, savedQw = camera.quaternion.w;
    let bestN = baseline.n;
    let bestMargin = baseline.minMargin;
    let bestEye = null;
    const distances = [2.0, 2.4, 2.8, 3.2, 3.6];
    const turns = 20;
    for (let yi = 0; yi < eyeYs.length; yi++) {
      const eyeY = eyeYs[yi];
      for (let di = 0; di < distances.length; di++) {
        const dist = distances[di];
        for (let t = 0; t < turns; t++) {
          const ang = (t * Math.PI * 2) / turns;
          const ex = lookX + Math.sin(ang) * dist;
          const ez = lookZ + Math.cos(ang) * dist;
          if (ex < xMin || ex > xMax || ez < zMin || ez > zMax) continue;
          applyEyeLook(ex, eyeY, ez, lookX, lookY, lookZ);
          const cam = cameraWorld();
          if (cam[0] < interior.min[0] || cam[0] > interior.max[0]
            || cam[1] < interior.min[1] || cam[1] > interior.max[1]
            || cam[2] < interior.min[2] || cam[2] > interior.max[2]) continue;
          const scored = scoreStanding();
          if (scored.n > bestN || (scored.n === bestN && scored.minMargin > bestMargin + 0.01)) {
            bestN = scored.n;
            bestMargin = scored.minMargin;
            bestEye = [ex, eyeY, ez];
          }
        }
      }
    }
    if (bestEye === null || bestN === 0) {
      camera.position.set(savedPx, savedPy, savedPz);
      camera.quaternion.set(savedQx, savedQy, savedQz, savedQw);
      camera.updateMatrixWorld(true);
      return "refine=keep-unimproved standing=" + String(baseline.n) + "/1 of " + String(standing.length);
    }
    applyEyeLook(bestEye[0], bestEye[1], bestEye[2], lookX, lookY, lookZ);
    if (camera.userData) {
      camera.userData.openClinXrActorContainment = bestN + "/1";
    }
    return "refine=orbit standing=" + String(bestN) + "/1 of " + String(standing.length)
      + " eye=" + bestEye.map(function (v) { return v.toFixed(2); }).join(",")
      + " look=" + [lookX, lookY, lookZ].map(function (v) { return v.toFixed(2); }).join(",");
  })()`)) as string;
  return note;
}
