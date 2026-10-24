import { compareRuns, evaluateRun, summarizeMetric } from "../index.js";
import type { CapacityRun } from "../types.js";
import { CAMPAIGN_PROTOCOLS, campaignOverlap, importCampaignJson, MAX_CAMPAIGN_BYTES, type SecureCampaign } from "./campaign-record.js";
import { startSecureCampaign, type CampaignServices } from "./secure-campaign.js";
import { localEndpoint } from "./transport-probes-state.js";
import { mountImmersiveControl } from "./immersive.js";
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] { const value = document.createElement(tag); value.textContent = text; return value; }
export interface CampaignPanel { isRunning(): boolean; abort(): void; dispose(): void }
export function mountCampaignPanel(parent: HTMLElement, options: { isBusy(): boolean; onBusy(): void; capabilityHash(): string; onRun(run: CapacityRun): void }): CampaignPanel {
  let active: AbortController | null = null; let report: SecureCampaign | null = null; let disposed = false;
  const urls = new Set<string>();
  const section = el("section"); section.className = "capacity-panel capacity-report"; section.id = "capacity-secure-lab";
  section.append(el("h2", "Secure transport + audio campaign"), el("p", "The same 384² scene, seed and asset size are retained across rendering baseline, isolated protocols, isolated audio, combined load and recovery. A shared observation barrier follows actual first echoes, worklet processing and asset upload. Muted synthetic PCM; microphone capture requires the separate explicit route probe. Pixel readback uses a separate untimed redraw after the observation window; it verifies fixture output and is excluded from phase timing, frame and draw counters."));
  const origin = el("input"); origin.type = "url"; origin.id = "capacity-services-url"; origin.placeholder = "https://localhost:port/capacity/manifest"; origin.setAttribute("aria-label", "Secure services manifest URL"); origin.value = new URL(location.href).searchParams.get("services") || (location.protocol === "https:" ? `${location.origin}/capacity/manifest` : "");
  const originLabel = el("label", "Local HTTPS service manifest "); originLabel.append(origin); section.append(originLabel);
  const level = el("select"); level.id = "capacity-campaign-level"; level.setAttribute("aria-label", "Campaign load level");
  for (let n = 1; n <= 3; n++) { const option = el("option", `Level ${n}`); option.value = String(n); level.append(option); }
  const duration = el("input"); duration.type = "number"; duration.id = "capacity-campaign-duration"; duration.value = "1000"; duration.min = "500"; duration.max = "5000"; duration.step = "100"; duration.setAttribute("aria-label", "Observation milliseconds per phase");
  const durationLabel = el("label", "Observation milliseconds per phase (500–5000) "); durationLabel.append(duration);
  const path = el("select"); path.id = "capacity-transport-path"; path.setAttribute("aria-label", "Declared transport route");
  for (const value of ["unverified-path", "host-loopback", "USB-reverse-TCP-LAN-UDP", "LAN-Wi-Fi"]) { const option = el("option", value); option.value = value; path.append(option); }
  const pathLabel = el("label", "Declared route (external collector must verify) "); pathLabel.append(path);
  const choices = CAMPAIGN_PROTOCOLS.map((protocol) => { const box = el("input"); box.type = "checkbox"; box.checked = true; box.value = protocol; box.name = "capacity-protocol"; const label = el("label", ` ${protocol}`); label.prepend(box); section.append(label); return box; });
  section.append(level, durationLabel, pathLabel, el("p", "Bounds per protocol: 1024 messages, 8 MiB admitted, 8 in flight, 1500 ms ACK deadline; asset loop: at most64 transfers, 2 MiB per PNG. Campaign watchdog120 s. Stop, tab hiding and unmount cancel owned work. Repeat each level independently; the first failed bound is a tested operating point, never a measured maximum."));
  const state = el("p", "Ready"); state.id = "capacity-campaign-status"; state.setAttribute("role", "status"); state.setAttribute("aria-live", "polite");
  const current = el("p", "No campaign measured. A successful echo or audio graph is bounded software evidence; acoustic timing, Wi-Fi maximum capacity, thermal limits and compositor presentation remain unmeasured."); current.className = "capacity-muted";
  const startButton = el("button", "Run secure mixed campaign"); startButton.type = "button"; startButton.className = "capacity-primary"; startButton.id = "capacity-secure-run";
  const stop = el("button", "Stop campaign"); stop.type = "button"; stop.id = "capacity-campaign-stop"; stop.disabled = true;
  const download = el("button", "Export campaign JSON"); download.type = "button"; download.id = "capacity-campaign-export"; download.disabled = true;
  const file = el("input"); file.type = "file"; file.accept = ".json,application/json"; file.id = "capacity-campaign-import"; file.setAttribute("aria-label", "Import campaign JSON");
  const importLabel = el("label", "Import untrusted campaign JSON (≤8 MiB) "); importLabel.append(file);
  const table = el("table"); table.setAttribute("aria-label", "Campaign phase evidence"); const head = el("tr"); for (const title of ["Phase", "State", "Observed axes", "Observed window", "Callback p95 / asset decodes"]) head.append(el("th", title)); const thead = el("thead"); thead.append(head); const body = el("tbody"); table.append(thead, body);
  const timeline = el("canvas"); timeline.width = 1000; timeline.height = 210; timeline.id = "capacity-campaign-timeline"; timeline.setAttribute("aria-label", "Campaign phase and actual operation timeline");
  const descriptive = el("p"); descriptive.id = "capacity-campaign-comparison"; descriptive.className = "capacity-muted";
  const details = el("details"); details.append(el("summary", "Browser-clock timeline and per-run adjudication")); const raw = el("pre"); details.append(raw);
  const scroll = el("div"); scroll.className = "capacity-table-scroll"; scroll.append(table);
  section.append(startButton, stop, state, current, timeline, scroll, descriptive, download, importLabel, details);
  const disposeImmersive = mountImmersiveControl(section);
  parent.append(section);
  Object.defineProperty(window, "__capacityCampaignReport", { configurable: true, get: () => report ? structuredClone(report) : null });
  function busy(value: boolean) { startButton.disabled = value; stop.disabled = !value; level.disabled = value; duration.disabled = value; origin.disabled = value; path.disabled = value; choices.forEach((choice) => { choice.disabled = value; }); options.onBusy(); }
  function show(value: SecureCampaign, imported: boolean) {
    report = value; body.replaceChildren(); download.disabled = false;
    const released = el("p", imported ? "Imported observations. No live scene is running." : "Workload resources released after measurement. The phase table retains the observations."); released.id = "capacity-campaign-release"; preview.replaceChildren(released);
    const overlap = campaignOverlap(value);
    current.textContent = `${imported ? "Imported observations; origin unauthenticated. " : ""}Campaign ${value.status}. Actual shared-window processing: ${overlap.observed ? "observed" : "not established"} (${Math.round(overlap.windowMs)} ms). ${overlap.axes.map((axis) => `${axis.axis}: ${axis.observations} observations${axis.delta === null ? "" : `, Δ ${axis.delta} blocks`}`).join("; ")}. ${overlap.reasons.join("; ")}. Per-run profiles remain provisional; no capacity or physical-readiness claim. ${overlap.timingBasis} Phase activity is recounted from its own window. Queue and delivery counters are cumulative and include setup; timing samples exclude setup, and whole-handle goodput is excluded from phase reports.`;
    for (const phase of value.phases) {
      const runs = value.runs.filter((run) => phase.runIds.includes(run.id));
      const gaps = runs.flatMap((run) => run.metrics).find((metric) => metric.id === "campaign.raf-gap");
      const assets = runs.flatMap((run) => run.metrics).find((metric) => metric.id === "campaign.asset-imagebitmap-decode");
      const row = el("tr"); for (const text of [phase.id, `${phase.status}; peer drain ${phase.drain.state}`, `${phase.worked.join(", ") || "idle"} / ${phase.expected.join(", ") || "idle"}`, phase.barrierAt === null ? "barrier absent" : `${Math.round(phase.endedAt - phase.barrierAt)} ms`, `${gaps ? summarizeMetric(gaps).p95?.toFixed(2) ?? "unavailable" : "unavailable"} ms / ${assets?.sampleCount ?? 0}`]) row.append(el("td", text)); body.append(row);
    }
    const sceneRun = (phase: string) => value.runs.find((record) => record.configuration.axes['campaignPhase'] === phase && record.configuration.axes['axis'] === "scene");
    const baselineRun = sceneRun("render-assets"); const mixedRun = sceneRun("combined"); const recoveryRun = sceneRun("recovery");
    const comparisons = baselineRun ? [mixedRun, recoveryRun].filter((record): record is CapacityRun => Boolean(record)).map((candidate) => ({ phase: candidate.configuration.axes['campaignPhase'], result: compareRuns(baselineRun, candidate, { allowedAxes: ["campaignPhase", "phaseWindowStart", "phaseWindowEnd", "audioEnabled"] }) })) : [];
    descriptive.textContent = comparisons.map(({ phase, result }) => { const frame = result.metrics.find((metric) => metric.id === "campaign.raf-gap"); return `${String(phase)} vs matched render/assets baseline: ${result.compatibility}; callback-gap p95 delta ${frame?.p95Delta === null || frame?.p95Delta === undefined ? "unavailable" : `${frame.p95Delta.toFixed(2)} ms`}. ${result.differences.join("; ")}`; }).join(" ") || "No matched baseline comparison available.";
    raw.textContent = JSON.stringify({ comparisons, clock: value.clock, deviceProof: value.deviceProof, events: value.events, evaluations: value.runs.map((run) => ({ id: run.id, axis: run.configuration.axes['axis'], phase: run.configuration.axes['campaignPhase'], status: run.status, provenance: run.provenance, evaluation: evaluateRun(run) })) }, null, 2);
    const context = timeline.getContext("2d"); if (context && value.phases.length) {
      context.clearRect(0, 0, timeline.width, timeline.height); context.font = "10px system-ui"; const begin = value.phases[0]!.requestedAt; const end = value.phases.at(-1)!.endedAt; const x = (at: number) => 150 + (at - begin) / Math.max(1, end - begin) * 820;
      value.phases.forEach((phase, i) => { const y = 10 + i * 17; context.fillStyle = "#91a8bd"; context.fillText(phase.id, 0, y + 9); context.fillStyle = "#304457"; context.fillRect(x(phase.requestedAt), y, Math.max(1, x(phase.endedAt) - x(phase.requestedAt)), 11); if (phase.barrierAt !== null) { context.fillStyle = phase.status === "completed" ? "#f2bc64" : "#d4807c"; context.fillRect(x(phase.barrierAt), y, Math.max(1, x(phase.endedAt) - x(phase.barrierAt)), 11); } });
    }
  }
  startButton.addEventListener("click", () => {
    if (active || options.isBusy() || disposed) return;
    active = new AbortController(); const controller = active; state.textContent = "Running"; busy(true);
    void (async () => {
      const manifestUrl = localEndpoint(origin.value, "https:");
      const response = await fetch(manifestUrl, { signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 65536) throw new Error("Service manifest unavailable or oversized");
      const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 65536) throw new Error("Service manifest exceeds64KiB");
      const services = JSON.parse(text) as CampaignServices; if (services.schema !== "quest-capacity-services.v1") throw new Error("Unsupported secure service manifest");
      for (const endpoint of [services.httpsOrigin, services.echoUrl, services.assetUrl, services.imageAssetUrl, services.rtcOfferUrl, services.rtcCloseUrl, services.peerStatsUrl, services.webTransportUrl]) if (endpoint) localEndpoint(endpoint, "https:"); if (services.wssUrl) localEndpoint(services.wssUrl, "wss:");
      const campaign = await startSecureCampaign({ services, level: Number(level.value), durationMs: Number(duration.value), protocols: choices.filter((box) => box.checked).map((box) => box.value as typeof CAMPAIGN_PROTOCOLS[number]), signal: controller.signal, capabilityHash: options.capabilityHash(), transportPath: path.value, canvas: () => { const canvas = el("canvas"); canvas.width = 384; canvas.height = 384; canvas.setAttribute("aria-label", "Secure campaign raw WebGL preview"); preview.replaceChildren(canvas); return canvas; }, onPhase: (phase) => { current.textContent = `Running ${phase}; phase setup followed by ${duration.value} ms of shared-window observations.`; } });
      if (disposed) return; show(campaign, false); for (const record of campaign.runs) options.onRun(record); state.textContent = campaign.status === "aborted" ? "Stopped" : campaign.status === "failed" ? "Failed" : "Completed";
    })().catch((error: unknown) => { if (!disposed) { state.textContent = controller.signal.aborted ? "Stopped" : "Failed"; current.textContent = error instanceof Error ? error.message : "Campaign failed"; } }).finally(() => { active = null; if (!disposed) busy(false); });
  });
  const preview = el("div"); preview.className = "capacity-canvases"; section.insertBefore(preview, timeline);
  stop.addEventListener("click", () => active?.abort());
  download.addEventListener("click", () => { if (!report) return; const owned = importCampaignJson(JSON.stringify(report)); const url = URL.createObjectURL(new Blob([JSON.stringify(owned, null, 2)], { type: "application/json" })); urls.add(url); const anchor = el("a"); anchor.href = url; anchor.download = "secure-campaign.json"; anchor.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 500); });
  file.addEventListener("change", () => { const selected = file.files?.[0]; file.value = ""; if (!selected || active) return; if (selected.size > MAX_CAMPAIGN_BYTES) { current.textContent = "Import rejected: campaign exceeds8MiB"; return; } void selected.text().then((json) => { if (!disposed) show(importCampaignJson(json), true); }).catch((error: unknown) => { if (!disposed) current.textContent = error instanceof Error ? error.message : "Import failed"; }); });
  const hidden = () => { if (document.visibilityState !== "visible") active?.abort(); }; document.addEventListener("visibilitychange", hidden);
  return { isRunning: () => Boolean(active), abort: () => active?.abort(), dispose() { disposed = true; active?.abort(); document.removeEventListener("visibilitychange", hidden); disposeImmersive(); for (const url of urls) URL.revokeObjectURL(url); urls.clear(); delete (window as unknown as Record<string, unknown>)['__capacityCampaignReport']; section.remove(); } };
}
