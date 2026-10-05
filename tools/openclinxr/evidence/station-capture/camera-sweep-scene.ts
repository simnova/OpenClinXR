import type { Page } from "playwright";

/**
 * Scene snapshot for the camera-only sweep (measurement only).
 *
 * Pure data extraction: actor boxes, headings, chests, room interior,
 * occluder boxes and review-panel boxes. No camera is moved. Split from
 * the search pass so each file stays reviewable.
 */

export type SweepActorSnapshot = {
  id: string;
  box: { min: [number, number, number]; max: [number, number, number] };
  heading: number;
  standing: boolean;
  recumbent: boolean;
  chest: [number, number, number];
};

export type SweepSceneSnapshot = {
  actors: SweepActorSnapshot[];
  actorIds: string[];
  primaryId: string;
  interior: { min: [number, number, number]; max: [number, number, number] };
  unionCentre: [number, number, number];
  sphereCentre: [number, number, number];
  patientChest: [number, number, number];
  occluders: Array<{
    box: { min: [number, number, number]; max: [number, number, number] };
    actorId: string | null;
    name: string;
  }>;
  placards: Array<{
    box: { min: [number, number, number]; max: [number, number, number] };
    nx: number;
    nz: number;
    cx: number;
    cz: number;
  }>;
  eyeYs: number[];
  orbitBounds: { xMin: number; xMax: number; zMin: number; zMax: number };
};

/** Page snapshot body. Keep free of TypeScript syntax (serialized into the page). */
export const CAMERA_SWEEP_SCENE_SOURCE = String.raw`function () {
  var scene = globalThis.__openClinXrDebugScene;
  if (!scene || typeof scene.traverse !== "function") return { error: "no-scene" };
  scene.updateMatrixWorld(true);
  var worldBoxOf = function (obj, refreshSkinned) {
    var geom = obj.geometry;
    if (!geom) return null;
    if (obj.isSkinnedMesh && refreshSkinned && typeof obj.computeBoundingBox === "function") obj.computeBoundingBox();
    if (!geom.boundingBox && typeof geom.computeBoundingBox === "function") geom.computeBoundingBox();
    var bb = obj.isSkinnedMesh && obj.boundingBox ? obj.boundingBox : geom.boundingBox;
    var e = obj.matrixWorld && obj.matrixWorld.elements;
    if (!bb || !e) return null;
    var xs = [bb.min.x, bb.max.x], ys = [bb.min.y, bb.max.y], zs = [bb.min.z, bb.max.z];
    var a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
      var x = xs[i], y = ys[j], z = zs[k];
      var p = [e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]];
      for (var c = 0; c < 3; c++) { if (p[c] < a[c]) a[c] = p[c]; if (p[c] > b[c]) b[c] = p[c]; }
    }
    return isFinite(a[0]) ? { min: a, max: b } : null;
  };
  var grow = function (acc, box) {
    if (!box) return acc;
    if (!acc) return { min: box.min.slice(), max: box.max.slice() };
    for (var c = 0; c < 3; c++) {
      if (box.min[c] < acc.min[c]) acc.min[c] = box.min[c];
      if (box.max[c] > acc.max[c]) acc.max[c] = box.max[c];
    }
    return acc;
  };
  var actorIdOf = function (mesh) {
    var p = mesh;
    while (p) {
      var ud = p.userData;
      if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId.length > 0) return ud.openClinXrActorId;
      p = p.parent;
    }
    return null;
  };
  var postureOf = function (mesh) {
    var p = mesh;
    while (p) {
      var posture = p.userData && p.userData.openClinXrActorPosture;
      if (typeof posture === "string" && posture.length > 0) return posture.toLowerCase();
      p = p.parent;
    }
    return "standing";
  };
  var effectivelyVisible = function (object) {
    var cur = object;
    while (cur && cur !== scene) { if (cur.visible === false) return false; cur = cur.parent; }
    return true;
  };
  var roomRoot = null;
  scene.traverse(function (o) { if (!roomRoot && o.name === "openclinxr.station-environment.infinigen-room") roomRoot = o; });
  if (!roomRoot) return { error: "no-room" };
  var interior = null;
  roomRoot.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    if (/exterior/i.test(o.name || "")) return;
    interior = grow(interior, worldBoxOf(o));
  });
  if (!interior) return { error: "no-interior" };
  var actorMap = {};
  scene.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh) || !effectivelyVisible(o)) return;
    var id = actorIdOf(o);
    if (!id) return;
    var box = worldBoxOf(o, true);
    if (!box) return;
    actorMap[id] = grow(actorMap[id] || null, box);
  });
  var headingOf = function (mesh) {
    var root = mesh;
    while (root) {
      var ud = root.userData;
      if (ud && typeof ud.openClinXrBaseHeadingRadians === "number") return ud.openClinXrBaseHeadingRadians;
      if (ud && typeof ud.openClinXrConsumedHeadingRadians === "number") return ud.openClinXrConsumedHeadingRadians;
      root = root.parent;
    }
    var e = mesh.matrixWorld && mesh.matrixWorld.elements;
    if (!e) return 0;
    return Math.atan2(-e[8], -e[10]);
  };
  var actorHeading = {}, actorPosture = {};
  scene.traverse(function (o) {
    if (!o.isSkinnedMesh) return;
    var id = actorIdOf(o);
    if (!id) return;
    if (actorHeading[id] === undefined) actorHeading[id] = headingOf(o);
    if (actorPosture[id] === undefined) actorPosture[id] = postureOf(o);
  });
  var actors = [], standing = [], ids = Object.keys(actorMap);
  for (var ai = 0; ai < ids.length; ai++) {
    var box = actorMap[ids[ai]];
    var height = box.max[1] - box.min[1];
    var posture = actorPosture[ids[ai]] || "standing";
    var recumbent = /(supine|lying|recumbent)/.test(posture);
    var upright = !/(supine|seated|lying|recumbent)/.test(posture);
    var cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
    var chest = upright
      ? [cx, box.min[1] + height * 0.65, cz]
      : [box.min[0] + (box.max[0] - box.min[0]) * 0.32, box.max[1] - height * 0.08, cz];
    var actor = { id: ids[ai], box: box, heading: actorHeading[ids[ai]] || 0,
      standing: upright && height >= 1.15, recumbent: recumbent, chest: chest };
    actors.push(actor);
    if (actor.standing) standing.push(actor);
  }
  if (actors.length === 0) return { error: "no-actors" };
  if (standing.length === 0) return { error: "no-standing" };
  var actorUnion = null, ui;
  for (ui = 0; ui < actors.length; ui++) actorUnion = grow(actorUnion, actors[ui].box);
  var unionCentre = [(actorUnion.min[0]+actorUnion.max[0])/2, (actorUnion.min[1]+actorUnion.max[1])/2, (actorUnion.min[2]+actorUnion.max[2])/2];
  var corners = [];
  for (var ci = 0; ci < actors.length; ci++) {
    var ab = actors[ci].box;
    for (var xi = 0; xi < 2; xi++) for (var yi = 0; yi < 2; yi++) for (var zi = 0; zi < 2; zi++)
      corners.push([xi ? ab.max[0] : ab.min[0], yi ? ab.max[1] : ab.min[1], zi ? ab.max[2] : ab.min[2]]);
  }
  var dist2 = function (a, b) { return (a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]) + (a[2]-b[2])*(a[2]-b[2]); };
  var s1 = corners[0], s2 = corners[0], si, sj;
  for (si = 0; si < corners.length; si++) if (dist2(corners[si], corners[0]) > dist2(s1, corners[0])) s1 = corners[si];
  for (sj = 0; sj < corners.length; sj++) if (dist2(corners[sj], s1) > dist2(s2, s1)) s2 = corners[sj];
  var sc = [(s1[0]+s2[0])/2, (s1[1]+s2[1])/2, (s1[2]+s2[2])/2];
  var sr = Math.sqrt(dist2(s1, s2)) / 2, sk;
  for (sk = 0; sk < corners.length; sk++) {
    var d = Math.sqrt(dist2(corners[sk], sc));
    if (d > sr) {
      var nr = (sr + d) / 2, f = d > 1e-9 ? (d - nr) / d : 0;
      sc = [sc[0] + (corners[sk][0]-sc[0])*f, sc[1] + (corners[sk][1]-sc[1])*f, sc[2] + (corners[sk][2]-sc[2])*f];
      sr = nr;
    }
  }
  var primary = standing[0], hi;
  for (hi = 1; hi < standing.length; hi++) {
    var hh = standing[hi].box.max[1] - standing[hi].box.min[1];
    if (hh > primary.box.max[1] - primary.box.min[1]) primary = standing[hi];
  }
  var patientActor = null, pi, qi;
  for (pi = 0; pi < actors.length; pi++) if (/patient/i.test(actors[pi].id)) { patientActor = actors[pi]; break; }
  if (!patientActor) for (qi = 0; qi < actors.length; qi++) if (actors[qi].recumbent) { patientActor = actors[qi]; break; }
  if (!patientActor) patientActor = actors[0];
  var occluders = [];
  scene.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh) || !effectivelyVisible(o)) return;
    var box = worldBoxOf(o, true);
    if (!box) return;
    occluders.push({ box: box, actorId: actorIdOf(o), name: o.name || "unnamed" });
  });
  var placards = [];
  scene.traverse(function (o) {
    if (!(o.isMesh || o.isSkinnedMesh) || o.visible === false) return;
    var n = o.name || "", ud = o.userData || {};
    if (!(/scenario-expectation-visual-review-panel|patient-note-capture-cue/i.test(n) || ud.openClinXrPortalInteriorReviewAffordance === true)) return;
    var box = worldBoxOf(o);
    if (!box) return;
    var e = o.matrixWorld && o.matrixWorld.elements;
    if (!e) return;
    placards.push({ box: box, nx: e[8], nz: e[10], cx: (box.min[0]+box.max[0])/2, cz: (box.min[2]+box.max[2])/2 });
  });
  var ceilingY = interior.max[1] - 0.45;
  var eyeYs = [1.52, 1.68, 1.84, 2.0, 2.16].map(function (y) {
    var ey = y;
    if (ey > ceilingY) ey = ceilingY;
    if (ey < 1.4) ey = 1.4;
    return ey;
  });
  return { actors: actors, actorIds: ids, primaryId: primary.id, interior: interior,
    unionCentre: unionCentre, sphereCentre: sc, patientChest: patientActor.chest,
    occluders: occluders, placards: placards, eyeYs: eyeYs,
    orbitBounds: { xMin: interior.min[0] + 0.9, xMax: interior.max[0] - 0.9, zMin: interior.min[2] + 0.22, zMax: interior.max[2] - 0.22 } };
}`;

export async function collectSweepScene(page: Page): Promise<SweepSceneSnapshot | { error: string }> {
  return page.evaluate(`(${CAMERA_SWEEP_SCENE_SOURCE})()`) as Promise<
    SweepSceneSnapshot | { error: string }
  >;
}
