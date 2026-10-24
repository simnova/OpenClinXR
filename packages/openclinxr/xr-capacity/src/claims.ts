import { summarizeMetric } from "./metric-summary.js";
import type { CapacityClaim, CapacityRun, ClaimEvaluation } from "./types.js";

const frameSemantics = new Set([
	"cpu-duration",
	"gpu-duration",
	"callback-gap",
	"display-gap",
]);

function scopeReasons(run: CapacityRun): string[] {
	if (run.profile.scope === "host" && run.provenance !== "node-host")
		return ["host scope requires node-host observations"];
	if (run.profile.scope === "desktop" && run.provenance !== "desktop-browser")
		return ["desktop scope requires desktop-browser observations"];
	if (run.profile.scope === "quest")
		return [
			"v1 has no independently trusted native collector; imported assertions and matching session tuples cannot establish Quest capacity",
		];
	return [];
}
export function evaluateClaim(
	run: CapacityRun,
	claim: CapacityClaim,
): ClaimEvaluation {
	const metric = run.metrics.find((item) => item.id === claim.metricId);
	const reasons = scopeReasons(run);
	const criterion = `${claim.id}: ${claim.statistic} ${claim.operator === "lte" ? "≤" : "≥"} ${claim.threshold} ${claim.unit} (${run.profile.scope} scope)`;
	if (run.provenance === "synthetic")
		reasons.push("synthetic fixtures verify harness semantics only");
	if (run.evidenceClass !== "capacity")
		reasons.push("smoke evidence cannot validate a capacity profile");
	if (run.profile.status !== "frozen")
		reasons.push(
			"profile is provisional; thresholds are not frozen acceptance criteria",
		);
	if (
		Date.parse(run.endedAt) - Date.parse(run.startedAt) <
		run.profile.minimumDurationMs
	)
		reasons.push("minimum observation duration not reached");
	if (!metric)
		return {
			id: claim.id,
			criterion,
			outcome: "inconclusive",
			reasons: [...reasons, `missing metric ${claim.metricId}`],
			summary: null,
		};
	const summary = summarizeMetric(metric);
	if (
		["audio-acoustic", "motion-to-photon", "display-gap"].includes(
			metric.semantic,
		) ||
		["audio-acoustic", "motion-to-photon", "full-rate"].includes(claim.kind)
	)
		reasons.push(
			"v1 has no trusted physical/native collector; external tool names and clocks are not measurement authority",
		);
	if (
		metric.semantic === "gpu-duration" &&
		(run.provenance !== "desktop-browser" ||
			run.profile.scope !== "desktop" ||
			metric.source.tool !== "webgl-timer-query" ||
			metric.clockDomain !== "browser-monotonic")
	)
		reasons.push(
			"browser GPU measurement requires desktop browser scope and completed asynchronous WebGL query provenance; host/native labels cannot substitute",
		);

	if (
		(/^quest[.:/-]/i.test(claim.id) || /^quest[.:/-]/i.test(metric.id)) &&
		run.profile.scope !== "quest"
	)
		reasons.push(
			"Quest-named claims/metrics cannot be validated in host or desktop scope",
		);
	if (/smoke/i.test(metric.source.tool))
		reasons.push("legacy smoke collectors cannot establish capacity evidence");
	if (metric.kind === "unavailable")
		reasons.push(metric.unavailableReason ?? "metric unavailable");
	if (metric.kind === "proxy" && claim.requiresMeasured)
		reasons.push("proxy observation cannot satisfy a measured claim");
	if (
		metric.semantic === "gpu-duration" &&
		metric.kind === "measured" &&
		![
			"webgl-timer-query",
			"metavr",
			"ovr-metrics",
			"ovrgpuprofiler",
			"perfetto",
		].includes(metric.source.tool)
	)
		reasons.push(
			"GPU duration source is not a supported asynchronous GPU/profiler measurement",
		);
	if (
		metric.semantic === "gpu-duration" &&
		!["browser-monotonic", "xr-session", "compositor"].includes(
			metric.clockDomain,
		)
	)
		reasons.push(
			"GPU duration does not have a supported browser/runtime clock",
		);
	if (
		metric.semantic === "audio-acoustic" &&
		(metric.clockDomain !== "external-acoustic" ||
			metric.source.tool !== "external-acoustic-loopback")
	)
		reasons.push("acoustic source family/clock mismatch");
	if (
		metric.semantic === "motion-to-photon" &&
		(metric.clockDomain !== "external-photon" ||
			!["external-highspeed-camera", "external-photon-sensor"].includes(
				metric.source.tool,
			))
	)
		reasons.push("photon source family/clock mismatch");
	if (
		metric.semantic === "display-gap" &&
		(metric.clockDomain !== "compositor" ||
			!["metavr", "perfetto", "ovr-metrics"].includes(metric.source.tool))
	)
		reasons.push("presentation source family/clock mismatch");
	if (claim.unit !== metric.unit) reasons.push("claim and metric units differ");
	if (
		summary.validSamples <
		Math.max(run.profile.minimumSamples, claim.minimumSamples)
	)
		reasons.push("insufficient valid observations");
	if (metric.droppedSamples > 0 || run.ringDroppedSamples > 0)
		reasons.push("sample drops invalidate this capture's capacity claim");
	if (summary.rejectedSamples > 0)
		reasons.push(
			"capture contains invalid, disjoint or placeholder observations",
		);
	if (summary[claim.statistic] === null)
		reasons.push(`${claim.statistic} is unavailable at this observation count`);
	if (
		metric.granularity === "aggregate-window" &&
		(frameSemantics.has(metric.semantic) ||
			claim.kind === "full-rate" ||
			claim.kind === "cadence")
	)
		reasons.push(
			"aggregate-window statistics cannot establish per-frame timing or burst claims",
		);
	if (
		run.profile.scope === "quest" &&
		metric.source.processId !== run.nativeSession?.processId
	)
		reasons.push("metric process does not match native browser process");
	if (metric.transportState === "pending")
		reasons.push(
			"transport negotiation is pending; construction is not connection success",
		);
	if (metric.transportState === "failed")
		return {
			id: claim.id,
			criterion,
			outcome: "failed",
			reasons: [...reasons, "transport negotiation failed"],
			summary,
		};
	if (
		claim.kind === "network" &&
		(metric.semantic !== "network-rtt" ||
			metric.transportState !== "connected" ||
			!["host-monotonic", "browser-monotonic"].includes(metric.clockDomain))
	)
		reasons.push(
			"network delivery needs connected transport and client-clock echo RTT; bufferedAmount is not delivered/unacked work",
		);
	if (
		claim.kind === "cadence" &&
		(metric.semantic !== "callback-gap" ||
			metric.timingDenominator === null ||
			!["browser-monotonic", "xr-session"].includes(metric.clockDomain))
	)
		reasons.push(
			"cadence requires callback gaps with a named browser/session denominator",
		);
	if (
		claim.kind === "audio-software" &&
		(metric.semantic !== "audio-software" ||
			!["host-monotonic", "browser-monotonic"].includes(metric.clockDomain))
	)
		reasons.push("software audio timing needs its own monotonic clock");
	if (
		claim.kind === "audio-acoustic" &&
		(metric.semantic !== "audio-acoustic" ||
			metric.clockDomain !== "external-acoustic" ||
			metric.kind !== "measured" ||
			metric.source.tool !== "external-acoustic-loopback")
	)
		reasons.push(
			"acoustic latency requires external acoustic measurement; software estimates cannot prove it",
		);
	if (
		claim.kind === "motion-to-photon" &&
		(metric.semantic !== "motion-to-photon" ||
			metric.clockDomain !== "external-photon" ||
			metric.kind !== "measured" ||
			!["external-highspeed-camera", "external-photon-sensor"].includes(
				metric.source.tool,
			))
	)
		reasons.push("motion-to-photon requires an external physical measurement");
	if (claim.kind === "full-rate") {
		if (run.profile.scope !== "quest")
			reasons.push("full-rate is a native Quest claim");
		if (
			metric.timingDenominator?.kind !== "compositorDisplay" ||
			metric.timingDenominator.source.processId !==
				run.nativeSession?.processId ||
			metric.clockDomain !== "compositor" ||
			metric.kind !== "measured"
		)
			reasons.push(
				"full-rate requires measured compositor display timing and attributed denominator",
			);
		if (metric.granularity !== "per-frame")
			reasons.push("full-rate requires per-frame observations");
		if (
			metric.semantic !== "display-gap" ||
			!["metavr", "perfetto", "ovr-metrics"].includes(metric.source.tool)
		)
			reasons.push(
				"full-rate requires attributed compositor presentation observations, not callback or CPU timings",
			);
		for (const semantic of ["cpu-duration", "gpu-duration"] as const) {
			const timing = run.metrics.find(
				(item) =>
					item.semantic === semantic &&
					item.kind === "measured" &&
					item.granularity === "per-frame" &&
					item.timingDenominator?.kind === "compositorDisplay" &&
					item.source.processId === run.nativeSession?.processId &&
					item.timingDenominator.source.processId ===
						run.nativeSession?.processId &&
					item.timingDenominator.periodMs ===
						metric.timingDenominator?.periodMs &&
					["compositor", "browser-monotonic", "xr-session"].includes(
						item.clockDomain,
					) &&
					(semantic !== "gpu-duration" ||
						[
							"webgl-timer-query",
							"metavr",
							"ovr-metrics",
							"ovrgpuprofiler",
							"perfetto",
						].includes(item.source.tool)),
			);
			if (
				!timing ||
				timing.droppedSamples > 0 ||
				timing.invalidSampleCount > 0 ||
				summarizeMetric(timing).validSamples <
					Math.max(run.profile.minimumSamples, claim.minimumSamples)
			)
				reasons.push(`full-rate lacks valid attributed per-frame ${semantic}`);
		}
	}
	if (reasons.length > 0)
		return {
			id: claim.id,
			criterion,
			outcome: "inconclusive",
			reasons,
			summary,
		};
	const value = summary[claim.statistic];
	const pass =
		value !== null &&
		(claim.operator === "lte"
			? value <= claim.threshold
			: value >= claim.threshold);
	return {
		id: claim.id,
		criterion,
		outcome: pass ? "validated-profile" : "failed",
		reasons: pass
			? []
			: [
					`${claim.statistic} ${String(value)} ${metric.unit} violates ${claim.operator} ${claim.threshold}`,
				],
		summary,
	};
}
