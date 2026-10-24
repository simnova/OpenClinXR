import { parseRunRecord } from "./schema.js";
import { evaluateClaim } from "./claims.js";
import { validSample, summarizeMetric } from "./metric-summary.js";
import type {
	CapacityMetric,
	CapacityRun,
	ComparisonResult,
	EvaluationContext,
	Outcome,
	RunEvaluation,
} from "./types.js";

const forbiddenClaims = [
	"quest-readiness",
	"clinical-validity",
	"scoring-validity",
	"exam-equivalence",
	"unmeasured-resource-capacity",
	"maximum-host-capacity",
	"visual-quality",
	"physical-comfort",
	"quest-capacity",
	"physical-tracking",
	"physical-audio-latency",
	"motion-to-photon-latency",
];
/** Revalidates typed callers too; outcomes are derived. Native/physical claims remain inconclusive in v1, and caller-supplied context tuples grant no authority. */
export function evaluateRun(
	input: CapacityRun,
	_context: EvaluationContext = {},
): RunEvaluation {
	const run = parseRunRecord(input);
	const claims = run.profile.requiredClaims.map((claim) =>
		evaluateClaim(run, claim),
	);
	const reasons: string[] = [];
	let outcome: Outcome;
	if (run.status === "planned") outcome = "planned";
	else if (run.status === "aborted") outcome = "aborted";
	else if (run.status === "unsupported") outcome = "unsupported";
	else if (claims.some((claim) => claim.outcome === "failed"))
		outcome = "failed";
	else if (
		claims.length === 0 ||
		claims.some((claim) => claim.outcome !== "validated-profile")
	)
		outcome = "inconclusive";
	else outcome = "validated-profile";
	if (run.profile.requiredClaims.length === 0)
		reasons.push("no acceptance claims configured");
	const stops = evaluateStopRules(run);
	if (run.status === "completed" && stops.triggered.length > 0) {
		outcome = "failed";
		reasons.push(
			...stops.triggered.map((id) => `bounded pressure stop ${id} reached`),
		);
	}
	if (run.status === "completed" && stops.unavailable.length > 0) {
		if (outcome !== "failed") outcome = "inconclusive";
		reasons.push(
			...stops.unavailable.map(
				(id) => `stop rule ${id} lacks matching metric/process/source`,
			),
		);
	}
	if (
		run.profile.stopRules.length === 0 &&
		run.profile.requiredClaims.length > 0
	) {
		if (outcome === "validated-profile") outcome = "inconclusive";
		reasons.push("no bounded stop metric configured");
	}
	// A run-level failure is retained even when independent claims passed.
	return {
		outcome,
		scope: run.profile.scope,
		claims,
		reasons,
		notEvidenceFor: [...forbiddenClaims],
	};
}

/** Evaluates bounded pressure stop rules for a run. Reports triggered and unavailable rule ids without mutating the record. */
export function evaluateStopRules(run: CapacityRun): {
	triggered: string[];
	unavailable: string[];
} {
	const triggered: string[] = [];
	const unavailable: string[] = [];
	for (const rule of run.profile.stopRules) {
		const metric = run.metrics.find(
			(item) =>
				item.id === rule.metricId &&
				item.source.processId === rule.processId &&
				item.source.tool === rule.source &&
				item.kind === "measured",
		);
		if (
			!metric ||
			metric.samples.filter(validSample).length === 0 ||
			metric.droppedSamples > 0 ||
			metric.invalidSampleCount > 0
		) {
			unavailable.push(rule.id);
			continue;
		}
		if (
			metric.samples.some(
				(sample) =>
					validSample(sample) &&
					(rule.operator === "gte"
						? sample.value >= rule.watermark
						: sample.value <= rule.watermark),
			)
		)
			triggered.push(rule.id);
	}
	return { triggered, unavailable };
}

/** Only explicit axis differences are allowed; workload-equivalence hashes never waive silently. */
export function compareRuns(
	baselineInput: CapacityRun,
	candidateInput: CapacityRun,
	options: {
		allowedAxes?: string[];
		equivalence?: {
			id: string;
			allowedEnvironment: ("revision" | "buildHash")[];
		};
	} = {},
): ComparisonResult {
	const baseline = parseRunRecord(baselineInput);
	const candidate = parseRunRecord(candidateInput);
	const differences: string[] = [];
	const allowedDifferences: string[] = [];
	for (const [label, run] of [
		["baseline", baseline],
		["candidate", candidate],
	] as const)
		for (const key of ["revision", "buildHash"] as const) {
			if (
				!run.environment[key].trim() ||
				/^(unrecorded|unavailable|unknown|unmeasured|not-applicable|none|missing|placeholder)(?:$|[ :._-])/i.test(
					run.environment[key],
				)
			)
				differences.push(
					`${label}.environment.${key} lacks a reproducible build identity`,
				);
		}

	const equivalence = options.equivalence
		? {
				id: options.equivalence.id,
				allowedEnvironment: [...options.equivalence.allowedEnvironment],
			}
		: null;
	const allowedEnvironment = new Set<string>();
	if (equivalence) {
		if (
			typeof equivalence.id !== "string" ||
			equivalence.id.trim().length === 0 ||
			equivalence.id.length > 128 ||
			/[\r\n]/.test(equivalence.id)
		)
			differences.push("equivalence requires a nonempty bounded review id");
		else
			for (const key of equivalence.allowedEnvironment) {
				if (key !== "revision" && key !== "buildHash")
					differences.push(
						`forbidden equivalent environment field ${String(key)}`,
					);
				else allowedEnvironment.add(key);
			}
	}
	const allowed = new Set(options.allowedAxes ?? []);
	for (const key of allowed)
		if (
			!Object.hasOwn(baseline.configuration.axes, key) ||
			!Object.hasOwn(candidate.configuration.axes, key)
		)
			differences.push(`unknown allowed axis ${key}`);
	const fields = ["evidenceClass", "provenance"] as const;
	for (const key of fields)
		if (baseline[key] !== candidate[key]) differences.push(key);
	for (const key of Object.keys(
		baseline.environment,
	) as (keyof CapacityRun["environment"])[])
		if (baseline.environment[key] !== candidate.environment[key])
			(allowedEnvironment.has(key) ? allowedDifferences : differences).push(
				`environment.${key}`,
			);
	if (
		baseline.configuration.workloadHash !== candidate.configuration.workloadHash
	)
		differences.push("configuration.workloadHash");
	if (
		baseline.configuration.capabilityHash !==
		candidate.configuration.capabilityHash
	)
		differences.push("configuration.capabilityHash");
	if (baseline.configuration.seed !== candidate.configuration.seed)
		differences.push("configuration.seed");
	// Process IDs are correlated within a run; a fresh browser/host process is expected in another run.
	const profileIdentity = (run: CapacityRun): unknown => ({
		...run.profile,
		stopRules: run.profile.stopRules.map(
			({ processId: _processId, ...rule }) => rule,
		),
	});
	if (
		JSON.stringify(profileIdentity(baseline)) !==
		JSON.stringify(profileIdentity(candidate))
	)
		differences.push("profile");
	const ids = new Set([
		...baseline.metrics.map((metric) => metric.id),
		...candidate.metrics.map((metric) => metric.id),
	]);
	for (const id of ids) {
		const leftMetric = baseline.metrics.find((metric) => metric.id === id),
			rightMetric = candidate.metrics.find((metric) => metric.id === id);
		if (!leftMetric || !rightMetric) {
			differences.push(`metrics.${id}.presence`);
			continue;
		}
		for (const key of [
			"semantic",
			"unit",
			"kind",
			"granularity",
			"clockDomain",
			"windowMs",
			"transportState",
		] as const)
			if (leftMetric[key] !== rightMetric[key])
				differences.push(`metrics.${id}.${key}`);
		for (const key of ["tool", "version"] as const)
			if (leftMetric.source[key] !== rightMetric.source[key])
				differences.push(`metrics.${id}.source.${key}`);
		const denominatorIdentity = (metric: CapacityMetric): unknown =>
			metric.timingDenominator
				? {
						kind: metric.timingDenominator.kind,
						periodMs: metric.timingDenominator.periodMs,
						tool: metric.timingDenominator.source.tool,
						version: metric.timingDenominator.source.version,
					}
				: null;
		if (
			JSON.stringify(denominatorIdentity(leftMetric)) !==
			JSON.stringify(denominatorIdentity(rightMetric))
		)
			differences.push(`metrics.${id}.timingDenominator`);
	}
	for (const key of new Set([
		...Object.keys(baseline.configuration.axes),
		...Object.keys(candidate.configuration.axes),
	])) {
		if (
			baseline.configuration.axes[key] !== candidate.configuration.axes[key] ||
			Object.hasOwn(baseline.configuration.axes, key) !==
				Object.hasOwn(candidate.configuration.axes, key)
		) {
			(allowed.has(key) ? allowedDifferences : differences).push(
				`configuration.axes.${key}`,
			);
		}
	}
	const left = evaluateRun(baseline);
	const right = evaluateRun(candidate);
	const claims = left.claims.map((claim) => {
		const next = right.claims.find((item) => item.id === claim.id);
		const outcome = next?.outcome ?? "inconclusive";
		return {
			id: claim.id,
			baseline: claim.outcome,
			candidate: outcome,
			baselineSamples: claim.summary?.validSamples ?? null,
			candidateSamples: next?.summary?.validSamples ?? null,
			regression:
				claim.outcome === "validated-profile" &&
				outcome !== "validated-profile",
		};
	});
	const ratio = (a: number | null, b: number | null): number | null =>
		a !== null && b !== null && a > 0 ? b / a : null;
	const delta = (a: number | null, b: number | null): number | null =>
		a !== null && b !== null ? b - a : null;
	const metrics =
		differences.length === 0
			? baseline.metrics.map((metric) => {
					const next = candidate.metrics.find((item) => item.id === metric.id)!;
					const leftSummary = summarizeMetric(metric),
						rightSummary = summarizeMetric(next);
					return {
						id: metric.id,
						unit: metric.unit,
						kind: metric.kind,
						granularity: metric.granularity,
						baseline: {
							samples: leftSummary.validSamples,
							max: leftSummary.max,
							p95: leftSummary.p95,
						},
						candidate: {
							samples: rightSummary.validSamples,
							max: rightSummary.max,
							p95: rightSummary.p95,
						},
						maxDelta: delta(leftSummary.max, rightSummary.max),
						maxRatio: ratio(leftSummary.max, rightSummary.max),
						p95Delta: delta(leftSummary.p95, rightSummary.p95),
						p95Ratio: ratio(leftSummary.p95, rightSummary.p95),
					};
				})
			: [];
	return {
		outcome: differences.length > 0 ? "failed" : "comparable",
		compatibility: differences.length > 0 ? "incompatible" : "compatible",
		equivalence,
		differences,
		allowedDifferences,
		claims,
		metrics,
	};
}
