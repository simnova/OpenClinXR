import type { Page } from "playwright";
import { collectSweepScene, type SweepSceneSnapshot } from "./camera-sweep-scene.js";

/**
 * Camera-only sweep search (measurement only).
 *
 * Opt-in: runs only when the caller passes a CameraSweepRequest
 * (refine-camera-for-occlusion-and-containment.ts delegates solely when its
 * options carry one). Gate is fixed: every actor crown AND chest visible,
 * all actors whole in frame, mean facing <= 90, near occlusion <= 0.10.
 * Selection lex order: gate pass, selectable (not a review-panel back),
 * visible actors, facing (lower), near (lower), margin (higher).
 */

export type CameraSweepEyes = "orbit" | "grid";
export type CameraSweepLookMode = "union" | "per-actor-chest" | "sphere" | "patient";

export type CameraSweepRequest = {
  fovs?: readonly number[];
  eyes?: readonly CameraSweepEyes[];
  looks?: readonly CameraSweepLookMode[];
  /** Stage-2 (full near-occlusion) finalists kept per variant. Default 24. */
  stage2Top?: number;
  /** Leave the camera on the overall-best variant. Default true. */
  applyBest?: boolean;
  /** Restrict to exact variant ids (phase-2 rerun). Default: all. */
  onlyVariantIds?: readonly string[];
};

export type CameraSweepRow = {
  variant: string;
  look: [number, number, number];
  eye: [number, number, number];
  fov: number;
  n: number;
  total: number;
  facing: number;
  near: number;
  margin: number;
  gatePass: boolean;
  placardBack: boolean;
  failures: string[];
};

export type CameraSweepReport = {
  error?: string;
  actorIds: string[];
  eyeCounts: { orbit: number; grid: number };
  timingMs: { snapshot: number; stage1: number; stage2: number };
  rows: CameraSweepRow[];
  bestVariant: string | null;
  note: string;
};

export type AppliedCameraScore = {
  eye: [number, number, number] | null;
  look: [number, number, number] | null;
  fov: number | null;
  refineTag: string | null;
  n: number;
  total: number;
  facing: number | null;
  near: number | null;
  placardBack: boolean;
  framingConstraintsMet: boolean | null;
  crownChest: Array<{
    actorId: string;
    crownVisible: boolean;
    chestVisible: boolean;
    visible: boolean;
    blockedSamples: Array<{ sample: string; blockedBy: string }>;
  }>;
};
export const DEFAULT_SWEEP_FOVS = [70, 80, 90] as const;
export const DEFAULT_SWEEP_EYES: readonly CameraSweepEyes[] = ["orbit", "grid"];
export const DEFAULT_SWEEP_LOOKS: readonly CameraSweepLookMode[] = [
  "union",
  "per-actor-chest",
  "sphere",
  "patient",
];

/** Task gate: crown+chest whole cast in frame, facing <= 90, near <= 0.10. */
export function sweepGatePass(input: { n: number; total: number; facing: number; near: number }): boolean {
  return input.total > 0 && input.n === input.total && input.facing <= 90 && input.near <= 0.1;
}

export function variantIdOf(look: string, fov: number, eyes: CameraSweepEyes): string {
  return `look=${look}:fov=${String(fov)}:eyes=${eyes}`;
}

/** Search body over a scene snapshot. Keep free of TypeScript syntax. */
export const CAMERA_SWEEP_SEARCH_SOURCE = String.raw`function (snap, req) {
  var t0 = Date.now();
  var fovs = (req && req.fovs) || [70, 80, 90];
  var eyeModes = (req && req.eyes) || ["orbit", "grid"];
  var lookModes = (req && req.looks) || ["union", "per-actor-chest", "sphere", "patient"];
  var stage2Top = (req && req.stage2Top) || 24;
  var onlyIds = (req && req.onlyVariantIds) || null;
  var actors = snap.actors, occluders = snap.occluders, placards = snap.placards;
  var interior = snap.interior, eyeYs = snap.eyeYs, bounds = snap.orbitBounds;
  var scene = globalThis.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return { error: "no-scene" };
  scene.updateMatrixWorld(true);
  var camera = null;
  scene.traverse(function (o) {
    if (camera) return;
    if (o.isPerspectiveCamera || o.type === "PerspectiveCamera") camera = o;
  });
  if (!camera) return { error: "no-camera" };
  var looks = [];
  var pushLook = function (id, p) {
    for (var li = 0; li < looks.length; li++) {
      var q = looks[li].p;
      if (Math.abs(q[0]-p[0]) < 1e-6 && Math.abs(q[1]-p[1]) < 1e-6 && Math.abs(q[2]-p[2]) < 1e-6) return;
    }
    looks.push({ id: id, p: p });
  };
  if (lookModes.indexOf("union") >= 0) pushLook("union", snap.unionCentre);
  if (lookModes.indexOf("per-actor-chest") >= 0) for (var ti = 0; ti < actors.length; ti++) pushLook("chest:" + actors[ti].id, actors[ti].chest);
  if (lookModes.indexOf("sphere") >= 0) pushLook("sphere", snap.sphereCentre);
  if (lookModes.indexOf("patient") >= 0) pushLook("patient", snap.patientChest);
  var cameraWorld = function () {
    camera.updateMatrixWorld(true);
    var e = camera.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  };
  var project = function (x, y, z) {
    camera.updateMatrixWorld(true);
    var e = camera.matrixWorldInverse.elements;
    var vx = e[0]*x+e[4]*y+e[8]*z+e[12], vy = e[1]*x+e[5]*y+e[9]*z+e[13], vz = e[2]*x+e[6]*y+e[10]*z+e[14], vw = e[3]*x+e[7]*y+e[11]*z+e[15];
    var p = camera.projectionMatrix.elements;
    var cxp = p[0]*vx+p[4]*vy+p[8]*vz+p[12]*vw, cyp = p[1]*vx+p[5]*vy+p[9]*vz+p[13]*vw, czp = p[2]*vx+p[6]*vy+p[10]*vz+p[14]*vw, cwp = p[3]*vx+p[7]*vy+p[11]*vz+p[15]*vw;
    if (cwp > -1e-8 && cwp < 1e-8) return null;
    return { x: cxp / cwp, y: cyp / cwp, z: czp / cwp };
  };
  var EDGE = 0.80, MIN_NDC_HEIGHT = 0.36;
  var primary = actors[0];
  for (var hi = 0; hi < actors.length; hi++) if (actors[hi].id === snap.primaryId) primary = actors[hi];
  var boxNdc = function (box) {
    var xs = [box.min[0], box.max[0]], ys = [box.min[1], box.max[1]], zs = [box.min[2], box.max[2]];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, ok = 0;
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
      var ndc = project(xs[i], ys[j], zs[k]);
      if (!ndc || ndc.z <= -1 || ndc.z >= 1) continue;
      ok += 1;
      if (ndc.x < minX) minX = ndc.x;
      if (ndc.x > maxX) maxX = ndc.x;
      if (ndc.y < minY) minY = ndc.y;
      if (ndc.y > maxY) maxY = ndc.y;
    }
    if (ok < 4) return null;
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  };
  var segHit = function (candidate, origin, target) {
    var first = 0, last = 1;
    for (var axis = 0; axis < 3; axis++) {
      var delta = target[axis] - origin[axis];
      if (Math.abs(delta) < 1e-12) {
        if (origin[axis] < candidate.min[axis] || origin[axis] > candidate.max[axis]) return Infinity;
        continue;
      }
      var near = (candidate.min[axis]-origin[axis])/delta, far = (candidate.max[axis]-origin[axis])/delta;
      if (near > far) { var s = near; near = far; far = s; }
      if (near > first) first = near;
      if (far < last) last = far;
      if (last < first) return Infinity;
    }
    return last > 1e-6 && first < 0.98 ? Math.max(first, 0) : Infinity;
  };
  var actorSamples = function (actor) {
    var box = actor.box, w = box.max[0]-box.min[0], h = box.max[1]-box.min[1], d = box.max[2]-box.min[2];
    var cx = (box.min[0]+box.max[0])/2, cz = (box.min[2]+box.max[2])/2;
    if (actor.recumbent) {
      var top = box.max[1] - h * 0.08, alongX = w >= d;
      var pt = function (f, m) { return alongX ? [box.min[0]+w*f, top, cz+d*m] : [cx+w*m, top, box.min[2]+d*f]; };
      return [{ n: "crown", p: pt(0.1, 0) }, { n: "chest", p: pt(0.32, 0) }, { n: "pelvis", p: pt(0.58, 0) }, { n: "left_foot", p: pt(0.88, -0.18) }, { n: "right_foot", p: pt(0.88, 0.18) }];
    }
    return [{ n: "crown", p: [cx, box.min[1]+h*0.9, cz] }, { n: "chest", p: [cx, box.min[1]+h*0.65, cz] },
      { n: "pelvis", p: [cx, box.min[1]+h*0.42, cz] }, { n: "left_foot", p: [box.min[0]+w*0.25, box.min[1]+h*0.12, cz] },
      { n: "right_foot", p: [box.min[0]+w*0.75, box.min[1]+h*0.12, cz] }];
  };
  var visibilityOf = function (origin, actor) {
    var samples = actorSamples(actor), crown = true, chest = true;
    for (var s = 0; s < samples.length; s++) {
      var nearest = Infinity;
      for (var i = 0; i < occluders.length; i++) {
        var oc = occluders[i];
        if (oc.actorId === actor.id) continue;
        if (origin[0] >= oc.box.min[0] && origin[0] <= oc.box.max[0] && origin[1] >= oc.box.min[1] && origin[1] <= oc.box.max[1] && origin[2] >= oc.box.min[2] && origin[2] <= oc.box.max[2]) continue;
        var hit = segHit(oc.box, origin, samples[s].p);
        if (hit < nearest) nearest = hit;
      }
      if (nearest !== Infinity) {
        if (samples[s].n === "crown") crown = false;
        if (samples[s].n === "chest") chest = false;
      }
    }
    return crown && chest;
  };
  var facingOf = function (eye) {
    var sum = 0;
    for (var i = 0; i < actors.length; i++) {
      var a = actors[i];
      var cx = (a.box.min[0]+a.box.max[0])/2, cz = (a.box.min[2]+a.box.max[2])/2;
      var fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      var tx = eye[0]-cx, tz = eye[2]-cz, len = Math.hypot(tx, tz), deg = 180;
      if (len > 1e-4) {
        var c = (fx*tx+fz*tz)/len;
        if (c > 1) c = 1;
        if (c < -1) c = -1;
        deg = Math.acos(c) * 180 / Math.PI;
      }
      sum += deg;
    }
    return sum / actors.length;
  };
  var applyEyeLook = function (ex, ey, ez, lx, ly, lz, fov) {
    camera.position.set(ex, ey, ez);
    var parent = camera.parent;
    if (parent && typeof parent.worldToLocal === "function") {
      parent.updateMatrixWorld(true);
      parent.worldToLocal(camera.position);
    }
    camera.lookAt(lx, ly, lz);
    if (typeof camera.fov === "number") {
      camera.fov = fov;
      if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
  };
  var nearOf = function () {
    var boxes = [];
    scene.traverse(function (o) {
      if (!(o.isMesh || o.isSkinnedMesh)) return;
      var cur = o;
      while (cur && cur !== scene) { if (cur.visible === false) return; cur = cur.parent; }
      var g = o.geometry;
      if (!g) return;
      if (!g.boundingBox && typeof g.computeBoundingBox === "function") g.computeBoundingBox();
      var bb = g.boundingBox, e = o.matrixWorld && o.matrixWorld.elements;
      if (!bb || !e) return;
      var xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
      var a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
        var p = [e[0]*xs[i]+e[4]*ys[j]+e[8]*zs[k]+e[12], e[1]*xs[i]+e[5]*ys[j]+e[9]*zs[k]+e[13], e[2]*xs[i]+e[6]*ys[j]+e[10]*zs[k]+e[14]];
        for (var c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
      }
      if (isFinite(a[0])) boxes.push({ min: a, max: b });
    });
    camera.updateMatrixWorld(true);
    var m = camera.matrixWorld.elements, origin = [m[12], m[13], m[14]];
    var tanH = Math.tan((camera.fov * Math.PI / 180) / 2);
    var aspect = typeof camera.aspect === "number" && camera.aspect > 0 ? camera.aspect : 16 / 9;
    var nearCount = 0;
    for (var row = 0; row < 9; row++) {
      var ndcY = 1 - 2 * ((row + 0.5) / 9);
      for (var col = 0; col < 16; col++) {
        var ndcX = 2 * ((col + 0.5) / 16) - 1;
        var lx = ndcX * aspect * tanH, ly = ndcY * tanH, lz = -1;
        var ll = Math.hypot(lx, ly, lz);
        lx /= ll; ly /= ll; lz /= ll;
        var dx = m[0]*lx+m[4]*ly+m[8]*lz, dy = m[1]*lx+m[5]*ly+m[9]*lz, dz = m[2]*lx+m[6]*ly+m[10]*lz;
        var nearest = Infinity;
        for (var i = 0; i < boxes.length; i++) {
          var bb2 = boxes[i], tmin = 0, tmax = Infinity, miss = false;
          for (var ax = 0; ax < 3 && !miss; ax++) {
            var v = ax === 0 ? origin[0] : ax === 1 ? origin[1] : origin[2];
            var dd = ax === 0 ? dx : ax === 1 ? dy : dz;
            if (Math.abs(dd) < 1e-12) { if (v < bb2.min[ax] || v > bb2.max[ax]) miss = true; continue; }
            var f1 = (bb2.min[ax]-v)/dd, f2 = (bb2.max[ax]-v)/dd;
            if (f1 > f2) { var sw = f1; f1 = f2; f2 = sw; }
            if (f1 > tmin) tmin = f1;
            if (f2 < tmax) tmax = f2;
            if (tmax < tmin) miss = true;
          }
          var dist = miss || tmax <= 1e-6 ? Infinity : (tmin > 1e-6 ? tmin : tmax);
          if (dist < nearest) nearest = dist;
        }
        if (nearest < 1) nearCount += 1;
      }
    }
    return nearCount / 144;
  };
  var placardBackOf = function (look) {
    var cam = cameraWorld();
    var dx = look[0]-cam[0], dy = look[1]-cam[1], dz = look[2]-cam[2];
    for (var i = 0; i < placards.length; i++) {
      var p = placards[i], box = p.box, tmin = 0, tmax = 0.92, miss = false;
      for (var c = 0; c < 3 && !miss; c++) {
        var o = c === 0 ? cam[0] : c === 1 ? cam[1] : cam[2];
        var d = c === 0 ? dx : c === 1 ? dy : dz;
        if (d > -1e-12 && d < 1e-12) { if (o < box.min[c] || o > box.max[c]) miss = true; continue; }
        var t1 = (box.min[c]-o)/d, t2 = (box.max[c]-o)/d;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmax < tmin) miss = true;
      }
      if (!miss && tmax > 1e-6 && tmin < 0.92) {
        if ((p.cx - cam[0]) * p.nx + (p.cz - cam[2]) * p.nz > 0) return true;
      }
    }
    return false;
  };
  var orbitEyes = [];
  if (eyeModes.indexOf("orbit") >= 0) {
    for (var yi = 0; yi < eyeYs.length; yi++) for (var di = 0; di < 29; di++) {
      var dist = 1.4 + di * 0.1;
      for (var t = 0; t < 64; t++) {
        var ang = (t * Math.PI * 2) / 64;
        var ex = snap.unionCentre[0] + Math.sin(ang) * dist, ez = snap.unionCentre[2] + Math.cos(ang) * dist;
        if (ex < bounds.xMin || ex > bounds.xMax || ez < bounds.zMin || ez > bounds.zMax) continue;
        orbitEyes.push([ex, eyeYs[yi], ez]);
      }
    }
  }
  var gridEyes = [];
  if (eyeModes.indexOf("grid") >= 0) {
    for (var gy = 0; gy < eyeYs.length; gy++) {
      for (var gx = interior.min[0] + 0.22; gx <= interior.max[0] - 0.22 + 1e-9; gx += 0.25)
        for (var gz = interior.min[2] + 0.22; gz <= interior.max[2] - 0.22 + 1e-9; gz += 0.25)
          gridEyes.push([gx, eyeYs[gy], gz]);
    }
  }
  var failureOf = function (actor, extent, vis) {
    if (!extent) return "not-projectable";
    if (actor.id === primary.id && extent.maxY - extent.minY < MIN_NDC_HEIGHT) return "primary-too-small";
    if (extent.minX < -EDGE || extent.maxX > EDGE || extent.minY < -EDGE || extent.maxY > EDGE) return "outside-edge";
    if (!vis) return "occluded-crown-or-chest";
    return null;
  };
  var betterStage1 = function (cand, inc) {
    if (cand.n !== inc.n) return cand.n > inc.n;
    if (Math.abs(cand.facing - inc.facing) > 1e-9) return cand.facing < inc.facing;
    return cand.margin > inc.margin + 0.01;
  };
  var betterFull = function (a, b) {
    if (a.sel !== b.sel) return a.sel;
    if (a.gate !== b.gate) return a.gate;
    if (a.n !== b.n) return a.n > b.n;
    if (Math.abs(a.facing - b.facing) > 1e-9) return a.facing < b.facing;
    if (Math.abs(a.near - b.near) > 1e-9) return a.near < b.near;
    return a.margin > b.margin + 0.01;
  };
  var t1 = Date.now();
  var eyeSets = [];
  if (eyeModes.indexOf("orbit") >= 0) eyeSets.push({ mode: "orbit", eyes: orbitEyes });
  if (eyeModes.indexOf("grid") >= 0) eyeSets.push({ mode: "grid", eyes: gridEyes });
  var visCache = {}, facingCache = {};
  var eyeKey = function (e) { return e[0].toFixed(3) + "," + e[1].toFixed(3) + "," + e[2].toFixed(3); };
  var allEyes = orbitEyes.concat(gridEyes), ei, vi;
  for (ei = 0; ei < allEyes.length; ei++) {
    var eye = allEyes[ei], key = eyeKey(eye), per = [];
    for (vi = 0; vi < actors.length; vi++) per.push(visibilityOf(eye, actors[vi]));
    visCache[key] = per;
    facingCache[key] = facingOf(eye);
  }
  var combos = [];
  for (var li2 = 0; li2 < looks.length; li2++) for (var fi = 0; fi < fovs.length; fi++) for (var mi = 0; mi < eyeSets.length; mi++) {
    var vid = "look=" + looks[li2].id + ":fov=" + String(fovs[fi]) + ":eyes=" + eyeSets[mi].mode;
    if (!onlyIds || onlyIds.indexOf(vid) >= 0) combos.push({ look: looks[li2], fov: fovs[fi], set: eyeSets[mi], id: vid });
  }
  var finalists = {}, ci2;
  for (ci2 = 0; ci2 < combos.length; ci2++) {
    var combo = combos[ci2], top = [], cap = stage2Top * 4, e2, a3;
    for (e2 = 0; e2 < combo.set.eyes.length; e2++) {
      var e3 = combo.set.eyes[e2], k3 = eyeKey(e3);
      applyEyeLook(e3[0], e3[1], e3[2], combo.look.p[0], combo.look.p[1], combo.look.p[2], combo.fov);
      var n = 0, minMargin = Infinity, fails = [], per2 = visCache[k3];
      for (a3 = 0; a3 < actors.length; a3++) {
        var ext = boxNdc(actors[a3].box);
        var fail = failureOf(actors[a3], ext, per2[a3]);
        if (fail === null) n += 1;
        else fails.push(actors[a3].id + ":" + fail);
        if (ext) {
          var mg = Math.min(ext.minX + 1, 1 - ext.maxX, ext.minY + 1, 1 - ext.maxY);
          if (mg < minMargin) minMargin = mg;
        } else minMargin = -1;
      }
      if (!isFinite(minMargin)) minMargin = -1;
      var cand = { eye: e3, n: n, facing: facingCache[k3], margin: minMargin, fails: fails };
      if (top.length < cap) top.push(cand);
      else {
        var worst = 0, w;
        for (w = 1; w < top.length; w++) if (betterStage1(top[worst], top[w])) worst = w;
        if (betterStage1(cand, top[worst])) top[worst] = cand;
      }
    }
    top.sort(function (a, b) {
      if (a.n !== b.n) return b.n - a.n;
      if (Math.abs(a.facing - b.facing) > 1e-9) return a.facing - b.facing;
      return b.margin - a.margin;
    });
    finalists[combo.id] = { combo: combo, cands: top.slice(0, stage2Top) };
  }
  var stage1Ms = Date.now() - t1, t2 = Date.now();
  var rows = [], comboIds = Object.keys(finalists), fi2, gi;
  for (fi2 = 0; fi2 < comboIds.length; fi2++) {
    var fin = finalists[comboIds[fi2]], best = null;
    for (gi = 0; gi < fin.cands.length; gi++) {
      var fc = fin.cands[gi];
      applyEyeLook(fc.eye[0], fc.eye[1], fc.eye[2], fin.combo.look.p[0], fin.combo.look.p[1], fin.combo.look.p[2], fin.combo.fov);
      var full = { eye: fc.eye, n: fc.n, facing: fc.facing, margin: fc.margin, fails: fc.fails,
        near: nearOf(), placardBack: placardBackOf(fin.combo.look.p) };
      full.gate = full.n === actors.length && full.facing <= 90 && full.near <= 0.1;
      full.sel = full.gate && !full.placardBack;
      if (!best || betterFull(full, best)) best = full;
    }
    if (!best) continue;
    rows.push({ variant: fin.combo.id, fov: fin.combo.fov,
      look: [fin.combo.look.p[0], fin.combo.look.p[1], fin.combo.look.p[2]],
      eye: [best.eye[0], best.eye[1], best.eye[2]],
      n: best.n, total: actors.length, facing: best.facing, near: best.near, margin: best.margin,
      gatePass: best.n === actors.length && best.facing <= 90 && best.near <= 0.1,
      placardBack: best.placardBack, failures: best.fails });
  }
  var stage2Ms = Date.now() - t2;
  rows.sort(function (a, b) {
    var ga = a.gatePass && !a.placardBack, gb = b.gatePass && !b.placardBack;
    if (ga !== gb) return ga ? -1 : 1;
    if (a.gatePass !== b.gatePass) return a.gatePass ? -1 : 1;
    if (a.n !== b.n) return b.n - a.n;
    if (Math.abs(a.facing - b.facing) > 1e-9) return a.facing - b.facing;
    if (Math.abs(a.near - b.near) > 1e-9) return a.near - b.near;
    return b.margin - a.margin;
  });
  var bestRow = rows.length > 0 ? rows[0] : null;
  if (bestRow && (!req || req.applyBest !== false)) {
    applyEyeLook(bestRow.eye[0], bestRow.eye[1], bestRow.eye[2], bestRow.look[0], bestRow.look[1], bestRow.look[2], bestRow.fov);
    if (camera.userData) {
      camera.userData.openClinXrCameraLookAt = bestRow.look;
      camera.userData.openClinXrRefineTag = "sweep:" + bestRow.variant;
    }
  }
  var passCount = 0, ri;
  for (ri = 0; ri < rows.length; ri++) if (rows[ri].gatePass) passCount += 1;
  return { rows: rows, bestVariant: bestRow ? bestRow.variant : null,
    eyeCounts: { orbit: orbitEyes.length, grid: gridEyes.length },
    timingMs: { stage1: stage1Ms, stage2: stage2Ms },
    note: "sweep=variants:" + String(rows.length) + " gatePass=" + String(passCount)
      + " best=" + (bestRow ? bestRow.variant : "none")
      + " stage1ms=" + String(stage1Ms) + " stage2ms=" + String(stage2Ms) };
}`;

export async function runCameraSweepInPage(page: Page, request: CameraSweepRequest = {}): Promise<CameraSweepReport> {
  const t0 = Date.now();
  const snapshot = (await collectSweepScene(page)) as SweepSceneSnapshot | { error: string };
  if ("error" in snapshot) {
    return {
      actorIds: [],
      eyeCounts: { orbit: 0, grid: 0 },
      timingMs: { snapshot: Date.now() - t0, stage1: 0, stage2: 0 },
      rows: [],
      bestVariant: null,
      note: `sweep=${snapshot.error}`,
      error: snapshot.error,
    };
  }
  const raw = (await page.evaluate(
    `(${CAMERA_SWEEP_SEARCH_SOURCE})(${JSON.stringify(snapshot)}, ${JSON.stringify(request)})`,
  )) as {
    rows: CameraSweepRow[];
    bestVariant: string | null;
    eyeCounts: { orbit: number; grid: number };
    timingMs: { stage1: number; stage2: number };
    note: string;
    error?: string;
  };
  if (raw.error !== undefined || !Array.isArray(raw.rows)) {
    return {
      actorIds: snapshot.actorIds,
      eyeCounts: { orbit: 0, grid: 0 },
      timingMs: { snapshot: Date.now() - t0, stage1: 0, stage2: 0 },
      rows: [],
      bestVariant: null,
      note: `sweep=${raw.error ?? "unknown"}`,
      error: raw.error ?? "unknown",
    };
  }
  return {
    actorIds: snapshot.actorIds,
    eyeCounts: raw.eyeCounts,
    timingMs: { snapshot: Date.now() - t0, stage1: raw.timingMs.stage1, stage2: raw.timingMs.stage2 },
    rows: raw.rows,
    bestVariant: raw.bestVariant,
    note: raw.note,
  };
}
