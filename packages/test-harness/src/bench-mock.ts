import { runEdChestPainSimulation } from "./index.js";

const started = performance.now();
const result = await runEdChestPainSimulation();
const elapsedMs = Number((performance.now() - started).toFixed(2));

console.log(
  JSON.stringify(
    {
      benchmark: "ed-chest-pain-mock",
      elapsedMs,
      stationRunId: result.stationRunId,
      eventCount: result.eventCount,
      missingRequiredTraceTags: result.reviewPacket.missingRequiredTraceTags,
      providerHealth: result.providerHealth,
    },
    null,
    2,
  ),
);
