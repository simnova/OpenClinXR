/**
 * Inspector regions instrument (card W4a-0): pure helpers, no browser, no fs.
 *
 * validateRegions checks one inspector doc (canvasRect, viewport, regions)
 * against the blueprint actor ids and returns blocker ids. blueprintActorLines
 * maps every actorId occurrence in the ed-chest-pain-mod.ts source text to
 * its 1-based line numbers.
 */

export const PATIENT_ACTOR_ID = "patient_robert_hayes_v1";

export const MIN_PATIENT_HEIGHT_FRACTION = 0.1;

export function validateRegions(doc, blueprintActorIds) {
  const blockers = [];
  const canvas = doc?.canvasRect ?? null;
  const viewport = doc?.viewport ?? null;
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const known = new Set(Array.isArray(blueprintActorIds) ? blueprintActorIds : []);

  for (const region of regions) {
    const actorId = region?.actorId;
    const bbox = region?.bbox ?? null;
    const width = Number(bbox?.width);
    const height = Number(bbox?.height);
    if (typeof actorId !== "string" || known.has(actorId) === false) {
      blockers.push(`region_actor_unknown:${String(actorId)}`);
    }
    if (bbox === null || Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0) {
      blockers.push(`region_bbox_zero_area:${String(actorId)}`);
      continue;
    }
    if (canvas !== null && Number.isFinite(canvas.x) && Number.isFinite(canvas.y) && Number.isFinite(canvas.width) && Number.isFinite(canvas.height)) {
      const inside =
        bbox.x >= canvas.x &&
        bbox.y >= canvas.y &&
        bbox.x + bbox.width <= canvas.x + canvas.width &&
        bbox.y + bbox.height <= canvas.y + canvas.height;
      if (inside === false) {
        blockers.push(`region_bbox_outside_canvas:${String(actorId)}`);
      }
    }
  }

  const patient = regions.find((region) => region?.actorId === PATIENT_ACTOR_ID) ?? null;
  if (patient === null) {
    blockers.push("region_patient_missing");
  } else {
    const viewportHeight = Number(viewport?.height);
    const patientHeight = Number(patient?.bbox?.height);
    if (Number.isFinite(viewportHeight) === false || viewportHeight <= 0 || Number.isFinite(patientHeight) === false || patientHeight / viewportHeight < MIN_PATIENT_HEIGHT_FRACTION) {
      blockers.push("region_patient_too_small");
    }
  }

  return blockers;
}

const ACTOR_ID_PATTERN = /actorId:\s*"([^"]+)"/g;

export function blueprintActorLines(sourceText) {
  const linesByActor = new Map();
  const lines = String(sourceText).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    ACTOR_ID_PATTERN.lastIndex = 0;
    let match = ACTOR_ID_PATTERN.exec(text);
    while (match !== null) {
      const actorId = match[1];
      if (linesByActor.has(actorId) === false) {
        linesByActor.set(actorId, []);
      }
      linesByActor.get(actorId).push(index + 1);
      match = ACTOR_ID_PATTERN.exec(text);
    }
  }
  return linesByActor;
}
