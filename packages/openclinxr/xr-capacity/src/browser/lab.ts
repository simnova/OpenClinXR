import { compareRuns, evaluateRun, runFixtureCampaign, summarizeMetric, validateRunRecord } from "../index.js";
import type { CapacityRun } from "../types.js";
import { collectCapabilities, hashManifest, runAudioProbe, runBrowserProbe, type BrowserSuite, type CapabilityManifest } from "./probes.js";
import { browserIdentity } from "./identity.js";
import { mountCampaignPanel, type CampaignPanel } from "./campaign-lab.js";
import { labStyles } from "./styles.js";

export const MAX_IMPORT_BYTES = 1024 * 1024;
export function importRunJson(text: string): CapacityRun {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("Run exceeds the 1 MiB import limit.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Choose a valid JSON run file."); }
  const result = validateRunRecord(value);
  if (!result.ok) throw new Error(`Invalid run: ${result.errors.slice(0, 4).join("; ")}`);
  // A fresh owned record, with no imported precomputed evaluation/outcome fields.
  const run = result.run;
  return structuredClone({ schema: run.schema, id: run.id, evidenceClass: run.evidenceClass, provenance: run.provenance, startedAt: run.startedAt, endedAt: run.endedAt, environment: run.environment, configuration: run.configuration, nativeSession: run.nativeSession, profile: run.profile, metrics: run.metrics, artifacts: run.artifacts, status: run.status, ringDroppedSamples: run.ringDroppedSamples });
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const result = node("button", label);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}
function format(value: number | null, unit = ""): string { return value === null ? "unavailable" : `${Number(value.toFixed(3))}${unit ? ` ${unit}` : ""}`; }
const suites: { id: BrowserSuite; title: string; detail: string }[] = [
  { id: "cadence", title: "Callback cadence", detail: "Page rAF timestamps; no compositor or display timing." },
  { id: "cpu", title: "CPU updates", detail: "Deterministic trigonometric update loops and checksum." },
  { id: "memory", title: "Memory touch", detail: "1 / 4 / 12 MiB fixture; cache-line touch timing, no RAM ceiling." },
  { id: "asset", title: "Asset steps", detail: "Local Blob → PNG ImageBitmap → Canvas2D readback; no HTTP or GLB claim." },
  { id: "render", title: "Raw WebGL2", detail: "16 / 64 / 160 triangle draws with fragment-work ladder at 384²." },
  { id: "three", title: "Matched Three.js", detail: "Same 384² triangle positions, shader arithmetic and draw ladder through Three.js." },
  { id: "movement", title: "Three.js movement updates", detail: "64 / 256 / 1024 Object3D position, rotation and world-matrix updates; no physical tracking claim." },
  { id: "glb", title: "GLB parse + first render", detail: "Generated embedded GLB → GLTFLoader → shader preparation → upload/render/readback; 1 / 8 / 32 instances." },
  { id: "mixed", title: "Combined load", detail: "Raw rendering, CPU, Object3D movement, memory touch and one local PNG in the same trial." },
];
export interface CapacityLabHandle { dispose: () => void }
export function mountCapacityLab(root: HTMLElement): CapacityLabHandle {
  let disposed = false;
  let active: AbortController | null = null;
  let campaignPanel: CampaignPanel | null = null;
  let manifest: CapabilityManifest | null = null;
  let selected: CapacityRun | null = null;
  const runs: CapacityRun[] = [];
  const imported = new Set<string>();
  const downloadUrls = new Set<string>();
  const style = node("style", labStyles);
  const shell = node("main", "", "capacity-lab");
  const eyebrow = node("div", "OPENCLINXR / ENGINEERING", "capacity-eyebrow");
  const heading = node("h1", "Capacity lab");
  const subtitle = node("p", "Measure a controlled workload. Preserve what the evidence can actually say.", "capacity-subtitle");
  const header = node("header"); header.append(eyebrow, heading, subtitle);
  const scope = node("div", browserIdentity().label, "capacity-scope");
  const status = node("span", "Ready", "capacity-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const notice = node("p", "A completed run means the probe executed. Provisional smoke profiles do not establish maximum capacity, Quest readiness, or physical latency.", "capacity-notice");
  const controls = node("section", "", "capacity-panel capacity-controls"); controls.append(node("h2", "Controlled workloads"));
  const suite = node("select"); suite.setAttribute("aria-label", "Workload suite");
  for (const item of suites) { const option = node("option", item.title); option.value = item.id; suite.append(option); }
  const detail = node("p", suites[0]?.detail ?? "", "capacity-muted");
  suite.addEventListener("change", () => { detail.textContent = suites.find((item) => item.id === suite.value)?.detail ?? ""; });
  const bound = node("p", "Three fixed levels · 650 ms each + at most 4 GPU polling frames · 12 MiB memory-touch buffer · 15 s watchdog. Switch tabs or press Stop to cancel.", "capacity-muted");
  const actionRow = node("div", "", "capacity-actions");
  const message = node("p", "Collecting API capabilities…", "capacity-message"); message.setAttribute("aria-live", "polite");
  const renderCanvas = node("canvas"); renderCanvas.width = 384; renderCanvas.height = 384; renderCanvas.setAttribute("aria-label", "Raw WebGL workload preview");
  const assetCanvas = node("canvas"); assetCanvas.width = 128; assetCanvas.height = 128; assetCanvas.setAttribute("aria-label", "Decoded local asset preview");
  const preview = node("section", "", "capacity-panel"); preview.append(node("h2", "Live workload"), node("p", "Actual fixture output appears during rendering. The final image is a static snapshot retained after graphics cleanup.", "capacity-muted"));
  const canvases = node("div", "", "capacity-canvases"); canvases.append(renderCanvas, assetCanvas); preview.append(canvases);
  const capabilities = node("section", "", "capacity-panel"); capabilities.append(node("h2", "Capability fingerprint"));
  const capabilityList = node("dl", "", "capacity-capabilities"); capabilities.append(capabilityList, node("p", "API presence and a support query are declarations. Successful operations are recorded separately in runs.", "capacity-muted"));
  const unavailable = node("section", "", "capacity-panel"); unavailable.append(node("h2", "Not measured in this lab"));
  const unknowns = node("ul");
  for (const text of ["Quest CPU/GPU, process RAM and sustained thermal limits", "Native immersive session, compositor and physical movement timing", "Acoustic round-trip and physical headset input/output routes", "Maximum Wi-Fi/server capacity and independently attributed physical network routes", "IWSDK, KTX2, skeletal actors and production station envelopes"]) unknowns.append(node("li", text));
  unavailable.append(unknowns, node("p", "Not collected here. Missing values stay unavailable; they are never zero.", "capacity-muted"));
  const report = node("section", "", "capacity-panel capacity-report"); report.append(node("h2", "Run evidence"));
  const selectRun = node("select"); selectRun.setAttribute("aria-label", "Selected run"); selectRun.disabled = true;
  const summary = node("p", "No measurements yet.", "capacity-notice");
  const table = node("table"); table.setAttribute("aria-label", "Metric summaries");
  const thead = node("thead"); const tr = node("tr");
  for (const title of ["Metric / meaning", "Kind", "Samples", "p50", "p95"]) tr.append(node("th", title));
  thead.append(tr); const tbody = node("tbody"); table.append(thead, tbody);
  const tableScroll = node("div", "", "capacity-table-scroll"); tableScroll.append(table);
  const curve = node("canvas"); curve.width = 760; curve.height = 170; curve.setAttribute("aria-label", "Last three levels callback p95 curve in milliseconds");
  const curveCaption = node("p", "The curve shows callback-gap p95 by workload level, not display FPS.", "capacity-muted");
  const exportButton = button("Export selected run", () => {
    if (!selected) return;
    // Validate and own the snapshot again at the boundary; no computed outcome is serialized.
    const canonical = importRunJson(JSON.stringify(selected));
    const url = URL.createObjectURL(new Blob([JSON.stringify(canonical, null, 2)], { type: "application/json" }));
    downloadUrls.add(url);
    const anchor = node("a"); anchor.href = url; anchor.download = `capacity-run-${Date.now()}.json`; anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 500);
  }); exportButton.disabled = true;
  const file = node("input"); file.type = "file"; file.accept = ".json,application/json"; file.setAttribute("aria-label", "Import run JSON");
  const importLabel = node("label", "Import run JSON (≤1 MiB) "); importLabel.append(file);
  const comparison = node("section", "", "capacity-panel"); comparison.append(node("h2", "Compare reproducible runs"));
  const baseline = node("select"); baseline.setAttribute("aria-label", "Baseline run");
  const candidate = node("select"); candidate.setAttribute("aria-label", "Candidate run");
  const allowLevel = node("input"); allowLevel.type = "checkbox";
  const allowLabel = node("label", " Allow workload level difference"); allowLabel.prepend(allowLevel);
  const allowBackend = node("input"); allowBackend.type = "checkbox";
  const backendLabel = node("label", " Allow matched raw WebGL2 / Three.js backend difference"); backendLabel.prepend(allowBackend);
  const allowBuild = node("input"); allowBuild.type = "checkbox";
  const buildLabel = node("label", " Compare across application builds"); buildLabel.prepend(allowBuild);
  const equivalenceId = node("input"); equivalenceId.type = "text"; equivalenceId.maxLength = 128; equivalenceId.placeholder = "Reviewed equivalence ID"; equivalenceId.setAttribute("aria-label", "Reviewed build equivalence ID");
  const equivalenceLabel = node("label", "Review reference for revision / build changes "); equivalenceLabel.append(equivalenceId);
  const comparisonResult = node("p", "Import a previous run or collect two runs. Environment and workload mismatches are checked before comparing claims.", "capacity-muted");
  const deltaTable = node("table"); deltaTable.setAttribute("aria-label", "Descriptive metric comparison");
  const deltaHead = node("thead"); const deltaTitles = node("tr");
  for (const title of ["Metric", "Baseline max", "Candidate max", "Δ max", "Baseline p95", "Candidate p95", "Δ p95", "Samples B / C"]) deltaTitles.append(node("th", title));
  deltaHead.append(deltaTitles); const deltaBody = node("tbody"); deltaTable.append(deltaHead, deltaBody);
  const deltaScroll = node("div", "", "capacity-table-scroll"); deltaScroll.append(deltaTable);
  const compareButton = button("Compare runs", () => {
    const first = runs[Number(baseline.value)]; const second = runs[Number(candidate.value)];
    if (!first || !second) { comparisonResult.textContent = "Choose two runs first."; return; }
    const result = compareRuns(first, second, { allowedAxes: [...(allowLevel.checked ? ["level"] : []), ...(allowBackend.checked ? ["backend"] : [])], ...(allowBuild.checked ? { equivalence: { id: equivalenceId.value.trim(), allowedEnvironment: ["revision", "buildHash"] as ("revision" | "buildHash")[] } } : {}) });
    comparisonResult.textContent = `${result.compatibility === "incompatible" ? "incompatible / comparison refused" : "comparable"}. ${result.differences.join("; ") || "No disallowed configuration differences."} ${result.allowedDifferences.length ? `Reviewed differences: ${result.allowedDifferences.join(", ")}. ` : ""}${result.claims.length ? `${result.claims.filter((claim) => claim.regression).length} declared-claim regression(s).` : "No frozen performance claims in these smoke runs; metric deltas are descriptive only."}`;
    deltaBody.replaceChildren();
    for (const metric of result.metrics) {
      const row = node("tr");
      for (const value of [`${metric.id} · ${metric.kind} / ${metric.granularity}`, format(metric.baseline.max, metric.unit), format(metric.candidate.max, metric.unit), format(metric.maxDelta, metric.unit), format(metric.baseline.p95, metric.unit), format(metric.candidate.p95, metric.unit), format(metric.p95Delta, metric.unit), `${metric.baseline.samples} / ${metric.candidate.samples}`]) row.append(node("td", value));
      deltaBody.append(row);
    }
  }); compareButton.disabled = true;
  comparison.append(node("p", "Baseline"), baseline, node("p", "Candidate"), candidate, allowLabel, backendLabel, buildLabel, equivalenceLabel, compareButton, comparisonResult, deltaScroll);
  const invalidateComparison = () => { comparisonResult.textContent = "Selections changed. Compare the current runs again."; deltaBody.replaceChildren(); };
  suite.addEventListener("change", invalidateComparison);
  for (const control of [baseline, candidate, allowLevel, allowBackend, allowBuild]) control.addEventListener("change", invalidateComparison);
  equivalenceId.addEventListener("input", invalidateComparison);
  function setStatus(text: "Ready" | "Running" | "Stopped" | "Completed" | "Failed"): void { status.textContent = text; status.dataset['state'] = text.toLowerCase(); }
  function updateButtons(): void { const busy = Boolean(active) || Boolean(campaignPanel?.isRunning()); runButton.disabled = busy || !manifest; audioButton.disabled = busy || !manifest || !manifest.audio.context; microphoneButton.disabled = busy || !manifest || !manifest.audio.captureApiPresent || !manifest.secureContext; syntheticButton.disabled = busy; stopButton.disabled = !busy; suite.disabled = busy; }
  function drawCurve(): void {
    const context = curve.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, curve.width, curve.height);
    const latestSuite = selected?.configuration.axes['suite'];
    const points = runs.filter((run) => run.provenance === "desktop-browser" && run.configuration.axes['suite'] === latestSuite).slice(-3).map((run) => { const gap = run.metrics.find((item) => item.id === "browser.raf-callback-gap"); return { level: Number(run.configuration.axes['level']), value: gap ? summarizeMetric(gap).p95 : null }; });
    context.fillStyle = "#91a8bd"; context.font = "13px system-ui";
    context.fillText("Callback-gap p95 (ms)", 14, 20);
    const values = points.map((point) => point.value).filter((value): value is number => value !== null && Number.isFinite(value));
    if (!values.length) { context.fillText("No callback samples for this suite", 14, 70); return; }
    const max = Math.max(20, ...values) * 1.15;
    context.strokeStyle = "#304457"; context.beginPath(); context.moveTo(45, 35); context.lineTo(45, 135); context.lineTo(720, 135); context.stroke();
    context.strokeStyle = "#f2bc64"; context.fillStyle = "#f2bc64"; context.lineWidth = 2; context.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      const point = points[i]; if (!point || point.value === null || !Number.isFinite(point.value)) continue;
      const x = 100 + i * 280; const y = 130 - point.value / max * 90;
      if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
      context.fillText(`L${point.level}: ${format(point.value, "ms")}`, x - 35, 157);
    }
    context.stroke();
  }
  function showRun(run: CapacityRun): void {
    selected = run; tbody.replaceChildren();
    const evaluation = evaluateRun(run); // Never trust an imported precomputed result.
    summary.textContent = `${run.status} · ${run.provenance} · ${run.evidenceClass} · evaluation: ${evaluation.outcome}. ${imported.has(run.id) ? "Imported evidence is not authenticated. " : ""}${evaluation.reasons.join(" ")} Not evidence for Quest readiness, clinical validity, scoring validity, exam equivalence or physical latency.`;
    for (const value of run.metrics) {
      const stats = summarizeMetric(value); const row = node("tr");
      row.append(node("td", `${value.id} · ${value.semantic}${value.unavailableReason ? ` — ${value.unavailableReason}` : ""}`), node("td", value.kind), node("td", `${stats.validSamples} valid / ${stats.rejectedSamples} rejected / ${value.droppedSamples} dropped`), node("td", format(stats.p50, value.unit)), node("td", format(stats.p95, value.unit)));
      tbody.append(row);
    }
    exportButton.disabled = false; drawCurve();
  }
  function addRun(run: CapacityRun, isImport = false): void {
    invalidateComparison();
    const owned = importRunJson(JSON.stringify(run));
    if (runs.length >= 24) { const removed = runs.shift(); if (removed) imported.delete(removed.id); }
    runs.push(owned); if (isImport) imported.add(owned.id);
    for (const control of [selectRun, baseline, candidate]) {
      const previous = control.value; control.replaceChildren();
      runs.forEach((item, i) => { const option = node("option", `${i + 1}. ${item.provenance} / ${String(item.configuration.axes['suite'] ?? item.id).slice(0, 70)} / ${String(item.configuration.axes['backend'] ?? "—")} / level ${String(item.configuration.axes['level'] ?? "—")}`); option.value = String(i); control.append(option); });
      control.disabled = false; control.value = previous || "0";
    }
    selectRun.value = String(runs.length - 1); candidate.value = String(runs.length - 1); compareButton.disabled = runs.length < 2;
    showRun(owned);
  }
  selectRun.addEventListener("change", () => { const run = runs[Number(selectRun.value)]; if (run) showRun(run); });
  file.addEventListener("change", () => {
    invalidateComparison();
    const selectedFile = file.files?.[0]; file.value = ""; if (!selectedFile) return;
    if (selectedFile.size > MAX_IMPORT_BYTES) { message.textContent = "Import rejected: file exceeds 1 MiB."; return; }
    void selectedFile.text().then((text) => { if (disposed) return; addRun(importRunJson(text), true); message.textContent = "Imported and re-evaluated a run. Evidence origin is unverified."; }).catch((error: unknown) => { if (!disposed) message.textContent = error instanceof Error ? error.message : "Import failed"; });
  });
  async function execute(mode: "ladder" | "audio" | "microphone" = "ladder"): Promise<void> {
    if (active || campaignPanel?.isRunning() || !manifest || disposed) return;
    active = new AbortController(); const controller = active; const watchdog = setTimeout(() => controller.abort(), 15000); setStatus("Running"); updateButtons();
    try {
      const capabilityHash = hashManifest(manifest);
      if (mode === "audio") {
        message.textContent = "Playing a quiet 440 Hz tone for 0.4 seconds. No microphone permission requested.";
        const run = await runAudioProbe(controller.signal, capabilityHash);
        if (!disposed) addRun(run);
      } else for (let level = 1; level <= (mode === "microphone" ? 1 : 3); level++) {
        if (controller.signal.aborted) break;
        message.textContent = mode === "microphone" ? "Microphone permission requested. Live track settings and 250 ms of software samples only; nothing recorded." : `${suites.find((item) => item.id === suite.value)?.title ?? "Probe"}: level ${level} / 3`;
        // New canvas per run prevents a lost WebGL context from being reused.
        const fresh = node("canvas"); fresh.width = 384; fresh.height = 384; fresh.setAttribute("aria-label", "Raw WebGL workload preview");
        if (mode === "ladder" && ["render", "three", "mixed", "glb"].includes(suite.value)) canvases.firstElementChild?.replaceWith(fresh);
        const run = await runBrowserProbe({ suite: mode === "microphone" ? "microphone" : suite.value as BrowserSuite, level, signal: controller.signal, canvas: fresh, assetCanvas, capabilityHash, onPreview: (dataUrl) => { if (disposed) return; const snapshot = node("img"); snapshot.alt = "Last rendered fixture snapshot; graphics resources released after capture"; snapshot.src = dataUrl; fresh.replaceWith(snapshot); } });
        if (fresh.isConnected && (suite.value === "render" || suite.value === "three" || suite.value === "mixed" || suite.value === "glb")) fresh.replaceWith(node("p", "No completed render snapshot", "capacity-muted"));
        if (!disposed) addRun(run);
        if (run.status === "unsupported") break;
      }
      if (!disposed) { setStatus(controller.signal.aborted ? "Stopped" : "Completed"); message.textContent = controller.signal.aborted ? "Stopped. Owned GL, audio and memory resources were released." : "Trial complete. These short desktop smoke runs do not establish a capacity ceiling."; }
    } catch (error) {
      if (!disposed) { const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError"); setStatus(aborted ? "Stopped" : "Failed"); message.textContent = aborted ? "Stopped; resources released." : error instanceof Error ? error.message : "Probe failed"; }
    } finally { clearTimeout(watchdog); active = null; if (!disposed) updateButtons(); }
  }
  const runButton = button("Run 3-level ladder", () => { void execute(); }); runButton.className = "capacity-primary";
  const stopButton = button("Stop", () => { active?.abort(); campaignPanel?.abort(); }); stopButton.disabled = true;
  const audioButton = button("Audio graph probe · quiet tone", () => { void execute("audio"); });
  const microphoneButton = button("Microphone route probe · permission prompt", () => { void execute("microphone"); });
  const syntheticButton = button("Check synthetic contracts", () => {
    const result = runFixtureCampaign();
    message.textContent = `SYNTHETIC CONTRACTS ONLY: ${result.cases.filter((item) => item.ok).length}/${result.cases.length} expectations matched. No browser or Quest capacity was measured.`;
  });
  actionRow.append(runButton, stopButton, status);
  controls.append(suite, detail, bound, actionRow, audioButton, microphoneButton, syntheticButton, message);
  report.append(selectRun, summary, curve, curveCaption, tableScroll, exportButton, importLabel);
  const grid = node("div", "", "capacity-grid"); grid.append(controls, preview, capabilities, unavailable, report, comparison);
  campaignPanel = mountCampaignPanel(grid, { isBusy: () => Boolean(active), onBusy: updateButtons, capabilityHash: () => manifest ? hashManifest(manifest) : "unavailable", onRun: addRun });
  shell.append(header, scope, notice, grid); root.replaceChildren(style, shell);
  const onVisibility = () => { if (document.visibilityState !== "visible") active?.abort(); };
  document.addEventListener("visibilitychange", onVisibility);
  updateButtons();
  void collectCapabilities().then((value) => {
    if (disposed) return;
    manifest = value; capabilityList.replaceChildren();
    for (const [label, text] of [["Origin", `${value.secureContext ? "secure" : "insecure"}; ${value.crossOriginIsolated ? "isolated" : "not isolated"}`], ["WebGL2", value.webgl.available ? `API available; ${value.webgl.extensions.length} declared extensions` : "unavailable"], ["GPU timer", value.webgl.gpuTimer ? "extension declared; actual query results required" : "unavailable"], ["WebXR", `${value.xr.apiPresent ? "API present" : "API absent"}; support query: ${value.xr.immersiveVrSupportQuery}`], ["Audio", value.audio.context ? "Context API present; explicit operation required" : "unavailable"], ["Hardware hints", `${value.hardwareConcurrencyHint ?? "unknown"} logical processors; ${value.deviceMemoryGiBHint ?? "unknown"} GiB device-memory hint (not usable RAM)`]]) { capabilityList.append(node("dt", label), node("dd", text)); }
    const raw = node("details"); raw.append(node("summary", "Raw capability manifest"), node("pre", JSON.stringify(value, null, 2))); capabilities.append(raw);
    message.textContent = "Ready. Choose a workload. No immersive session or microphone permission is requested."; updateButtons();
  }).catch((error: unknown) => { if (!disposed) { setStatus("Failed"); message.textContent = error instanceof Error ? error.message : "Capability collection failed"; } });
  return { dispose() { disposed = true; active?.abort(); campaignPanel?.dispose(); document.removeEventListener("visibilitychange", onVisibility); for (const url of downloadUrls) URL.revokeObjectURL(url); downloadUrls.clear(); root.replaceChildren(); } };
}
