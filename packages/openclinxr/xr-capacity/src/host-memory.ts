import { makeMetric } from "./factories.js";
import type { CapacityMetric, MetricSource } from "./types.js";

/** A process-wide RSS snapshot, not allocation, a peak, free memory or a browser quota. */
export function processMemorySnapshot(
	read: (() => { rss: number }) | undefined,
	at: number,
	source: MetricSource,
): CapacityMetric {
	let rss: number | null = null;
	try {
		const value = read?.().rss;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0)
			rss = value;
	} catch {
		/* Preserve unavailable measurement rather than a fabricated zero. */
	}
	return makeMetric({
		id: "host.process-rss.bytes",
		semantic: "memory",
		unit: "bytes",
		granularity: "event",
		source: { ...source, tool: "process.memoryUsage" },
		kind: rss === null ? "unavailable" : "measured",
		samples: rss === null ? [] : [{ at, value: rss, valid: true }],
		unavailableReason:
			rss === null
				? "Node process RSS API unavailable; touched fixture bytes are not process allocation"
				: null,
	});
}
