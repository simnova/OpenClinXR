import type { Page } from "playwright";
import { CAMERA_SCORE_IS_BETTER_BROWSER_SOURCE } from "./camera-candidate-scoring.js";
import { ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE } from "./actor-visibility-page-probe.js";
import { NEAR_OCCLUSION_BROWSER_FUNCTION_SOURCE } from "./near-occlusion-page-probe.js";
import { runCameraSweepInPage, type CameraSweepRequest } from "./camera-sweep-search.js";

export async function refineCameraForOcclusionAndContainment(
  page: Page,
  options?: { cameraSweep?: CameraSweepRequest },
): Promise<string> {
  if (options?.cameraSweep) {
    return (await runCameraSweepInPage(page, options.cameraSweep)).note;
  }
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

    const worldBoxOf = function (obj, refreshSkinned) {
      const geom = obj.geometry;
      if (!geom) return null;
      if (obj.isSkinnedMesh && refreshSkinned && typeof obj.computeBoundingBox === "function") obj.computeBoundingBox();
      if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
      const bb = obj.isSkinnedMesh && obj.boundingBox ? obj.boundingBox : geom.boundingBox;
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
      while (p) {
        const ud = p.userData;
        if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId.length > 0) {
          return ud.openClinXrActorId;
        }
        p = p.parent;
      }
      return null;
    };
    const actorPostureOf = function (mesh) {
      let p = mesh;
      while (p) {
        const posture = p.userData && p.userData.openClinXrActorPosture;
        if (typeof posture === "string" && posture.length > 0) return posture.toLowerCase();
        p = p.parent;
      }
      return "standing";
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

    const effectivelyVisible = function (object) {
      let current = object;
      while (current && current !== scene) {
        if (current.visible === false) return false;
        current = current.parent;
      }
      return true;
    };

    const actorMap = {};
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh) || !effectivelyVisible(o)) return;
      const id = actorIdOf(o);
      if (!id) return;
      const box = worldBoxOf(o, true);
      if (!box) return;
      actorMap[id] = grow(actorMap[id] || null, box);
    });
    const headingOf = function (mesh) {
      let root = mesh;
      while (root) {
        const ud = root.userData;
        if (ud && typeof ud.openClinXrBaseHeadingRadians === "number") return ud.openClinXrBaseHeadingRadians;
        if (ud && typeof ud.openClinXrConsumedHeadingRadians === "number") return ud.openClinXrConsumedHeadingRadians;
        root = root.parent;
      }
      const e = mesh.matrixWorld && mesh.matrixWorld.elements;
      if (!e) return 0;
      return Math.atan2(-e[8], -e[10]);
    };
    const actorHeading = {};
    const actorPosture = {};
    scene.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      const id = actorIdOf(o);
      if (!id) return;
      if (actorHeading[id] === undefined) actorHeading[id] = headingOf(o);
      if (actorPosture[id] === undefined) actorPosture[id] = actorPostureOf(o);
    });
    const actors = [];
    const standing = [];
    const ids = Object.keys(actorMap);
    for (let i = 0; i < ids.length; i++) {
      const box = actorMap[ids[i]];
      const height = box.max[1] - box.min[1];
      const posture = actorPosture[ids[i]] || "standing";
      const recumbent = /(supine|lying|recumbent)/.test(posture);
      const upright = !/(supine|seated|lying|recumbent)/.test(posture);
      const actor = { id: ids[i], box: box, heading: actorHeading[ids[i]] || 0, standing: upright && height >= 1.15, recumbent: recumbent };
      actors.push(actor);
      if (actor.standing) standing.push(actor);
    }
    if (actors.length === 0) return "refine=no-actors";
    if (standing.length === 0) return "refine=no-standing";

    const visibilityOccluders = [];
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh) || !effectivelyVisible(o)) return;
      const box = worldBoxOf(o, true);
      if (!box) return;
      visibilityOccluders.push({
        box: box,
        actorId: actorIdOf(o),
        name: o.name || (o.parent && o.parent.name) || "unnamed-visible-mesh"
      });
    });

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
    const placards = [];
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      if (o.visible === false) return;
      const n = o.name || "";
      const ud = o.userData || {};
      if (!(/scenario-expectation-visual-review-panel|patient-note-capture-cue/i.test(n)
        || ud.openClinXrPortalInteriorReviewAffordance === true)) return;
      const box = worldBoxOf(o);
      if (!box) return;
      const e = o.matrixWorld && o.matrixWorld.elements;
      if (!e) return;
      placards.push({
        box: box,
        nx: e[8], ny: e[9], nz: e[10],
        cx: (box.min[0] + box.max[0]) / 2,
        cy: (box.min[1] + box.max[1]) / 2,
        cz: (box.min[2] + box.max[2]) / 2
      });
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
    const measureActorVisibility = (${ACTOR_VISIBILITY_BROWSER_FUNCTION_SOURCE});
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
    const actorFailure = function (actor, visibility) {
      const box = actor.box;
      const extent = boxNdc(box);
      if (!extent) return "not-projectable";
      if (actor.id === primary.id && extent.maxY - extent.minY < MIN_NDC_HEIGHT) return "primary-too-small";
      if (extent.minX < -EDGE || extent.maxX > EDGE || extent.minY < -EDGE || extent.maxY > EDGE) return "outside-edge";
      if (!visibility.visible) return "occluded-" + String(visibility.visibleSampleCount) + "/5";
      return null;
    };
    const placardBackVisible = function () {
      const cam = cameraWorld();
      const look = [
        (primary.box.min[0] + primary.box.max[0]) / 2,
        (primary.box.min[1] + primary.box.max[1]) / 2,
        (primary.box.min[2] + primary.box.max[2]) / 2
      ];
      const ldx = look[0] - cam[0], ldy = look[1] - cam[1], ldz = look[2] - cam[2];
      for (let i = 0; i < placards.length; i++) {
        const p = placards[i];
        if (rayHitsBoxes(cam[0], cam[1], cam[2], ldx, ldy, ldz, [p.box])) {
          const vx = p.cx - cam[0], vz = p.cz - cam[2];
          if (vx * p.nx + vz * p.nz > 0) return true;
        }
      }
      return false;
    };
    const meanFacingDeg = function () {
      const cam = cameraWorld();
      let sum = 0;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        const cx = (a.box.min[0] + a.box.max[0]) / 2;
        const cz = (a.box.min[2] + a.box.max[2]) / 2;
        const fx = Math.sin(a.heading);
        const fz = Math.cos(a.heading);
        const tx = cam[0] - cx, tz = cam[2] - cz;
        const tlen = Math.hypot(tx, tz);
        let deg = 180;
        if (tlen > 1e-4) {
          let c = (fx * tx + fz * tz) / tlen;
          if (c > 1) c = 1;
          if (c < -1) c = -1;
          deg = Math.acos(c) * 180 / Math.PI;
        }
        sum += deg;
      }
      return actors.length === 0 ? 180 : sum / actors.length;
    };
    const measureNearOcclusion = (${NEAR_OCCLUSION_BROWSER_FUNCTION_SOURCE});
    const scoreIsBetter = (${CAMERA_SCORE_IS_BETTER_BROWSER_SOURCE});
    const scoreActors = function () {
      let wholeCount = 0;
      let standingWholeCount = 0;
      let minMargin = Infinity;
      const failures = [];
      const visibility = [];
      const cam = cameraWorld();
      for (let i = 0; i < actors.length; i++) {
        const actor = actors[i];
        const extent = boxNdc(actor.box);
        const actorVisibility = measureActorVisibility(cam, actor, visibilityOccluders);
        visibility.push(actorVisibility);
        const failure = actorFailure(actor, actorVisibility);
        const whole = failure === null;
        if (whole) wholeCount += 1;
        else failures.push(actor.id + ":" + failure);
        if (actor.standing && whole) standingWholeCount += 1;
        if (extent) {
          const margin = Math.min(extent.minX + 1, 1 - extent.maxX, extent.minY + 1, 1 - extent.maxY);
          if (margin < minMargin) minMargin = margin;
        } else {
          minMargin = -1;
        }
      }
      if (!isFinite(minMargin)) minMargin = -1;
      return {
        n: wholeCount,
        total: actors.length,
        standingN: standingWholeCount,
        minMargin: minMargin,
        placardBack: placardBackVisible(),
        meanFacing: meanFacingDeg(),
        nearOcclusion: measureNearOcclusion(camera, scene, worldBoxOf).fraction,
        failures: failures,
        visibility: visibility
      };
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

    let actorUnion = null;
    for (let i = 0; i < actors.length; i++) actorUnion = grow(actorUnion, actors[i].box);
    const lookX = (actorUnion.min[0] + actorUnion.max[0]) / 2;
    const lookY = (actorUnion.min[1] + actorUnion.max[1]) / 2;
    const lookZ = (actorUnion.min[2] + actorUnion.max[2]) / 2;
    const ceilingY = interior.max[1] - 0.45;
    const sideStandoff = 0.9;
    const depthStandoff = 0.22;
    const xMin = interior.min[0] + sideStandoff;
    const xMax = interior.max[0] - sideStandoff;
    const zMin = interior.min[2] + depthStandoff;
    const zMax = interior.max[2] - depthStandoff;
    const eyeYs = [1.52, 1.68, 1.84, 2.0, 2.16].map(function (y) {
      let ey = y;
      if (ey > ceilingY) ey = ceilingY;
      if (ey < 1.4) ey = 1.4;
      return ey;
    });

    const formatScore = function (tag, scored, eye) {
      return tag
        + " actors=" + String(scored.n) + "/" + String(actors.length)
        + " standing=" + String(scored.standingN) + "/" + String(standing.length)
        + " constraints=" + (scored.n === actors.length && scored.meanFacing <= 90 ? "met" : "unmet")
        + " nearOcclusion=" + scored.nearOcclusion.toFixed(4)
        + " placardBack=" + (scored.placardBack ? "1" : "0")
        + " meanFacingDeg=" + scored.meanFacing.toFixed(1)
        + (scored.failures.length > 0 ? " missing=" + scored.failures.join(",") : "")
        + " eye=" + eye.map(function (v) { return v.toFixed(2); }).join(",")
        + " look=" + [lookX, lookY, lookZ].map(function (v) { return v.toFixed(2); }).join(",");
    };
    const baseline = scoreActors();
    const baselineEye = cameraWorld();
    const savedPx = camera.position.x, savedPy = camera.position.y, savedPz = camera.position.z;
    const savedQx = camera.quaternion.x, savedQy = camera.quaternion.y, savedQz = camera.quaternion.z, savedQw = camera.quaternion.w;
    let best = baseline.placardBack || baseline.meanFacing > 90 ? null : baseline;
    let bestEye = baseline.placardBack || baseline.meanFacing > 90 ? null : baselineEye;
    const distances = [];
    for (let distance = 1.4; distance <= 4.21; distance += 0.1) distances.push(distance);
    const turns = 64;
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
          const scored = scoreActors();
          if (scored.placardBack) continue;
          if (scoreIsBetter(scored, best)) {
            best = scored;
            bestEye = [ex, eyeY, ez];
          }
        }
      }
    }
    if (bestEye === null || best === null) {
      camera.position.set(savedPx, savedPy, savedPz);
      camera.quaternion.set(savedQx, savedQy, savedQz, savedQw);
      camera.updateMatrixWorld(true);
      const kept = scoreActors();
      if (camera.userData) {
        camera.userData.openClinXrActorContainment = String(kept.n) + "/" + String(actors.length);
        camera.userData.openClinXrStandingActorContainment = String(kept.standingN) + "/" + String(standing.length);
        camera.userData.openClinXrPlacardBack = kept.placardBack;
        camera.userData.openClinXrMeanFacingDeg = kept.meanFacing;
        camera.userData.openClinXrFramingConstraintsMet = kept.n === actors.length && kept.meanFacing <= 90;
        camera.userData.openClinXrNearOcclusionFraction = kept.nearOcclusion;
        camera.userData.openClinXrActorVisibility = kept.visibility;
        camera.userData.openClinXrRefineTag = "keep-unimproved";
        camera.userData.openClinXrCameraLookAt = [lookX, lookY, lookZ];
      }
      return formatScore("refine=keep-unimproved", kept, cameraWorld());
    }
    applyEyeLook(bestEye[0], bestEye[1], bestEye[2], lookX, lookY, lookZ);
    const constraintsMet = best.n === actors.length && best.meanFacing <= 90;
    const chosenTag = constraintsMet ? (bestEye === baselineEye ? "keep" : "orbit") : "best-effort-unmet";
    if (camera.userData) {
      camera.userData.openClinXrActorContainment = String(best.n) + "/" + String(actors.length);
      camera.userData.openClinXrStandingActorContainment = String(best.standingN) + "/" + String(standing.length);
      camera.userData.openClinXrPlacardBack = best.placardBack;
      camera.userData.openClinXrMeanFacingDeg = best.meanFacing;
      camera.userData.openClinXrFramingConstraintsMet = constraintsMet;
      camera.userData.openClinXrNearOcclusionFraction = best.nearOcclusion;
      camera.userData.openClinXrActorVisibility = best.visibility;
      camera.userData.openClinXrRefineTag = chosenTag;
      camera.userData.openClinXrCameraLookAt = [lookX, lookY, lookZ];
    }
    return formatScore("refine=" + chosenTag, best, bestEye);
  })()`)) as string;
  return note;
}
