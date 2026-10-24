import { makeMetric, makeRun } from "./factories.js";
import { parseRunRecord } from "./schema.js";
import { processMemorySnapshot } from "./host-memory.js";
import type {
	CapacityClaim,
	CapacityMetric,
	CapacityRun,
	MetricSample,
} from "./types.js";

export type HostWorkload = "cpu" | "memory" | "asset";
export interface HostWorkloadOptions {
	iterations?: number;
	updatesPerIteration?: number;
	memoryMiB?: number;
	assetBytes?: number;
	workloads?: HostWorkload[];
	mode?: "independent" | "interleaved";
	maxDurationMs?: number;
	signal?: AbortSignal;
	id?: string;
	revision?: string;
	buildHash?: string;
}
export interface CampaignPoint {
	id: string;
	mode: "independent" | "interleaved";
	workloads: HostWorkload[];
	iterations: number;
	updatesPerIteration: number;
	memoryMiB: number;
	assetBytes: number;
}
export interface HostCampaign {
	id: string;
	scope: "host";
	points: CampaignPoint[];
	notEvidenceFor: string[];
}
/** Bounded host workload ceilings for capacity ladders. Caps iterations, memory, assets, and duration for deterministic screens. */
export const HOST_LIMITS = Object.freeze({
	iterations: 500,
	updatesPerIteration: 100_000,
	memoryMiB: 32,
	assetBytes: 1_048_576,
	durationMs: 10_000,
});

function bounded(
	value: number | undefined,
	fallback: number,
	max: number,
	field: string,
	minimum = 0,
): number {
	const n = value ?? fallback;
	if (!Number.isSafeInteger(n) || n < minimum || n > max)
		throw new RangeError(`${field} must be an integer in [${minimum}, ${max}]`);
	return n;
}

/** Deterministic, bounded independent ladders plus a labeled single-thread interleaved contention screen. */
export function planCampaign(): HostCampaign {
	const points: CampaignPoint[] = [];
	for (const updatesPerIteration of [1_000, 5_000, 20_000])
		points.push({
			id: `cpu-${updatesPerIteration}`,
			mode: "independent",
			workloads: ["cpu"],
			iterations: 40,
			updatesPerIteration,
			memoryMiB: 0,
			assetBytes: 0,
		});
	for (const memoryMiB of [1, 4, 8])
		points.push({
			id: `memory-${memoryMiB}`,
			mode: "independent",
			workloads: ["memory"],
			iterations: 40,
			updatesPerIteration: 0,
			memoryMiB,
			assetBytes: 0,
		});
	for (const assetBytes of [16_384, 65_536, 262_144])
		points.push({
			id: `asset-${assetBytes}`,
			mode: "independent",
			workloads: ["asset"],
			iterations: 40,
			updatesPerIteration: 0,
			memoryMiB: 0,
			assetBytes,
		});
	points.push({
		id: "mixed-interleaved",
		mode: "interleaved",
		workloads: ["cpu", "memory", "asset"],
		iterations: 40,
		updatesPerIteration: 5_000,
		memoryMiB: 4,
		assetBytes: 65_536,
	});
	return {
		id: "host-functional-ladders.v1",
		scope: "host",
		points,
		notEvidenceFor: [
			"quest-capacity",
			"gpu-capacity",
			"network-capacity",
			"audio-capacity",
			"maximum-host-capacity",
			"parallel-worker-contention",
		],
	};
}

/** Executes real host work, never an OOM search. Timings describe this tested workload only. */
export async function runHostWorkloads(
	inputOptions: HostWorkloadOptions = {},
): Promise<CapacityRun> {
	const options = {
		...inputOptions,
		...(inputOptions.workloads
			? { workloads: [...inputOptions.workloads] }
			: {}),
	};
	const host = (
		globalThis as unknown as {
			process?: {
				release?: { name?: string };
				version?: string;
				platform?: string;
				arch?: string;
				pid?: number;
				memoryUsage?: () => { rss: number };
			};
		}
	).process;
	if (host?.release?.name !== "node")
		throw new Error(
			"runHostWorkloads requires a Node host; browser probes have separate provenance",
		);
	const iterations = bounded(
		options.iterations,
		40,
		HOST_LIMITS.iterations,
		"iterations",
		1,
	);
	const updates = bounded(
		options.updatesPerIteration,
		1_000,
		HOST_LIMITS.updatesPerIteration,
		"updatesPerIteration",
	);
	const memoryMiB = bounded(
		options.memoryMiB,
		8,
		HOST_LIMITS.memoryMiB,
		"memoryMiB",
	);
	const assetBytes = bounded(
		options.assetBytes,
		262_144,
		HOST_LIMITS.assetBytes,
		"assetBytes",
	);
	const maxDurationMs = bounded(
		options.maxDurationMs,
		3_000,
		HOST_LIMITS.durationMs,
		"maxDurationMs",
		1,
	);
	const workloads = options.workloads ?? ["cpu", "memory", "asset"];
	if (
		workloads.length === 0 ||
		workloads.length > 3 ||
		new Set(workloads).size !== workloads.length ||
		workloads.some((workload) => !["cpu", "memory", "asset"].includes(workload))
	)
		throw new RangeError(
			"workloads must be a nonempty unique subset of cpu, memory, asset",
		);
	const mode = options.mode ?? "independent";
	if (mode !== "independent" && mode !== "interleaved")
		throw new RangeError("invalid workload mode");
	const active = workloads.filter((workload) =>
		workload === "cpu"
			? updates > 0
			: workload === "memory"
				? memoryMiB > 0
				: assetBytes > 0,
	);
	if (active.length === 0)
		throw new RangeError("at least one workload must perform work");
	const startedAt = new Date().toISOString();
	const started = performance.now();
	const source = {
		tool: "host-workload",
		version: "1",
		processId: `node:${host.pid ?? "unknown"}`,
	};
	const cpuSamples: MetricSample[] = [],
		touchSamples: MetricSample[] = [],
		assetSamples: MetricSample[] = [],
		stepSamples: MetricSample[] = [];
	const elapsed = (): number => Math.max(0, performance.now() - started);
	let aborted = options.signal?.aborted === true;
	let stopped = false;
	let cpuChecksum = 0x12345678,
		memoryChecksum = 0,
		decodeChecksum = 0,
		completedUpdates = 0,
		decodedBytes = 0,
		touchCount = 0;
	// Allocation and fixture creation are included in total duration and explicitly bounded.
	let memory = new Uint8Array(
		!aborted && active.includes("memory") ? memoryMiB * 1_048_576 : 0,
	);
	const jsonAsset =
		!aborted && active.includes("asset")
			? JSON.stringify({
					seed: 1,
					payload: "x".repeat(Math.max(0, assetBytes - 23)),
				})
			: "";
	const assetWireBytes = new TextEncoder().encode(jsonAsset).byteLength;
	function shouldStop(): boolean {
		aborted ||= options.signal?.aborted === true;
		stopped ||= elapsed() >= maxDurationMs;
		return aborted || stopped;
	}
	function work(workload: HostWorkload): void {
		const before = performance.now();
		if (workload === "cpu") {
			for (let j = 0; j < updates; j++)
				cpuChecksum =
					(Math.imul(cpuChecksum ^ (j + 1), 1_664_525) + 1_013_904_223) >>> 0;
			completedUpdates += updates;
		} else if (workload === "memory") {
			// Write every byte; no duplicate references or lazy untouched allocation stands in for pressure.
			memory.fill((touchCount % 254) + 1);
			memoryChecksum =
				(memoryChecksum + (memory[0] ?? 0) + (memory.at(-1) ?? 0)) >>> 0;
			touchCount++;
		} else {
			const decoded = JSON.parse(jsonAsset) as {
				seed: number;
				payload: string;
			};
			decodeChecksum =
				(decodeChecksum + decoded.payload.length + decoded.seed) >>> 0;
			decodedBytes += assetWireBytes;
		}
		const sample = {
			at: elapsed(),
			value: Math.max(0, performance.now() - before),
			valid: true,
		};
		(workload === "cpu"
			? cpuSamples
			: workload === "memory"
				? touchSamples
				: assetSamples
		).push(sample);
	}
	if (!aborted) {
		if (mode === "interleaved") {
			for (let i = 0; i < iterations && !shouldStop(); i++) {
				const before = performance.now();
				for (const workload of active) {
					if (shouldStop()) break;
					work(workload);
				}
				stepSamples.push({
					at: elapsed(),
					value: Math.max(0, performance.now() - before),
					valid: true,
				});
				// Yield once per bounded step so cancellation is observable, including on fast machines.
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		} else {
			for (const workload of active)
				for (let i = 0; i < iterations && !shouldStop(); i++) {
					work(workload);
					if (i % 10 === 0)
						await new Promise<void>((resolve) => setTimeout(resolve, 0));
				}
		}
	}
	shouldStop();
	const totalMs = elapsed();
	const endedAt = new Date().toISOString();
	const metrics: CapacityMetric[] = [
		processMemorySnapshot(host.memoryUsage?.bind(host), totalMs, source),
	];
	for (const [id, semantic, samples] of [
		["host.cpu.update-ms", "cpu-duration", cpuSamples],
		["host.memory.touch-ms", "cpu-duration", touchSamples],
		["host.asset.json-decode-ms", "asset-duration", assetSamples],
		["host.mixed.step-ms", "cpu-duration", stepSamples],
	] as const)
		if (samples.length > 0)
			metrics.push(
				makeMetric({
					id,
					semantic,
					granularity: "event",
					clockDomain: "host-monotonic",
					source,
					samples,
				}),
			);
	metrics.push(
		makeMetric({
			id: "host.touched-memory.bytes",
			semantic: "memory",
			unit: "bytes",
			granularity: "event",
			source,
			samples: [
				{
					at: totalMs,
					value: touchCount > 0 ? memory.byteLength : 0,
					valid: true,
				},
			],
		}),
	);
	metrics.push(
		makeMetric({
			id: "host.elapsed-ms",
			semantic: "cpu-duration",
			granularity: "event",
			source,
			samples: [{ at: totalMs, value: totalMs, valid: true }],
		}),
	);
	for (const [id, value] of [
		["host.completed-updates", completedUpdates],
		["host.memory-touches", touchCount],
		["host.asset-decoded-bytes", decodedBytes],
		["host.cpu-checksum", cpuChecksum],
		["host.memory-checksum", memoryChecksum],
		["host.asset-checksum", decodeChecksum],
	] as const)
		metrics.push(
			makeMetric({
				id,
				semantic: id === "host.asset-decoded-bytes" ? "bytes" : "counter",
				unit: id === "host.asset-decoded-bytes" ? "bytes" : "count",
				granularity: "event",
				source,
				samples: [{ at: totalMs, value, valid: true }],
			}),
		);
	memory = new Uint8Array(0);
	const claims: CapacityClaim[] = metrics
		.filter((metric) => metric.unit === "ms" && metric.id !== "host.elapsed-ms")
		.map((metric) => ({
			id: `${metric.id}.bounded`,
			kind: "threshold",
			metricId: metric.id,
			operator: "lte",
			threshold: maxDurationMs,
			unit: "ms",
			statistic: "max",
			requiresMeasured: true,
			minimumSamples: iterations,
		}));
	const run = makeRun({
		id: options.id ?? `host-${Date.now()}`,
		evidenceClass: "capacity",
		provenance: "node-host",
		startedAt,
		endedAt,
		environment: {
			runtime: host.version ?? "node",
			device: `host ${host.arch ?? "unknown-arch"} (coarse hint; not a quota)`,
			os: host.platform ?? "unknown",
			browser: "not-applicable",
			revision: options.revision ?? "unrecorded",
			buildHash: options.buildHash ?? "unrecorded",
		},
		configuration: {
			workloadHash: "host-functional-workloads.v1",
			capabilityHash: `node-${host.version ?? "unknown"}-${host.platform ?? "unknown"}-${host.arch ?? "unknown"}`,
			seed: 1,
			axes: {
				iterations,
				updatesPerIteration: active.includes("cpu") ? updates : 0,
				memoryMiB: active.includes("memory") ? memoryMiB : 0,
				assetBytes: active.includes("asset") ? assetBytes : 0,
				actualAssetBytes: active.includes("asset") ? assetWireBytes : 0,
				mode,
				workloadSet: active.join("+"),
				maxDurationMs,
				memoryMeaning:
					"distinct Uint8Array bytes written; not process PSS or free memory",
				assetMeaning: "JSON text parse; not GLB/KTX2/GPU upload",
			},
		},
		profile: {
			id: "host-bounded-functional.v1",
			version: "1",
			status: "frozen",
			scope: "host",
			minimumSamples: 1,
			minimumDurationMs: 0,
			requiredClaims: claims,
			stopRules: [
				{
					id: "host.wall-watchdog",
					version: "1",
					metricId: "host.elapsed-ms",
					processId: source.processId,
					source: source.tool,
					watermark: maxDurationMs,
					operator: "gte",
				},
				{
					id: "host.allocation-bound",
					version: "1",
					metricId: "host.touched-memory.bytes",
					processId: source.processId,
					source: source.tool,
					watermark: HOST_LIMITS.memoryMiB * 1_048_576 + 1,
					operator: "gte",
				},
			],
		},
		metrics,
		status: aborted || stopped ? "aborted" : "completed",
	});
	return parseRunRecord(run);
}
