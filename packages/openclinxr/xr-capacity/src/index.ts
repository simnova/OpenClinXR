/** Shared capacity evidence validation, scoped adjudication and bounded host workloads. */
export {
	CAPACITY_LIMITS,
	parseRunRecord,
	validateRunRecord,
} from "./schema.js";
export { makeMetric, makeRun } from "./factories.js";
export {
	compareRuns,
	evaluateRun,
	evaluateStopRules,
} from "./reducers.js";
export { makeFixtureCampaign, runFixtureCampaign } from "./fixtures.js";
export { HOST_LIMITS, planCampaign, runHostWorkloads } from "./host.js";
export type {
	CapacityMetric,
	CapacityRun,
	EvaluationContext,
} from "./types.js";
export { summarizeMetric } from "./metric-summary.js";
