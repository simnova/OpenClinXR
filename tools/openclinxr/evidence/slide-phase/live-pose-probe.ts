/**
 * Live-pose probe for the slide-phase capture (rest-stance slice, M2).
 *
 * The sample-tail probe (`PROBE_SOURCE` in `slide-phase-capture.ts`) reads the
 * published evidence ring, which SKIPS the first walking frame (idle pose,
 * lock unarmed — see `publishBedsideApproachRuntimeEvidence`) — so the
 * walk-start rest pose never appears in any record. This probe reads the LIVE
 * scene instead (toe-bone worlds + slot pose per actor root), so analysis can
 * recover the rest pose off the pre-walk probes, whose live skeletons still
 * hold idle.
 *
 * Deliberately independent of the evidence object (no actorId lookup): the
 * earliest pre-walk probes run before any evidence is published, and the rest
 * pose lives exactly there. Returns one entry per scene node carrying an
 * actor id; analysis joins the physician by `physicianActorId` once the
 * evidence names it. Empty array when the scene or the actors are absent.
 *
 * Toe-bone names mirror `resolveToeBones` (`xr-humanoid-animation`), sanitised
 * forms included; a rig matching none of them yields null toes (loud mismatch
 * at analysis, never a silent pick off a pattern — the `toe_ik_target` trap
 * that module documents).
 */

export type LivePoseVec3 = { x: number; y: number; z: number };

export type LiveActorPose = {
  actorId: string;
  slot: { x: number; y: number; z: number; yaw: number } | null;
  toeL: LivePoseVec3 | null;
  toeR: LivePoseVec3 | null;
};

export const LIVE_POSE_PROBE_SOURCE = `
(() => {
  const out = [];
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return out;
  const roots = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (ud.openClinXrActorId !== undefined && ud.openClinXrActorId !== null) roots.push(o);
  });
  for (const root of roots) {
    let slot = root;
    while (slot.parent && slot.parent !== scene) slot = slot.parent;
    const wOf = (bone) => {
      if (!bone) return null;
      if (typeof bone.updateWorldMatrix === "function") bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return { x: e[12], y: e[13], z: e[14] };
    };
    const byNames = (names) => {
      for (const n of names) {
        const b = slot.getObjectByName(n);
        if (b) return b;
      }
      return null;
    };
    const toeL = byNames(["toe1-1L", "toe1-1.L", "mixamorig:LeftToeBase", "toe.L", "toeL"]);
    const toeR = byNames(["toe1-1R", "toe1-1.R", "mixamorig:RightToeBase", "toe.R", "toeR"]);
    out.push({
      actorId: root.userData.openClinXrActorId,
      slot: { x: slot.position.x, y: slot.position.y, z: slot.position.z, yaw: slot.rotation.y },
      toeL: wOf(toeL),
      toeR: wOf(toeR),
    });
  }
  return out;
})()
`;
