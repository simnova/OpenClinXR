import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const COLLECTOR_SOURCE_FILE =
  "tools/openclinxr/evidence/viseme-drive/epoch-profile-evidence.ts";

type Peaks = Record<string, number>;

export type VisemeProfileEvidence = {
  actorId: string;
  meshName: string;
  subjectAssetPath: string;
  subjectAssetSha256: string;
  dictKeysSha256: string;
  targetCount: number;
  activeEpochSampleCount: number;
  inactiveEpochSampleCount: number;
  ownerMismatchCount: number;
  completedEpochCount: number;
  prematureEpochClearCount: number;
  activeMorphPeaks: Peaks;
  inactiveMorphPeaks: Peaks;
  sourceFile: string;
  sourceSha256: string;
  collectorSourceFile?: string;
  collectorSourceSha256?: string;
};

type Authority = {
  actorId: string;
  meshName: string;
  subjectAssetPath: string;
  subjectAssetSha256: string;
  dictKeysSha256: string;
  targetCount: number;
  expectedActivePeaks: Peaks;
  expectedInactiveAAAndTH: number;
  sourceFile: string;
  sourceSha256: string;
};

function fail(field: string, msg: string): never {
  throw new Error(`visemeProfileEvidence.${field}: ${msg}`);
}

function num(ev: Record<string, unknown>, field: string): number {
  const v = ev[field];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(field, "must be a finite number");
  return v as number;
}

export function assertNaturalVisemeProfile(ev: unknown, authority: unknown, repoRoot: string): void {
  if (typeof ev !== "object" || ev === null) fail("evidence", "must be an object");
  if (typeof authority !== "object" || authority === null) fail("authority", "must be an object");
  const e = ev as Record<string, unknown>;
  const a = authority as Authority;
  const str = (o: Record<string, unknown>, f: string): string => {
    const v = o[f];
    if (typeof v !== "string" || v.length === 0) fail(f, "must be a non-empty string");
    return v as string;
  };
  if (str(e, "actorId") !== a.actorId) fail("actorId", `must match authority ${a.actorId}`);
  if (str(e, "meshName") !== a.meshName) fail("meshName", `must match authority ${a.meshName}`);
  if (str(e, "subjectAssetPath") !== a.subjectAssetPath) fail("subjectAssetPath", "must match authority");
  if (str(e, "subjectAssetSha256") !== a.subjectAssetSha256)
    fail("subjectAssetSha256", "must match authority asset hash");
  if (str(e, "dictKeysSha256") !== a.dictKeysSha256)
    fail("dictKeysSha256", "must match authority dictionary hash");
  if (num(e, "targetCount") !== a.targetCount) fail("targetCount", `must equal ${a.targetCount}`);
  // Evidence record binding: the recorded measurement must name the authority driver.
  if (str(e, "sourceFile") !== a.sourceFile)
    fail("sourceFile", "evidence driver path must match authority");
  if (str(e, "sourceSha256") !== a.sourceSha256)
    fail("sourceSha256", "evidence driver hash must match authority");
  // Driver hash: read actual source file bytes from the live tree.
  const driverPath = join(repoRoot, a.sourceFile);
  if (!existsSync(driverPath)) fail("sourceFile", `missing live driver ${a.sourceFile}`);
  const actualDriverSha = createHash("sha256").update(readFileSync(driverPath)).digest("hex");
  if (actualDriverSha !== a.sourceSha256)
    fail("sourceSha256", "live driver bytes do not match authority hash");
  const ap = e["activeMorphPeaks"];
  const ip = e["inactiveMorphPeaks"];
  if (typeof ap !== "object" || ap === null) fail("activeMorphPeaks", "must be an object");
  if (typeof ip !== "object" || ip === null) fail("inactiveMorphPeaks", "must be an object");
  const active = ap as Peaks;
  const inactive = ip as Peaks;
  const close = (v: unknown, want: number): boolean =>
    typeof v === "number" && Math.abs(v - want) < 0.005;
  if (!close(active["viseme_sil"], a.expectedActivePeaks["viseme_sil"]))
    fail("activeMorphPeaks.viseme_sil", "must be 0.5");
  if (!close(active["viseme_aa"], a.expectedActivePeaks["viseme_aa"]))
    fail("activeMorphPeaks.viseme_aa", "must be 0.5");
  if (!close(active["viseme_TH"], a.expectedActivePeaks["viseme_TH"]))
    fail("activeMorphPeaks.viseme_TH", "must be 1");
  if (!close(inactive["viseme_aa"] ?? a.expectedInactiveAAAndTH, a.expectedInactiveAAAndTH))
    fail("inactiveMorphPeaks.viseme_aa", "inactive AA must be 0");
  if (!close(inactive["viseme_TH"] ?? a.expectedInactiveAAAndTH, a.expectedInactiveAAAndTH))
    fail("inactiveMorphPeaks.viseme_TH", "inactive TH must be 0");
  if (num(e, "activeEpochSampleCount") <= 0) fail("activeEpochSampleCount", "must be > 0");
  if (num(e, "inactiveEpochSampleCount") <= 0) fail("inactiveEpochSampleCount", "must be > 0");
  if (num(e, "ownerMismatchCount") !== 0) fail("ownerMismatchCount", "must be 0");
  if (num(e, "completedEpochCount") < 1) fail("completedEpochCount", "needs observed completion >= 1");
  if (num(e, "prematureEpochClearCount") !== 0) fail("prematureEpochClearCount", "must be 0");
  // Collector binding.
  if (e["collectorSourceFile"] !== COLLECTOR_SOURCE_FILE)
    fail("collectorSourceFile", `must be ${COLLECTOR_SOURCE_FILE}`);
  const csha = e["collectorSourceSha256"];
  if (typeof csha !== "string" || !/^[0-9a-f]{64}$/.test(csha))
    fail("collectorSourceSha256", "must be a full sha256 hex");
  const collectorPath = join(repoRoot, COLLECTOR_SOURCE_FILE);
  if (!existsSync(collectorPath)) fail("collectorSourceFile", "collector file missing in live tree");
  const liveCollectorSha = createHash("sha256").update(readFileSync(collectorPath)).digest("hex");
  if (csha !== liveCollectorSha) fail("collectorSourceSha256", "must equal live collector bytes");
}
