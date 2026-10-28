/**
 * predicate-reference.ts — loader for the frozen versioned reference geometry.
 *
 * The predicate's KNOWN_GOOD_ROOMS calibration (room_extract_predicate.py) is
 * versioned: ED sha bc5db832… (commit b27f423b1) and peds sha 731fed25…
 * (commit 719cadf82). The live published GLBs have since been re-finished
 * (Oct1 fleet regen: doorway threshold tab, 2.65 m ceilings), so live bytes
 * no longer reproduce the Aug28 numbers exactly — but still PASS the
 * unchanged gate. These frozen geometry-only payloads preserve the TRUE
 * historical world triangles (via dumpRoomGeometryPayload on readonly
 * git cat-file temp inputs) so CI rederives the original calibration
 * without storing texture MB or requiring git objects at runtime.
 */
import { readFileSync } from "node:fs";

export type PredicateReferenceSource = {
  file: string;
  commit: string;
  gitBlobSha: string;
  rawGlbSha256: string;
  room: string;
  extractor: string;
  note: string;
};

export type PredicateReferencePayload = {
  room: string;
  parts: Record<string, [number, number, number][][]>;
};

export type PredicateReference = {
  source: PredicateReferenceSource;
  payload: PredicateReferencePayload;
};

export function loadPredicateReference(absPath: string): PredicateReference {
  const raw = readFileSync(absPath, "utf8");
  const ref = JSON.parse(raw) as PredicateReference;
  if (!ref.source || !ref.payload || !ref.payload.parts) {
    throw new Error(`malformed predicate reference: ${absPath}`);
  }
  if (typeof ref.source.rawGlbSha256 !== "string" || ref.source.rawGlbSha256.length !== 64) {
    throw new Error(`reference source SHA must be a full 64-char sha256: ${absPath}`);
  }
  return ref;
}
