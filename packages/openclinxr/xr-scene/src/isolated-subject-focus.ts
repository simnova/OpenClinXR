/**
 * Focus-region resolution for isolated-subject-lab (#354/#358).
 *
 * Extracted from isolated-subject-lab.ts when the #358 head-focus mode pushed
 * the lab over the apps/ zone budget — a pure move, no behaviour change to the
 * #354 eye path (the eye-box derivation and its evidence record are verbatim).
 *
 * #358: the eye-focus station framed the head only on the MPFB rail and SILENTLY
 * fell back to whole-subject framing everywhere else (7 of 7 Anny actors have
 * eye BONES but zero eye GEOMETRY). `resolveFocus` now REFUSES an unresolvable
 * focus instead of falling back, and records which framing was actually used:
 *
 *   - "eyes": the world AABB of meshes matching the eye channel (unchanged)
 *   - "head": the topmost band of the body's own bounds, cut at the neck via
 *     the silhouette width profile (`deriveHeadBoxFromPoints` — the same pure
 *     function the file-side inspection uses, so runtime and measurement
 *     cannot drift). Works on every rail: MPFB, Anny, hm08 library bodies.
 *
 * Never literal camera coordinates (D1). `whole_subject_fallback` remains in
 * the type only for pre-#358 artifacts; new runs refuse.
 */

import type { Object3D } from "three";
import { Box3, Mesh, SkinnedMesh, Vector3 } from "three";
import { computeMeshBounds } from "./camera-fit-to-bounds.js";
import { deriveHeadBoxFromPoints, isFittedHairMeshName } from "./head-box-from-geometry.js";

type Vec3Meters = { x: number; y: number; z: number };

export type FocusRegion =
  | {
      kind: "eye_box";
      matchedMeshes: string[];
      boundsMeters: { min: Vec3Meters; max: Vec3Meters };
    }
  | {
      kind: "head_box";
      derivation: string;
      neckPositionMeters: number;
      dominantAxis: "x" | "y" | "z";
      matchedVertexCount: number;
      boundsMeters: { min: Vec3Meters; max: Vec3Meters };
    }
  | {
      kind: "mouth_box";
      derivation: string;
      teethVertexCount: number;
      orisVertexCount: number;
      boundsMeters: { min: Vec3Meters; max: Vec3Meters };
    }
  | { kind: "whole_subject_fallback"; reason: string }
  | null;

/** #354: mesh-name filter for the eye channel — matches the MakeClothes low-poly eye export. */
const EYE_MESH_RE = /eyes|iris|cornea|sclera/i;

/** Round a Box3 to 4-dp metres for the evidence record (#354/#358). */
function boxToRecord(b: Box3): { min: Vec3Meters; max: Vec3Meters } {
  return {
    min: {
      x: Math.round(b.min.x * 10000) / 10000,
      y: Math.round(b.min.y * 10000) / 10000,
      z: Math.round(b.min.z * 10000) / 10000,
    },
    max: {
      x: Math.round(b.max.x * 10000) / 10000,
      y: Math.round(b.max.y * 10000) / 10000,
      z: Math.round(b.max.z * 10000) / 10000,
    },
  };
}

/**
 * #354: derive the eye focus box from the ASSET at runtime — the world AABB of
 * every mesh that carries the eye channel. three.js GLTFLoader overrides a
 * loaded mesh's name with its NODE name, and the shipped MPFB eye node is named
 * `mpfb_*_body_mesh.low-poly` (the "eyes" channel lives on the glTF MESH data
 * name, which the loader does not keep) — so the match checks the mesh name,
 * the raw node name (`userData.name`), AND the material name, which the
 * materialize script names `mat_makeclothes_library_eyes_*` on every MPFB
 * actor. Falls back to whole-subject bounds when nothing matches (recorded,
 * never silent). Works on the next body unchanged: no literal camera
 * coordinates (D1).
 */
function deriveEyeFocusBounds(root: Object3D): {
  kind: "eye_box" | "whole_subject_fallback";
  bounds: Box3;
  matchedMeshes: string[];
  reason?: string;
} {
  const eyeBounds = new Box3();
  const point = new Vector3();
  const matchedMeshes: string[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    const materialNames = Array.isArray(object.material)
      ? object.material.map((m) => m.name)
      : [object.material.name];
    const names = [
      object.name,
      typeof object.userData?.name === "string" ? object.userData.name : "",
      ...materialNames,
    ];
    if (!names.some((n) => EYE_MESH_RE.test(n))) return;
    matchedMeshes.push(object.name);
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      eyeBounds.expandByPoint(point);
    }
  });
  if (matchedMeshes.length === 0 || !Number.isFinite(eyeBounds.min.x)) {
    return {
      kind: "whole_subject_fallback",
      bounds: computeMeshBounds(root),
      matchedMeshes: [],
      reason: `no mesh matched ${String(EYE_MESH_RE)} (mesh name, raw node name, or material name) — whole-subject framing`,
    };
  }
  return { kind: "eye_box", bounds: eyeBounds, matchedMeshes };
}

/**
 * #358: derive the head focus box from the ASSET at runtime — the topmost band
 * of the body's own bounds, cut at the neck via the silhouette width profile
 * (`deriveHeadBoxFromPoints`, the same pure function the file-side inspection
 * uses). Works on every rail: MPFB, Anny (eye bones, zero eye geometry), and
 * the hm08 library bodies. Refuses (throws) when no head is derivable — never
 * falls back silently. Fitted hair is NOT body (#394): hair meshes are excluded
 * from the silhouette profile (they mask the neck constriction) but their
 * bounds union into the box, so a head crop still contains the hair.
 */
function deriveHeadFocusBounds(root: Object3D): {
  kind: "head_box";
  box: Box3;
  neckPositionMeters: number;
  dominantAxis: "x" | "y" | "z";
  matchedVertexCount: number;
  derivation: string;
} {
  const points: Array<{ x: number; y: number; z: number }> = [];
  const silhouettePoints: Array<{ x: number; y: number; z: number }> = [];
  const containPoints: Array<{ x: number; y: number; z: number }> = [];
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    // GLTFLoader overrides mesh.name with the NODE name and keeps the glTF MESH
    // name on geometry.name — check both layers (same shape as the #354 eye path).
    const isHair = isFittedHairMeshName(object.name)
      || (typeof object.userData?.name === "string" && isFittedHairMeshName(object.userData.name))
      || isFittedHairMeshName(object.geometry.name);
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      const p = { x: point.x, y: point.y, z: point.z };
      points.push(p);
      if (isHair) containPoints.push(p);
      else silhouettePoints.push(p);
    }
  });
  const derived = deriveHeadBoxFromPoints(points, { silhouettePoints, containPoints });
  if (!derived) {
    throw new Error(
      "focus=head unresolvable: no head-like region derivable from the body bounds "
      + "(body too small or no neck constriction) — refusing rather than falling back (#358)",
    );
  }
  return {
    kind: "head_box",
    box: new Box3(
      new Vector3(derived.box.min.x, derived.box.min.y, derived.box.min.z),
      new Vector3(derived.box.max.x, derived.box.max.y, derived.box.max.z),
    ),
    neckPositionMeters: derived.neckPosition,
    dominantAxis: derived.dominantAxis,
    matchedVertexCount: derived.vertexCount,
    derivation:
      "topmost band of the body bounds cut at the neck (silhouette width profile); never the eye mesh, never literal coordinates (D1)",
  };
}

/**
 * U1 mouth-front: derive the mouth focus box from the ASSET at runtime —
 * the union of the fitted-teeth mesh AABB and the AABB of body verts whose
 * dominant skinning joint is an orbicularis-oris bone (lip tissue by rig,
 * never literal coordinates). Teeth alone would crop the vermilion under
 * the 0.8 pack fill; oris alone could miss the incisal tips. Refuses when
 * no fitted-teeth mesh resolves (same refusal posture as eyes, #358).
 */
const TEETH_MESH_RE = /fitted_teeth/i;
const ORIS_JOINT_RE = /^oris/i;

function meshNameLayers(object: Mesh): string[] {
  return [
    object.name,
    typeof (object as Mesh & { userData?: { name?: unknown } }).userData?.name === "string"
      ? String((object as Mesh & { userData?: { name?: unknown } }).userData?.name)
      : "",
    ...(Array.isArray(object.material)
      ? object.material.map((m) => m.name)
      : [object.material?.name ?? ""]),
  ];
}

function deriveMouthFocusBounds(root: Object3D): {
  kind: "mouth_box" | "whole_subject_fallback";
  box: Box3;
  teethVertexCount: number;
  orisVertexCount: number;
  reason?: string;
} {
  const box = new Box3();
  const point = new Vector3();
  let teethVertexCount = 0;
  let orisVertexCount = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    const names = meshNameLayers(object);
    const isTeeth = names.some((n) => TEETH_MESH_RE.test(n));
    const isBody = names.some((n) => /_body$/i.test(n));
    if (isTeeth) {
      for (let i = 0; i < position.count; i += 1) {
        point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        box.expandByPoint(point);
      }
      teethVertexCount += position.count;
      return;
    }
    if (!isBody || !(object instanceof SkinnedMesh)) return;
    const skeleton = object.skeleton;
    const skinIndex = object.geometry.getAttribute("skinIndex");
    const skinWeight = object.geometry.getAttribute("skinWeight");
    if (!skeleton || !skinIndex || !skinWeight) return;
    const bones = skeleton.bones;
    for (let i = 0; i < position.count; i += 1) {
      let joint = -1;
      let best = 0;
      const w0 = skinWeight.getX(i);
      const w1 = skinWeight.getY(i);
      const w2 = skinWeight.getZ(i);
      const w3 = skinWeight.getW(i);
      const j0 = skinIndex.getX(i);
      const j1 = skinIndex.getY(i);
      const j2 = skinIndex.getZ(i);
      const j3 = skinIndex.getW(i);
      if (w0 > best) {
        best = w0;
        joint = j0;
      }
      if (w1 > best) {
        best = w1;
        joint = j1;
      }
      if (w2 > best) {
        best = w2;
        joint = j2;
      }
      if (w3 > best) {
        best = w3;
        joint = j3;
      }
      const jointName = joint >= 0 ? (bones[joint]?.name ?? "") : "";
      if (!ORIS_JOINT_RE.test(jointName)) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      box.expandByPoint(point);
      orisVertexCount += 1;
    }
  });
  if (teethVertexCount === 0 || !Number.isFinite(box.min.x)) {
    return {
      kind: "whole_subject_fallback",
      box: computeMeshBounds(root),
      teethVertexCount,
      orisVertexCount,
      reason: "no fitted-teeth mesh matched (mesh name, raw node name, or material name) — refusing rather than falling back (#358)",
    };
  }
  return { kind: "mouth_box", box, teethVertexCount, orisVertexCount };
}

/**
 * Resolve the camera frame for the requested focus. An unresolvable focus
 * THROWS (refusal, #358) — the station never degrades silently. The returned
 * `focusRegion` records which framing was actually used.
 */
export function resolveFocus(
  root: Object3D,
  focus: "eyes" | "head" | "mouth" | undefined,
  wholeBodyBounds: Box3,
): { focusRegion: FocusRegion; frameBounds: Box3 } {
  if (focus === "eyes") {
    const derived = deriveEyeFocusBounds(root);
    if (derived.kind !== "eye_box") {
      throw new Error(
        `focus=eyes unresolvable: ${derived.reason ?? "no eye mesh matched"} — refusing rather than falling back (#358)`,
      );
    }
    return {
      focusRegion: {
        kind: "eye_box",
        matchedMeshes: derived.matchedMeshes,
        boundsMeters: boxToRecord(derived.bounds),
      },
      frameBounds: derived.bounds,
    };
  }
  if (focus === "head") {
    const derived = deriveHeadFocusBounds(root);
    return {
      focusRegion: {
        kind: "head_box",
        derivation: derived.derivation,
        neckPositionMeters: Math.round(derived.neckPositionMeters * 10000) / 10000,
        dominantAxis: derived.dominantAxis,
        matchedVertexCount: derived.matchedVertexCount,
        boundsMeters: boxToRecord(derived.box),
      },
      frameBounds: derived.box,
    };
  }
  if (focus === "mouth") {
    const derived = deriveMouthFocusBounds(root);
    if (derived.kind !== "mouth_box") {
      throw new Error(
        `focus=mouth unresolvable: ${derived.reason ?? "no mouth box derivable"} — refusing rather than falling back (#358)`,
      );
    }
    return {
      focusRegion: {
        kind: "mouth_box",
        derivation:
          "union of the fitted-teeth mesh AABB and the AABB of body verts dominant-weighted to orbicularis-oris bones; never literal coordinates (D1)",
        teethVertexCount: derived.teethVertexCount,
        orisVertexCount: derived.orisVertexCount,
        boundsMeters: boxToRecord(derived.box),
      },
      frameBounds: derived.box,
    };
  }
  return { focusRegion: null, frameBounds: wholeBodyBounds };
}
