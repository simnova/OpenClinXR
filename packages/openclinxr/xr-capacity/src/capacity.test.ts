import { describe, expect, it } from "vitest";
import { CAPACITY_LIMITS, HOST_LIMITS, compareRuns, evaluateRun, evaluateStopRules, makeFixtureCampaign, makeMetric, makeRun, parseRunRecord, planCampaign, runFixtureCampaign, runHostWorkloads, summarizeMetric, validateRunRecord } from "./index.js";
import type { CapacityRun, EvaluationContext } from "./index.js";

function observedHost(): CapacityRun {
	// Positive reducer-control only. Actual host execution is independently tested below.
	const fixture = structuredClone(makeFixtureCampaign()[0]!.run);
	fixture.provenance = "node-host";
	fixture.environment.revision = "fixture-revision";
	fixture.environment.buildHash = "fixture-build";
	return fixture;
}
function nativeControl(): { run: CapacityRun; context: EvaluationContext } {
	const run = observedHost();
	run.provenance = "quest-native";
	run.environment.runtime = "native-browser";
	run.environment.device = "Quest 3";
	run.environment.browser = "Meta Browser pinned";
	run.nativeSession = {
		sessionId: "native-session-1",
		processId: "browser:42",
		device: "Quest 3",
		browser: "Meta Browser pinned",
		ownershipVerified: true,
		worn: true,
	};
	run.profile.scope = "quest";
	const source = {
		tool: "perfetto",
		version: "pinned",
		processId: "browser:42",
	};
	const timingDenominator = {
		kind: "compositorDisplay" as const,
		periodMs: 1000 / 90,
		source,
	};
	const raw = Array.from({ length: 120 }, (_, i) => ({
		at: (i * 1000) / 90,
		value: 10,
		valid: true,
	}));
	run.metrics = [
		makeMetric({
			id: "presentation",
			semantic: "display-gap",
			source,
			timingDenominator,
			clockDomain: "compositor",
			samples: raw,
		}),
		makeMetric({
			id: "cpu",
			semantic: "cpu-duration",
			source,
			timingDenominator,
			clockDomain: "compositor",
			samples: raw.map((sample) => ({ ...sample, value: 4 })),
		}),
		makeMetric({
			id: "gpu",
			semantic: "gpu-duration",
			source,
			timingDenominator,
			clockDomain: "compositor",
			samples: raw.map((sample) => ({ ...sample, value: 5 })),
		}),
	];
	run.profile.requiredClaims = [
		{
			id: "native-rate",
			kind: "full-rate",
			metricId: "presentation",
			operator: "lte",
			threshold: 12,
			unit: "ms",
			statistic: "p99",
			requiresMeasured: true,
			minimumSamples: 100,
		},
	];
	run.profile.stopRules = [
		{
			id: "timing-pressure",
			version: "1",
			metricId: "presentation",
			processId: source.processId,
			source: source.tool,
			watermark: 30,
			operator: "gte",
		},
	];
	return {
		run,
		context: {
			nativeSessionVerified: {
				sessionId: "native-session-1",
				processId: "browser:42",
			},
		},
	};
}

describe("untrusted JSON boundary", () => {
	it("roundtrips and detaches checked objects", () => {
		const raw = observedHost();
		const parsed = parseRunRecord(JSON.stringify(raw));
		expect(parsed).toEqual(raw);
		parsed.configuration.axes['modified'] = true;
		expect(raw.configuration.axes['modified']).toBeUndefined();
	});
	it.each([
		NaN,
		Infinity,
		-1,
		"2",
		null,
	])("rejects nonnumeric or unbounded timing: %s", (value) => {
		const raw = observedHost() as unknown as {
			metrics: { samples: { value: unknown }[] }[];
		};
		raw.metrics[0]!.samples[0]!.value = value;
		expect(validateRunRecord(raw).ok).toBe(false);
	});
	it("rejects unknown fields including caller supplied successful outcomes", () => {
		expect(
			validateRunRecord({ ...observedHost(), outcome: "validated-profile" }).ok,
		).toBe(false);
		expect(
			validateRunRecord(JSON.parse('{"__proto__":{"polluted":true}}')).ok,
		).toBe(false);
	});
	it("rejects accessors without executing them", () => {
		const run = observedHost();
		let read = false;
		Object.defineProperty(run, "id", {
			get: () => {
				read = true;
				return "oops";
			},
			enumerable: true,
		});
		expect(validateRunRecord(run).ok).toBe(false);
		expect(read).toBe(false);
	});
	it("rejects unit, clock, granularity and sample-count spoofing", () => {
		for (const patch of [
			{ unit: "Hz" },
			{ clockDomain: "wall-clock" },
			{ granularity: "average" },
			{ sampleCount: 999 },
			{ invalidSampleCount: 1 },
			{ source: null },
		]) {
			const raw = observedHost();
			Object.assign(raw.metrics[0]!, patch);
			expect(validateRunRecord(raw).ok).toBe(false);
		}
	});
	it("requires a duration for aggregates and advancing per-frame timestamps", () => {
		const raw = observedHost();
		raw.metrics[0]!.granularity = "aggregate-window";
		expect(validateRunRecord(raw).ok).toBe(false);
		raw.metrics[0]!.granularity = "per-frame";
		raw.metrics[0]!.samples[1]!.at = 0;
		expect(validateRunRecord(raw).ok).toBe(false);
	});
	it("bounds cardinalities before processing oversized records", () => {
		const raw = observedHost();
		raw.metrics = Array.from(
			{ length: CAPACITY_LIMITS.metrics + 1 },
			() => raw.metrics[0]!,
		);
		expect(validateRunRecord(raw).ok).toBe(false);
		expect(
			validateRunRecord(" ".repeat(CAPACITY_LIMITS.inputBytes + 1)).ok,
		).toBe(false);
	});
	it("does not accept invalid timestamps, duplicated identifiers or null stop watermarks", () => {
		const raw = observedHost();
		raw.endedAt = "2026-02-31T00:00:00Z";
		expect(validateRunRecord(raw).ok).toBe(false);
		const duplicate = observedHost();
		duplicate.metrics.push(duplicate.metrics[0]!);
		expect(validateRunRecord(duplicate).ok).toBe(false);
		const nullStop = observedHost() as unknown as {
			profile: { stopRules: { watermark: unknown }[] };
		};
		nullStop.profile.stopRules[0]!.watermark = null;
		expect(validateRunRecord(nullStop).ok).toBe(false);
	});
});

describe("honest reduction and claim attribution", () => {
	it("reports actual nearest-rank percentiles from raw observations", () => {
		const metric = makeMetric({
			samples: Array.from({ length: 100 }, (_, i) => ({
				at: i,
				value: i + 1,
				valid: true,
			})),
		});
		expect(summarizeMetric(metric)).toMatchObject({
			p50: 50,
			p95: 95,
			p99: 99,
			validSamples: 100,
		});
	});
	it("leaves p99 unavailable below 100 observations", () => {
		const metric = makeMetric({ samples: [{ at: 0, value: 10, valid: true }] });
		expect(summarizeMetric(metric)).toMatchObject({
			p50: 10,
			p95: null,
			p99: null,
		});
	});
	it("filters GPU disjoint, explicit placeholders, and zero-as-placeholder values", () => {
		const metric = makeMetric({
			semantic: "gpu-duration",
			samples: [
				{ at: 0, value: 999, valid: true, disjoint: true },
				{ at: 1, value: 0, valid: true },
				{ at: 2, value: 9, valid: true, placeholder: true },
				{ at: 3, value: 4, valid: true },
			],
		});
		expect(summarizeMetric(metric)).toMatchObject({
			p50: 4,
			max: 4,
			rejectedSamples: 3,
		});
	});
	it("does not manufacture metavr statistics from its under-20 placeholders", () => {
		const metric = makeMetric({
			source: { tool: "metavr", version: "1", processId: "browser" },
			granularity: "aggregate-window",
			windowMs: 1000,
			samples: Array.from({ length: 19 }, (_, i) => ({
				at: i * 1000,
				value: 10,
				valid: true,
			})),
		});
		expect(summarizeMetric(metric)).toMatchObject({
			validSamples: 0,
			p50: null,
			p99: null,
		});
	});
	it("never derives callback bursts from window averages, and breaks bursts at invalid observations", () => {
		const base = makeMetric({
			semantic: "callback-gap",
			timingDenominator: {
				kind: "callbackMedian",
				periodMs: 10,
				source: { tool: "browser", version: "1", processId: "p" },
			},
			samples: [20, 20, null, 20].map((value, at) => ({
				at,
				value,
				valid: value !== null,
			})),
		});
		expect(summarizeMetric(base)).toMatchObject({
			lateCallbackCount: 3,
			longestLateBurst: 2,
		});
		expect(
			summarizeMetric({
				...base,
				granularity: "aggregate-window",
				windowMs: 1000,
			}),
		).toMatchObject({ lateCallbackCount: null, longestLateBurst: null });
	});
	it("admits a correctly scoped host profile and rejects smoke/synthetic promotion", () => {
		const run = observedHost();
		expect(evaluateRun(run).outcome).toBe("validated-profile");
		expect(evaluateRun({ ...run, evidenceClass: "smoke" }).outcome).toBe(
			"inconclusive",
		);
		expect(evaluateRun({ ...run, provenance: "synthetic" }).outcome).toBe(
			"inconclusive",
		);
	});
	it("holds only missing independent claims inconclusive", () => {
		const run = observedHost();
		run.profile.requiredClaims.push({
			...run.profile.requiredClaims[0]!,
			id: "missing-audio",
			metricId: "audio",
		});
		const result = evaluateRun(run);
		expect(result.outcome).toBe("inconclusive");
		expect(result.claims.map((claim) => claim.outcome)).toEqual([
			"validated-profile",
			"inconclusive",
		]);
	});
	it("fails a measured threshold and an actual bounded pressure limit", () => {
		const run = observedHost();
		run.profile.requiredClaims[0]!.threshold = 1;
		expect(evaluateRun(run).outcome).toBe("failed");
		run.profile.requiredClaims[0]!.threshold = 8;
		run.profile.stopRules[0]!.watermark = 3;
		expect(evaluateRun(run).outcome).toBe("failed");
	});
	it("requires stop source, process and versioned watermarks to match observations", () => {
		const run = observedHost();
		run.profile.stopRules[0]!.processId = "wrong-process";
		expect(evaluateStopRules(run)).toEqual({
			triggered: [],
			unavailable: ["fixture-pressure"],
		});
		expect(evaluateRun(run).outcome).toBe("inconclusive");
	});
	it("does not turn GPU averages or lost observations into a frame claim", () => {
		const run = observedHost();
		run.metrics[0]!.granularity = "aggregate-window";
		run.metrics[0]!.windowMs = 1000;
		expect(evaluateRun(run).outcome).toBe("inconclusive");
		run.metrics[0]!.granularity = "per-frame";
		run.metrics[0]!.windowMs = null;
		run.ringDroppedSamples = 1;
		expect(evaluateRun(run).outcome).toBe("inconclusive");
	});
	it("does not accept proxy observations for a measured claim", () => {
		const run = observedHost();
		run.metrics[0]!.kind = "proxy";
		expect(evaluateRun(run).outcome).toBe("inconclusive");
	});
	it("does not launder a host metric through a Quest claim name or legacy smoke source", () => {
		const run = observedHost();
		run.profile.requiredClaims[0]!.id = "quest.fullRate";
		expect(evaluateRun(run).outcome).toBe("inconclusive");
		run.profile.requiredClaims[0]!.id = "host.cpu";
		run.metrics[0]!.source.tool = "legacy-quest-smoke";
		expect(evaluateRun(run).outcome).toBe("inconclusive");
	});
	it("does not mistake pending transport or zero websocket buffering for delivery", () => {
		const run = observedHost();
		run.profile.requiredClaims[0]!.kind = "network";
		run.metrics[0]!.semantic = "network-rtt";
		run.metrics[0]!.transportState = "pending";
		expect(evaluateRun(run).outcome).toBe("inconclusive");
		run.metrics[0]!.transportState = "connected";
		expect(evaluateRun(run).outcome).toBe("validated-profile");
		run.metrics[0]!.semantic = "websocket-buffered";
		run.metrics[0]!.unit = "bytes";
		run.profile.requiredClaims[0]!.unit = "bytes";
		expect(evaluateRun(run).outcome).toBe("inconclusive");
	});
	it("rejects HTTP timing relabeled as physical acoustic or photon measurement", () => {
		for (const semantic of ["audio-acoustic", "motion-to-photon"] as const) {
			const run = observedHost();
			run.metrics[0]!.semantic = semantic;
			run.metrics[0]!.clockDomain =
				semantic === "audio-acoustic" ? "external-acoustic" : "external-photon";
			// Even a generic threshold cannot bypass the semantic source-family restriction.
			expect(evaluateRun(run).outcome).toBe("inconclusive");
		}
	});
});

describe("native claim controls (synthetic unit-test inputs only)", () => {
	it("rejects host forgeries even when profiler family and clock strings match", () => {
		for (const [semantic, clockDomain, tool] of [
			["audio-acoustic", "external-acoustic", "external-acoustic-loopback"],
			["motion-to-photon", "external-photon", "external-photon-sensor"],
			["gpu-duration", "browser-monotonic", "webgl-timer-query"],
			["display-gap", "compositor", "perfetto"],
		] as const) {
			const run = observedHost();
			Object.assign(run.metrics[0]!, {
				semantic,
				clockDomain,
				source: { ...run.metrics[0]!.source, tool },
			});
			run.profile.stopRules[0]!.source = tool;
			expect(evaluateRun(run).outcome).toBe("inconclusive");
		}
	});
	it("does not grant authority to matching imported session tuples", () => {
		const { run, context } = nativeControl();
		expect(evaluateRun(run).outcome).toBe("inconclusive");
		// Matching values copied from the same document supply no independent authority.
		expect(evaluateRun(run, context).outcome).toBe("inconclusive");
		expect(parseRunRecord(run).nativeSession).toBeNull();
	});
	it("rejects missing GPU, mismatched GPU period, proxy source and callback denominators", () => {
		for (const mutation of [
			(run: CapacityRun) => {
				run.metrics.pop();
			},
			(run: CapacityRun) => {
				run.metrics[2]!.timingDenominator!.periodMs = 13.89;
			},
			(run: CapacityRun) => {
				run.metrics[2]!.source.tool = "performance.now";
			},
			(run: CapacityRun) => {
				run.metrics[0]!.timingDenominator!.kind = "callbackMedian";
			},
			(run: CapacityRun) => {
				run.metrics[0]!.semantic = "callback-gap";
			},
		]) {
			const { run, context } = nativeControl();
			mutation(run);
			expect(evaluateRun(run, context).outcome).toBe("inconclusive");
		}
	});
	it("keeps future readiness and physical quality outside a validated timing profile", () => {
		const { run, context } = nativeControl();
		expect(evaluateRun(run, context).notEvidenceFor).toContain(
			"quest-readiness",
		);
		expect(evaluateRun(run, context).notEvidenceFor).toContain(
			"visual-quality",
		);
	});
});

describe("comparison and deterministic fixtures", () => {
	it("shows raw max and p95 changes while both functional bounds still pass", () => {
		const baseline = observedHost(),
			candidate = observedHost();
		for (const run of [baseline, candidate])
			run.profile.requiredClaims[0]!.threshold = 100;
		candidate.metrics[0]!.samples = candidate.metrics[0]!.samples.map(
			(sample) => ({ ...sample, value: (sample.value ?? 0) * 2 }),
		);
		const result = compareRuns(baseline, candidate);
		expect(result.compatibility).toBe("compatible");
		expect(result.claims[0]!.regression).toBe(false);
		expect(result.metrics[0]).toMatchObject({
			unit: "ms",
			baseline: { samples: 120, max: 6, p95: 6 },
			candidate: { samples: 120, max: 12, p95: 12 },
			maxDelta: 6,
			maxRatio: 2,
			p95Delta: 6,
			p95Ratio: 2,
		});
	});
	it("refuses unknown build identity even with an explicit reviewed equivalence", () => {
		const run = observedHost();
		run.environment.revision = "unrecorded";
		const result = compareRuns(run, run, {
			equivalence: {
				id: "review-123",
				allowedEnvironment: ["revision", "buildHash"],
			},
		});
		expect(result.compatibility).toBe("incompatible");
		expect(result.metrics).toEqual([]);
	});
	it("permits a named reviewed build change while retaining device and workload identity", () => {
		const baseline = observedHost(),
			candidate = observedHost();
		candidate.environment.revision = "optimized-revision";
		candidate.environment.buildHash = "optimized-build";
		expect(compareRuns(baseline, candidate)).toMatchObject({
			outcome: "failed",
			compatibility: "incompatible",
		});
		const options = {
			equivalence: {
				id: "reviewed-optimization-123",
				allowedEnvironment: ["revision", "buildHash"] as (
					| "revision"
					| "buildHash"
				)[],
			},
		};
		expect(compareRuns(baseline, candidate, options)).toMatchObject({
			outcome: "comparable",
			compatibility: "compatible",
			equivalence: options.equivalence,
			allowedDifferences: ["environment.revision", "environment.buildHash"],
		});
		candidate.environment.device = "another-device";
		expect(compareRuns(baseline, candidate, options)).toMatchObject({
			outcome: "failed",
			differences: ["environment.device"],
		});
		candidate.environment.device = baseline.environment.device;
		candidate.configuration.workloadHash = "different-workload";
		expect(compareRuns(baseline, candidate, options).compatibility).toBe(
			"incompatible",
		);
		options.equivalence.id = " ";
		expect(compareRuns(baseline, baseline, options).compatibility).toBe(
			"incompatible",
		);
	});
	it("fails unexpected equivalence, subject, dependency and profile differences", () => {
		for (const mutate of [
			(run: CapacityRun) => {
				run.configuration.workloadHash = "different-shader";
			},
			(run: CapacityRun) => {
				run.provenance = "desktop-browser";
			},
			(run: CapacityRun) => {
				run.environment.browser = "new-browser";
			},
			(run: CapacityRun) => {
				run.profile.stopRules[0]!.watermark = 100;
			},
			(run: CapacityRun) => {
				run.evidenceClass = "smoke";
			},
		]) {
			const baseline = observedHost(),
				candidate = observedHost();
			mutate(candidate);
			expect(compareRuns(baseline, candidate).outcome).toBe("failed");
		}
	});
	it("permits only named configuration axes and never waives workload identity", () => {
		const baseline = observedHost(),
			candidate = observedHost();
		baseline.configuration.axes['renderScale'] = 1;
		candidate.configuration.axes['renderScale'] = 0.8;
		expect(compareRuns(baseline, candidate).outcome).toBe("failed");
		expect(
			compareRuns(baseline, candidate, { allowedAxes: ["renderScale"] }),
		).toMatchObject({
			outcome: "comparable",
			allowedDifferences: ["configuration.axes.renderScale"],
		});
		candidate.configuration.workloadHash = "wrong";
		expect(
			compareRuns(baseline, candidate, { allowedAxes: ["renderScale"] })
				.outcome,
		).toBe("failed");
		expect(
			compareRuns(baseline, baseline, { allowedAxes: ["missing"] }).outcome,
		).toBe("failed");
	});
	it("reports a regression when a previously sufficient sample count is insufficient", () => {
		const baseline = observedHost(),
			candidate = observedHost();
		candidate.metrics = [
			makeMetric({
				...candidate.metrics[0]!,
				samples: candidate.metrics[0]!.samples.slice(0, 2),
			}),
		];
		expect(compareRuns(baseline, candidate)).toMatchObject({
			outcome: "comparable",
			claims: [{ id: "cpu", regression: true, candidate: "inconclusive" }],
		});
	});
	it("all fixture expectations pass and no synthetic fixture becomes capacity validation", () => {
		const campaign = runFixtureCampaign();
		expect(campaign.ok).toBe(true);
		expect(campaign.cases.length).toBeGreaterThan(10);
		expect(
			campaign.cases.some((test) => test.actual === "validated-profile"),
		).toBe(false);
		expect(
			makeFixtureCampaign().every(
				(test) => test.run.provenance === "synthetic",
			),
		).toBe(true);
	});
});

describe("bounded actual host workloads", () => {
	it("distinguishes zero selected fixture memory from positive process RSS and states numeric bounds", async () => {
		const run = await runHostWorkloads({
			iterations: 2,
			workloads: ["cpu"],
			updatesPerIteration: 100,
			memoryMiB: 0,
			assetBytes: 0,
		});
		expect(
			run.metrics.find((metric) => metric.id === "host.touched-memory.bytes")!
				.samples[0]!.value,
		).toBe(0);
		expect(
			run.metrics.find((metric) => metric.id === "host.process-rss.bytes")!
				.samples[0]!.value,
		).toBeGreaterThan(0);
		expect(evaluateRun(run).notEvidenceFor).toContain("maximum-host-capacity");
		expect(evaluateRun(run).claims[0]!.criterion).toContain("max ≤ 3000 ms");
	});
	it("runs CPU, distinct touched memory and real JSON decoding with visible work counters", async () => {
		const run = await runHostWorkloads({
			iterations: 4,
			updatesPerIteration: 100,
			memoryMiB: 1,
			assetBytes: 1024,
		});
		expect(evaluateRun(run).outcome).toBe("validated-profile");
		expect(run.provenance).toBe("node-host");
		expect(
			run.metrics.find((metric) => metric.id === "host.completed-updates")!
				.samples[0]!.value,
		).toBe(400);
		expect(
			run.metrics.find((metric) => metric.id === "host.touched-memory.bytes")!
				.samples[0]!.value,
		).toBe(1_048_576);
		expect(
			run.metrics.find((metric) => metric.id === "host.asset-decoded-bytes")!
				.samples[0]!.value,
		).toBeGreaterThan(0);
		expect(evaluateRun(run).notEvidenceFor).toContain("quest-capacity");
	});
	it("keeps an independent CPU run separate from interleaved contention", async () => {
		const run = await runHostWorkloads({
			iterations: 3,
			workloads: ["cpu"],
			updatesPerIteration: 100,
			memoryMiB: 0,
			assetBytes: 0,
		});
		expect(
			run.metrics.find((metric) => metric.id === "host.asset.json-decode-ms"),
		).toBeUndefined();
		const mixed = await runHostWorkloads({
			iterations: 3,
			mode: "interleaved",
			updatesPerIteration: 100,
			memoryMiB: 1,
			assetBytes: 1024,
		});
		expect(
			mixed.metrics.find((metric) => metric.id === "host.mixed.step-ms")!
				.sampleCount,
		).toBe(3);
		expect(mixed.configuration.axes['mode']).toBe("interleaved");
	});
	it("aborts promptly before work and when a running signal is cancelled", async () => {
		const early = new AbortController();
		early.abort();
		const run = await runHostWorkloads({ signal: early.signal });
		expect(run.status).toBe("aborted");
		expect(
			run.metrics.find((metric) => metric.id === "host.completed-updates")!
				.samples[0]!.value,
		).toBe(0);
		const during = new AbortController();
		const pending = runHostWorkloads({
			iterations: 500,
			mode: "interleaved",
			signal: during.signal,
		});
		during.abort();
		expect((await pending).status).toBe("aborted");
	});
	it("snapshots selected workloads and profile limits before yielding", async () => {
		const options = {
			iterations: 3,
			workloads: ["cpu" as const],
			updatesPerIteration: 100,
			maxDurationMs: 3000,
		};
		const pending = runHostWorkloads(options);
		options.workloads.length = 0;
		options.maxDurationMs = 1;
		const run = await pending;
		expect(run.status).toBe("completed");
		expect(run.profile.stopRules[0]!.watermark).toBe(3000);
	});
	it("refuses OOM hunting and invalid options before allocation", async () => {
		await expect(
			runHostWorkloads({ memoryMiB: HOST_LIMITS.memoryMiB + 1 }),
		).rejects.toThrow(RangeError);
		await expect(runHostWorkloads({ assetBytes: NaN })).rejects.toThrow(
			RangeError,
		);
		await expect(runHostWorkloads({ workloads: [] })).rejects.toThrow(
			RangeError,
		);
	});
	it("plans independent resource ramps and a clearly labeled mixed screen", () => {
		const campaign = planCampaign();
		expect(campaign.points).toHaveLength(10);
		expect(
			campaign.points.filter((point) => point.mode === "interleaved"),
		).toHaveLength(1);
		expect(campaign.notEvidenceFor).toContain("maximum-host-capacity");
	});
});
