import type { Group, Object3D } from "three";
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";

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
 * Head-local offset. Jaw sits at head-local ~(0, 0.006, 0.017) on this MPFB
 * rig. Palate/cavity is slightly above and behind that. Do not worldToLocal a
 * world metre-point: a stale head.matrixWorld turns (0,1.575,0.055) into a
 * cheek/chin slab (named + WORLD_PLACE recaptures 2026-09-20).
 */
const HEAD_LOCAL = new Vector3(0, 0.008, 0.01);

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
  card.position.copy(HEAD_LOCAL);
  return card;
}

export function applyInnerMouthCavity(root: Group, openness: number): void {
  const head = findHeadBone(root);
  if (head === null) return;
  const card = ensureCard(root, head);
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  const named = namedJawDrive(root);
  const namedRadians = typeof named?.jawOpenRadians === "number" ? named.jawOpenRadians : 0;
  card.visible = namedRadians > NAMED_JAW_VISIBLE || clamped > OPEN_VISIBLE;
}
