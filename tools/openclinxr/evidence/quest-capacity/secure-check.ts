import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";
import { allowOptions, flagOption, integerOption, parseArguments, stringOption } from "./args.js";
import { startSecureServices } from "./secure-services.js";
import { checkFailurePage } from "./secure-failures.js";
import { checkCampaignBuildIdentity, expectedAppIdentity, parseServedAppIdentity } from "./secure-build-identity.js";
import { checkSecureWires } from "./secure-wire-client.js";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
export async function checkSecure(argv = process.argv.slice(2)) {
  const { options } = parseArguments(["secure-check", ...argv]); allowOptions(options, ["out", "wire-only", "campaign-only", "python", "level", "levels", "duration-ms", "expected-build-hash"]);
  const output = resolve(stringOption(options, "out") ?? ".openclinxr/capacity-runs"); await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, `secure-check-${process.pid}-`));
  const wireOnly = flagOption(options, "wire-only"); const campaignOnly = flagOption(options, "campaign-only");
  if (wireOnly && campaignOnly) throw new Error("--wire-only conflicts with --campaign-only");
  if (Object.hasOwn(options, "level") && Object.hasOwn(options, "levels")) throw new Error("Use --level or --levels");
  const levels = (stringOption(options, "levels") ?? String(integerOption(options, "level", 1, 1, 3))).split(",").map(Number);
  if (!levels.length || levels.length > 3 || levels.some((level, index) => !Number.isSafeInteger(level) || level < 1 || level > 3 || (index > 0 && level <= levels[index - 1]!))) throw new Error("--levels must be ascending unique1..3");
  const durationMs = integerOption(options, "duration-ms", 1000, 500, 5000);
  let app: PortlessDevServer | undefined; let service: Awaited<ReturnType<typeof startSecureServices>> | undefined; let browser: Browser | undefined;
  const errors: string[] = []; let lastPage: import("playwright").Page | undefined; let data: Record<string, unknown> = {};
  const stop = () => { void browser?.close().catch(() => undefined); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    if (!wireOnly) app = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: root, readyTimeoutMs: 45000, env: { OPENCLINXR_CAPACITY_TLS_PROXY: "1" } });
    service = await startSecureServices({ appOrigin: app?.url ? new URL(app.url).origin : undefined, python: stringOption(options, "python") });
    const activeService = service;
    const manifest = activeService.manifest;
    // Heavy-compute launch runs inside the compute-services facade (slot-gated,
    // labelled); browserLaunch keeps the exact SPKI-pinned SwiftShader flags.
    return createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, { headless: true, args: [`--ignore-certificate-errors-spki-list=${manifest.certificateSpkiSha256Base64}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] }),
    }).sceneCapture.withBrowser("quest-capacity:secure-check", async (launched) => {
    browser = launched as Browser;
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); lastPage = page; page.on("pageerror", (error) => errors.push(error.message.slice(0, 1000)));
    await page.goto(`${manifest.httpsOrigin}/capacity/manifest`, { waitUntil: "load" });
    const observations = campaignOnly ? [] : await checkSecureWires(page, manifest);
    let failureFixtures: unknown = { ok: true, status: "explicitly skipped by --campaign-only" };
    if (!campaignOnly) {
    const faultService = await startSecureServices({ echoDelayMs: 200, python: stringOption(options, "python") });
    let faultBrowser: Browser | undefined;
    try {
      await createLocalComputeServices({
        browserLaunch: chromium.launch.bind(chromium, { headless: true, args: [`--ignore-certificate-errors-spki-list=${faultService.manifest.certificateSpkiSha256Base64}`, "--mute-audio", "--autoplay-policy=no-user-gesture-required"] }),
      }).sceneCapture.withBrowser("quest-capacity:secure-check:fault-fixture", async (launchedFault) => {
      faultBrowser = launchedFault as Browser;
      const faultPage = await faultBrowser.newPage(); await faultPage.goto(`${faultService.manifest.httpsOrigin}/capacity/manifest`);
      failureFixtures = await checkFailurePage(faultPage, faultService);
      await writeFile(join(directory, "secure-failure-fixtures.json"), `${JSON.stringify(failureFixtures, null, 2)}\n`);
    });
    } finally { await faultService.close(); }
    }
    let campaign: unknown = null; let appIdentityEvidence: unknown = null;
    if (!wireOnly) {
      const url = new URL(manifest.httpsOrigin); url.searchParams.set("capacity", "1"); url.searchParams.set("services", `${manifest.httpsOrigin}/capacity/manifest`);
      await page.goto(url.href, { waitUntil: "networkidle" });
      if (await page.locator('#capacity-app-metadata[type="application/json"]').count() !== 1) throw new Error("Exactly one served app identity declaration is required");
      const metadataText = await page.locator("#capacity-app-metadata").textContent();
      if (!metadataText || metadataText.length > 4096) throw new Error("Served app metadata absent or exceeds bound");
      const servedIdentity = parseServedAppIdentity(JSON.parse(metadataText));
      const independentlyExpectedIdentity = await expectedAppIdentity(root, stringOption(options, "expected-build-hash"));
      if (servedIdentity.revision !== independentlyExpectedIdentity.revision || servedIdentity.buildHash !== independentlyExpectedIdentity.buildHash) throw new Error("Served app identity differs from independently computed application source identity");
      appIdentityEvidence = { schema: "quest-capacity-app-identity-check.v1", source: "served script#capacity-app-metadata read before workloads", served: servedIdentity, expected: independentlyExpectedIdentity, expectedSource: "application Vite configuration source/dist/dependency fingerprint and git HEAD", externalExpectedHash: stringOption(options, "expected-build-hash") ?? null };
      await writeFile(join(directory, "served-app-metadata.json"), `${JSON.stringify(appIdentityEvidence, null, 2)}\n`);
      const { importCampaignJson, campaignOverlap } = await import("@openclinxr/xr-capacity/browser");
      const campaigns: unknown[] = [];
      for (const level of levels) {
        await page.locator("#capacity-campaign-level").selectOption(String(level)); await page.locator("#capacity-campaign-duration").fill(String(durationMs)); await page.locator("#capacity-transport-path").selectOption("host-loopback");
        await page.locator("#capacity-secure-run").click();
        await page.locator("#capacity-campaign-status").filter({ hasText: /Completed|Failed|Stopped/ }).waitFor({ timeout: 120_000 });
        if (!(await page.locator("#capacity-campaign-export").isEnabled())) throw new Error(`Campaign${level} ended without an exportable report: ${await page.locator("#capacity-campaign-status").innerText()}`);
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.locator("#capacity-campaign-export").click({ timeout: 1000 })]); const path = join(directory, `secure-campaign-level-${level}.json`); await download.saveAs(path);
        const { readLocalJson } = await import("./artifacts.js"); const record = importCampaignJson(JSON.stringify(await readLocalJson(path))); const overlap = campaignOverlap(record);
        const identity = checkCampaignBuildIdentity(record.runs, servedIdentity, independentlyExpectedIdentity);
        const phaseEvidence = record.phases.map((phase) => ({ id: phase.id, status: phase.status, expected: phase.expected, worked: phase.worked, allRequestedObserved: phase.expected.every((axis) => phase.worked.includes(axis)) }));
        const ok = identity.ok && phaseEvidence.every((phase) => phase.allRequestedObserved) && record.status === "completed" && record.phases.length === 11 && record.phases.every((phase) => phase.status === "completed") && record.runs.every((run) => run.status === "completed") && overlap.observed && overlap.axes.length === 9;
        campaigns.push({ level, path: `secure-campaign-level-${level}.json`, status: record.status, ok, overlap, identity, phaseEvidence });
        await page.locator("#capacity-campaign-import").setInputFiles(path);
        if (!ok) break;
      }
      const finalExpected = await expectedAppIdentity(root, stringOption(options, "expected-build-hash"));
      if (finalExpected.revision !== independentlyExpectedIdentity.revision || finalExpected.buildHash !== independentlyExpectedIdentity.buildHash) throw new Error("Application source identity changed during campaign");
      campaign = { levels, durationMs, campaigns, ok: campaigns.length === levels.length && campaigns.every((record) => (record as {ok:boolean}).ok), firstFailedLevel: campaigns.find((record) => !(record as {ok:boolean}).ok) ?? null, maximumCapacityMeasured: false };
      await page.screenshot({ path: join(directory, "secure-capacity-lab.png"), fullPage: true });
    }
    const peerStats = await page.evaluate(async (url) => (await fetch(url)).json(), `${manifest.httpsOrigin}/capacity/peer-stats?token=${manifest.token}`);
    data = { schema: "quest-capacity-secure-check.v1", observedAt: new Date().toISOString(), mode: "actual-desktop-browser-and-local-peers", wireOnly, manifest, appIdentityEvidence, observations, failureFixtures, campaign, peerStats, counters: activeService.counters, browser: browser.version(), browserErrors: errors, ok: (wireOnly || (campaign as {ok:boolean})?.ok === true) && observations.every((item) => item.ok) && (failureFixtures as { ok: boolean }).ok && errors.length === 0, notEvidenceFor: ["Quest/native maximum capacity", "Wi-Fi, WAN or routed impairment", "physical/acoustic audio latency", "hardware GPU capacity: declared SwiftShader browser backend", "software audio output: browser explicitly muted"] };
    await writeFile(join(directory, "secure-check.json"), `${JSON.stringify(data, null, 2)}\n`);
    return { directory, data };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics = lastPage ? await lastPage.evaluate("({text:document.body.innerText.slice(0,12000),report:window.__capacityCampaignReport??null})").catch(() => null) : null;
    await lastPage?.screenshot({ path: join(directory, "secure-failed.png"), fullPage: true }).catch(() => undefined);
    await writeFile(join(directory, "secure-check.json"), `${JSON.stringify({ schema: "quest-capacity-secure-check.v1", ok: false, error: message, browserErrors: errors, diagnostics, partial: data }, null, 2)}\n`);
    throw new Error(`${message}; diagnostics: ${directory}`);
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await browser?.close(); await service?.close(); if (app) await stopPortlessDevServer(app.proc); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkSecure().then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.data["ok"] ? 0 : 1; }).catch((error) => { process.stderr.write(`${JSON.stringify({ error: String(error) })}\n`); process.exitCode = 2; });
