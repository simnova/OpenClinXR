import { pathToFileURL } from "node:url";
import { compareRuns, evaluateRun, HOST_LIMITS, parseRunRecord, planCampaign, runFixtureCampaign, runHostWorkloads, type CapacityRun } from "@openclinxr/xr-capacity";
import { allowOptions, axisList, flagOption, integerOption, parseArguments, stringOption, type Options } from "./args.js";
import { exportArtifacts, readLocalJson } from "./artifacts.js";
import { runLoopback } from "./loopback.js";
import { probeHost } from "./probe.js";
import { runReport } from "./report.js";
import { collectBuildIdentity } from "./identity.js";

const commands = {
  probe: "Report current host, local dependency versions, and unavailable physical observations. Optional --adb inventories devices without claiming session ownership.",
  fixtures: "Execute positive/negative evidence fixtures; exit nonzero on an unexpected verdict.",
  sweep: "Execute bounded CPU, touched-memory and JSON decode ladders; optional --combined interleaves the stages.",
  network: "Measure actual local HTTP/1.1 asset download and echo with fixed offered arrivals, bounded queues and ACK deadlines.",
  "secure-check": "Run actual local HTTPS/H2, WSS, WebRTC data/audio and WebTransport stream/datagram browser echoes plus controlled failure fixtures; defaults to visible combined campaign. Dedicated entry secure-check.ts/root quest:capacity:secure-check.",
  compare: "Validate two local run JSON files and apply package equivalence and regression checks.",
  report: "Validate a local run JSON file and export its adjudication and metric distributions.",
  plan: "Export the package's explicit host campaign plan without pretending it was measured.",
};

function help() {
  return {
    schema: "quest-capacity-cli-help.v1",
    commands,
    output: "One machine-readable JSON result on stdout; every execution exports result.json and report.txt to its own unique directory under --out (default .openclinxr/capacity-runs).",
    exits: { "0": "bounded host success or completed smoke operation; never proves headset capacity", "1": "failed profile, compatible-run claim regression, aborted run, or unexpected fixture verdict", "2": "invalid input, refused incompatible comparison, or execution error", "3": "imported native/physical claim remains unverified or inconclusive" },
    examples: [
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts probe",
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts fixtures",
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts sweep --levels 1,2,4 --iterations 12 --combined",
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts network --requests 24 --payload-bytes 1024",
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts compare --baseline /path/run.json --candidate /path/run.json --allow-axes updatesPerIteration",
      "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/cli.ts report --input /path/run.json",
    ],
    sweepBounds: { levels: "1–8 unique integers, each 1–16", iterations: "3–200 per point", perPoint: HOST_LIMITS, campaignDurationMs: "250–60000; abort is retained as evidence" },
    defaults: {
      sweep: { levels: [1, 2, 4], iterations: 12, updates: 5000, memoryMiB: 2, assetBytes: 16384, combined: false, maxDurationMs: 30000, perPointDurationMs: 3000 },
      network: { requests: 24, payloadBytes: 1024, assetBytes: 65536, intervalMs: 2, concurrency: 4, queueCapacity: 16, serverDelayMs: 0, deadlineMs: 2000 },
      outputRoot: ".openclinxr/capacity-runs",
    },
    networkBounds: { requests: [1, 256], payloadBytes: [1, 1048576], totalOfferedPayloadBytes: 67108864, assetBytes: [1, 8388608], intervalMs: [0, 100], concurrency: [1, 16], queueCapacity: [0, 128], serverDelayMs: [0, 100], deadlineMs: [50, 10000] },
    options: {
      common: "--out DIRECTORY creates a unique child directory; it never overwrites an existing run.",
      probe: "--adb performs optional bounded adb devices -l inventory. No device session is started.",
      sweep: "--levels 1,2,4 --iterations N --updates N --memory-mib N --asset-bytes N --combined --max-duration-ms N. Sizes scale by level. Zero disables that resource. Combined mode is single-thread interleaving, not hardware parallelism.",
      network: "--requests N --payload-bytes N --asset-bytes N --interval-ms N --concurrency N --queue-capacity N --server-delay-ms N --deadline-ms N. A private HTTP/1.1 echo/asset server listens on ephemeral 127.0.0.1 and closes in finally. Delay is mock application delay, not routed impairment. First ACK deadline aborts the trial.",
      compare: "--baseline FILE --candidate FILE [--allow-axes axis,axis] [--allow-build-change]. Use exported standalone run JSON files. --allow-build-change declares named cli-explicit-build-change.v1 equivalence for revision/buildHash only. Runtime/device/OS/browser, workload/capability hashes, profile and metric source/meaning/granularity must match. Only explicitly named configuration axes may differ; refused incompatible evidence and regressions exit nonzero.",
      report: "--input FILE accepts a standalone run or the report/network result.json wrapper, revalidates it, and recomputes verdicts. Local regular files only; 8 MiB read limit. Imported outcomes are never trusted.",
      artifacts: "result.json and report.txt hold the complete result, manifest.json indexes standalone run JSON and SHA-256 values for report/compare. Synthetic fixtures verify reducers; a host validated-profile applies only to its bounded host workload.",
      secureCheck: "pnpm quest:capacity:secure-check [--wire-only|--campaign-only] [--level 1|--levels 1,2,3] [--duration-ms 500..5000] [--out DIRECTORY] [--python /path/to/venv/bin/python]. With no --python, creates a private unique temporary uv venv using Python 3.13 and syncs the checked-in fully pinned requirements; free PyPI packages, no global install. Chromium trusts only generated test certificate SPKI for this run; WT uses full DER SHA256 hashes separately. A quiet synthetic tone is muted. Controlled 200 ms server application delay vs 30 ms echo deadlines produces expected failures; it is not routed network impairment. Cleanup removes the key/venv, TLS server, peers and owned browser/app. --wire-only skips visible campaign, not the real protocol checks.",
      secureServe: "pnpm quest:capacity:secure-serve [--app-origin http://127.0.0.1:PORT] [--bind-host 0.0.0.0 --advertise-host LOCAL_IPV4] [--allowed-origin EXACT_ORIGIN] [--echo-delay-ms 0..1000]. Owns a UI-XR server unless --service-only or --app-origin is supplied. Prints manifest and lab URL; Ctrl-C cleans up. Node/OpenSSL/uv+Python 3.13 required; endpoint token is ephemeral test scope. LAN bind is explicit; no STUN/TURN or OS certificate trust changes. HTTP/WSS via USB reverse is a separate path from RTC/QUIC UDP; actual peers must establish the UDP route.",
      browserCheck: "pnpm exec tsx tools/openclinxr/evidence/quest-capacity/browser-check.ts [--out DIRECTORY] [--url http://127.0.0.1:PORT/] checks the actual UI-XR lab, downloads/imports, comparison, cancellation and unavailable graphics. Without --url it owns a portless UI-XR server and cleans it up. Chromium uses a declared software rendering backend; no hardware timing claims.",
    },
    unavailable: "Quest XR/GPU/audio/physical tracking/thermal/Wi-Fi measurements require separate browser, native or physical fixtures. HTTP loopback is not HTTPS, Wi-Fi, WAN, WebSocket, WebRTC or WebTransport evidence.",
  };
}

function exitForRuns(runs: CapacityRun[]): number {
  if (runs.some((run) => ["failed", "aborted"].includes(evaluateRun(run).outcome))) return 1;
  return runs.some((run) => {
    const evaluation = evaluateRun(run);
    const physicalClaims = run.profile.requiredClaims.filter((claim) => ["full-rate", "audio-acoustic", "motion-to-photon"].includes(claim.kind));
    return evaluation.outcome !== "validated-profile" && (run.profile.scope === "quest" || run.provenance === "quest-native" || physicalClaims.length > 0);
  }) ? 3 : 0;
}

async function write(command: string, payload: unknown, report: string, options: Options, exitCode = 0, runs: CapacityRun[] = []) {
  const artifacts = await exportArtifacts(command, payload, report, stringOption(options, "out"), runs);
  return { exitCode, result: { command, artifacts, data: payload } };
}

async function loadRun(path: string): Promise<CapacityRun> {
  const value = await readLocalJson(path);
  // Accept the standalone run record or this CLI's explicit report/network artifact envelope.
  if (typeof value === "object" && value !== null && "run" in value) return parseRunRecord(value.run);
  return parseRunRecord(value);
}

async function sweep(options: Options) {
  allowOptions(options, ["out", "levels", "iterations", "updates", "memory-mib", "asset-bytes", "combined", "max-duration-ms"]);
  const raw = stringOption(options, "levels") ?? "1,2,4";
  const levels = raw.split(",").map((item) => /^\d+$/.test(item) ? Number(item) : Number.NaN);
  if (levels.length < 1 || levels.length > 8 || levels.some((item) => !Number.isSafeInteger(item) || item < 1 || item > 16) || new Set(levels).size !== levels.length) throw new Error("--levels requires 1–8 unique integers in [1, 16]");
  const iterations = integerOption(options, "iterations", 12, 3, 200);
  const updates = integerOption(options, "updates", 5000, 0, HOST_LIMITS.updatesPerIteration);
  const memoryMiB = integerOption(options, "memory-mib", 2, 0, HOST_LIMITS.memoryMiB);
  const assetBytes = integerOption(options, "asset-bytes", 16 * 1024, 0, HOST_LIMITS.assetBytes);
  const largest = Math.max(...levels);
  if (updates * largest > HOST_LIMITS.updatesPerIteration || memoryMiB * largest > HOST_LIMITS.memoryMiB || assetBytes * largest > HOST_LIMITS.assetBytes) throw new Error("Scaled workload exceeds the host safety bound; reduce a base size or level");
  const combined = flagOption(options, "combined");
  const active = (["cpu", "memory", "asset"] as const).filter((workload) => workload === "cpu" ? updates > 0 : workload === "memory" ? memoryMiB > 0 : assetBytes > 0);
  if (active.length === 0) throw new Error("At least one workload size must be greater than zero");
  const maxDurationMs = integerOption(options, "max-duration-ms", 30_000, 250, 60_000);
  const identity = await collectBuildIdentity();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Host campaign duration limit reached")), maxDurationMs);
  const abort = () => controller.abort(new Error("Host campaign interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const runs: CapacityRun[] = [];
  try {
    for (const level of levels) {
      for (const workload of active) {
        if (controller.signal.aborted) break;
        runs.push(await runHostWorkloads({ iterations, updatesPerIteration: updates * level, memoryMiB: memoryMiB * level, assetBytes: assetBytes * level, workloads: [workload], mode: "independent", revision: identity.revision, buildHash: identity.buildHash, signal: controller.signal }));
      }
      if (combined && !controller.signal.aborted) runs.push(await runHostWorkloads({ iterations, updatesPerIteration: updates * level, memoryMiB: memoryMiB * level, assetBytes: assetBytes * level, workloads: active, mode: "interleaved", revision: identity.revision, buildHash: identity.buildHash, signal: controller.signal }));
      if (controller.signal.aborted) break;
    }
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
  const data = { schema: "quest-capacity-host-campaign.v1", status: controller.signal.aborted ? "aborted" : "completed", levels, combined, maxDurationMs, identity, runs, evaluations: runs.map((run) => evaluateRun(run)), notEvidenceFor: [...planCampaign().notEvidenceFor, "Quest capacity or readiness", "GPU frames or browser audio", "simultaneous hardware execution; combined mode interleaves stages in one Node task"] };
  return write("sweep", data, [`Host campaign: ${data.status}. ${runs.length} runs.`, ...runs.map(runReport)].join("\n\n"), options, controller.signal.aborted ? 1 : exitForRuns(runs), runs);
}

export async function execute(argv: string[]) {
  const { command, options } = parseArguments(argv);
  if (command === "help" || command === "--help" || command === "-h") { allowOptions(options, []); return { exitCode: 0, result: help() }; }
  if (command === "secure-check") {
    const { checkSecure } = await import("./secure-check.js");
    const result = await checkSecure(argv.slice(1)); return { exitCode: result.data["ok"] ? 0 : 1, result };
  }
  if (command === "probe") {
    allowOptions(options, ["out", "adb"]);
    const data = await probeHost(flagOption(options, "adb"));
    return write(command, data, `Host probe ${data.observedAt}\n${JSON.stringify(data.host, null, 2)}\nUnavailable:\n${data.unavailable.join("\n")}\nNot evidence for: ${data.notEvidenceFor.join("; ")}`, options);
  }
  if (command === "fixtures") {
    allowOptions(options, ["out"]);
    const data = runFixtureCampaign();
    return write(command, data, `Fixture campaign: ${data.ok ? "passed" : "FAILED"}\n${data.cases.map((item) => `${item.id}: expected ${item.expected}, actual ${item.actual}, ${item.ok ? "matched" : "REGRESSION"}`).join("\n")}\nSynthetic fixtures verify adjudication only.`, options, data.ok ? 0 : 1);
  }
  if (command === "sweep") return sweep(options);
  if (command === "network") {
    allowOptions(options, ["out", "requests", "payload-bytes", "asset-bytes", "interval-ms", "concurrency", "queue-capacity", "server-delay-ms", "deadline-ms"]);
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const data = await runLoopback({ requests: integerOption(options, "requests", 24, 1, 256), payloadBytes: integerOption(options, "payload-bytes", 1024, 1, 1_048_576), assetBytes: integerOption(options, "asset-bytes", 65536, 1, 8_388_608), intervalMs: integerOption(options, "interval-ms", 2, 0, 100), concurrency: integerOption(options, "concurrency", 4, 1, 16), queueCapacity: integerOption(options, "queue-capacity", 16, 0, 128), serverDelayMs: integerOption(options, "server-delay-ms", 0, 0, 100), deadlineMs: integerOption(options, "deadline-ms", 2000, 50, 10_000), signal: controller.signal });
      return write(command, { ...data, evaluation: evaluateRun(data.run) }, `${runReport(data.run)}\nTraffic: ${JSON.stringify(data.counters)}\nProtocols: ${data.protocols.join(", ")}\nNot evidence for: ${data.notEvidenceFor.join("; ")}`, options, exitForRuns([data.run]), [data.run]);
    } finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
  }
  if (command === "report") {
    allowOptions(options, ["out", "input"]);
    const run = await loadRun(stringOption(options, "input", true)!);
    return write(command, { run, evaluation: evaluateRun(run) }, runReport(run), options, exitForRuns([run]), [run]);
  }
  if (command === "compare") {
    allowOptions(options, ["out", "baseline", "candidate", "allow-axes", "allow-build-change"]);
    const [baseline, candidate] = await Promise.all([loadRun(stringOption(options, "baseline", true)!), loadRun(stringOption(options, "candidate", true)!)]);
    const allowedAxes = axisList(options, "allow-axes");
    const allowBuildChange = flagOption(options, "allow-build-change");
    const comparison = compareRuns(baseline, candidate, { allowedAxes, ...(allowBuildChange ? { equivalence: { id: "cli-explicit-build-change.v1", allowedEnvironment: ["revision", "buildHash"] as ("revision" | "buildHash")[] } } : {}) });
    const regression = comparison.outcome === "failed" || comparison.claims.some((claim) => claim.regression);
    const status = comparison.outcome === "failed" ? "refused-incompatible" : regression ? "regression" : "comparable";
    const deltas = comparison.metrics.map((metric) => `${metric.id} [${metric.unit}; ${metric.kind}; ${metric.granularity}] maxDelta=${String(metric.maxDelta)}, maxRatio=${String(metric.maxRatio)}, p95Delta=${String(metric.p95Delta)}, p95Ratio=${String(metric.p95Ratio)}; baseline n=${metric.baseline.samples}, candidate n=${metric.candidate.samples}`);
    return write(command, { status, baselineId: baseline.id, candidateId: candidate.id, permissions: { allowedAxes, allowBuildChange }, comparison }, `Comparison: ${status}\nBuild/revision equivalence explicitly allowed: ${allowBuildChange}\nAllowed configuration axes: ${allowedAxes.join(", ") || "none"}\nRefused differences: ${comparison.differences.join("; ") || "none"}\nAllowed differences: ${comparison.allowedDifferences.join("; ") || "none"}\nDescriptive metric changes within the declared scope (no automatic slowdown acceptance policy):\n${deltas.join("\n")}\n${comparison.claims.map((claim) => `${claim.id}: ${claim.baseline} -> ${claim.candidate}; regression=${claim.regression}`).join("\n")}`, options, comparison.outcome === "failed" ? 2 : regression ? 1 : 0);
  }
  if (command === "plan") {
    allowOptions(options, ["out"]);
    const data = planCampaign();
    return write(command, data, JSON.stringify(data, null, 2), options);
  }
  throw new Error(`Unknown command ${command}; run help for usage`);
}

async function main() {
  try {
    const { exitCode, result } = await execute(process.argv.slice(2));
    const helpRequested = process.argv.length <= 2 || ["help", "--help", "-h"].includes(process.argv[2]!);
    process.stdout.write(`${JSON.stringify(result, null, helpRequested ? 2 : undefined)}\n`);
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown execution error" })}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
