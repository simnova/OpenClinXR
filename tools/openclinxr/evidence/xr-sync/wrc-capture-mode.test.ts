import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { GPU_ARGS, VIEWPORT } from "../site/capture/capture-instrument.mjs";
import { assertUiXrDist, mergeCaptureLaunchArgs } from "./harness-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const STORE = "/Volumes/files/openclinxr-assets/store/site-reimagine/wrc";
const BEFORE_C36 = join(STORE, "before-c36-a3");
const BEFORE_C14 = join(STORE, "before-c14-a3");
const AFTER_C36 = join(STORE, "after-off-c36");
const AFTER_C14 = join(STORE, "after-off-c14");
const ON_C36 = process.env.WRC_ON_C36_DIR ?? join(STORE, "on-c36-a5");
const ON_C14 = join(STORE, "on-c14-a5");
const REVIEW_INDEX = "exam-session.review-index.json";
const REVIEW_PACKET = "exam-session.review-packet.json";
const DEV_SERVER_DIST = "xr-sync-server dev-server.js";
const GRADED_VIEWPORT = { width: 960, height: 600 };
const GRADED_GPU_ARGS = ["--disable-features=WebXR", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
const c36CallerArgs = (runDir: string) => ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(runDir, "audio", "onset.wav")}`];
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function pngWidth(path: string): number {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex"), `${path} PNG signature`).toBe("89504e470d0a1a0a");
  return bytes.readUInt32BE(16);
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function hashFiles(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else hashes[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return hashes;
}

/**
 * Closed volatility list for the flag-off known-good comparison. Nothing else
 * is removed:
 * - elapsedMs/startedAt: wall-clock start and duration vary per execution.
 * - pageUrl/syncUrl/seedOut/scoreDir/sessionDir/traceDir: each write-once run
 *   has a different output path and ephemeral localhost ports.
 * - connectionId/pageLoadId/lastServerState.learners: Colyseus/browser ids are
 *   generated per connection (the learner map is keyed by that id).
 * - frameMs/rttMs/firstSnapshotAtMs/lastChangeAtMs/atMs and
 *   mouthActiveSpeakingFrames: scheduler, network-loop and animation samples.
 * - reviewIndex station traceFile/noteFile and sessionHashesBefore/After: room
 *   basenames are random; session integrity is asserted independently below.
 * - c36 assertion detail at indexes 0 and 4, stack bootLines/instance/port,
 *   probe countdown strings, and capture samples/rms/releaseToCaptionMs/
 *   confidence: ephemeral port/instance, countdown sampling, and live audio.
 */
function withoutVolatileFields(kind: "c36" | "c14", raw: unknown): unknown {
  const value = structuredClone(raw) as Record<string, unknown>;
  if (kind === "c36") {
    delete value.elapsedMs;
    const assertions = value.assertions as Record<string, unknown>[];
    delete assertions[0]?.detail;
    delete assertions[4]?.detail;
    const stack = value.stack as Record<string, unknown>;
    delete stack.bootLines;
    delete stack.instance;
    delete stack.port;
    for (const probe of Object.values(stack.probe as Record<string, Record<string, unknown>>)) {
      delete probe.countdown;
      for (const capture of (probe.captures ?? []) as Record<string, unknown>[]) {
        delete capture.samples;
        delete capture.rms;
        delete capture.releaseToCaptionMs;
        delete capture.confidence;
      }
    }
    return value;
  }

  for (const field of ["elapsedMs", "startedAt", "pageUrl", "syncUrl", "seedOut", "scoreDir", "sessionDir", "traceDir", "frameMs", "rttMs", "sessionHashesBefore", "sessionHashesAfter"]) {
    delete value[field];
  }
  const scrub = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) scrub(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    for (const field of ["connectionId", "pageLoadId", "firstSnapshotAtMs", "lastChangeAtMs", "atMs", "frameMs", "rttMs", "mouthActiveSpeakingFrames"]) delete object[field];
    if ("lastServerState" in object && object.lastServerState !== null && typeof object.lastServerState === "object") {
      delete (object.lastServerState as Record<string, unknown>).learners;
    }
    for (const child of Object.values(object)) scrub(child);
  };
  scrub(value);
  const reviewIndex = value.reviewIndex as Record<string, unknown>;
  for (const station of reviewIndex.stations as Record<string, unknown>[]) {
    delete station.traceFile;
    delete station.noteFile;
  }
  return value;
}

function assertSameOwnerEnvironment(beforeDir: string, afterDir: string): void {
  const before = readJson(join(beforeDir, "owner-env.json"));
  const after = readJson(join(afterDir, "owner-env.json"));
  for (const field of ["XR_SYNC_STT_PYTHON", "sttPythonTarget", "pathPrefix"]) expect(after[field], field).toBe(before[field]);
  const beforeDist = before.dist as Record<string, string>;
  const afterDist = after.dist as Record<string, string>;
  expect(Object.keys(afterDist).sort()).toEqual(Object.keys(beforeDist).sort());
  for (const name of Object.keys(beforeDist)) {
    if (name === DEV_SERVER_DIST) expect(afterDist[name], name).not.toBe(beforeDist[name]);
    else expect(afterDist[name], name).toBe(beforeDist[name]);
  }
  // head, dirtyFiles and recordedAt are intentionally not compared: the
  // after run is on the edited tree and is necessarily recorded later.
}

async function recomputePacket(traceDir: string, scoreDir: string): Promise<unknown> {
  const loadingPath = join(ROOT, "packages/openclinxr/xr-sync-server/dist/station-replay-loading.js");
  const packetPath = join(ROOT, "packages/openclinxr/xr-sync-server/dist/review-packet.js");
  const { loadStationReplayDir } = await import(pathToFileURL(loadingPath).href);
  const { buildReviewPacket } = await import(pathToFileURL(packetPath).href);
  const built = buildReviewPacket(traceDir, loadStationReplayDir(traceDir), { scoreDir, rubric: RUBRIC });
  expect(built.ok).toBe(true);
  return built.packet;
}

it.skipIf(!existsSync(STORE))("flag-off c36 and c14 match their known-good outputs under the recorded equal owner environment", () => {
  assertSameOwnerEnvironment(BEFORE_C36, AFTER_C36);
  assertSameOwnerEnvironment(BEFORE_C14, AFTER_C14);
  expect(withoutVolatileFields("c36", readJson(join(AFTER_C36, "c36-run.json")))).toEqual(
    withoutVolatileFields("c36", readJson(join(BEFORE_C36, "c36-run.json"))),
  );
  expect(withoutVolatileFields("c14", readJson(join(AFTER_C14, "c14-run.json")))).toEqual(
    withoutVolatileFields("c14", readJson(join(BEFORE_C14, "c14-run.json"))),
  );
});

it("W0 and the harness share the side-effect-free graded GPU args and viewport", () => {
  expect(GPU_ARGS).toEqual(GRADED_GPU_ARGS);
  expect(VIEWPORT).toEqual(GRADED_VIEWPORT);
  const w0 = readFileSync(join(ROOT, "tools/openclinxr/evidence/site/capture/w0-still.mjs"), "utf8");
  const harness = readFileSync(join(ROOT, "tools/openclinxr/evidence/xr-sync/harness-lib.mjs"), "utf8");
  expect(w0).toContain('import { GPU_ARGS, VIEWPORT } from "./capture-instrument.mjs"');
  expect(harness).toContain('import { GPU_ARGS, VIEWPORT } from "../site/capture/capture-instrument.mjs"');
});

it("capture merges every GPU and C36 caller launch arg once while flag-off retains its original launch and context", () => {
  const callerArgs = c36CallerArgs("/tmp/wrc-pure-probe");
  const merged = mergeCaptureLaunchArgs(["--disable-features=WebXR", ...callerArgs]);
  for (const arg of [...GPU_ARGS, ...callerArgs]) expect(merged).toContain(arg);
  expect(merged.filter((arg) => arg === "--disable-features=WebXR")).toHaveLength(1);
  const harness = readFileSync(join(ROOT, "tools/openclinxr/evidence/xr-sync/harness-lib.mjs"), "utf8");
  const c36 = readFileSync(join(ROOT, "tools/openclinxr/evidence/xr-sync/c36-run.mjs"), "utf8");
  for (const arg of callerArgs.slice(0, 3)) expect(c36).toContain(arg);
  expect(c36).toContain("--use-file-for-fake-audio-capture=");
  expect(harness).toContain('args: ["--disable-features=WebXR", ...launchArgs]');
  expect(harness).toContain('context = await browser.newContext({ viewport: { width: 800, height: 600 } });');
});

it("fails fast with ui_xr_dist_missing when the UI build is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "wrc-ui-xr-dist-"));
  try {
    expect(() => assertUiXrDist(root)).toThrow(/ui_xr_dist_missing/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

it.skipIf(!existsSync(join(ROOT, "apps/ui-xr/dist/index.html")))("accepts the real repository UI build when present", () => {
  expect(() => assertUiXrDist(ROOT)).not.toThrow();
});

it.skipIf(!existsSync(STORE))("capture records the a5 merged launch list and a non-software GPU renderer", () => {
  const record = readJson(join(ON_C36, "renderer.json"));
  const callerArgs = c36CallerArgs(ON_C36);
  const expected = mergeCaptureLaunchArgs([...GPU_ARGS, ...callerArgs]);
  expect(record.launchArgs).toEqual(expected);
  expect([...GPU_ARGS, ...callerArgs].filter((arg) => !record.launchArgs.includes(arg))).toEqual([]);
  expect(record.renderer).not.toBeNull();
  expect(record.renderer).not.toMatch(/SwiftShader|llvmpipe|software/i);
});

it.skipIf(!existsSync(STORE))("capture screenshots cover the runtime panel and show distinct doorway and encounter states", () => {
  const doorway = join(ON_C36, "c36-doorway-refusal.png");
  const encounter = join(ON_C36, "c36-encounter.png");
  expect(sha256(doorway)).not.toBe(sha256(encounter));
  expect(pngWidth(doorway)).toBeGreaterThan(371);
  expect(pngWidth(encounter)).toBeGreaterThan(371);
});

it.skipIf(!existsSync(STORE))("capture video has a codec and spans the measured browser-context lifetime", () => {
  const videos = readdirSync(join(ON_C36, "video")).filter((name) => statSync(join(ON_C36, "video", name)).isFile());
  expect(videos.length).toBeGreaterThan(0);
  const ffprobe = readJson(join(ON_C36, "video.json"));
  const codec = ffprobe.streams?.[0]?.codec_name;
  const duration = Number(ffprobe.format?.duration);
  const renderer = readJson(join(ON_C36, "renderer.json"));
  expect(codec).toBeTruthy();
  expect(duration).toBeGreaterThanOrEqual(renderer.captureDurationSeconds);
  expect(renderer.captureDurationSeconds).toBe((renderer.captureEndedAtMs - renderer.captureStartedAtMs) / 1000);
});

it.skipIf(!existsSync(STORE))("on-c14 reviews exactly the persisted on-c36 session and its packet is rebuilt by the server packet builder", async () => {
  const sessionDir = join(ON_C36, "session");
  const traceDir = join(sessionDir, "trace");
  const onRun = readJson(join(ON_C14, "c14-run.json"));
  const onPacket = readJson(join(ON_C14, "scores", REVIEW_PACKET));
  const onIndex = readJson(join(traceDir, REVIEW_INDEX));
  expect(onRun.sessionHashesBefore).toEqual(hashFiles(sessionDir));
  for (const station of onIndex.stations) {
    expect(existsSync(join(traceDir, station.traceFile)), station.traceFile).toBe(true);
    if (station.noteFile !== null) expect(existsSync(join(traceDir, station.noteFile)), station.noteFile).toBe(true);
  }
  expect(onPacket).toEqual(await recomputePacket(traceDir, join(ON_C14, "scores")));
});

it.skipIf(!existsSync(STORE))("the builder reproduces the known-good c12seed packet, and on-c14 is not that seeded session", async () => {
  const beforeTrace = join(BEFORE_C14, "c12seed", "session", "trace");
  const beforePacket = readJson(join(BEFORE_C14, "scores", REVIEW_PACKET));
  const rebuiltBefore = await recomputePacket(beforeTrace, join(BEFORE_C14, "scores"));
  const onPacket = readJson(join(ON_C14, "scores", REVIEW_PACKET));
  expect(rebuiltBefore).toEqual(beforePacket);
  expect(onPacket).not.toEqual(rebuiltBefore);
});
