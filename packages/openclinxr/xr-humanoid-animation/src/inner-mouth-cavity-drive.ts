import type { Group, Object3D } from "three";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";

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
 * Fallback when no teeth mesh exists. Measured 2026-09-20 speech-emotion-video
 * frame 189 (viseme_aa): teeth back-center in head local is (0.016, -0.061, 0.065).
 * Constant (0, 0, 0.045) sat 6 cm above the teeth and inside the skull (0 px vs pink).
 */
const HEAD_LOCAL = new Vector3(0, -0.061, 0.065);
const TEETH_BACK_INSET = 0.008;

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

function teethBackInHead(root: Group, head: Object3D): Vector3 | null {
  const box = new Box3();
  let found = false;
  root.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    if (!/teeth/i.test(object.name)) return;
    box.expandByObject(object);
    found = true;
  });
  if (!found || box.isEmpty()) return null;
  const world = new Vector3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    box.min.z + TEETH_BACK_INSET,
  );
  return head.worldToLocal(world);
}

function ensureCard(root: Group, head: Object3D): Mesh {
  const existing = root.getObjectByName(CARD_NAME);
  if (existing instanceof Mesh) return existing;
  const card = new Mesh(
    new BoxGeometry(0.036, 0.02, 0.024),
    new MeshBasicMaterial({ color: 0xb34752 }),
  );
  card.name = CARD_NAME;
  card.frustumCulled = false;
  head.add(card);
  return card;
}

export function applyInnerMouthCavity(root: Group, openness: number): void {
  const head = findHeadBone(root);
  if (head === null) return;
  const card = ensureCard(root, head);
  root.updateMatrixWorld(true);
  const local = teethBackInHead(root, head);
  card.position.copy(local ?? HEAD_LOCAL);
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  const named = namedJawDrive(root);
  const namedRadians = typeof named?.jawOpenRadians === "number" ? named.jawOpenRadians : 0;
  card.visible = namedRadians > NAMED_JAW_VISIBLE || clamped > OPEN_VISIBLE;
}
