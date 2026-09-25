import type { Group, Object3D } from "three";
import {
  BufferGeometry,
  BoxGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from "three";

/**
 * Unlit cavity card behind the teeth, parented to `head`.
 *
 * Lip-sync review: viseme_aa=1 and mouth-open=1 still left parent lips sealed
 * (f6c7d15d8); jaw-bone drive is what opens the scratch-nurse aa crop. The open
 * mouth then shows a dark hole because no palate/gums mesh exists and inner
 * faces are unlit. MeshBasicMaterial is the same unlit fill the viseme map
 * already uses for honest closed/open tokens (Rhubarb D=AA wide open).
 *
 * Live speech-emotion-video keeps visemeSequence at ["sil"] and drives the mouth
 * through applyNamedSpeechVisemes bakedCues (Rhubarb D→AA). visemeOpenness("sil")
 * × sine stays 0.16–0.29, so openness>0.35 never trips on the capture path.
 * Named drive already writes jawOpenRadians from viseme-timeline-drive
 * JAW_APERTURE_FRACTION (aa=1, pp/sil=0). Key visibility off that, not the
 * coarse sequence.
 *
 * Visible when named jawOpenRadians > NAMED_JAW_VISIBLE, else openness > 0.35.
 * notEvidenceFor: anatomical palate, clinical oral exam, shipped-GLB identity.
 */

const CARD_NAME = "openclinxr_inner_mouth_cavity";
const OPEN_VISIBLE = 0.35;
/** ~0.33 of JAW_OPEN_TEETH_CLEAR_RADIANS (0.15086); fv 0.023 stays hidden, e 0.068 shows. */
const NAMED_JAW_VISIBLE = 0.05;
/**
 * Head-local from 2026-09-21 recapture ladder (aa frame 189).
 * (0,-0.039,0.055) filled the opening. z=0.068 denser fill, no lip poke.
 * z=0.075 poked both lip corners. x=-0.008 and -0.018 punched the left cheek.
 */
/**
 * SphereGeometry radius 0.015, 16x12 segs. Position (0,-0.038,0.052)
 * larger radius eats the dark crescent without leaving the visible Y window.
 */
const HEAD_LOCAL = new Vector3(0, -0.038, 0.052);
const CARD_RADIUS = 0.015;
const PALATE_NAME = "openclinxr_inner_mouth_palate";
const PALATE_LOCAL = new Vector3(0, -0.010, 0.054);
const PALATE_RADIUS = 0.010;
const FACES_NAME = "openclinxr_inner_lip_faces";
const RIM_NAME = "openclinxr_inner_lip_rim";
const UPPER_NAME = "openclinxr_inner_lip_upper";
const BODY_NAME = /_body(?:\.\d+|\d+)?$/;
const ATTEMPTED_KEY = "openClinXrInnerLipFacesAttempted";
const ABS_X = 0.022;
const Y_MIN = -0.062;
const Y_MAX = -0.010;
const Z_MIN = 0.074;
const Z_MAX = 0.100;
const INWARD_DOT = 0.12;
/** NO +Z slab: user forbid the 0.010 pink slab. */
const HEAD_Z_PUSH = 0;
/** Rim only: along triangle normal, toward camera for front-facing faces. Not +Z. */
const RIM_NORMAL_PUSH = 0.002;

type NamedJawDrive = {
  activeTargetName?: string | null;
  jawOpenRadians?: number;
};

function namedJawDrive(root: Group): NamedJawDrive | undefined {
  const bag = root.userData["openClinXrNamedVisemeDrive"] as NamedJawDrive | undefined;
  return bag && typeof bag === "object" ? bag : undefined;
}

function findHeadBone(root: Group): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object: Object3D) => {
    if (found === null && object.name === "head") found = object;
  });
  if (found !== null) return found;
  root.traverse((object: Object3D) => {
    if (found === null && object.name.toLowerCase().includes("head")) found = object;
  });
  return found;
}

function findBodyMeshes(root: Group): Mesh[] {
  const found: Mesh[] = [];
  root.traverse((object: Object3D) => {
    if (object instanceof Mesh && BODY_NAME.test(object.name)) found.push(object);
  });
  return found;
}

function keepInnerLipTriangle(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  const mx = (ax + bx + cx) / 3;
  const my = (ay + by + cy) / 3;
  const mz = (az + bz + cz) / 3;
  if (Math.abs(mx) >= ABS_X || my < Y_MIN || my > Y_MAX || mz < Z_MIN || mz > Z_MAX) return false;
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return false;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const tx = HEAD_LOCAL.x - mx;
  const ty = HEAD_LOCAL.y - my;
  const tz = HEAD_LOCAL.z - mz;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-12) return false;
  return (nx * tx + ny * ty + nz * tz) / tLen > INWARD_DOT;
}

function keepInnerLipRim(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  const mx = (ax + bx + cx) / 3;
  const my = (ay + by + cy) / 3;
  const mz = (az + bz + cz) / 3;
  if (Math.abs(mx) >= 0.018 || my < -0.055 || my > -0.034 || mz < 0.082 || mz > 0.094) return false;
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return false;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const tx = HEAD_LOCAL.x - mx;
  const ty = HEAD_LOCAL.y - my;
  const tz = HEAD_LOCAL.z - mz;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-12) return false;
  return (nx * tx + ny * ty + nz * tz) / tLen <= INWARD_DOT;
}

function keepUpperRim(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  const mx = (ax + bx + cx) / 3;
  const my = (ay + by + cy) / 3;
  const mz = (az + bz + cz) / 3;
  if (Math.abs(mx) >= 0.026 || my < -0.032 || my > 0.012 || mz < 0.048 || mz > 0.096) return false;
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return false;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const tx = HEAD_LOCAL.x - mx;
  const ty = HEAD_LOCAL.y - my;
  const tz = HEAD_LOCAL.z - mz;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-12) return false;
  return (nx * tx + ny * ty + nz * tz) / tLen <= INWARD_DOT;
}

function keepUpperCavity(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  const mx = (ax + bx + cx) / 3;
  const my = (ay + by + cy) / 3;
  const mz = (az + bz + cz) / 3;
  if (Math.abs(mx) >= 0.016 || my < -0.014 || my > 0.000 || mz < 0.080 || mz > 0.094) return false;
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen < 1e-12) return false;
  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const tx = HEAD_LOCAL.x - mx;
  const ty = HEAD_LOCAL.y - my;
  const tz = HEAD_LOCAL.z - mz;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-12) return false;
  return (nx * tx + ny * ty + nz * tz) / tLen > INWARD_DOT;
}

function deformToHeadLocal(
  mesh: Mesh,
  index: number,
  headInv: Matrix4,
  target: Vector3,
): void {
  mesh.getVertexPosition(index, target);
  target.applyMatrix4(mesh.matrixWorld);
  target.applyMatrix4(headInv);
}

function extractInnerLipFaces(root: Group, head: Object3D): void {
  if (root.userData[ATTEMPTED_KEY] === true) return;
  root.userData[ATTEMPTED_KEY] = true;
  const sources = findBodyMeshes(root);
  if (sources.length === 0) {
    console.log("INNER_LIP_FACES n=0 source=none skinned=false");
    return;
  }
  sources.sort((a, b) => b.geometry.getAttribute("position").count - a.geometry.getAttribute("position").count);
  const source = sources[0]!;
  root.updateMatrixWorld(true);
  if (source instanceof SkinnedMesh && source.skeleton) source.skeleton.update();
  const headInv = new Matrix4().copy(head.matrixWorld).invert();
  const geo = source.geometry;
  const index = geo.index;
  const pos = geo.getAttribute("position");
  const triCount = index !== null ? index.count / 3 : pos.count / 3;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cavityPos: number[] = [];
  const rimPos: number[] = [];
  const upperPos: number[] = [];
  let bandN = 0;
  let bandYMin = 1;
  let bandYMax = -1;
  let bandZMin = 1;
  let bandZMax = -1;
  let unkeptN = 0;
  let unkeptYMin = 1;
  let unkeptYMax = -1;
  let unkeptZMin = 1;
  let unkeptZMax = -1;
  for (let t = 0; t < triCount; t += 1) {
    const i0 = index !== null ? index.getX(t * 3) : t * 3;
    const i1 = index !== null ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index !== null ? index.getX(t * 3 + 2) : t * 3 + 2;
    deformToHeadLocal(source, i0, headInv, a);
    deformToHeadLocal(source, i1, headInv, b);
    deformToHeadLocal(source, i2, headInv, c);
    const mx = (a.x + b.x + c.x) / 3;
    const my = (a.y + b.y + c.y) / 3;
    const mz = (a.z + b.z + c.z) / 3;
    if (Math.abs(mx) < 0.04 && my > -0.12 && my < 0.12 && mz > 0.04 && mz < 0.12) {
      bandN += 1;
      if (my < bandYMin) bandYMin = my;
      if (my > bandYMax) bandYMax = my;
      if (mz < bandZMin) bandZMin = mz;
      if (mz > bandZMax) bandZMax = mz;
    }
    const keptCav = keepInnerLipTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const keptInnerLipRim = keepInnerLipRim(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const keptUpperRim = keepUpperRim(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const keptUpperCavity = keepUpperCavity(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const keptRim = keptInnerLipRim || keptUpperRim;
    if (!keptCav && !keptRim && !keptUpperCavity && Math.abs(mx) < 0.03 && my > -0.04 && my < 0.02 && mz > 0.05 && mz < 0.10) {
      unkeptN += 1;
      if (my < unkeptYMin) unkeptYMin = my;
      if (my > unkeptYMax) unkeptYMax = my;
      if (mz < unkeptZMin) unkeptZMin = mz;
      if (mz > unkeptZMax) unkeptZMax = mz;
    }
    if (keptCav && my > -0.028) {
      const e1x = b.x - a.x;
      const e1y = b.y - a.y;
      const e1z = b.z - a.z;
      const e2x = c.x - a.x;
      const e2y = c.y - a.y;
      const e2z = c.z - a.z;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / nLen) * RIM_NORMAL_PUSH;
      ny = (ny / nLen) * RIM_NORMAL_PUSH;
      nz = (nz / nLen) * RIM_NORMAL_PUSH;
      rimPos.push(a.x + nx, a.y + ny, a.z + nz, b.x + nx, b.y + ny, b.z + nz, c.x + nx, c.y + ny, c.z + nz);
    } else if (keptCav) {
      cavityPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    } else if (keptInnerLipRim || keptUpperRim) {
      const e1x = b.x - a.x;
      const e1y = b.y - a.y;
      const e1z = b.z - a.z;
      const e2x = c.x - a.x;
      const e2y = c.y - a.y;
      const e2z = c.z - a.z;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / nLen) * RIM_NORMAL_PUSH;
      ny = (ny / nLen) * RIM_NORMAL_PUSH;
      nz = (nz / nLen) * RIM_NORMAL_PUSH;
      rimPos.push(a.x + nx, a.y + ny, a.z + nz, b.x + nx, b.y + ny, b.z + nz, c.x + nx, c.y + ny, c.z + nz);
    } else if (keptUpperCavity) {
      const e1x = b.x - a.x;
      const e1y = b.y - a.y;
      const e1z = b.z - a.z;
      const e2x = c.x - a.x;
      const e2y = c.y - a.y;
      const e2z = c.z - a.z;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx = (-nx / nLen) * RIM_NORMAL_PUSH;
      ny = (-ny / nLen) * RIM_NORMAL_PUSH;
      nz = (-nz / nLen) * RIM_NORMAL_PUSH;
      upperPos.push(a.x + nx, a.y + ny, a.z + nz, b.x + nx, b.y + ny, b.z + nz, c.x + nx, c.y + ny, c.z + nz);
    }
  }
  console.log(
    `INNER_LIP_FACES n=${cavityPos.length / 9} rim=${rimPos.length / 9} upper=${upperPos.length / 9} source=${source.name} skinned=${source instanceof SkinnedMesh}`,
  );
  console.log(
    `INNER_LIP_CENSUS n=${bandN} y=${bandYMin.toFixed(3)}..${bandYMax.toFixed(3)} z=${bandZMin.toFixed(3)}..${bandZMax.toFixed(3)}`,
  );
  console.log(
    `INNER_LIP_UNKEPT n=${unkeptN} y=${unkeptYMin.toFixed(3)}..${unkeptYMax.toFixed(3)} z=${unkeptZMin.toFixed(3)}..${unkeptZMax.toFixed(3)}`,
  );

  if (cavityPos.length > 0) {
    const out = new BufferGeometry();
    out.setAttribute("position", new Float32BufferAttribute(cavityPos, 3));
    const clone = new Mesh(
      out,
      new MeshBasicMaterial({
        color: 0xb34752,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    clone.name = FACES_NAME;
    clone.frustumCulled = false;
    const faceTriCount = cavityPos.length / 9;
    if (faceTriCount <= 4) head.add(clone);
  }
  if (rimPos.length > 0) {
    const out = new BufferGeometry();
    out.setAttribute("position", new Float32BufferAttribute(rimPos, 3));
    const rim = new Mesh(
      out,
      new MeshBasicMaterial({
        color: 0xb34752,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    rim.name = RIM_NAME;
    rim.frustumCulled = false;
    const rimTriCount = rimPos.length / 9;
    if (rimTriCount <= 4) head.add(rim);
  }
  if (upperPos.length > 0) {
    const out = new BufferGeometry();
    out.setAttribute("position", new Float32BufferAttribute(upperPos, 3));
    const upper = new Mesh(
      out,
      new MeshBasicMaterial({
        color: 0xb34752,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    upper.name = UPPER_NAME;
    upper.frustumCulled = false;
    const upperTriCount = upperPos.length / 9;
    if (upperTriCount <= 4) head.add(upper);
  }
}

function ensureCard(root: Group, head: Object3D): Mesh {
  const existing = root.getObjectByName(CARD_NAME);
  if (existing instanceof Mesh) return existing;
  const card = new Mesh(
    new SphereGeometry(CARD_RADIUS, 16, 12),
    new MeshBasicMaterial({ color: 0xb34752 }),
  );
  card.name = CARD_NAME;
  card.frustumCulled = false;
  head.add(card);
  card.position.copy(HEAD_LOCAL);
  return card;
}

function ensurePalate(root: Group, head: Object3D): Mesh {
  const existing = root.getObjectByName(PALATE_NAME);
  if (existing instanceof Mesh) return existing;
  const palate = new Mesh(
    new SphereGeometry(PALATE_RADIUS, 12, 10),
    new MeshBasicMaterial({ color: 0xb34752 }),
  );
  palate.name = PALATE_NAME;
  palate.frustumCulled = false;
  head.add(palate);
  palate.position.copy(PALATE_LOCAL);
  return palate;
}

export function applyInnerMouthCavity(root: Group, openness: number): void {
  const head = findHeadBone(root);
  if (head === null) return;
  const card = ensureCard(root, head);
  card.position.copy(HEAD_LOCAL);
  const palate = ensurePalate(root, head);
  palate.position.copy(PALATE_LOCAL);
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  const named = namedJawDrive(root);
  const namedRadians = typeof named?.jawOpenRadians === "number" ? named.jawOpenRadians : 0;
  const visible = namedRadians > NAMED_JAW_VISIBLE || clamped > OPEN_VISIBLE;
  card.visible = visible;
  palate.visible = visible;
  if (visible) extractInnerLipFaces(root, head);
  const faces = root.getObjectByName(FACES_NAME);
  if (faces) faces.visible = visible;
  const rim = root.getObjectByName(RIM_NAME);
  if (rim) rim.visible = visible;
  const upper = root.getObjectByName(UPPER_NAME);
  if (upper) upper.visible = visible;
}
