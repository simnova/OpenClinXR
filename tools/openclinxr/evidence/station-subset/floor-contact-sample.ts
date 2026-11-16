import type { SampleRecord } from "../station-subset.js";

export type FloorContactSampleReport = {
  scenarios: string[];
  actors: { scenarioId: string }[];
  sample: SampleRecord | null;
};

/**
 * S1/S4 shared coverage gate for floor-contact consumer tests (ob-nurse,
 * seated-patient). Sampled run (report.sample non-null, R2 record at
 * actor-floor-contact-all-stations.ts:52): the report must carry at least one
 * actor and the set of actor scenarioIds must equal the set of stations the
 * report covers. Full run (sample null): today's >30 floor, unchanged.
 * Throws with a naming message on any violation; the consumer tests and the
 * S5 planting units share this exact check.
 */
export function assertFloorContactCoverage(
  report: FloorContactSampleReport,
  fullFloorMin = 30,
): void {
  if (report.sample === null) {
    if (report.actors.length <= fullFloorMin) {
      throw new Error(
        `floor-contact report has ${report.actors.length} actor rows, need more than ${fullFloorMin} (full bank)`,
      );
    }
    return;
  }
  if (report.actors.length === 0) {
    throw new Error(
      `floor-contact sample [${report.sample.ids.join(",")}] measured no actors`,
    );
  }
  const actorStations = [...new Set(report.actors.map((actor) => actor.scenarioId))].sort();
  const covered = [...new Set(report.scenarios)].sort();
  if (actorStations.join(",") !== covered.join(",")) {
    throw new Error(
      `floor-contact sample covers [${covered.join(",")}] but actor rows report [${actorStations.join(",")}]`,
    );
  }
}
