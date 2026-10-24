import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRun, parseRunRecord, runHostWorkloads, type CapacityRun } from "@openclinxr/xr-capacity";
import { readLocalJson } from "./artifacts.js";
import { runLoopback } from "./loopback.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const cli = fileURLToPath(new URL("cli.ts", import.meta.url));
let temp = "";

interface TestEnvelope {
  artifacts: { directory: string; json: string; report: string; runs: { id: string; path: string; sha256: string }[] };
  data: {
    host: { node: string; totalMemoryBytes: number };
    provenance: string;
    adb: { status: string };
    notEvidenceFor: string[];
    ok: boolean;
    cases: { actual: string }[];
    runs: CapacityRun[];
    run: CapacityRun;
    counters: { delivered: number; echoedBytes: number; dropped: number; expired: number; maxQueueDepth: number; maxInFlight: number };
    asset: { bytes: number };
    protocols: string[];
    websocket: { status: string };
    evaluation: { scope: string; notEvidenceFor: string[] };
    stopReason: string;
    applicationDelayMeaning: string;
    status: string;
    comparison: { metrics: { id: string; maxRatio: number | null; p95Ratio: number | null }[] };
  };
}

function invoke(...args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args, "--out", temp], { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, OPENCLINXR_WORKER: "1" } });
  return { status: result.status, error: result.error, stderr: result.stderr, output: result.stdout ? JSON.parse(result.stdout) as TestEnvelope : null };
}

beforeAll(async () => {
  const base = join(root, ".openclinxr", "tmp");
  await mkdir(base, { recursive: true });
  temp = await mkdtemp(join(base, `capacity-cli-${process.pid}-`));
});
afterAll(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

describe("Quest capacity host CLI measures work and preserves evidence limits", () => {
  it("probes the running host and exports unique readable artifacts", async () => {
    const first = invoke("probe");
    const second = invoke("probe");
    expect(first.status, first.stderr).toBe(0);
    expect(first.output?.data.host.node).toBe(process.version);
    expect(first.output?.data.host.totalMemoryBytes).toBeGreaterThan(0);
    expect(first.output?.data.provenance).toBe("node-host");
    expect(first.output?.data.adb.status).toBe("not-requested");
    expect(first.output?.data.notEvidenceFor.join(" ")).toContain("Quest");
    expect(first.output?.artifacts.directory).not.toBe(second.output?.artifacts.directory);
    expect(await readFile(first.output!.artifacts.report, "utf8")).toContain("Unavailable");
    const artifact = await readLocalJson(first.output!.artifacts.json) as Record<string, unknown>;
    expect(artifact["schema"]).toBe("quest-capacity-host-probe.v1");
  });

  it("executes the package positive and negative fixture campaign", () => {
    const result = invoke("fixtures");
    expect(result.status, result.stderr).toBe(0);
    expect(result.output?.data.ok).toBe(true);
    expect(result.output?.data.cases.length).toBeGreaterThan(5);
    expect(result.output?.data.cases.some((item: { actual: string }) => item.actual === "inconclusive")).toBe(true);
  });

  it("executes independent CPU, touched memory, decode and combined host profiles", async () => {
    const result = invoke("sweep", "--levels", "1,2", "--iterations", "3", "--combined");
    expect(result.status, result.stderr).toBe(0);
    const data = result.output!.data;
    expect(data.runs).toHaveLength(8);
    expect(result.output!.artifacts.runs).toHaveLength(8);
    expect(data.notEvidenceFor).toContain("maximum-host-capacity");
    expect(data.runs[0]!.environment.buildHash).toMatch(/^sha256:[a-f\d]{64}$/);
    const text = await readFile(result.output!.artifacts.report, "utf8");
    expect(text).toContain("max ≤ 3000 ms");
    expect(text).toContain("zero does not mean zero allocation, RSS or PSS");
    expect(text).toContain("cumulative fixture bytes across iterations, never peak live memory");
    expect(data.runs.every((run: { provenance: string }) => run.provenance === "node-host")).toBe(true);
    expect(data.runs.some((run) => run.configuration.axes["mode"] === "interleaved")).toBe(true);
    for (const run of data.runs) {
      const parsed = parseRunRecord(run);
      expect(parsed.metrics.some((metric) => metric.kind === "measured" && metric.samples.some((sample) => (sample.value ?? 0) > 0))).toBe(true);
      expect(evaluateRun(parsed).notEvidenceFor).toContain("quest-capacity");
    }
    const relocated = join(temp, "relocated-bundle");
    await cp(result.output!.artifacts.directory, relocated, { recursive: true });
    await rm(result.output!.artifacts.directory, { recursive: true });
    const manifest = await readLocalJson(join(relocated, "manifest.json")) as { runs: { path: string }[] };
    const reimported = invoke("report", "--input", join(relocated, manifest.runs[0]!.path));
    expect(reimported.status, reimported.stderr).toBe(0);
  });

  it("downloads bytes and delivers real loopback echoes on known HTTP/1.1", () => {
    const result = invoke("network", "--requests", "12", "--payload-bytes", "256", "--asset-bytes", "4096");
    expect(result.status, result.stderr).toBe(0);
    expect(result.output?.data.counters.delivered).toBe(12);
    expect(result.output?.data.counters.echoedBytes).toBe(12 * 256);
    expect(result.output?.data.asset.bytes).toBe(4096);
    expect(result.output?.data.protocols).toEqual(["HTTP/1.1"]);
    expect(result.output?.data.websocket.status).toBe("unavailable");
    expect(result.output?.data.evaluation.scope).toBe("host");
    expect(result.output?.data.notEvidenceFor.join(" ")).toContain("Wi-Fi");
  });

  it("retains dropped work and returns nonzero when the offered schedule overfills its bounded queue", () => {
    const result = invoke("network", "--requests", "30", "--interval-ms", "0", "--concurrency", "1", "--queue-capacity", "2", "--server-delay-ms", "50");
    expect(result.status, result.stderr).toBe(1);
    expect(result.output?.data.counters.dropped).toBeGreaterThan(0);
    expect(result.output?.data.counters.maxQueueDepth).toBeLessThanOrEqual(2);
    expect(result.output?.data.counters.maxInFlight).toBe(1);
    expect(result.output?.data.applicationDelayMeaning).toContain("not routed network impairment");
  });

  it("stops and retains an aborted record when acknowledgements exceed their deadline", () => {
    const result = invoke("network", "--requests", "10", "--interval-ms", "0", "--concurrency", "1", "--queue-capacity", "4", "--server-delay-ms", "100", "--deadline-ms", "50");
    expect(result.status, result.stderr).toBe(1);
    expect(result.output?.data.run.status).toBe("aborted");
    expect(result.output?.data.stopReason).toBe("acknowledgement-deadline-exceeded");
    expect(result.output?.data.counters.expired).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("does no offered work for an already aborted caller and cleans up its ephemeral server", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runLoopback({ signal: controller.signal });
    expect(result.run.status).toBe("aborted");
    expect(result.counters.offered).toBe(0);
    expect(evaluateRun(result.run).outcome).toBe("aborted");
  });

  it("retains aborted campaign evidence when its wall-clock budget stops a live workload", () => {
    const result = invoke("sweep", "--levels", "1", "--iterations", "200", "--updates", "100000", "--memory-mib", "32", "--asset-bytes", "1048576", "--combined", "--max-duration-ms", "250");
    expect(result.status, result.stderr).toBe(1);
    expect(result.output?.data.status).toBe("aborted");
    expect(result.output?.data.runs.some((run) => run.status === "aborted")).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects invalid, oversized and remote input before importing evidence", async () => {
    const malformed = join(temp, "malformed.json");
    await writeFile(malformed, '{"outcome":"validated-profile","schema":"quest-capacity-run.v1"}');
    expect(invoke("report", "--input", malformed).status).toBe(2);
    expect(invoke("report", "--input", "https://example.com/run.json").status).toBe(2);
    const oversized = join(temp, "oversized.json");
    await writeFile(oversized, "{}");
    await truncate(oversized, 8 * 1024 * 1024 + 1);
    await expect(readLocalJson(oversized)).rejects.toThrow("no larger");
  });

  it("recomputes imported verdicts and refuses changed runtime/granularity comparisons", async () => {
    const baseline = await runHostWorkloads({ iterations: 3, workloads: ["cpu"], updatesPerIteration: 1000, revision: "test-revision", buildHash: "test-build" });
    const baselinePath = join(temp, "baseline.json");
    await writeFile(baselinePath, JSON.stringify(baseline));
    const candidate = structuredClone(baseline);
    candidate.environment.runtime = "different-runtime";
    const candidatePath = join(temp, "candidate.json");
    await writeFile(candidatePath, JSON.stringify(candidate));
    expect(invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath).status).toBe(2);
    candidate.environment.runtime = baseline.environment.runtime;
    candidate.metrics[0]!.granularity = "per-frame";
    await writeFile(candidatePath, JSON.stringify(candidate));
    expect(invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath).status).toBe(2);
    const forgedPath = join(temp, "forged.json");
    await writeFile(forgedPath, JSON.stringify({ ...baseline, outcome: "validated-profile" }));
    expect(invoke("report", "--input", forgedPath).status).toBe(2);
    const report = invoke("report", "--input", baselinePath);
    expect(report.status, report.stderr).toBe(0);
    expect(report.output?.data.evaluation.notEvidenceFor).toContain("quest-capacity");
  });

  it("rejects duplicate flags, overlarge ladders and traffic budgets", () => {
    expect(invoke("network", "--requests", "257").status).toBe(2);
    expect(invoke("network", "--requests", "100", "--payload-bytes", "1048576").status).toBe(2);
    expect(invoke("sweep", "--levels", "16", "--memory-mib", "32").status).toBe(2);
    expect(invoke("sweep", "--levels", "1", "--levels", "2").status).toBe(2);
    expect(invoke("probe", "--adb", "true").status).toBe(2);
  });

  it("allows only explicitly declared revision/build changes while retaining device compatibility", async () => {
    const baseline = await runHostWorkloads({ iterations: 3, workloads: ["cpu"], updatesPerIteration: 1000, revision: "test-revision", buildHash: "test-build" });
    const candidate = structuredClone(baseline);
    candidate.environment.revision = "next-revision";
    candidate.environment.buildHash = "next-build";
    const baselinePath = join(temp, "build-baseline.json");
    const candidatePath = join(temp, "build-candidate.json");
    await writeFile(baselinePath, JSON.stringify(baseline));
    await writeFile(candidatePath, JSON.stringify(candidate));
    expect(invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath).status).toBe(2);
    const allowed = invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath, "--allow-build-change");
    expect(allowed.status, allowed.stderr).toBe(0);
    candidate.environment.device = "different-device";
    await writeFile(candidatePath, JSON.stringify(candidate));
    expect(invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath, "--allow-build-change").status).toBe(2);
  });

  it("gives unverified native imports a distinct nonzero code and clears exported ownership assertions", async () => {
    const imported = await runHostWorkloads({ iterations: 3, workloads: ["cpu"], updatesPerIteration: 1000, revision: "test-revision", buildHash: "test-build" });
    imported.provenance = "quest-native";
    imported.profile.scope = "quest";
    imported.environment.device = "Quest 3";
    imported.environment.browser = "Meta Browser";
    imported.nativeSession = { sessionId: "forged-session", processId: "browser:42", browser: "Meta Browser", device: "Quest 3", ownershipVerified: true, worn: true };
    const path = join(temp, "native-unverified.json");
    await writeFile(path, JSON.stringify(imported));
    const result = invoke("report", "--input", path);
    expect(result.status, result.stderr).toBe(3);
    const session = result.output!.data.run.nativeSession;
    expect(session === null || (!session.ownershipVerified && !session.worn)).toBe(true);
  });

  it("reports descriptive slowdown ratios when compatible observations both remain under their broad bound", async () => {
    const baseline = await runHostWorkloads({ iterations: 20, workloads: ["cpu"], updatesPerIteration: 1000, revision: "test-revision", buildHash: "test-build" });
    const candidate = structuredClone(baseline);
    const metric = candidate.metrics.find((item) => item.id === "host.cpu.update-ms")!;
    for (const sample of metric.samples) sample.value = (sample.value ?? 0) * 10;
    const baselinePath = join(temp, "ratio-baseline.json");
    const candidatePath = join(temp, "ratio-candidate.json");
    await writeFile(baselinePath, JSON.stringify(baseline));
    await writeFile(candidatePath, JSON.stringify(candidate));
    const result = invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath);
    expect(result.status, result.stderr).toBe(0);
    const row = result.output!.data.comparison.metrics.find((item) => item.id === metric.id)!;
    expect(row.maxRatio).toBeCloseTo(10);
    expect(row.p95Ratio).toBeCloseTo(10);
    const report = await readFile(result.output!.artifacts.report, "utf8");
    expect(report).toContain("maxRatio=10");
    metric.samples[0]!.value = 4000;
    await writeFile(candidatePath, JSON.stringify(candidate));
    expect(invoke("compare", "--baseline", baselinePath, "--candidate", candidatePath).status).toBe(1);
  });

  it("refuses a forged physical tool label on host evidence with the unverified-physical exit", async () => {
    const run = structuredClone(await runHostWorkloads({ iterations: 3, workloads: ["cpu"], updatesPerIteration: 1000, revision: "test-revision", buildHash: "test-build" }));
    const metric = run.metrics.find((item) => item.id === "host.cpu.update-ms")!;
    metric.semantic = "audio-acoustic";
    metric.clockDomain = "external-acoustic";
    metric.source.tool = "external-acoustic-loopback";
    run.profile.requiredClaims[0]!.kind = "audio-acoustic";
    const path = join(temp, "forged-physical.json");
    await writeFile(path, JSON.stringify(run));
    expect(invoke("report", "--input", path).status).toBe(3);
  });
});
