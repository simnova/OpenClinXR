import type { CapacityMetric, MetricSample, MetricSummary } from "./types.js";

function quantile(sorted: number[], fraction: number): number | null {
	if (sorted.length === 0) return null;
	// Nearest-rank estimator; never interpolate an observation that was not collected.
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}
export function validSample(
	sample: MetricSample,
): sample is MetricSample & { value: number } {
	return (
		sample.valid &&
		!sample.disjoint &&
		!sample.placeholder &&
		sample.value !== null &&
		Number.isFinite(sample.value) &&
		sample.value >= 0
	);
}

/** Raw observations only; aggregate window quantiles retain their aggregate label. */
export function summarizeMetric(metric: CapacityMetric): MetricSummary {
	const reasons: string[] = [];
	const raw = metric.samples
		.filter(validSample)
		.filter((sample) => metric.semantic !== "gpu-duration" || sample.value > 0);
	const metavrPlaceholder =
		metric.source.tool.toLowerCase() === "metavr" &&
		metric.granularity === "aggregate-window" &&
		raw.length < 20;
	if (metavrPlaceholder)
		reasons.push(
			"metavr aggregate has fewer than 20 observations; placeholder statistics are unusable",
		);
	if (metric.kind === "unavailable")
		reasons.push(metric.unavailableReason ?? "unavailable");
	if (metric.droppedSamples > 0) reasons.push("collector dropped samples");
	const samples = metavrPlaceholder || metric.kind === "unavailable" ? [] : raw;
	const sorted = samples.map((sample) => sample.value).sort((a, b) => a - b);
	if (sorted.length < 20)
		reasons.push("p95 requires at least 20 valid raw observations");
	if (sorted.length < 100)
		reasons.push("p99 requires at least 100 valid raw observations");
	let lateCallbackCount: number | null = null;
	let longestLateBurst: number | null = null;
	if (
		metric.semantic === "callback-gap" &&
		metric.granularity === "per-frame" &&
		metric.timingDenominator &&
		metric.unit === "ms"
	) {
		let burst = 0;
		lateCallbackCount = 0;
		longestLateBurst = 0;
		// Invalid/disjoint records break observed continuity, so no burst bridges a missing observation.
		for (const sample of metric.samples) {
			if (
				validSample(sample) &&
				sample.value > metric.timingDenominator.periodMs * 1.5
			) {
				lateCallbackCount++;
				burst++;
				longestLateBurst = Math.max(longestLateBurst, burst);
			} else burst = 0;
		}
	}
	return {
		id: metric.id,
		kind: metric.kind,
		granularity: metric.granularity,
		validSamples: sorted.length,
		rejectedSamples: metric.samples.length - sorted.length,
		p50: quantile(sorted, 0.5),
		p95: sorted.length >= 20 ? quantile(sorted, 0.95) : null,
		p99: sorted.length >= 100 ? quantile(sorted, 0.99) : null,
		min: sorted[0] ?? null,
		max: sorted.at(-1) ?? null,
		lateCallbackCount,
		longestLateBurst,
		reasons,
	};
}
