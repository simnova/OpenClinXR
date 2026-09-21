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
 * Head-local from speech-emotion-video probe 2026-09-20 frame 189 (viseme_aa).
 * Y/Z from the upper-teeth placement that first put 0xb34752 in the hole.
 * x=-0.018 worlded through the left cheek (hlx recapture). x=0 keeps the
 * fill inside the opening (hl0). (0,0,0.045) was 6 cm too high. Mid-Y AABB
 * sat on the chin. Live AABB mid-X painted the right of the opening.
 */
const HEAD_LOCAL = new Vector3(0, -0.039, 0.055);

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
    new BoxGeometry(0.048, 0.026, 0.028),
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
  card.position.copy(HEAD_LOCAL);
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  const named = namedJawDrive(root);
  const namedRadians = typeof named?.jawOpenRadians === "number" ? named.jawOpenRadians : 0;
  card.visible = namedRadians > NAMED_JAW_VISIBLE || clamped > OPEN_VISIBLE;
}
