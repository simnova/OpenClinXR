/**
 * Freshness gate for the committed measured-geometry artifact (#707).
 *
 * `measured-station-geometry.json` carries per-source fingerprints (geometrySha256, with
 * legacy bytes + sha256 still honored when a row carries them) recorded when the generator measured the triangle counts. Nothing
 * re-derives them, so a rebake can change the GLB bytes and leave the numbers
 * while every readiness verdict keeps citing the stale counts (#699 -> #700 ->
 * #705 -> this card).
 *
 * #705's constraint decides the shape: `scenario-runtime` consumes the registry
 * and has no filesystem dependency, so it cannot stat a file let alone hash
 * one. Consumers keep trusting the artifact; this gate is what makes that trust
 * earned. Fail-closed: a missing fingerprint, a missing file, or any mismatch
 * in the recorded size or hash reports the assetId.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { glbGeometryDigest } from "@openclinxr/factory-station-core/runner";

export type MeasuredGeometryFingerprint = {
  bytes?: number;
  sha256?: string;
  geometrySha256?: string;
};

/**
 * Returns the assetIds in `doc.sources` whose recorded fingerprint disagrees
 * with the file on disk. An artifact that records nothing can never be
 * verified, so a missing or empty fingerprint reports the assetId rather than
 * silently passing — that is the same lie one layer along.
 */
export function findStaleMeasuredGeometry(doc: unknown, repoRoot: string): string[] {
  const sources = (doc as { sources?: Record<string, unknown> } | undefined)?.sources ?? {};
  const fingerprints = (doc as { fingerprints?: Record<string, MeasuredGeometryFingerprint> } | undefined)
    ?.fingerprints ?? {};

  const stale: string[] = [];
  for (const [assetId, rel] of Object.entries(sources)) {
    if (typeof rel !== "string" || rel.length === 0) {
      stale.push(assetId);
      continue;
    }
    const fp = fingerprints[assetId];
    if (
      !fp ||
      typeof fp !== "object" ||
      (fp.bytes === undefined && fp.sha256 === undefined && fp.geometrySha256 === undefined)
    ) {
      stale.push(assetId);
      continue;
    }
    const abs = join(repoRoot, rel);
    let bytes: Buffer;
    try {
      if (!existsSync(abs)) throw new Error(`missing ${abs}`);
      bytes = readFileSync(abs);
    } catch {
      stale.push(assetId);
      continue;
    }
    if (fp.bytes !== undefined && fp.bytes !== bytes.length) {
      stale.push(assetId);
      continue;
    }
    if (fp.sha256 !== undefined && fp.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
      stale.push(assetId);
      continue;
    }
    if (fp.geometrySha256 !== undefined && !geometryMatches(bytes, fp.geometrySha256)) {
      stale.push(assetId);
    }
  }
  return stale;
}

/**
 * Geometry-pin comparison: a material-only post-export stage (new images, edited material
 * fields, zero vertex bytes changed) keeps the digest, so only a real geometry change —
 * rebake, vertex edit, re-index — reports the assetId. Unparseable bytes fail closed.
 */
function geometryMatches(bytes: Buffer, geometrySha256: string): boolean {
  let digest: string;
  try {
    digest = glbGeometryDigest(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return false;
  }
  return digest === geometrySha256;
}

/**
 * Returns the measured triangle counts whose fingerprint still matches the file on disk — the
 * counts the verdict may cite (#711). A stale, missing, or fingerprint-less assetId is dropped so
 * `evaluateScenarioAssetBudget` fires #700's typed `station_triangle_measurements_incomplete`
 * instead of blending the stale number with declared maxima.
 */
export function freshMeasuredTriangleCounts(doc: unknown, repoRoot: string): Record<string, number> {
  const stale = new Set(findStaleMeasuredGeometry(doc, repoRoot));
  const sources = (doc as { sources?: Record<string, unknown> } | undefined)?.sources ?? {};
  const triangles = (doc as { triangles?: Record<string, number> } | undefined)?.triangles ?? {};
  const fresh: Record<string, number> = {};
  for (const [assetId, count] of Object.entries(triangles)) {
    if (typeof count !== "number" || !Number.isFinite(count) || stale.has(assetId)) continue;
    if (!Object.hasOwn(sources, assetId)) continue;
    const rel = (sources as Record<string, unknown>)[assetId];
    if (typeof rel !== "string" || rel.length === 0) continue;
    fresh[assetId] = count;
  }
  return fresh;
}
