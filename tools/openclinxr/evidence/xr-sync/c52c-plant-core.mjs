/**
 * C52c shared plant + read code. The SAME functions run in node and in the page bundle, so the
 * only thing that differs between the two records is the runtime (loader, V8, float paths).
 * Inputs mirror the-supine-plant-keeps-its-pose-while-getting-faster.test.ts (RED A) exactly.
 */

export const RED_A_DECK_TOP_WORLD_Y = 0.55;
export const RED_A_PARENT_YAW = -0.26;
export const RED_A_PARENT_SCALE = 0.82;

/** Plant one loaded humanoid on a procedural stretcher; returns the parent group that owns the root. */
export function plantLoadedHumanoid(root, spec, deps) {
  const { Group, buildPatientStretcher, applyAndPlantSupineOnDeck } = deps;
  const parent = new Group();
  // deck "none" = a support surface with no procedural stretcher (exam table): RED A's bedless inputs.
  const bed = spec.deck === "none" ? null : buildPatientStretcher({ slotId: "patient", position: { x: 0, y: 0, z: 0 }, trimColor: 0, inclineDegrees: spec.inclineDeg });
  if (bed) {
    parent.rotation.y = RED_A_PARENT_YAW;
    parent.scale.setScalar(RED_A_PARENT_SCALE);
  }
  parent.add(root);
  parent.updateMatrixWorld(true);
  applyAndPlantSupineOnDeck(root, { ...(bed ? { stretcher: bed } : {}), deckTopWorldY: RED_A_DECK_TOP_WORLD_Y, deckCenter: { x: 0, z: 0 } });
  root.updateMatrixWorld(true);
  return parent;
}

/** Root position + quaternion and the world position of every bone, keyed by name (#n for repeats). */
export function readPose(root, Vector3) {
  root.updateMatrixWorld(true);
  const bones = {};
  root.traverse((object) => {
    if (object.isBone !== true) return;
    let key = object.name;
    let n = 1;
    while (bones[key]) { n += 1; key = `${object.name}#${n}`; }
    const p = object.getWorldPosition(new Vector3());
    bones[key] = [p.x, p.y, p.z];
  });
  const q = root.quaternion;
  return { root: { position: [root.position.x, root.position.y, root.position.z], quaternion: [q.x, q.y, q.z, q.w] }, bones };
}

/** Largest per-case deltas between two pose records. Infinity when a bone is missing or a shape differs. */
export function comparePoses(a, b) {
  let bone = 0;
  let worstBone = null;
  const names = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
  for (const name of names) {
    const p = a.bones[name];
    const q = b.bones[name];
    let d = Infinity;
    if (p && q && p.length === q.length) d = Math.max(...p.map((v, i) => Math.abs(v - q[i])));
    if (d > bone || (d === Infinity && worstBone === null)) { bone = Math.max(bone, d); worstBone = name; }
  }
  const diffs = (x, y) => (x.length === y.length ? x.map((v, i) => Math.abs(v - y[i])) : [Infinity]);
  const rootPosDeltaM = Math.max(...diffs(a.root.position, b.root.position));
  const rootQuatDelta = Math.max(...diffs(a.root.quaternion, b.root.quaternion));
  return { maxAbsBoneDeltaM: bone, worstBone, rootPosDeltaM, rootQuatDelta };
}

/** Case key: body + deck + incline. */
export const caseKey = (c) => `${c.body}|${c.deck}|${c.inclineDeg}`;
