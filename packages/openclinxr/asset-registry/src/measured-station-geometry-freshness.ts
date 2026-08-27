/**
 * Freshness gate for the committed measured-geometry artifact (#707).
 *
 * `measured-station-geometry.json` carries per-source fingerprints (bytes +
 * sha256) recorded when the generator measured the triangle counts. Nothing
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

export type MeasuredGeometryFingerprint = {
  bytes?: number;
  sha256?: string;
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
    if (!fp || typeof fp !== "object" || (fp.bytes === undefined && fp.sha256 === undefined)) {
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
    }
  }
  return stale;
}
