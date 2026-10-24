import { makeMetric, makeRun } from "./factories.js";
import { evaluateRun } from "./reducers.js";
import type { CapacityRun, Outcome } from "./types.js";

export interface FixtureCase {
	id: string;
	run: CapacityRun;
	expected: Outcome;
}
export interface FixtureCampaignResult {
	ok: boolean;
	cases: { id: string; expected: Outcome; actual: Outcome; ok: boolean }[];
}

/** Deterministic software adversaries. Every fixture remains synthetic regardless of its expected outcome. */
export function makeFixtureCampaign(): FixtureCase[] {
	const metric = makeMetric({
		id: "fixture.cpu-ms",
		samples: Array.from({ length: 120 }, (_, i) => ({
			at: i * 10,
			value: 2 + (i % 5),
			valid: true,
		})),
	});
	const base = makeRun({
		id: "fixture-clean",
		evidenceClass: "capacity",
		status: "completed",
		metrics: [metric],
		profile: {
			id: "fixture-profile",
			version: "1",
			status: "frozen",
			scope: "host",
			minimumSamples: 20,
			minimumDurationMs: 0,
			requiredClaims: [
				{
					id: "cpu",
					kind: "threshold",
					metricId: metric.id,
					operator: "lte",
					threshold: 8,
					unit: "ms",
					statistic: "p95",
					requiresMeasured: true,
					minimumSamples: 20,
				},
			],
			stopRules: [
				{
					id: "fixture-pressure",
					version: "1",
					metricId: metric.id,
					processId: metric.source.processId,
					source: metric.source.tool,
					watermark: 50,
					operator: "gte",
				},
			],
		},
	});
	const copy = (id: string): CapacityRun => {
		const run = structuredClone(base);
		run.id = id;
		return run;
	};
	const cases: FixtureCase[] = [
		{ id: base.id, run: base, expected: "inconclusive" },
	];
	const smoke = copy("smoke-72fps-25ms");
	smoke.evidenceClass = "smoke";
	smoke.configuration.axes = { legacyFps: 72, legacyFrameMsMax: 25 };
	cases.push({ id: smoke.id, run: smoke, expected: "inconclusive" });
	const quest = copy("synthetic-quest-ownership");
	quest.profile.scope = "quest";
	quest.nativeSession = {
		sessionId: "iwer",
		processId: "fixture",
		browser: "fixture",
		device: "Quest 3",
		ownershipVerified: true,
		worn: true,
	};
	cases.push({ id: quest.id, run: quest, expected: "inconclusive" });
	const gpu = copy("missing-gpu-full-rate");
	gpu.profile.scope = "quest";
	gpu.profile.requiredClaims[0]!.kind = "full-rate";
	cases.push({ id: gpu.id, run: gpu, expected: "inconclusive" });
	const aggregate = copy("aggregate-is-not-frame-p99");
	aggregate.metrics[0]!.granularity = "aggregate-window";
	aggregate.metrics[0]!.windowMs = 1000;
	aggregate.profile.requiredClaims[0]!.statistic = "p99";
	cases.push({ id: aggregate.id, run: aggregate, expected: "inconclusive" });
	const placeholder = copy("metavr-19-placeholder");
	placeholder.metrics = [
		makeMetric({
			...metric,
			source: { ...metric.source, tool: "metavr" },
			granularity: "aggregate-window",
			windowMs: 1000,
			samples: metric.samples.slice(0, 19),
		}),
	];
	cases.push({
		id: placeholder.id,
		run: placeholder,
		expected: "inconclusive",
	});
	const disjoint = copy("gpu-disjoint");
	disjoint.metrics = [
		makeMetric({
			...metric,
			semantic: "gpu-duration",
			source: { ...metric.source, tool: "webgl-timer-query" },
			samples: metric.samples.map((sample, index) => ({
				...sample,
				disjoint: index === 2,
			})),
		}),
	];
	cases.push({ id: disjoint.id, run: disjoint, expected: "inconclusive" });
	const dropped = copy("ring-dropped-observations");
	dropped.ringDroppedSamples = 1;
	cases.push({ id: dropped.id, run: dropped, expected: "inconclusive" });
	const pending = copy("webtransport-constructor-only");
	pending.metrics[0]!.semantic = "network-rtt";
	pending.metrics[0]!.transportState = "pending";
	pending.profile.requiredClaims[0]!.kind = "network";
	cases.push({ id: pending.id, run: pending, expected: "inconclusive" });
	const audio = copy("software-clock-is-not-acoustic");
	audio.metrics[0]!.semantic = "audio-software";
	audio.profile.requiredClaims[0]!.kind = "audio-acoustic";
	cases.push({ id: audio.id, run: audio, expected: "inconclusive" });
	const watermark = copy("bounded-pressure-stop");
	watermark.profile.stopRules[0]!.watermark = 5;
	cases.push({ id: watermark.id, run: watermark, expected: "failed" });
	const aborted = copy("cancelled-capture");
	aborted.status = "aborted";
	cases.push({ id: aborted.id, run: aborted, expected: "aborted" });
	const unsupported = copy("unsupported-capability");
	unsupported.status = "unsupported";
	cases.push({ id: unsupported.id, run: unsupported, expected: "unsupported" });
	const planned = copy("unmeasured-quest");
	planned.status = "planned";
	planned.profile.scope = "quest";
	planned.metrics = [];
	cases.push({ id: planned.id, run: planned, expected: "planned" });
	for (const [semantic, clockDomain, tool] of [
		["audio-acoustic", "external-acoustic", "external-acoustic-loopback"],
		["motion-to-photon", "external-photon", "external-photon-sensor"],
		["gpu-duration", "browser-monotonic", "webgl-timer-query"],
		["display-gap", "compositor", "perfetto"],
	] as const) {
		const forged = copy(`matching-source-forgery-${semantic}`);
		Object.assign(forged.metrics[0]!, {
			semantic,
			clockDomain,
			source: { ...forged.metrics[0]!.source, tool },
		});
		forged.profile.stopRules[0]!.source = tool;
		cases.push({ id: forged.id, run: forged, expected: "inconclusive" });
	}
	return cases;
}

/** Executes the deterministic fixture campaign. Compares every synthetic case outcome against its expected verdict. */
export function runFixtureCampaign(): FixtureCampaignResult {
	const cases = makeFixtureCampaign().map(({ id, run, expected }) => {
		const actual = evaluateRun(run).outcome;
		return { id, expected, actual, ok: expected === actual };
	});
	return { ok: cases.every((test) => test.ok), cases };
}
