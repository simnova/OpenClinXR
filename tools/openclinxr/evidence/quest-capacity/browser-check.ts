import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { evaluateRun, parseRunRecord, type CapacityRun } from "@openclinxr/xr-capacity";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";
import { allowOptions, integerOption, parseArguments, stringOption } from "./args.js";
import { readLocalJson } from "./artifacts.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const MAX_UI_IMPORT_BYTES = 1024 * 1024;
const BROWSER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"];
type AutomationMode = "real-browser-operation" | "synthetic-webgl-unavailable" | "synthetic-permission-denial" | "synthetic-late-grant";
interface Check { id: string; ok: boolean; detail: string; mode: AutomationMode }

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function exportSelected(page: Page, directory: string, name: string): Promise<{ path: string; run: CapacityRun }> {
  const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
  await page.getByRole("button", { name: "Export selected run", exact: true }).click();
  const download = await downloadPromise;
  const path = join(directory, `${name}.json`);
  await download.saveAs(path);
  requireCondition((await stat(path)).size <= MAX_UI_IMPORT_BYTES, "Export exceeds UI import budget");
  const run = parseRunRecord(await readLocalJson(path));
  evaluateRun(run);
  return { path, run };
}

async function waitReady(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Capacity lab", exact: true }).waitFor();
  await page.getByRole("button", { name: "Run 3-level ladder", exact: true }).waitFor();
  await page.waitForFunction("!document.querySelector('button.capacity-primary')?.disabled", undefined, { timeout: 10_000 });
}

async function ladder(page: Page, suite: string): Promise<void> {
  await page.getByLabel("Workload suite", { exact: true }).selectOption(suite);
  await page.getByRole("button", { name: "Run 3-level ladder", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Running" }).waitFor();
  await page.getByRole("status").filter({ hasText: "Completed" }).waitFor({ timeout: 12_000 });
}

/** Functional browser evidence, intentionally isolated from native/headset and hardware capacity. */
export async function checkBrowser(argv: string[] = []) {
  const { options } = parseArguments(["browser-check", ...argv]);
  allowOptions(options, ["out", "url", "ready-timeout-ms"]);
  const readyTimeoutMs = integerOption(options, "ready-timeout-ms", 45000, 1000, 45000);
  const explicitUrl = stringOption(options, "url");
  if (explicitUrl) {
    const candidate = new URL(explicitUrl);
    requireCondition(candidate.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(candidate.hostname) && !candidate.username && !candidate.password, "Browser check accepts a local HTTP URL only");
  }
  const outputRoot = resolve(stringOption(options, "out") ?? ".openclinxr/capacity-runs");
  await mkdir(outputRoot, { recursive: true });
  const directory = await mkdtemp(join(outputRoot, `browser-check-${process.pid}-`));
  const checks: Check[] = [];
  const observedRuns: { path: string; mode: AutomationMode; run: CapacityRun; evaluation: ReturnType<typeof evaluateRun> }[] = [];
  const errors: string[] = [];
  let server: PortlessDevServer | undefined;
  let browser: Browser | undefined;
  let failure: string | null = null;
  let url = explicitUrl ?? "";
  const record = (id: string, ok: boolean, detail: string, mode: AutomationMode = "real-browser-operation") => { checks.push({ id, ok, detail, mode }); requireCondition(ok, `${id}: ${detail}`); };
  const captureRun = async (page: Page, name: string, mode: AutomationMode = "real-browser-operation") => {
    const result = await exportSelected(page, directory, name);
    // The automation controller knows when it has replaced an API. Preserve that provenance
    // in the archived canonical record as well as its wrapper; it can never certify real capture.
    if (mode !== "real-browser-operation") {
      result.run = parseRunRecord({ ...result.run, provenance: "synthetic" });
      await writeFile(result.path, `${JSON.stringify(result.run, null, 2)}\n`);
    }
    observedRuns.push({ ...result, mode, evaluation: evaluateRun(result.run) });
    return result;
  };
  const stop = () => { void browser?.close().catch(() => undefined); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (!explicitUrl) { server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: root, readyTimeoutMs }); url = server.url; }
    const labUrl = new URL(url); labUrl.searchParams.set("capacity", "1");
    // Heavy-compute launch runs inside the compute-services facade (slot-gated,
    // labelled); browserLaunch keeps the exact SwiftShader launch flags.
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, { headless: true, args: BROWSER_ARGS }),
    }).sceneCapture.withBrowser("quest-capacity:browser-check", async (launched) => {
      browser = launched as Browser;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => { errors.push(error.message.slice(0, 1000)); });
    await page.goto(labUrl.href, { waitUntil: "networkidle", timeout: 15000 });
    await waitReady(page);
    record("physical-scope", (await page.locator(".capacity-scope").innerText()).includes("NO HEADSET MEASUREMENTS"), "Desktop scope and explicit lack of headset measurements visible");
    record("missing-hardware", (await page.getByRole("heading", { name: "Not measured in this lab", exact: true }).count()) === 1 && (await page.getByText("Quest CPU/GPU, process RAM and sustained thermal limits", { exact: true }).count()) === 1, "Native GPU, audio, motion, thermal and network unknowns are visible");
    await ladder(page, "cpu");
    const cpu = await captureRun(page, "desktop-cpu");
    record("actual-cpu-smoke", cpu.run.provenance === "desktop-browser" && cpu.run.status === "completed" && cpu.run.metrics.some((metric) => metric.semantic === "cpu-duration" && metric.kind === "measured" && metric.samples.length > 0), "Actual browser updates produced measured samples");
    record("no-native-promotion", evaluateRun(cpu.run).outcome === "inconclusive" && evaluateRun(cpu.run).notEvidenceFor.includes("quest-capacity"), "Short desktop smoke run remains inconclusive for capacity");
    const importInput = page.getByLabel("Import run JSON", { exact: true });
    await importInput.setInputFiles(cpu.path);
    await page.getByText("Imported and re-evaluated a run. Evidence origin is unverified.", { exact: true }).waitFor();
    record("import-export", (await page.locator(".capacity-report").innerText()).includes("Imported evidence is not authenticated"), "Downloaded canonical run was imported through the visible file control and re-evaluated");
    await importInput.setInputFiles({ name: "malformed.json", mimeType: "application/json", buffer: Buffer.from('{"outcome":"validated-profile"}') });
    await page.locator(".capacity-message").filter({ hasText: "Invalid run:" }).waitFor();
    record("reject-forged-import", true, "Caller-supplied verdict/incomplete run was rejected");
    await importInput.setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(MAX_UI_IMPORT_BYTES + 1, 0x20) });
    await page.getByText("Import rejected: file exceeds 1 MiB.", { exact: true }).waitFor();
    record("bounded-import", true, "Oversized file rejected before reading/parsing");
    await page.getByLabel("Baseline run", { exact: true }).selectOption("0");
    await page.getByLabel("Candidate run", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "Compare runs", exact: true }).click();
    await page.getByText(/(?:failed|incompatible \/ comparison refused)\. configuration\.axes\.level/).waitFor();
    record("comparison-equivalence", true, "Different workload levels fail comparison until an explicit axis is allowed");
    await page.getByLabel("Allow workload level difference", { exact: false }).check();
    await page.getByRole("button", { name: "Compare runs", exact: true }).click();
    await page.getByText(/comparable\. No disallowed configuration differences\./).waitFor();
    record("comparison-allowed-axis", true, "Explicit level axis permits descriptive comparison without capacity claims");
    await ladder(page, "render");
    const render = await captureRun(page, "desktop-webgl");
    record("actual-webgl", render.run.status === "completed" && render.run.metrics.some((metric) => metric.kind === "measured" && metric.samples.length > 0 && metric.id.startsWith("render.")), "Raw WebGL completed on requested software backend; hardware GPU capacity remains unmeasured");
    const rawRenderIndex = await page.getByLabel("Selected run", { exact: true }).inputValue();
    await ladder(page, "mixed");
    const mixed = await captureRun(page, "desktop-mixed");
    record("combined-browser-work", mixed.run.status === "completed" && mixed.run.configuration.axes["suite"] === "mixed", "Combined render, CPU, touched memory and local asset smoke workload executed");
    await page.getByLabel("Baseline run", { exact: true }).selectOption("0");
    const candidateControl = page.getByLabel("Candidate run", { exact: true });
    await candidateControl.selectOption(String(await candidateControl.locator("option").count() - 1));
    await page.getByRole("button", { name: "Compare runs", exact: true }).click();
    await page.getByText(/(?:failed|incompatible \/ comparison refused)\..*configuration\.workloadHash/).waitFor();
    record("unlike-workloads-refused", true, "CPU versus mixed workload is refused even with workload-level equivalence allowed");
    await page.screenshot({ path: join(directory, "capacity-lab.png"), fullPage: true });
    await ladder(page, "three");
    const three = await captureRun(page, "desktop-three");
    record("three-render", three.run.status === "completed" && three.run.configuration.axes["backend"] === "three" && three.run.metrics.some((metric) => metric.id === "render.verified-nonbackground-pixels" && metric.samples.some((sample) => sample.valid && (sample.value ?? 0) > 0)), "Three.js matched fixture rendered verified visible pixels on software backend");
    record("render-snapshot", await page.getByAltText("Last rendered fixture snapshot; graphics resources released after capture", { exact: true }).count() === 1, "Final real rendered frame persists after graphics resource disposal");
    await page.getByLabel("Baseline run", { exact: true }).selectOption(rawRenderIndex);
    await candidateControl.selectOption(String(await candidateControl.locator("option").count() - 1));
    await page.getByRole("button", { name: "Compare runs", exact: true }).click();
    await page.getByText(/(?:failed|incompatible \/ comparison refused)\..*configuration\.axes\.backend/).waitFor();
    await page.getByLabel("Allow matched raw WebGL2 / Three.js backend difference", { exact: false }).check();
    await page.getByRole("button", { name: "Compare runs", exact: true }).click();
    await page.getByText(/comparable\. No disallowed configuration differences\./).waitFor();
    record("matched-backend-equivalence", true, "Raw WebGL2 and matched Three.js compare only with explicit backend equivalence and matching instruments");
    await ladder(page, "movement");
    const movement = await captureRun(page, "desktop-movement");
    record("movement-updates", movement.run.status === "completed" && movement.run.metrics.some((metric) => metric.id === "movement.object3d-update" && metric.samples.length > 0), "Actual Object3D transformations and world matrices updated; no physical tracking claim");
    await ladder(page, "glb");
    const glb = await captureRun(page, "desktop-glb");
    record("glb-first-render", glb.run.status === "completed" && glb.run.metrics.some((metric) => metric.id === "asset.glb-verified-pixels" && metric.samples.some((sample) => sample.valid && (sample.value ?? 0) > 0)) && glb.run.metrics.some((metric) => metric.id === "asset.glb-parse" && metric.kind === "measured"), "Generated GLB parsed and rendered with verified nonbackground pixels");
    await page.getByRole("button", { name: "Audio graph probe · quiet tone", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Completed" }).waitFor({ timeout: 5000 });
    const audio = await captureRun(page, "desktop-audio");
    record("audio-software-graph", audio.run.status === "completed" && audio.run.metrics.some((metric) => metric.id === "audio.software-nonzero-samples" && metric.kind === "measured" && metric.samples.some((sample) => sample.valid && (sample.value ?? 0) > 0)) && audio.run.metrics.filter((metric) => metric.semantic === "audio-software").every((metric) => metric.kind === "proxy" || metric.kind === "unavailable") && audio.run.metrics.some((metric) => metric.semantic === "audio-acoustic" && metric.kind === "unavailable"), "Nonzero software graph samples under --mute-audio; software latency estimates remain proxies and acoustic/headset latency is unavailable");
    await page.getByLabel("Workload suite", { exact: true }).selectOption("memory");
    await page.getByRole("button", { name: "Run 3-level ladder", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Running" }).waitFor();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Stopped" }).waitFor();
    const cancelled = await captureRun(page, "desktop-cancelled");
    record("cancellation", cancelled.run.status === "aborted", "Stop retained an aborted run and released owned resources");
    await page.screenshot({ path: join(directory, "cancelled.png"), fullPage: true });
    const unavailableContext = await browser.newContext({ acceptDownloads: true });
    await unavailableContext.addInitScript("const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(kind, ...args) { if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null; return original.call(this, kind, ...args); };");
    const unavailablePage = await unavailableContext.newPage();
    await unavailablePage.goto(labUrl.href, { waitUntil: "networkidle" });
    await waitReady(unavailablePage);
    await ladder(unavailablePage, "render");
    const unavailable = await captureRun(unavailablePage, "webgl-unavailable", "synthetic-webgl-unavailable");
    record("unsupported-webgl", unavailable.run.status === "unsupported" && unavailable.run.metrics.some((metric) => metric.semantic === "gpu-duration" && metric.kind === "unavailable" && metric.samples.length === 0), "Forced missing WebGL produces unsupported evidence, never measured zero or a graphics pass", "synthetic-webgl-unavailable");
    await unavailablePage.screenshot({ path: join(directory, "webgl-unavailable.png"), fullPage: true });
    await unavailableContext.close();
    const deniedContext = await browser.newContext({ acceptDownloads: true });
    await deniedContext.addInitScript("window.__capacityMicCalls = 0; Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => { window.__capacityMicCalls++; return Promise.reject(new DOMException('Controlled test refusal', 'NotAllowedError')); } });");
    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto(labUrl.href, { waitUntil: "networkidle" });
    await waitReady(deniedPage);
    record("no-implicit-microphone", await deniedPage.evaluate("window.__capacityMicCalls === 0") as boolean, "Lab initialization collected capabilities without requesting microphone access", "synthetic-permission-denial");
    await deniedPage.getByRole("button", { name: "Microphone route probe · permission prompt", exact: true }).click();
    await deniedPage.getByRole("status").filter({ hasText: "Completed" }).waitFor();
    const denied = await captureRun(deniedPage, "microphone-denied", "synthetic-permission-denial");
    record("microphone-denied", denied.run.status === "unsupported" && denied.run.metrics.some((metric) => metric.kind === "unavailable" && metric.samples.length === 0 && metric.unavailableReason?.includes("NotAllowedError")) && await deniedPage.evaluate("window.__capacityMicCalls === 1") as boolean, "Synthetic permission-refusal fixture verified lifecycle only; real microphone access was not measured", "synthetic-permission-denial");
    await deniedContext.close();
    const lateContext = await browser.newContext({ acceptDownloads: true });
    await lateContext.addInitScript("window.__capacityLateTrackStopped = false; Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => { window.__capacityLateCaptureCalled = true; return new Promise(resolve => setTimeout(() => { const context = new AudioContext(); const destination = context.createMediaStreamDestination(); const stream = destination.stream; const track = stream.getAudioTracks()[0]; const originalStop = track.stop.bind(track); track.stop = () => { originalStop(); window.__capacityLateTrackStopped = track.readyState === 'ended'; void context.close(); }; resolve(stream); }, 500)); } });");
    const latePage = await lateContext.newPage();
    await latePage.goto(labUrl.href, { waitUntil: "networkidle" });
    await waitReady(latePage);
    await latePage.getByRole("button", { name: "Microphone route probe · permission prompt", exact: true }).click();
    await latePage.waitForFunction("window.__capacityLateCaptureCalled === true");
    await latePage.getByRole("button", { name: "Stop", exact: true }).click();
    await latePage.getByRole("status").filter({ hasText: "Stopped" }).waitFor();
    await latePage.waitForFunction("window.__capacityLateTrackStopped === true");
    const late = await captureRun(latePage, "microphone-late-cancelled", "synthetic-late-grant");
    record("microphone-late-grant-cleanup", late.run.status === "aborted", "Synthetic late-grant fixture verified cleanup only; cancelled capture immediately stopped its injected track", "synthetic-late-grant");
    await lateContext.close();
    record("page-errors", errors.length === 0, errors.join("; ") || "No uncaught page errors");
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unknown browser check failure";
    checks.push({ id: "execution", ok: false, detail: failure, mode: "real-browser-operation" });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await browser?.close();
    await stopPortlessDevServer(server?.proc);
  }
  const report = { schema: "quest-capacity-browser-check.v1", evidenceClass: "functional-automation", ok: failure === null, directory, url, browserArgs: BROWSER_ARGS, graphicsBackend: "requested software SwiftShader; no host hardware GPU claim", automation: { browser: "Playwright headless Chromium", audio: "muted software graph only", microphone: "getUserMedia denial and late-grant behavior are injected synthetic lifecycle fixtures; no physical microphone requested", nativeHeadset: "not connected or requested" }, checks, runs: observedRuns, pageErrors: errors, notEvidenceFor: ["Quest capacity/readiness", "real microphone capture or hardware input/output routes", "native headset/compositor timing", "host hardware GPU capacity", "physical audio/tracking/latency", "Wi-Fi/WAN performance"] };
  const portableReport = { ...report, directory: ".", runs: observedRuns.map((entry) => ({ ...entry, path: basename(entry.path) })) };
  await writeFile(join(directory, "result.json"), `${JSON.stringify(portableReport, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(directory, "report.txt"), `${checks.map((check) => `${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`).join("\n")}\nNot evidence for: ${report.notEvidenceFor.join("; ")}\n`, { flag: "wx" });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkBrowser(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ ok: result.ok, directory: result.directory, checks: result.checks })}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown browser check error" })}\n`);
    process.exitCode = 2;
  }
}
