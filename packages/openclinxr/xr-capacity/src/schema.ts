import type { CapacityRun, MetricSemantic, ValidationResult } from "./types.js";
import {
	CAPACITY_LIMITS,
	array,
	bool,
	choice,
	date,
	fail,
	integer,
	number,
	object,
	semanticUnits,
	semantics,
	source,
	text,
	unique,
	units,
} from "./schema-primitives.js";
export {
	CAPACITY_LIMITS,
	CapacityValidationError,
} from "./schema-primitives.js";

/** Strict JSON boundary. Unknown fields, nonfinite values, forged units and oversized arrays fail closed. */
export function parseRunRecord(input: unknown): CapacityRun {
	let parsed = input;
	if (typeof input === "string") {
		if (
			input.length > CAPACITY_LIMITS.inputBytes ||
			new TextEncoder().encode(input).byteLength > CAPACITY_LIMITS.inputBytes
		)
			fail("run", "input exceeds byte limit");
		try {
			parsed = JSON.parse(input) as unknown;
		} catch {
			fail("run", "invalid JSON");
		}
	}
	const r = object(parsed, "run", [
		"schema",
		"id",
		"evidenceClass",
		"provenance",
		"startedAt",
		"endedAt",
		"environment",
		"configuration",
		"nativeSession",
		"profile",
		"metrics",
		"artifacts",
		"status",
		"ringDroppedSamples",
	]);
	choice(r["schema"], "schema", ["quest-capacity-run.v1"]);
	text(r["id"], "id", 128);
	choice(r["evidenceClass"], "evidenceClass", ["smoke", "capacity"]);
	choice(r["provenance"], "provenance", [
		"synthetic",
		"node-host",
		"desktop-browser",
		"quest-browser",
		"browser-unverified",
		"quest-native",
	]);
	if (date(r["endedAt"], "endedAt") < date(r["startedAt"], "startedAt"))
		fail("endedAt", "precedes start");
	const e = object(r["environment"], "environment", [
		"runtime",
		"device",
		"os",
		"browser",
		"revision",
		"buildHash",
	]);
	for (const key of Object.keys(e)) text(e[key], `environment.${key}`);
	const config = object(r["configuration"], "configuration", [
		"workloadHash",
		"capabilityHash",
		"seed",
		"axes",
	]);
	text(config["workloadHash"], "configuration.workloadHash");
	text(config["capabilityHash"], "configuration.capabilityHash");
	integer(config["seed"], "configuration.seed", 0xffff_ffff);
	if (
		!config["axes"] ||
		typeof config["axes"] !== "object" ||
		Array.isArray(config["axes"])
	)
		fail("configuration.axes", "expected object");
	const axisKeys = Object.keys(config["axes"]);
	if (axisKeys.length > CAPACITY_LIMITS.axes)
		fail("configuration.axes", "too many axes");
	const axes = object(config["axes"], "configuration.axes", axisKeys);
	for (const key of axisKeys) {
		text(key, "configuration.axis key", 80);
		const value = axes[key];
		if (typeof value === "string") text(value, `configuration.axes.${key}`);
		else if (typeof value === "number")
			number(value, `configuration.axes.${key}`);
		else if (value !== null && typeof value !== "boolean")
			fail(`configuration.axes.${key}`, "expected a scalar");
	}
	if (r["nativeSession"] !== null) {
		const n = object(r["nativeSession"], "nativeSession", [
			"sessionId",
			"processId",
			"browser",
			"device",
			"ownershipVerified",
			"worn",
		]);
		for (const key of ["sessionId", "processId", "browser", "device"])
			text(n[key], `nativeSession.${key}`);
		bool(n["ownershipVerified"], "nativeSession.ownershipVerified");
		bool(n["worn"], "nativeSession.worn");
	}
	const p = object(r["profile"], "profile", [
		"id",
		"version",
		"status",
		"scope",
		"minimumSamples",
		"minimumDurationMs",
		"requiredClaims",
		"stopRules",
	]);
	text(p["id"], "profile.id");
	text(p["version"], "profile.version");
	choice(p["status"], "profile.status", ["provisional", "frozen"]);
	choice(p["scope"], "profile.scope", ["host", "desktop", "quest"]);
	integer(
		p["minimumSamples"],
		"profile.minimumSamples",
		CAPACITY_LIMITS.samplesPerMetric,
	);
	number(p["minimumDurationMs"], "profile.minimumDurationMs", 86_400_000);
	const claims = array(
		p["requiredClaims"],
		"profile.requiredClaims",
		CAPACITY_LIMITS.claims,
	);
	const claimIds: string[] = [];
	for (const [i, value] of claims.entries()) {
		const path = `profile.requiredClaims[${i}]`;
		const c = object(value, path, [
			"id",
			"kind",
			"metricId",
			"operator",
			"threshold",
			"unit",
			"statistic",
			"requiresMeasured",
			"minimumSamples",
		]);
		text(c["id"], `${path}.id`);
		claimIds.push(c["id"]);
		text(c["metricId"], `${path}.metricId`);
		choice(c["kind"], `${path}.kind`, [
			"threshold",
			"full-rate",
			"cadence",
			"network",
			"audio-software",
			"audio-acoustic",
			"motion-to-photon",
		]);
		choice(c["operator"], `${path}.operator`, ["lte", "gte"]);
		number(c["threshold"], `${path}.threshold`);
		choice(c["unit"], `${path}.unit`, units);
		choice(c["statistic"], `${path}.statistic`, [
			"p50",
			"p95",
			"p99",
			"max",
			"min",
		]);
		bool(c["requiresMeasured"], `${path}.requiresMeasured`);
		integer(
			c["minimumSamples"],
			`${path}.minimumSamples`,
			CAPACITY_LIMITS.samplesPerMetric,
		);
	}
	unique(claimIds, "profile.requiredClaims");
	const stopRules = array(
		p["stopRules"],
		"profile.stopRules",
		CAPACITY_LIMITS.stopRules,
	);
	const stopIds: string[] = [];
	for (const [i, value] of stopRules.entries()) {
		const path = `profile.stopRules[${i}]`;
		const s = object(value, path, [
			"id",
			"version",
			"metricId",
			"processId",
			"source",
			"watermark",
			"operator",
		]);
		for (const key of ["id", "version", "metricId", "processId", "source"])
			text(s[key], `${path}.${key}`);
		stopIds.push(s["id"] as string);
		number(s["watermark"], `${path}.watermark`);
		choice(s["operator"], `${path}.operator`, ["gte", "lte"]);
	}
	unique(stopIds, "profile.stopRules");
	const metrics = array(r["metrics"], "metrics", CAPACITY_LIMITS.metrics);
	let totalSamples = 0;
	const metricIds: string[] = [];
	for (const [i, value] of metrics.entries()) {
		const path = `metrics[${i}]`;
		const m = object(value, path, [
			"id",
			"semantic",
			"unit",
			"kind",
			"granularity",
			"clockDomain",
			"source",
			"samples",
			"sampleCount",
			"invalidSampleCount",
			"droppedSamples",
			"windowMs",
			"timingDenominator",
			"unavailableReason",
			"transportState",
		]);
		text(m["id"], `${path}.id`);
		metricIds.push(m["id"]);
		choice(m["semantic"], `${path}.semantic`, semantics);
		choice(m["unit"], `${path}.unit`, units);
		if (m["unit"] !== semanticUnits[m["semantic"] as MetricSemantic])
			fail(`${path}.unit`, "does not match metric semantic");
		choice(m["kind"], `${path}.kind`, ["measured", "proxy", "unavailable"]);
		choice(m["granularity"], `${path}.granularity`, [
			"per-frame",
			"aggregate-window",
			"event",
		]);
		choice(m["clockDomain"], `${path}.clockDomain`, [
			"host-monotonic",
			"browser-monotonic",
			"xr-session",
			"compositor",
			"server-monotonic",
			"external-acoustic",
			"external-photon",
		]);
		source(m["source"], `${path}.source`);
		integer(
			m["sampleCount"],
			`${path}.sampleCount`,
			CAPACITY_LIMITS.samplesPerMetric,
		);
		integer(
			m["invalidSampleCount"],
			`${path}.invalidSampleCount`,
			CAPACITY_LIMITS.samplesPerMetric,
		);
		integer(m["droppedSamples"], `${path}.droppedSamples`);
		if (m["windowMs"] !== null) {
			number(m["windowMs"], `${path}.windowMs`, 86_400_000);
			if (m["windowMs"] === 0) fail(`${path}.windowMs`, "must be positive");
		}
		if (m["granularity"] === "aggregate-window" && m["windowMs"] === null)
			fail(`${path}.windowMs`, "aggregate measurements require a window");
		if (m["granularity"] !== "aggregate-window" && m["windowMs"] !== null)
			fail(`${path}.windowMs`, "only aggregate measurements have a window");
		if (m["timingDenominator"] !== null) {
			const t = object(m["timingDenominator"], `${path}.timingDenominator`, [
				"kind",
				"periodMs",
				"source",
			]);
			choice(t["kind"], `${path}.timingDenominator.kind`, [
				"sessionTarget",
				"compositorDisplay",
				"callbackMedian",
			]);
			number(t["periodMs"], `${path}.timingDenominator.periodMs`, 1000);
			if (t["periodMs"] === 0)
				fail(`${path}.timingDenominator.periodMs`, "must be positive");
			source(t["source"], `${path}.timingDenominator.source`);
		}
		if (m["unavailableReason"] !== null)
			text(m["unavailableReason"], `${path}.unavailableReason`);
		if (m["kind"] === "unavailable" && m["unavailableReason"] === null)
			fail(`${path}.unavailableReason`, "unavailable metric needs a reason");
		choice(m["transportState"], `${path}.transportState`, [
			"not-applicable",
			"pending",
			"connected",
			"failed",
		]);
		const samples = array(
			m["samples"],
			`${path}.samples`,
			CAPACITY_LIMITS.samplesPerMetric,
		);
		totalSamples += samples.length;
		if (totalSamples > CAPACITY_LIMITS.samplesTotal)
			fail("metrics", "total sample limit exceeded");
		if (m["sampleCount"] !== samples.length)
			fail(`${path}.sampleCount`, "must equal raw sample count");
		let lastAt = -1;
		let invalid = 0;
		for (const [j, raw] of samples.entries()) {
			const samplePath = `${path}.samples[${j}]`;
			// Optional flags are deliberately limited to these two JSON properties.
			const optional =
				raw && typeof raw === "object"
					? Object.keys(raw).filter(
							(key) => key === "disjoint" || key === "placeholder",
						)
					: [];
			const s = object(raw, samplePath, ["at", "value", "valid", ...optional]);
			number(s["at"], `${samplePath}.at`);
			if (
				s["at"] < lastAt ||
				(m["granularity"] === "per-frame" && s["at"] === lastAt)
			)
				fail(
					`${samplePath}.at`,
					"timestamps must be monotonic and per-frame observations must advance",
				);
			lastAt = s["at"];
			if (s["value"] !== null) number(s["value"], `${samplePath}.value`);
			bool(s["valid"], `${samplePath}.valid`);
			for (const key of optional) bool(s[key], `${samplePath}.${key}`);
			if (s["valid"] && s["value"] === null)
				fail(`${samplePath}.value`, "valid sample needs a value");
			if (
				!s["valid"] ||
				s["value"] === null ||
				s["disjoint"] === true ||
				s["placeholder"] === true
			)
				invalid++;
		}
		if (m["invalidSampleCount"] !== invalid)
			fail(
				`${path}.invalidSampleCount`,
				"does not match raw invalid/disjoint/placeholder count",
			);
		if (m["kind"] === "unavailable" && samples.length !== 0)
			fail(
				`${path}.samples`,
				"unavailable metrics cannot contain observations",
			);
	}
	unique(metricIds, "metrics");
	const artifacts = array(
		r["artifacts"],
		"artifacts",
		CAPACITY_LIMITS.artifacts,
	);
	const artifactIds: string[] = [];
	for (const [i, value] of artifacts.entries()) {
		const path = `artifacts[${i}]`;
		const a = object(value, path, ["id", "kind", "path", "sha256"]);
		for (const key of ["id", "kind", "path"]) text(a[key], `${path}.${key}`);
		artifactIds.push(a["id"] as string);
		text(a["sha256"], `${path}.sha256`, 64);
		if (!/^[a-f0-9]{64}$/.test(a["sha256"]))
			fail(`${path}.sha256`, "expected lowercase SHA-256");
	}
	unique(artifactIds, "artifacts");
	choice(r["status"], "status", [
		"planned",
		"completed",
		"aborted",
		"unsupported",
	]);
	integer(r["ringDroppedSamples"], "ringDroppedSamples");
	// Validation returns detached JSON so an importer cannot mutate checked properties through aliases.
	const canonical = JSON.parse(JSON.stringify(parsed)) as CapacityRun;
	// v1 has no trusted native collector. Imported session assertions are not portable authority.
	canonical.nativeSession = null;
	return canonical;
}

/** Non-throwing capacity record validator. Returns the parsed run or a list of boundary errors. */
export function validateRunRecord(input: unknown): ValidationResult {
	try {
		return { ok: true, run: parseRunRecord(input), errors: [] };
	} catch (error) {
		return {
			ok: false,
			errors: [
				error instanceof Error ? error.message : "Invalid capacity record",
			],
		};
	}
}
