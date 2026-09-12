import type {
  ReplayableAttemptManifest,
  ReplayableAttemptManifestBreak,
  ReplayableAttemptManifestStation,
} from "./types.js";

export type ReconstructedAttemptStationSegment = {
  kind: "station";
  stationOrder: number;
  slotId: string;
  stationRunId: string;
  admittedPhaseRefs: ReplayableAttemptManifestStation["admittedPhaseRefs"];
  learnerEventTraceRef: string;
  reviewPacketRef: string;
};

export type ReconstructedAttemptBreakSegment = {
  kind: "break";
  afterStationOrder: number;
  durationSeconds: number;
  started: ReplayableAttemptManifestBreak["started"];
  ended: ReplayableAttemptManifestBreak["ended"];
};

export type ReconstructedAttemptSegment =
  | ReconstructedAttemptStationSegment
  | ReconstructedAttemptBreakSegment;

/**
 * Rebuilds the ordered attempt (stations and intervening breaks) from a sealed
 * manifest value alone. Callers must not pass a live run, session, or store.
 */
export function reconstructOrderedAttemptSegmentsFromManifest(
  manifest: ReplayableAttemptManifest,
): readonly ReconstructedAttemptSegment[] {
  const remainingBreaks = [...manifest.breaks];
  const segments: ReconstructedAttemptSegment[] = [];

  for (const station of manifest.stations) {
    segments.push({
      kind: "station",
      stationOrder: station.stationOrder,
      slotId: station.slotId,
      stationRunId: station.stationRunId,
      admittedPhaseRefs: station.admittedPhaseRefs,
      learnerEventTraceRef: station.learnerEventTraceRef,
      reviewPacketRef: station.reviewPacketRef,
    });

    const breakIndex = remainingBreaks.findIndex(
      (entry) => entry.afterStationOrder === station.stationOrder,
    );
    if (breakIndex < 0) {
      continue;
    }
    const [brk] = remainingBreaks.splice(breakIndex, 1);
    if (!brk) {
      continue;
    }
    segments.push({
      kind: "break",
      afterStationOrder: brk.afterStationOrder,
      durationSeconds: brk.durationSeconds,
      started: brk.started,
      ended: brk.ended,
    });
  }

  if (remainingBreaks.length > 0) {
    throw new Error("attempt manifest break is not positioned after a station in station order");
  }
  return segments;
}
