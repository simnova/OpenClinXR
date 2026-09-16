import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { sceneClosureCaseDocument } from "../../../../tools/openclinxr/factory/scene-closure-case-source.js";
import { newEvidencePage } from "../lib/evidence-page.js";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import { waitForStationShell } from "../ui-xr-environment-room-capture.js";
import {
  type AdmissionSnapshot,
  type AttemptRecord,
  type BedsideAdmissionColdBootsReport,
  type CollectorIdentity,
  type NamedTimeout,
  SOURCE_PATHS,
  attemptHasAdmissionObservation,
  recomputeCollectorOutcome,
  repoRootFromHere,
  sha256File,
  sha256Hex,
  validateBedsideAdmissionColdBootsReport,
} from "./validate.js";

/**
 * Bounded five-boot admission collector.
 *
 * INSTRUMENT: measures what the production ui-xr path publishes on five fresh
 * Chromium processes against one shared portless server. Not a requirement that
 * the product admits. Five named refusals are a complete successful result.
 *
 * Default CLI writes a unique gitignored directory under
 * `.openclinxr/evidence/bedside-admission-cold-boots/<run-id>/` and NEVER
 * rewrites the tracked snapshot.
 */

const CASE_ID = "scene_closure_supine_bedside_v1";
const CASE_STATION_ID = "scene_closure_supine_bedside_station_v1";
const CASE_ENVIRONMENT_ID = "inpatient_ward_room_v1";
const ATTEMPT_COUNT = 5;
const VIEWPORT = { width: 960, height: 720 } as const;
const SERVER_READY_MS = 180_000;
const NAVIGATION_MS = 240_000;
const STATION_SHELL_MS = 180_000;
const ADMISSION_OBSERVE_MS = 30_000;
const TRANSITION_TAIL_MS = 5_000;
const POLL_MS = 250;
const LAUNCH_ARGS = [
  "--disable-gpu-vsync",
  "--disable-frame-rate-limit",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
] as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getHeadSha(): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: REPO_ROOT }, (err: Error | null, stdout: string) => {
      resolve(err ? "unknown" : stdout.trim());
    });
  });
}

async function hashSources(): Promise<BedsideAdmissionColdBootsReport["sourceSha256"]> {
  const out = {} as BedsideAdmissionColdBootsReport["sourceSha256"];
  for (const [key, rel] of Object.entries(SOURCE_PATHS) as Array<
    [keyof typeof SOURCE_PATHS, string]
  >) {
    const abs = path.join(REPO_ROOT, rel);
    out[key] = { path: rel, sha256: await sha256File(abs) };
  }
  return out;
}

function slimSnapshot(value: Record<string, unknown> | null, atMs: number): AdmissionSnapshot {
  if (value === null) {
    return {
      atIso: new Date(atMs).toISOString(),
      atMs,
      status: "unknown",
      reason: null,
      detail: null,
      reproduced: null,
      observedGeometryRevision: null,
      source: null,
    };
  }
  const statusRaw = value.status;
  const status = typeof statusRaw === "string" ? statusRaw : "unknown";
  return {
    atIso: new Date(atMs).toISOString(),
    atMs,
    status,
    reason: value.reason === null || value.reason === undefined ? null : String(value.reason),
    detail: value.detail === null || value.detail === undefined ? null : String(value.detail),
    reproduced: typeof value.reproduced === "boolean" ? value.reproduced : null,
    observedGeometryRevision:
      value.observedGeometryRevision === null || value.observedGeometryRevision === undefined
        ? null
        : String(value.observedGeometryRevision),
    source: value.source === null || value.source === undefined ? null : String(value.source),
  };
}

function snapshotKey(snap: AdmissionSnapshot): string {
  return JSON.stringify({
    status: snap.status,
    reason: snap.reason,
    detail: snap.detail,
    reproduced: snap.reproduced,
    observedGeometryRevision: snap.observedGeometryRevision,
  });
}

function isTerminalSnapshot(snap: AdmissionSnapshot | undefined): boolean {
  if (!snap) return false;
  if (snap.status === "refused" || snap.status === "no_plan_carried") return true;
  return snap.status === "admitted" && snap.reproduced === true;
}

const ADMISSION_OBSERVER_INIT = `(() => {
  const logKey = "__openClinXrAdmissionObserverLog";
  const countKey = "__openClinXrAdmissionObserverPublishCount";
  const currentKey = "__openClinXrFrozenScenePlanAdmission";
  const log = [];
  let current = undefined;
  globalThis[logKey] = log;
  globalThis[countKey] = 0;
  Object.defineProperty(globalThis, currentKey, {
    configurable: true,
    enumerable: true,
    get() { return current; },
    set(value) {
      current = value;
      globalThis[countKey] = (globalThis[countKey] || 0) + 1;
      const atMs = Date.now();
      log.push({ atMs, value: value === undefined ? null : value });
    }
  });
})()`;

type ObserverDump = {
  publishCount: number;
  snapshots: AdmissionSnapshot[];
};

async function readObserver(page: Page): Promise<ObserverDump> {
  const dumped = (await page.evaluate(`(() => {
    const log = globalThis.__openClinXrAdmissionObserverLog;
    const publishCount = globalThis.__openClinXrAdmissionObserverPublishCount ?? 0;
    if (!Array.isArray(log)) {
      return { publishCount, entries: [], diagnostic: "observer log missing" };
    }
    return {
      publishCount,
      diagnostic: null,
      entries: log.map((row) => ({ atMs: row.atMs, value: row.value ?? null })),
    };
  })()`)) as {
    publishCount: number;
    diagnostic: string | null;
    entries: Array<{ atMs: number; value: Record<string, unknown> | null }>;
  };
  const snapshots: AdmissionSnapshot[] = [];
  let lastKey = "";
  for (const entry of dumped.entries ?? []) {
    const snap = slimSnapshot(entry.value, entry.atMs);
    const key = snapshotKey(snap);
    if (key !== lastKey) {
      snapshots.push(snap);
      lastKey = key;
    }
  }
  return { publishCount: dumped.publishCount ?? 0, snapshots };
}

async function readDrive(page: Page): Promise<{ driveSource: string; diagnostic: string | null }> {
  try {
    return (await page.evaluate(`(() => {
      const ev = globalThis.__openClinXrBedsideApproachEvidence;
      if (!ev) {
        return { driveSource: "unknown", diagnostic: "__openClinXrBedsideApproachEvidence never published" };
      }
      if (ev.driveSource === null || ev.driveSource === undefined) {
        return { driveSource: "unknown", diagnostic: "driveSource field null on published bedside evidence" };
      }
      return { driveSource: String(ev.driveSource), diagnostic: null };
    })()`)) as { driveSource: string; diagnostic: string | null };
  } catch (err) {
    return {
      driveSource: "unknown",
      diagnostic: `driveSource evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function readEnvironment(
  page: Page,
): Promise<{ state: string; diagnostic: string | null }> {
  try {
    return (await page.evaluate(`(() => {
      const scene = globalThis.__openClinXrDebugScene;
      if (!scene) {
        return { state: "unknown", diagnostic: "__openClinXrDebugScene missing" };
      }
      let found = null;
      const visit = (ud) => {
        if (ud && typeof ud === "object" && ud.openClinXrInfinigenEnvironmentStatus) {
          found = ud.openClinXrInfinigenEnvironmentStatus;
        }
      };
      visit(scene.userData || {});
      if (typeof scene.traverse === "function") {
        scene.traverse((object) => visit(object.userData || {}));
      }
      if (!found) {
        return { state: "unknown", diagnostic: "openClinXrInfinigenEnvironmentStatus not present on scene graph" };
      }
      return { state: String(found.state ?? "unknown"), diagnostic: found.error ? String(found.error) : null };
    })()`)) as { state: string; diagnostic: string | null };
  } catch (err) {
    return {
      state: "unknown",
      diagnostic: `environment evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function readActors(page: Page): Promise<{
  actors: AttemptRecord["actorWorldPositions"];
  diagnostic: string | null;
}> {
  try {
    return (await page.evaluate(`(() => {
      const scene = globalThis.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") {
        return { actors: [], diagnostic: "__openClinXrDebugScene missing or has no traverse" };
      }
      const actors = [];
      scene.traverse((object) => {
        const id = object.userData && object.userData.openClinXrActorId;
        if (typeof id !== "string" || !id) return;
        if (typeof object.updateWorldMatrix === "function") {
          object.updateWorldMatrix(true, false);
        }
        let x = null, y = null, z = null;
        const e = object.matrixWorld && object.matrixWorld.elements;
        if (e && e.length >= 15) {
          x = e[12]; y = e[13]; z = e[14];
        } else if (object.position) {
          x = object.position.x; y = object.position.y; z = object.position.z;
        }
        actors.push({ actorId: id, name: object.name || null, x, y, z });
      });
      return { actors, diagnostic: actors.length === 0 ? "debug scene exposed but no openClinXrActorId roots" : null };
    })()`)) as { actors: AttemptRecord["actorWorldPositions"]; diagnostic: string | null };
  } catch (err) {
    return {
      actors: [],
      diagnostic: `actor position evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function finalFromSnapshots(snapshots: AdmissionSnapshot[]): Pick<
  AttemptRecord,
  "finalStatus" | "finalReason" | "finalDetail" | "finalReproduced" | "observedGeometryRevision"
> {
  const last = snapshots[snapshots.length - 1];
  if (!last) {
    return {
      finalStatus: "unknown",
      finalReason: "unknown",
      finalDetail: "window.__openClinXrFrozenScenePlanAdmission was never published",
      finalReproduced: null,
      observedGeometryRevision: null,
    };
  }
  return {
    finalStatus: last.status,
    finalReason: last.reason,
    finalDetail: last.detail,
    finalReproduced: last.reproduced,
    observedGeometryRevision: last.observedGeometryRevision,
  };
}

async function persistAttempt(
  runDir: string,
  attempt: AttemptRecord,
): Promise<AttemptRecord> {
  const relRaw = path.join(runDir, `attempt-${attempt.attemptId}.json`);
  const absRaw = path.resolve(REPO_ROOT, relRaw);
  attempt.raw = { path: relRaw, sha256: "" };
  const body = `${JSON.stringify(attempt, null, 2)}\n`;
  await writeFile(absRaw, body, "utf8");
  attempt.raw = { path: relRaw, sha256: sha256Hex(body) };
  return attempt;
}

async function runOneAttempt(input: {
  attemptId: string;
  serverUrl: string;
  bundleJson: string;
  bundleRoute: string;
  portalUrl: string;
  runDir: string;
  captureHead: string;
  identity: CollectorIdentity;
}): Promise<AttemptRecord> {
  const startIso = nowIso();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestErrors: string[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;
  let namedTimeout: NamedTimeout = null;
  let timeoutDiagnostic: string | null = null;
  let launchedAtIso: string | null = null;
  let closedAtIso: string | null = null;
  let pid: number | null = null;
  let pidDiagnostic: string | null = "playwright browser.process() not yet launched";
  let browserVersion = "unknown";
  let screenshotPath: string | null = null;
  let screenshotSha: string | null = null;
  let screenshotDiagnostic: string | null = "screenshot not taken";
  let snapshots: AdmissionSnapshot[] = [];
  let publishCount = 0;
  let driveSource = "unknown";
  let driveSourceDiagnostic: string | null = "page never reached drive read";
  let environmentState = "unknown";
  let environmentDiagnostic: string | null = "page never reached environment read";
  let actors: AttemptRecord["actorWorldPositions"] = [];
  let actorPositionsDiagnostic: string | null = "page never reached actor read";

  try {
    launchedAtIso = nowIso();
    try {
      browser = await chromium.launch({
        headless: true,
        args: [...LAUNCH_ARGS],
      });
    } catch (err) {
      namedTimeout = "browser_launch";
      timeoutDiagnostic = `chromium.launch failed: ${err instanceof Error ? err.message : String(err)}`;
      pidDiagnostic = "browser launch failed; no child process";
      browser = null;
    }
    if (browser) {
    browserVersion = browser.version();
    const proc = (
      browser as Browser & { process?: () => { pid?: number } | null }
    ).process?.();
    if (proc?.pid) {
      pid = proc.pid;
      pidDiagnostic = null;
    } else {
      pidDiagnostic = "playwright browser.process() returned no pid";
    }

    page = await newEvidencePage(browser, { viewport: { ...VIEWPORT } });
    await page.addInitScript(ADMISSION_OBSERVER_INIT);
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err instanceof Error ? err.message : String(err));
    });
    page.on("requestfailed", (req) => {
      requestErrors.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? "failed"}`);
    });
    await page.route(input.bundleRoute, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: input.bundleJson });
    });

    try {
      await page.goto(input.portalUrl, { waitUntil: "networkidle", timeout: NAVIGATION_MS });
    } catch (err) {
      namedTimeout = "navigation";
      timeoutDiagnostic = `navigation wait timed out: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (namedTimeout === null) {
      try {
        await waitForStationShell(page, STATION_SHELL_MS);
      } catch (err) {
        namedTimeout = "station_shell";
        timeoutDiagnostic = `station shell wait timed out: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (namedTimeout === null || namedTimeout === "station_shell") {
      const observeMs = namedTimeout === null ? ADMISSION_OBSERVE_MS : Math.min(5_000, ADMISSION_OBSERVE_MS);
      const observeUntil = Date.now() + observeMs;
      let terminalAt: number | null = null;
      while (Date.now() < observeUntil) {
        const dump = await readObserver(page);
        snapshots = dump.snapshots;
        publishCount = dump.publishCount;
        const last = snapshots[snapshots.length - 1];
        if (isTerminalSnapshot(last) && terminalAt === null) terminalAt = Date.now();
        if (terminalAt !== null && Date.now() - terminalAt >= TRANSITION_TAIL_MS) break;
        await sleep(POLL_MS);
      }
      if (terminalAt === null) {
        await sleep(TRANSITION_TAIL_MS);
        const dump = await readObserver(page);
        snapshots = dump.snapshots;
        publishCount = dump.publishCount;
        if (!attemptHasAdmissionObservation({ snapshots } as AttemptRecord)) {
          namedTimeout = namedTimeout ?? "admission_observation";
          timeoutDiagnostic =
            timeoutDiagnostic ??
            "admission observation window elapsed with no production admission snapshot";
        }
      } else {
        const dump = await readObserver(page);
        snapshots = dump.snapshots;
        publishCount = dump.publishCount;
      }
    } else {
      try {
        const dump = await readObserver(page);
        snapshots = dump.snapshots;
        publishCount = dump.publishCount;
      } catch {
        snapshots = [];
      }
    }

    try {
      const drive = await readDrive(page);
      driveSource = drive.driveSource;
      driveSourceDiagnostic = drive.diagnostic;
      const env = await readEnvironment(page);
      environmentState = env.state;
      environmentDiagnostic = env.diagnostic;
      const actorDump = await readActors(page);
      actors = actorDump.actors;
      actorPositionsDiagnostic = actorDump.diagnostic;
    } catch (err) {
      driveSourceDiagnostic = `telemetry read failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      const relShot = path.join(input.runDir, `attempt-${input.attemptId}.png`);
      const absShot = path.resolve(REPO_ROOT, relShot);
      await page.screenshot({ path: absShot, type: "png" });
      screenshotPath = relShot;
      screenshotSha = await sha256File(absShot);
      screenshotDiagnostic = null;
    } catch (err) {
      screenshotDiagnostic = `screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    }
  } catch (err) {
    if (namedTimeout === null) {
      timeoutDiagnostic = `attempt failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } finally {
    closedAtIso = nowIso();
    if (page) {
      await page.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }

  const finals = finalFromSnapshots(snapshots);
  const attempt: AttemptRecord = {
    attemptId: input.attemptId,
    captureHead: input.captureHead,
    bundleSha256: input.identity.bundleSha256,
    frozenPlanSha256: input.identity.frozenPlanSha256,
    browserVersion,
    startIso,
    endIso: nowIso(),
    namedTimeout,
    timeoutDiagnostic,
    admissionObservationPresent: false,
    ...finals,
    snapshots,
    publishCount,
    driveSource,
    driveSourceDiagnostic,
    environmentState,
    environmentDiagnostic,
    actorWorldPositions: actors,
    actorPositionsDiagnostic,
    consoleErrors,
    pageErrors,
    requestErrors,
    browser: {
      name: "chromium",
      version: browserVersion,
      pid,
      pidDiagnostic,
      launchedAtIso,
      closedAtIso,
    },
    screenshot: {
      path: screenshotPath,
      sha256: screenshotSha,
      diagnostic: screenshotDiagnostic,
    },
    raw: { path: "", sha256: "" },
  };
  attempt.admissionObservationPresent = attemptHasAdmissionObservation(attempt);
  return persistAttempt(input.runDir, attempt);
}

export async function captureBedsideAdmissionColdBoots(): Promise<{
  report: BedsideAdmissionColdBootsReport;
  runDir: string;
  reportPath: string;
}> {
  const captureHead = await getHeadSha();
  const runId = `${nowIso().replace(/[:.]/g, "-")}-${process.pid}`;
  const runDir = path.join(".openclinxr", "evidence", "bedside-admission-cold-boots", runId);
  await mkdir(path.resolve(REPO_ROOT, runDir), { recursive: true });
  const wallStart = Date.now();
  const deadlinesHit: string[] = [];
  const attempts: AttemptRecord[] = [];

  const { CASE_FROZEN_SCENE_PLANS } = await import(
    "../../../../packages/openclinxr/asset-registry/src/case-frozen-scene-plans.js"
  );
  const { createEdChestPainRuntimeSceneManifest } = await import(
    "../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js"
  );
  const frozenPlan = CASE_FROZEN_SCENE_PLANS[CASE_ID];
  if (!frozenPlan) {
    throw new Error(`CASE_FROZEN_SCENE_PLANS missing ${CASE_ID}`);
  }
  const frozenPlanJson = `${JSON.stringify(frozenPlan)}\n`;
  const frozenPlanSha256 = sha256Hex(frozenPlanJson);

  const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({
    scenarioId: CASE_ID,
    stationId: CASE_STATION_ID,
    scenario: sceneClosureCaseDocument() as never,
  });
  (bundle as unknown as { acceptedScenePlan: typeof frozenPlan }).acceptedScenePlan = frozenPlan;
  bundle.sceneManifest = createEdChestPainRuntimeSceneManifest({
    scenarioId: CASE_ID,
    stationId: CASE_STATION_ID,
    scenario: sceneClosureCaseDocument() as never,
    environmentId: CASE_ENVIRONMENT_ID,
  });
  const bundleJson = `${JSON.stringify(bundle, null, 2)}\n`;
  const bundleSha256 = sha256Hex(bundleJson);
  const BUNDLE_ROUTE = `**/xr-assets/generated/${CASE_ID}/learner-runtime-bundle.v1.json`;

  let identity: CollectorIdentity = {
    bundleSha256,
    frozenPlanId: String(frozenPlan.planId),
    frozenPlanSha256,
    frozenGeometryRevision: String(frozenPlan.revisions.geometryRevision),
    browserName: "chromium",
    browserVersion: "unknown",
    caseId: CASE_ID,
    stationId: CASE_STATION_ID,
    environmentId: CASE_ENVIRONMENT_ID,
    viewport: { ...VIEWPORT },
    launchArgs: [...LAUNCH_ARGS],
  };

  let server: PortlessDevServer | null = null;
  try {
    try {
      server = await spawnPortlessDevServer({
        filter: "@openclinxr/ui-xr",
        readyTimeoutMs: SERVER_READY_MS,
      });
    } catch (err) {
      deadlinesHit.push("server_startup");
      const diagnostic = `server startup wait timed out: ${err instanceof Error ? err.message : String(err)}`;
      for (let i = 1; i <= ATTEMPT_COUNT; i += 1) {
        const failed: AttemptRecord = {
          attemptId: String(i),
          captureHead,
          bundleSha256,
          frozenPlanSha256,
          browserVersion: "unknown",
          startIso: nowIso(),
          endIso: nowIso(),
          namedTimeout: "server_startup",
          timeoutDiagnostic: diagnostic,
          admissionObservationPresent: false,
          finalStatus: "unknown",
          finalReason: "unknown",
          finalDetail: "server never became ready; no admission observation",
          finalReproduced: null,
          observedGeometryRevision: null,
          snapshots: [],
          publishCount: 0,
          driveSource: "unknown",
          driveSourceDiagnostic: "server never became ready",
          environmentState: "unknown",
          environmentDiagnostic: "server never became ready",
          actorWorldPositions: [],
          actorPositionsDiagnostic: "server never became ready",
          consoleErrors: [],
          pageErrors: [],
          requestErrors: [],
          browser: {
            name: "chromium",
            version: "unknown",
            pid: null,
            pidDiagnostic: "server never became ready; browser not launched",
            launchedAtIso: null,
            closedAtIso: null,
          },
          screenshot: {
            path: null,
            sha256: null,
            diagnostic: "server never became ready; no screenshot",
          },
          raw: { path: "", sha256: "" },
        };
        attempts.push(await persistAttempt(runDir, failed));
      }
    }

    if (server) {
      const portalUrl =
        `${server.url}?openclinxrScenarioId=${CASE_ID}&stationId=${CASE_STATION_ID}` +
        `&openclinxrEnvironmentId=${CASE_ENVIRONMENT_ID}&openclinxrPortalStart=encounter` +
        `&openclinxrAcceleratedExam=1`;
      for (let i = 1; i <= ATTEMPT_COUNT; i += 1) {
        const attempt = await runOneAttempt({
          attemptId: String(i),
          serverUrl: server.url,
          bundleJson,
          bundleRoute: BUNDLE_ROUTE,
          portalUrl,
          runDir,
          captureHead,
          identity,
        });
        if (attempt.namedTimeout) deadlinesHit.push(`attempt-${attempt.attemptId}:${attempt.namedTimeout}`);
        if (attempt.browserVersion !== "unknown" && identity.browserVersion === "unknown") {
          identity = { ...identity, browserVersion: attempt.browserVersion };
        }
        attempts.push(attempt);
      }
    }
  } finally {
    if (server) {
      await stopPortlessDevServer(server.proc).catch(() => undefined);
    }
  }

  const { outcome, geometryVariation } = recomputeCollectorOutcome(attempts);
  const report: BedsideAdmissionColdBootsReport = {
    schemaVersion: "openclinxr.bedside-admission-cold-boots.v1",
    generatedAt: nowIso(),
    captureHead,
    runId,
    runDir,
    elapsedWallClockMs: Date.now() - wallStart,
    outcome,
    identity,
    sourceSha256: await hashSources(),
    attempts,
    geometryVariation,
    deadlinesHit,
    claimScope:
      "Five fresh Chromium boots of the production ui-xr path against one intercepted scene-closure bundle and accepted frozen plan, recording published frozen-scene-plan admission snapshots.",
    notEvidenceFor: [
      "clinical validity",
      "exam equivalence",
      "Quest readiness",
      "foot contact",
      "universal admission reliability",
      "GPU or headset performance",
    ],
  };

  const reportPath = path.join(runDir, "report.json");
  const absReport = path.resolve(REPO_ROOT, reportPath);
  await writeFile(absReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, runDir, reportPath };
}

async function main(): Promise<void> {
  const { report, runDir, reportPath } = await captureBedsideAdmissionColdBoots();
  const validation = await validateBedsideAdmissionColdBootsReport(report, {
    root: repoRootFromHere(),
  });
  process.stdout.write(`runDir=${runDir}\n`);
  process.stdout.write(`report=${reportPath}\n`);
  process.stdout.write(`outcome=${report.outcome}\n`);
  process.stdout.write(`elapsedMs=${report.elapsedWallClockMs}\n`);
  process.stdout.write(`deadlinesHit=${report.deadlinesHit.join(",") || "none"}\n`);
  for (const attempt of report.attempts) {
    process.stdout.write(
      `attempt ${attempt.attemptId} status=${attempt.finalStatus} reason=${attempt.finalReason ?? "null"} detail=${attempt.finalDetail ?? "null"} geom=${attempt.observedGeometryRevision ?? "null"} drive=${attempt.driveSource} timeout=${attempt.namedTimeout ?? "none"}\n`,
    );
  }
  if (!validation.ok) {
    process.stderr.write(`validator errors:\n${validation.errors.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("validator=ok\n");
  process.exit(0);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = fileURLToPath(import.meta.url);
if (invoked === thisFile) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
