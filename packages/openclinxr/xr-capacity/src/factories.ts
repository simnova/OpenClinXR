import type { CapacityMetric, CapacityRun } from "./types.js";

/** Small honest defaults for collectors; overrides are shallow and validated at the evidence boundary. */
export function makeMetric(
	overrides: Partial<CapacityMetric> = {},
): CapacityMetric {
	const samples = overrides.samples ?? [];
	const metric: CapacityMetric = {
		id: "fixture.duration",
		semantic: "cpu-duration",
		unit: "ms",
		kind: "measured",
		granularity: "per-frame",
		clockDomain: "host-monotonic",
		source: { tool: "fixture", version: "1", processId: "fixture" },
		samples,
		sampleCount: samples.length,
		invalidSampleCount: samples.filter(
			(sample) =>
				!sample.valid ||
				sample.value === null ||
				sample.disjoint ||
				sample.placeholder,
		).length,
		droppedSamples: 0,
		windowMs: null,
		timingDenominator: null,
		unavailableReason: null,
		transportState: "not-applicable",
		...overrides,
	};
	return {
		...metric,
		samples: metric.samples.map((sample) => ({ ...sample })),
		sampleCount: samples.length,
		invalidSampleCount: samples.filter(
			(sample) =>
				!sample.valid ||
				sample.value === null ||
				sample.disjoint ||
				sample.placeholder,
		).length,
		source: { ...metric.source },
		timingDenominator: metric.timingDenominator
			? {
					...metric.timingDenominator,
					source: { ...metric.timingDenominator.source },
				}
			: null,
	};
}

/** Synthetic and provisional by default. A caller must supply observed provenance and its acceptance profile. */
export function makeRun(overrides: Partial<CapacityRun> = {}): CapacityRun {
	return {
		schema: "quest-capacity-run.v1",
		id: "capacity-unmeasured",
		evidenceClass: "smoke",
		provenance: "synthetic",
		startedAt: "2026-10-14T00:00:00.000Z",
		endedAt: "2026-10-14T00:00:01.000Z",
		environment: {
			runtime: "synthetic",
			device: "unmeasured",
			os: "unmeasured",
			browser: "unmeasured",
			revision: "unrecorded",
			buildHash: "unrecorded",
		},
		configuration: {
			workloadHash: "unmeasured",
			capabilityHash: "unmeasured",
			seed: 1,
			axes: {},
		},
		nativeSession: null,
		profile: {
			id: "unmeasured-profile",
			version: "1",
			status: "provisional",
			scope: "quest",
			minimumSamples: 20,
			minimumDurationMs: 0,
			requiredClaims: [],
			stopRules: [],
		},
		metrics: [],
		artifacts: [],
		status: "planned",
		ringDroppedSamples: 0,
		...overrides,
	};
}
