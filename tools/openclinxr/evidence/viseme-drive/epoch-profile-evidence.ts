/**
 * source152 — owned-epoch viseme profile + expiry summary (collector pairing fix + source seal).
 *
 * Fix vs source148: pair each epoch's last owned row ONLY with the next immediate
 * applicable row. If that row carries a different owned epoch/owner, the old epoch was
 * replaced/interrupted — preserve partial/unknown, never scan past it to claim completion.
 * Absence must be same selected mesh/actor with finite clock plus the new
 * clock-root identity (ownedClockRootActorId); legacy epoch root may be null.
 */

export type RawTimelineRow = {
  t: number;
  meshName: string;
  nonZeroVisemes: Array<{ targetName: string; influence: number; index: number; meshName: string }>;
  diagSameInstant?: Record<string, unknown> | null;
};

export type VisemeProfileEvidence = {
  actorId: string;
  meshName: string;
  subjectAssetPath: string;
  subjectAssetSha256: string;
  dictKeysSha256: string;
  targetCount: number;
  sourceFile: string;
  sourceSha256: string;
  collectorSourceFile: string;
  collectorSourceSha256: string;
  activeEpochSampleCount: number;
  inactiveEpochSampleCount: number;
  ownerMismatchCount: number;
  completedEpochCount: number;
  prematureEpochClearCount: number;
  activeMorphPeaks: Record<string, number>;
  inactiveMorphPeaks: Record<string, number>;
};

type OwnedEpoch = {
  actorId?: unknown;
  speechActorId?: unknown;
  startedAtMs?: unknown;
  durationMs?: unknown;
};

function epochDictOf(diag: Record<string, unknown>): OwnedEpoch | null {
  const raw = diag["ownedSpeechEpoch"];
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as OwnedEpoch;
}

function isFiniteDuration(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0;
}

function isFiniteStart(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isFinite(ms);
}

export function buildVisemeProfileEvidence(args: {
  rows: RawTimelineRow[];
  expectedOwnerActorId: string;
  expectedMeshName: string;
  actorId: string;
  meshName: string;
  subjectAssetPath: string;
  subjectAssetSha256: string;
  dictKeysSha256: string;
  targetCount: number;
  sourceFile: string;
  sourceSha256: string;
  collectorSourceFile: string;
  collectorSourceSha256: string;
}): VisemeProfileEvidence {
  const {
    rows, expectedOwnerActorId, expectedMeshName, actorId, meshName,
    subjectAssetPath, subjectAssetSha256, dictKeysSha256, targetCount,
    sourceFile, sourceSha256, collectorSourceFile, collectorSourceSha256,
  } = args;
  let activeEpochSampleCount = 0;
  let inactiveEpochSampleCount = 0;
  let ownerMismatchCount = 0;
  const activeMorphPeaks: Record<string, number> = {};
  const inactiveMorphPeaks: Record<string, number> = {};
  const trackPeak = (bucket: Record<string, number>, name: string, influence: number): void => {
    if (typeof influence !== "number" || !Number.isFinite(influence)) return;
    const prev = bucket[name];
    if (prev === undefined || influence > prev) bucket[name] = influence;
  };
  const epochKeyOf = (epoch: OwnedEpoch): string =>
    `${String(epoch.startedAtMs)}|${String(epoch.durationMs)}|${String(epoch.actorId)}|${String(epoch.speechActorId)}`;
  const lastOwnedIndexByEpoch = new Map<string, number>();
  const epochByKey = new Map<string, OwnedEpoch>();
  rows.forEach((row, index) => {
    const diag = (row.diagSameInstant ?? null) as Record<string, unknown> | null;
    const epoch = diag === null ? null : epochDictOf(diag);
    const ownedEpochClockMs = diag === null ? null : (diag["ownedEpochClockMs"] as unknown);
    const rootActor = diag === null ? null : diag["ownedEpochRootActorId"];
    const clockRootActor = diag === null ? null : diag["ownedClockRootActorId"];
    const selectedMeshActor = diag === null ? null : diag["meshActorId"];
    const owned =
      epoch !== null
      && epoch.actorId === expectedOwnerActorId
      && epoch.speechActorId === expectedOwnerActorId
      && selectedMeshActor === expectedOwnerActorId
      && rootActor === expectedOwnerActorId
      && clockRootActor === expectedOwnerActorId
      && row.meshName === expectedMeshName
      && isFiniteStart(epoch.startedAtMs)
      && isFiniteDuration(epoch.durationMs)
      && typeof ownedEpochClockMs === "number"
      && Number.isFinite(ownedEpochClockMs)
      && ownedEpochClockMs >= (epoch.startedAtMs as number)
      && ownedEpochClockMs < (epoch.startedAtMs as number) + (epoch.durationMs as number);
    if (owned && epoch !== null) {
      activeEpochSampleCount += 1;
      for (const w of row.nonZeroVisemes) trackPeak(activeMorphPeaks, w.targetName, w.influence);
      // Count ALL positive divergences among actual owner fields on owned-branch rows.
      if (rootActor !== expectedOwnerActorId) ownerMismatchCount += 1;
      const key = epochKeyOf(epoch);
      lastOwnedIndexByEpoch.set(key, index);
      epochByKey.set(key, epoch);
    } else if (epoch === null) {
      // Inactive only when the owned epoch is absent AND the selected mesh/actor match;
      // weights come from actual measured arrays only.
      if (
        selectedMeshActor === expectedOwnerActorId
        && row.meshName === expectedMeshName
      ) {
        inactiveEpochSampleCount += 1;
        for (const w of row.nonZeroVisemes) trackPeak(inactiveMorphPeaks, w.targetName, w.influence);
      }
      // Mismatched samples (foreign mesh/actor) are excluded, never counted.
    } else {
      // Positive epoch present but not owned: count every owner-field divergence.
      if (epoch.actorId !== expectedOwnerActorId) ownerMismatchCount += 1;
      if (epoch.speechActorId !== expectedOwnerActorId) ownerMismatchCount += 1;
      if (selectedMeshActor !== expectedOwnerActorId) ownerMismatchCount += 1;
      if (rootActor !== expectedOwnerActorId) ownerMismatchCount += 1;
      if ((diag as Record<string, unknown>)["ownedClockRootActorId"] !== expectedOwnerActorId) ownerMismatchCount += 1;
      if (row.meshName !== expectedMeshName) ownerMismatchCount += 1;
    }
  });
  // Expiry pairing: last owned row -> NEXT IMMEDIATE applicable row only.
  // A different owned epoch/owner there means replaced/interrupted: no completion claim.
  // A frame pass ending owned is unobserved/partial, never completion.
  let completedEpochCount = 0;
  let prematureEpochClearCount = 0;
  for (const [key, ownedIndex] of lastOwnedIndexByEpoch) {
    const epoch = epochByKey.get(key);
    if (epoch === undefined) continue;
    const nextIndex = ownedIndex + 1;
    if (nextIndex >= rows.length) continue; // ends owned: partial/unknown
    const nextRow = rows[nextIndex];
    const nextDiag = (nextRow.diagSameInstant ?? null) as Record<string, unknown> | null;
    if (nextDiag === null) continue; // no signal: preserve partial/unknown
    const nextEpoch = epochDictOf(nextDiag);
    if (nextEpoch !== null) continue; // replaced by another epoch: not completion
    // Absent epoch: require same selected mesh/actor, finite clock, and the NEW
    // clock-root identity (ownedClockRootActorId from the same cud that stamped
    // the clock). The legacy epoch root may legitimately be null (actual 141 raw).
    // Missing clock-root identity means completion UNKNOWN: never invent an owner.
    const nextMeshActor = nextDiag["meshActorId"];
    const nextClockRoot = nextDiag["ownedClockRootActorId"];
    const nextClock = nextDiag["ownedEpochClockMs"] as unknown;
    if (
      nextMeshActor !== expectedOwnerActorId
      || nextClockRoot !== expectedOwnerActorId
      || nextRow.meshName !== expectedMeshName
      || typeof nextClock !== "number"
      || !Number.isFinite(nextClock)
    ) continue; // foreign/missing clock identity or no clock: does not prove completion
    const declaredEnd = (epoch.startedAtMs as number) + (epoch.durationMs as number);
    if (nextClock >= declaredEnd) completedEpochCount += 1;
    else prematureEpochClearCount += 1;
  }
  return {
    actorId, meshName, subjectAssetPath, subjectAssetSha256, dictKeysSha256, targetCount,
    sourceFile, sourceSha256, collectorSourceFile, collectorSourceSha256,
    activeEpochSampleCount, inactiveEpochSampleCount, ownerMismatchCount,
    completedEpochCount, prematureEpochClearCount, activeMorphPeaks, inactiveMorphPeaks,
  };
}
