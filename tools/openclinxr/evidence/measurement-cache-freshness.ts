/**
 * #141 — enumerate cache-reading evidence modules and report tree-stamp posture.
 *
 * Modules are DISCOVERED by scanning `tools/openclinxr/evidence/**` for
 * tryReadArtifact / fromDisk measure-once patterns — not listed by hand.
 *
 * Shared stamp helper: `./lib/measurement-tree-stamp.ts`.
 */

import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  computeMeasurementTreeStamp,
  tryReadStampedArtifact,
  withTreeStamp,
  MEASUREMENT_CACHE_DURATION_HEURISTIC,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";

export { MEASUREMENT_CACHE_DURATION_HEURISTIC };

export type CachingModule = {
  /** Repo-relative path of an evidence module that reads back its own artifact. */
  modulePath: string;
  /** Repo-relative path of the artifact it reads. */
  artifactPath: string;
  /** True when the artifact records the tree state it measured — a sha, or input hashes. */
  recordsTreeStamp: boolean;
  /** True when a stamp that no longer matches causes the cache to be refused or refreshed. */
  refusesStaleStamp: boolean;
  /** True when the module still returns a cached result for an unchanged tree. */
  servesFreshCache: boolean;
};

const EVIDENCE_DIR = "tools/openclinxr/evidence";

type Discovered = {
  modulePath: string;
  artifactPath: string;
  source: string;
};

/**
 * Static discovery: every non-test .ts under tools/openclinxr/evidence that has
 * a tryReadArtifact / fromDisk measure-once path.
 */
export async function discoverCacheReadingEvidenceModules(
  evidenceDir: string = EVIDENCE_DIR,
): Promise<Discovered[]> {
  const names = await readdir(evidenceDir);
  const out: Discovered[] = [];

  for (const name of names) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    // Helper itself is not a cache consumer.
    if (name === "measurement-cache-freshness.ts") continue;
    const modulePath = path.join(evidenceDir, name);
    const source = await readFile(modulePath, "utf8");
    if (!/tryReadArtifact|tryReadStampedArtifact/.test(source)) continue;
    if (!/fromDisk|tryReadStampedArtifact/.test(source)) continue;
    // Must both read and write an artifact (measure-once), not just validate foreign paths.
    if (!/writeFile/.test(source)) continue;

    const artifactPath = resolveArtifactPath(source) ?? `${name.replace(/\.ts$/, "")}/artifact.json`;
    out.push({ modulePath, artifactPath, source });
  }

  out.sort((a, b) => a.modulePath.localeCompare(b.modulePath));
  return out;
}

function resolveArtifactPath(source: string): string | null {
  const dirMatch = source.match(
    /export const \w+(?:_DIR|DIR)\s*=\s*["']([^"']+)["']/,
  );
  if (!dirMatch) return null;
  const dir = dirMatch[1]!;

  const nameConsts = [
    ...source.matchAll(/export const (\w+)\s*=\s*["']([^"']+\.json)["']/g),
  ];
  const preferred = nameConsts.find((m) =>
    /NAME|PRE_FIX|MEASUREMENTS|CONTACT|FLOOR|POSTURE/.test(m[1]!),
  );
  if (preferred) return path.join(dir, preferred[2]!);

  if (/preFixPath|PRE_FIX|pre-fix/.test(source)) {
    return path.join(dir, "pre-fix.json");
  }

  const anyJson = nameConsts.find((m) => m[2]!.endsWith(".json"));
  if (anyJson) return path.join(dir, anyJson[2]!);
  return path.join(dir, "artifact.json");
}

function sourceRecordsTreeStamp(source: string): boolean {
  return (
    /computeMeasurementTreeStamp|withTreeStamp|treeStamp/.test(source)
    && /treeStamp/.test(source)
    && /measurement-tree-stamp/.test(source)
  );
}

function sourceRefusesStaleStamp(source: string): boolean {
  // Must go through the shared reader that compares stamps, or call stampsMatch and refuse.
  return (
    /tryReadStampedArtifact/.test(source)
    || (/stampsMatch/.test(source) && /return null/.test(source))
  );
}

function sourceStillServesCache(source: string): boolean {
  // Still has a disk-serve path (fromDisk or tryReadStampedArtifact returning data).
  // Must not have deleted the cache entirely.
  const hasServePath =
    /tryReadStampedArtifact/.test(source)
    || (/fromDisk/.test(source) && /return fromDisk/.test(source));
  const deletedCache =
    /CACHE_DISABLED|do not cache|cache removed|never read disk/i.test(source);
  return hasServePath && !deletedCache;
}

/**
 * Probe the shared helper: serve when stamp matches, refuse when it does not.
 * Used so per-module flags are not pure source greps of a dead field.
 */
async function probeSharedStampBehaviour(): Promise<{
  servesFresh: boolean;
  refusesStale: boolean;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "ocxr-meas-stamp-"));
  try {
    const current = computeMeasurementTreeStamp();
    const goodPath = path.join(dir, "good.json");
    const stalePath = path.join(dir, "stale.json");

    const goodPayload = withTreeStamp(
      {
        schemaVersion: "openclinxr.measurement-cache-freshness.probe.v1",
        report: { ok: true as const },
      },
      current,
    );
    await writeFile(goodPath, `${JSON.stringify(goodPayload)}\n`, "utf8");

    const staleStamp: MeasurementTreeStamp = {
      head: "0".repeat(40),
      fingerprint: "deadbeef".repeat(8),
      algorithm: current.algorithm,
    };
    const stalePayload = {
      schemaVersion: "openclinxr.measurement-cache-freshness.probe.v1",
      treeStamp: staleStamp,
      report: { ok: true as const },
    };
    await writeFile(stalePath, `${JSON.stringify(stalePayload)}\n`, "utf8");

    const extract = (parsed: Record<string, unknown>) => {
      const report = parsed.report as { ok?: boolean } | undefined;
      if (report?.ok === true) return report;
      return null;
    };

    const good = await tryReadStampedArtifact(goodPath, extract, { currentStamp: current });
    const stale = await tryReadStampedArtifact(stalePath, extract, { currentStamp: current });

    return {
      servesFresh: good !== null && good.ok === true,
      refusesStale: stale === null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Signature consumed by measurement-cache-freshness.test.ts planted contracts.
 */
export async function inspectMeasurementCacheFreshness(): Promise<{
  modules: CachingModule[];
}> {
  const discovered = await discoverCacheReadingEvidenceModules();
  const probe = await probeSharedStampBehaviour();

  const modules: CachingModule[] = discovered.map((d) => {
    const recordsTreeStamp = sourceRecordsTreeStamp(d.source);
    const refusesInSource = sourceRefusesStaleStamp(d.source);
    const stillCaches = sourceStillServesCache(d.source);

    return {
      modulePath: d.modulePath,
      artifactPath: d.artifactPath,
      recordsTreeStamp,
      // Stamp is only "refused" if the module uses the comparing reader AND the helper refuses.
      refusesStaleStamp: recordsTreeStamp && refusesInSource && probe.refusesStale,
      // Cache still serves when the module keeps a serve path AND the helper serves matching stamps.
      servesFreshCache: stillCaches && recordsTreeStamp && probe.servesFresh,
    };
  });

  return { modules };
}
