import { runEdChestPainSimulation } from "./index.js";
import { buildMockBenchmarkReport } from "./benchmark-report.js";

const started = performance.now();
const result = await runEdChestPainSimulation();
const elapsedMs = Number((performance.now() - started).toFixed(2));

console.log(
  JSON.stringify(
    buildMockBenchmarkReport(result, elapsedMs),
    null,
    2,
  ),
);
