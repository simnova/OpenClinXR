import type { SampleRecord } from "../station-subset.js";

export type StationRoomSampleReport = {
  rooms: { scenarioId: string }[];
  sample: SampleRecord | null;
};

export type SupineStagingSampleReport = {
  rows: { scenarioId: string }[];
  sample: SampleRecord | null;
};

function sortedUnique(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

function findDuplicate(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * F2: in-process cache identity — "full" or `sample:seed:sorted-sample-ids` (prefix keeps a seed named "explicit" apart from explicit keys, Codex r3 F1).
 * A call reuses a cached or in-flight report only when its key equals the call's key.
 */
export function selectionCacheKey(sample: SampleRecord | null): string {
  if (sample === null) return "full";
  return `sample:${sample.seed}:${[...sample.ids].sort().join(",")}`;
}

/**
 * R3-F1: an explicit scenarioIds call gets its own key, distinct from "full"
 * and from any seed key. Sorted so id order never matters.
 */
export function explicitSelectionCacheKey(scenarioIds: string[]): string {
  return `explicit:${[...scenarioIds].sort().join(",")}`;
}

/**
 * F3: sampled disk reuse — accept a *.sampled.json only when its recorded sample
 * matches the request exactly (seed plus sorted sample ids) AND the measured rows
 * cover every requested id. Claimed ids never substitute for measured rows.
 */
export function isUsableSampledDiskReport(input: {
  reportSample: SampleRecord | null;
  measuredScenarioIds: string[];
  requestedSeed: string;
  requestedSampleIds: string[];
  neededIds: string[];
}): boolean {
  const { reportSample, measuredScenarioIds, requestedSeed, requestedSampleIds, neededIds } = input;
  if (reportSample === null) return false;
  if (reportSample.seed !== requestedSeed) return false;
  if ([...reportSample.ids].sort().join(",") !== [...requestedSampleIds].sort().join(",")) {
    return false;
  }
  const measured = new Set(measuredScenarioIds);
  return neededIds.every((id) => measured.has(id));
}

/**
 * S3/CW3 shared gate for station-room-not-empty.
 * Full (sample null): today's floor verbatim — more than `fullMin` rooms.
 * Sampled: the set of room scenarioIds equals sample.ids, and is non-empty.
 * Throws with a naming message on any violation.
 */
export function assertStationRoomSampleCoverage(
  report: StationRoomSampleReport,
  fullMin = 3,
): void {
  if (report.sample === null) {
    if (report.rooms.length <= fullMin) {
      throw new Error(
        `station-room-not-empty: no station was evaluated (rooms=${report.rooms.length}, need more than ${fullMin} for a full run)`,
      );
    }
    return;
  }
  if (report.rooms.length === 0) {
    throw new Error(
      `station-room-not-empty: sampled run measured no rooms (sample [${report.sample.ids.join(",")}])`,
    );
  }
  // F4: an empty sample and duplicate ids are planting-shaped, never valid.
  if (report.sample.ids.length === 0) {
    throw new Error(
      `station-room-not-empty: sampled run recorded an empty sample (seed=${report.sample.seed})`,
    );
  }
  const dupSample = findDuplicate(report.sample.ids);
  if (dupSample !== null) {
    throw new Error(
      `station-room-not-empty: duplicate station ${dupSample} in sample [${report.sample.ids.join(",")}]`,
    );
  }
  const roomIdList = report.rooms.map((r) => r.scenarioId);
  const dupRoom = findDuplicate(roomIdList);
  if (dupRoom !== null) {
    throw new Error(
      `station-room-not-empty: duplicate station ${dupRoom} in sampled rooms [${roomIdList.join(",")}]`,
    );
  }
  if (roomIdList.length !== report.sample.ids.length) {
    throw new Error(
      `station-room-not-empty: sampled rooms [${[...roomIdList].sort().join(",")}] count ${roomIdList.length} != sample [${[...report.sample.ids].sort().join(",")}] count ${report.sample.ids.length}`,
    );
  }
  const roomIds = sortedUnique(roomIdList);
  const expected = sortedUnique(report.sample.ids);
  if (roomIds.join(",") !== expected.join(",")) {
    const missing = expected.filter((id) => !roomIds.includes(id));
    const extra = roomIds.filter((id) => !expected.includes(id));
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(",")}`);
    if (extra.length > 0) parts.push(`extra ${extra.join(",")}`);
    throw new Error(
      `station-room-not-empty: sampled rooms [${roomIds.join(",")}] != sample [${expected.join(",")}] (${parts.join("; ")})`,
    );
  }
}

/** The union a sampled supine run must measure (sample ids plus always-kept targets). */
export function supineSampleExpectedIds(sampleIds: string[], targets: string[]): string[] {
  return sortedUnique([...sampleIds, ...targets]);
}

/**
 * Generic sampled-coverage gate for instruments whose report carries
 * `sample: SampleRecord | null` but whose rows are not room/supine rows.
 * Full (sample null) is the caller's own floor; sampled requires the measured
 * set to equal sample.ids ∪ targets (set equality). Throws naming violations.
 */
export function assertSampledStationCoverage(input: {
  instrument: string;
  measuredScenarioIds: string[];
  sample: SampleRecord;
  targets: string[];
}): void {
  const { instrument, measuredScenarioIds, sample, targets } = input;
  const expected = supineSampleExpectedIds(sample.ids, targets);
  if (measuredScenarioIds.length === 0) {
    throw new Error(
      `${instrument}: sampled run measured no stations (sample [${sample.ids.join(",")}])`,
    );
  }
  // F4: an empty sample and duplicate ids are planting-shaped, never valid.
  if (sample.ids.length === 0) {
    throw new Error(
      `${instrument}: sampled run recorded an empty sample (seed=${sample.seed})`,
    );
  }
  const dupSample = findDuplicate(sample.ids);
  if (dupSample !== null) {
    throw new Error(
      `${instrument}: duplicate station ${dupSample} in sample [${sample.ids.join(",")}]`,
    );
  }
  const dupMeasured = findDuplicate(measuredScenarioIds);
  if (dupMeasured !== null) {
    throw new Error(
      `${instrument}: duplicate station ${dupMeasured} in sampled stations [${measuredScenarioIds.join(",")}]`,
    );
  }
  if (measuredScenarioIds.length !== expected.length) {
    throw new Error(
      `${instrument}: sampled stations [${[...measuredScenarioIds].sort().join(",")}] count ${measuredScenarioIds.length} != sample ∪ targets [${expected.join(",")}] count ${expected.length}`,
    );
  }
  const measured = sortedUnique(measuredScenarioIds);
  if (measured.join(",") !== expected.join(",")) {
    const missing = expected.filter((id) => !measured.includes(id));
    const extra = measured.filter((id) => !expected.includes(id));
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(",")}`);
    if (extra.length > 0) parts.push(`extra ${extra.join(",")}`);
    throw new Error(
      `${instrument}: sampled stations [${measured.join(",")}] != sample ∪ targets [${expected.join(",")}] (${parts.join("; ")})`,
    );
  }
}

/**
 * S4/CW3 shared gate for inpatient-supine-staging.
 * Full (sample null): today's floor verbatim — at least `fullMin` rows.
 * Sampled: the set of row scenarioIds equals sample.ids ∪ targets (set equality).
 * Throws with a naming message on any violation.
 */
export function assertSupineStagingSampleCoverage(
  report: SupineStagingSampleReport,
  targets: string[],
  fullMin = 14,
): void {
  if (report.sample === null) {
    if (report.rows.length < fullMin) {
      throw new Error(
        `inpatient-supine-staging: fewer stations enumerated than the bank ships (rows=${report.rows.length}, need >= ${fullMin} for a full run)`,
      );
    }
    return;
  }
  const expected = supineSampleExpectedIds(report.sample.ids, targets);
  if (report.rows.length === 0) {
    throw new Error(
      `inpatient-supine-staging: sampled run measured no rows (sample [${report.sample.ids.join(",")}] targets [${targets.join(",")}])`,
    );
  }
  // F4: an empty sample and duplicate ids are planting-shaped, never valid.
  if (report.sample.ids.length === 0) {
    throw new Error(
      `inpatient-supine-staging: sampled run recorded an empty sample (seed=${report.sample.seed})`,
    );
  }
  const dupSample = findDuplicate(report.sample.ids);
  if (dupSample !== null) {
    throw new Error(
      `inpatient-supine-staging: duplicate station ${dupSample} in sample [${report.sample.ids.join(",")}]`,
    );
  }
  const rowIdList = report.rows.map((r) => r.scenarioId);
  const dupRow = findDuplicate(rowIdList);
  if (dupRow !== null) {
    throw new Error(
      `inpatient-supine-staging: duplicate station ${dupRow} in sampled rows [${rowIdList.join(",")}]`,
    );
  }
  if (rowIdList.length !== expected.length) {
    throw new Error(
      `inpatient-supine-staging: sampled rows [${[...rowIdList].sort().join(",")}] count ${rowIdList.length} != sample ∪ targets [${expected.join(",")}] count ${expected.length}`,
    );
  }
  const rowIds = sortedUnique(rowIdList);
  if (rowIds.join(",") !== expected.join(",")) {
    const missing = expected.filter((id) => !rowIds.includes(id));
    const extra = rowIds.filter((id) => !expected.includes(id));
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(",")}`);
    if (extra.length > 0) parts.push(`extra ${extra.join(",")}`);
    throw new Error(
      `inpatient-supine-staging: sampled rows [${rowIds.join(",")}] != sample ∪ targets [${expected.join(",")}] (${parts.join("; ")})`,
    );
  }
}
