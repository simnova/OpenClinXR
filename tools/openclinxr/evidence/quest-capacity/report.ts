import { evaluateRun, summarizeMetric, type CapacityRun } from "@openclinxr/xr-capacity";

export function runReport(run: CapacityRun): string {
  const evaluation = evaluateRun(run);
  const metrics = run.metrics.map((metric) => {
    const summary = summarizeMetric(metric);
    const value = (number: number | null) => number === null ? "unavailable" : number.toFixed(3);
    return `${metric.id} [${metric.kind}; ${metric.granularity}; ${metric.unit}]: n=${summary.validSamples}, rejected=${summary.rejectedSamples}, p50=${value(summary.p50)}, p95=${value(summary.p95)}, p99=${value(summary.p99)}, max=${value(summary.max)}${metric.unavailableReason ? `; ${metric.unavailableReason}` : ""}`;
  });
  return [
    `Run ${run.id}: ${evaluation.outcome}`,
    `Provenance: ${run.provenance}; profile scope: ${run.profile.scope}; evidence class: ${run.evidenceClass}`,
    `Runtime: ${run.environment.runtime}; device: ${run.environment.device}; OS: ${run.environment.os}`,
    `Configuration: ${JSON.stringify(run.configuration.axes)}`,
    ...(run.provenance === "node-host" ? ["Host bounded measurements exclude maximum-host-capacity."] : []),
    ...(run.metrics.some((metric) => metric.id === "host.touched-memory.bytes") ? ["Touched-memory bytes count only the explicit Uint8Array actually written; zero does not mean zero allocation, RSS or PSS. Asset-decoded bytes are cumulative fixture bytes across iterations, never peak live memory."] : []),
    ...metrics,
    ...evaluation.claims.map((claim) => {
      const definition = run.profile.requiredClaims.find((item) => item.id === claim.id)!;
      return `Claim ${claim.id}: ${definition.statistic} ${definition.operator === "lte" ? "≤" : "≥"} ${definition.threshold} ${definition.unit}; ${claim.outcome}; ${claim.reasons.join("; ")}`;
    }),
    `Reasons: ${evaluation.reasons.join("; ") || "none"}`,
    `Not evidence for: ${evaluation.notEvidenceFor.join("; ")}`,
  ].join("\n");
}
