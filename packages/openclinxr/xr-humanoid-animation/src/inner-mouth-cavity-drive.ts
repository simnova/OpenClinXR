import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import type { Group } from "three";

/**
 * Unlit cavity card behind the teeth, parented to `head`.
 *
 * Lip-sync review: viseme_aa=1 and mouth-open=1 still left parent lips sealed
 * (f6c7d15d8); jaw-bone drive is what opens the scratch-nurse aa crop. The open
 * mouth then shows a dark hole because no palate/gums mesh exists and inner
 * faces are unlit. MeshBasicMaterial is the same unlit fill the viseme map
 * already uses for honest closed/open tokens (Rhubarb D=AA wide open).
 *
 * Visible only when openness > 0.35 so PP/sil stay sealed.
 * notEvidenceFor: anatomical palate, clinical oral exam, shipped-GLB identity.
 */

const CARD_NAME = "openclinxr_inner_mouth_cavity";
const OPEN_VISIBLE = 0.35;
const WORLD_PLACE = new Vector3(0, 1.575, 0.055);

function findHeadBone(root: Group): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (found === null && object.name === "head") found = object;
  });
  return found;
}

function ensureCard(root: Group, head: Object3D): Mesh {
  const existing = root.getObjectByName(CARD_NAME);
  if (existing instanceof Mesh) return existing;
  const card = new Mesh(
    new BoxGeometry(0.048, 0.026, 0.032),
    new MeshBasicMaterial({ color: 0xb34752 }),
  );
  card.name = CARD_NAME;
  card.frustumCulled = false;
  head.add(card);
  head.updateWorldMatrix(true, false);
  card.position.copy(head.worldToLocal(WORLD_PLACE.clone()));
  return card;
}

export function applyInnerMouthCavity(root: Group, openness: number): void {
  const head = findHeadBone(root);
  if (head === null) return;
  const card = ensureCard(root, head);
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  card.visible = clamped > OPEN_VISIBLE;
}
