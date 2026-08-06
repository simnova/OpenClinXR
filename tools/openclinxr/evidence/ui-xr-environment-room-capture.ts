/**
 * #69 — station environment room capture from the live ui-xr scene.
 *
 * Proves a learner-facing room was rendered, and ties each image to shell facts
 * read back from the running page (not restated from environment-descriptors.ts).
 *
 * Capture mode: `scene-overview` (main.ts isGeneratedSceneOverviewCaptureMode) —
 * wider FOV, multi-actor framing, and does NOT take the clean-humanoid comparator
 * path that hides stationEnvironment + floor (main.ts:3318-3320).
 *
 * claimScope: parametric shell visibility + live shell fact readout.
 * notEvidenceFor: clinical realism, Quest readiness, kit-bashed room assets.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";

export const ROOM_CAPTURE_OUTPUT_DIR = ".openclinxr/evidence/ui-xr-environment-room/latest";
export const ROOM_CAPTURE_MANIFEST_NAME = "capture-manifest.json";

/** Modes known to hide the station shell / floor for clean humanoid grading. */
const HIDDEN_ENVIRONMENT_CAPTURE_MODES = [
  "clean-humanoid-source-comparator",
  "source-clean",
] as const;

export type LiveShell = {
  environmentId: string;
  floorColor?: unknown;
  roomDepthMeters?: unknown;
  roomWidthMeters?: unknown;
  roomHeightMeters?: unknown;
  shellVisible?: boolean;
  floorVisible?: boolean;
  encounterFloorTheme?: unknown;
  captureMode?: string;
  cameraFraming?: string;
};

export type RoomCaptureManifestEntry = {
  scenarioId: string;
  imagePath: string;
  liveShell: LiveShell;
  /** Always live_scene — never restated from the descriptor module. */
  source: "live_scene";
};

export type RoomCaptureManifest = {
  schemaVersion: "openclinxr.ui-xr-environment-room-capture.v1";
  kind: "ui_xr_environment_room_capture";
  generatedAt: string;
  captureMode: string;
  framingNote: string;
  claimScope: string[];
  notEvidenceFor: string[];
  entries: RoomCaptureManifestEntry[];
};

export type PageReading = {
  scenarioId: string;
  imagePath: string;
  liveShell: LiveShell;
};

/**
 * Build a capture manifest from page readings only.
 * Must not import or reconcile against environment-descriptors — that would restate
 * the inputs (the schematic failure this contract exists to prevent).
 */
export function buildRoomCaptureManifest(input: {
  pageReadings: ReadonlyArray<PageReading>;
}): RoomCaptureManifest {
  return {
    schemaVersion: "openclinxr.ui-xr-environment-room-capture.v1",
    kind: "ui_xr_environment_room_capture",
    generatedAt: new Date().toISOString(),
    captureMode: "scene-overview",
    framingNote:
      "scene-overview (isGeneratedSceneOverviewCaptureMode) keeps the station shell visible and uses room-scale FOV; not face-detail or clean-humanoid-source-comparator",
    claimScope: [
      "parametric_station_shell_rendered_in_ui_xr",
      "live_shell_facts_read_from_running_page",
    ],
    notEvidenceFor: [
      "clinical_room_realism",
      "quest_readiness",
      "kit_bashed_or_generated_room_assets",
      "exam_equivalence",
    ],
    entries: input.pageReadings.map((reading) => ({
      scenarioId: reading.scenarioId,
      imagePath: reading.imagePath,
      liveShell: { ...reading.liveShell },
      source: "live_scene" as const,
    })),
  };
}

/**
 * Refuse capture modes that hide the station environment (empty-stage trap).
 * scene-overview (and other room-visible modes) must not be refused.
 */
export function refusesHiddenEnvironmentCapture(input: { captureMode: string }): boolean {
  const mode = input.captureMode.trim().toLowerCase();
  if (mode.length === 0) return false;
  for (const blocked of HIDDEN_ENVIRONMENT_CAPTURE_MODES) {
    if (mode === blocked || mode.includes(blocked)) return true;
  }
  // Also refuse bare "source-clean" / humanoid-source-comparator clean paths.
  if (mode.includes("source-clean")) return true;
  if (mode.includes("clean-humanoid")) return true;
  return false;
}

const DEFAULT_SCENARIOS = [
  "ed_chest_pain_priority_v1",
  "telehealth_diabetes_health_literacy_v1",
] as const;

const ROOM_CAPTURE_MODE = "scene-overview";

function buildCaptureUrl(baseUrl: string, scenarioId: string, captureMode: string): string {
  const params = new URLSearchParams({
    openclinxrScenarioId: scenarioId,
    scenarioId,
    openclinxrCaptureMode: captureMode,
    capture: captureMode,
    openclinxrPortalStart: "encounter",
    openclinxrAcceleratedExam: "1",
  });
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${root}?${params.toString()}`;
}

type LiveShellFromPage = LiveShell & { ready: boolean; reason?: string };

async function readLiveShellFromPage(page: Page): Promise<LiveShellFromPage> {
  return page.evaluate(() => {
    type Obj = {
      name?: string;
      visible?: boolean;
      userData?: Record<string, unknown>;
      children?: Obj[];
      traverse?: (cb: (o: Obj) => void) => void;
    };
    type SceneLike = Obj & {
      userData?: Record<string, unknown>;
    };
    const win = window as unknown as {
      __openClinXrDebugScene?: SceneLike;
      __openClinXrBootEvidence?: { events?: Array<{ phase?: string }> };
    };
    const scene = win.__openClinXrDebugScene;
    if (!scene) {
      return { ready: false, reason: "no __openClinXrDebugScene", environmentId: "" };
    }

    const stationMeta = scene.userData?.openClinXrStationEnvironment as
      | { environmentId?: string; floorColor?: unknown; roomDepthMeters?: unknown; environmentFallbackActive?: boolean }
      | undefined;

    let shell: Obj | undefined;
    let floor: Obj | undefined;
    if (typeof scene.traverse === "function") {
      scene.traverse((object) => {
        const name = object.name ?? "";
        if (name === "openclinxr.station-environment-shell") shell = object;
        if (name === "openclinxr.station-environment.floor" || name.endsWith(".floor")) {
          if (object.userData?.openClinXrEncounterSpecificRuntimeTheme || name.includes("station-environment")) {
            floor = object;
          }
        }
      });
    }

    // Prefer shell.userData (written by buildStationEnvironment) — page truth.
    const shellUd = shell?.userData ?? {};
    const environmentId =
      (typeof shellUd.environmentId === "string" && shellUd.environmentId)
      || stationMeta?.environmentId
      || "";
    if (!environmentId) {
      return { ready: false, reason: "station shell not resolved yet", environmentId: "" };
    }

    // Camera framing note from locomotion child if present.
    let cameraFraming = "";
    if (typeof scene.traverse === "function") {
      scene.traverse((object) => {
        const framing = object.userData?.openClinXrCameraFraming;
        if (typeof framing === "string" && framing.length > 0 && !cameraFraming) {
          cameraFraming = framing;
        }
      });
    }

    return {
      ready: true,
      environmentId,
      floorColor: shellUd.floorColor ?? stationMeta?.floorColor,
      roomDepthMeters: shellUd.roomDepthMeters ?? stationMeta?.roomDepthMeters,
      roomWidthMeters: shellUd.roomWidthMeters,
      roomHeightMeters: shellUd.roomHeightMeters,
      shellVisible: shell?.visible !== false,
      floorVisible: floor?.visible !== false,
      encounterFloorTheme: floor?.userData?.openClinXrEncounterSpecificRuntimeTheme
        ?? "floor_color_derived_from_environmentId_descriptor",
      cameraFraming,
    };
  });
}

/**
 * Pull camera back / elevate slightly so walls + floor of the parametric shell
 * read as a room rather than an actor close-up. scene-overview already starts
 * wider than face-detail; this nudges toward a learner standing at the doorway.
 */
async function reframeCameraForRoom(page: Page): Promise<string> {
  return page.evaluate(() => {
    type Cam = {
      position: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
      lookAt: (x: number, y: number, z: number) => void;
      fov?: number;
      updateProjectionMatrix?: () => void;
      userData?: Record<string, unknown>;
      parent?: { worldToLocal?: (v: { set: (x: number, y: number, z: number) => unknown; x: number; y: number; z: number }) => unknown };
    };
    type Obj = {
      isPerspectiveCamera?: boolean;
      type?: string;
      name?: string;
      traverse?: (cb: (o: Obj) => void) => void;
    } & Partial<Cam>;

    const scene = (window as unknown as { __openClinXrDebugScene?: Obj }).__openClinXrDebugScene;
    if (!scene?.traverse) return "no-scene";

    let camera: Cam | undefined;
    scene.traverse((object) => {
      if (camera) return;
      if (object.isPerspectiveCamera || object.type === "PerspectiveCamera") {
        camera = object as unknown as Cam;
      }
    });
    if (!camera) return "no-camera";

    // Doorway-side elevated overview looking into the encounter (negative Z).
    camera.position.set(1.35, 2.05, 3.15);
    camera.lookAt(0, 1.0, -1.35);
    if (typeof camera.fov === "number") {
      camera.fov = 62;
      camera.updateProjectionMatrix?.();
    }
    if (camera.userData) {
      camera.userData.openClinXrCameraFraming = "environment_room_capture_doorway_elevated_overview_#69";
    }
    return `roomCam=${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
  });
}

async function waitForStationShell(page: Page, timeoutMs = 180_000): Promise<LiveShellFromPage> {
  // Playwright signature is (fn, arg, options) — options must be the third argument.
  await page.waitForFunction(
    () => {
      const scene = (window as unknown as {
        __openClinXrDebugScene?: {
          userData?: { openClinXrStationEnvironment?: { environmentId?: string } };
          traverse?: (cb: (o: { name?: string }) => void) => void;
        };
      }).__openClinXrDebugScene;
      if (!scene) return false;
      if (scene.userData?.openClinXrStationEnvironment?.environmentId) return true;
      let found = false;
      scene.traverse?.((object) => {
        if (object.name === "openclinxr.station-environment-shell") found = true;
      });
      return found;
    },
    undefined,
    { timeout: timeoutMs },
  );
  const reading = await readLiveShellFromPage(page);
  if (!reading.ready) {
    throw new Error(`station shell not ready: ${reading.reason ?? "unknown"}`);
  }
  return reading;
}

export type CaptureStationEnvironmentRoomsInput = {
  /** Absolute or repo-relative output directory. */
  outputDir?: string;
  /** Scenario ids to load (default: ED chest pain + telehealth diabetes). */
  scenarioIds?: readonly string[];
  captureMode?: string;
  /** Injected base URL skips spawning a dev server (tests / resume). */
  baseUrl?: string;
};

/**
 * Capture room screenshots for each scenario and write a live_scene manifest.
 * Throws if the capture mode would hide the station environment.
 */
export async function captureStationEnvironmentRooms(
  input: CaptureStationEnvironmentRoomsInput = {},
): Promise<RoomCaptureManifest> {
  const captureMode = input.captureMode ?? ROOM_CAPTURE_MODE;
  if (refusesHiddenEnvironmentCapture({ captureMode })) {
    throw new Error(
      `refusesHiddenEnvironmentCapture: mode "${captureMode}" hides the station environment (main.ts clean humanoid comparator path). Use scene-overview / generated-scene / dynamic-only.`,
    );
  }

  const scenarioIds = input.scenarioIds ?? [...DEFAULT_SCENARIOS];
  const outputDir = input.outputDir ?? ROOM_CAPTURE_OUTPUT_DIR;
  await mkdir(outputDir, { recursive: true });

  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl = input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({
          filter: "@openclinxr/ui-xr",
          readyTimeoutMs: 180_000,
        });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const pageReadings: PageReading[] = [];

      for (const scenarioId of scenarioIds) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          const url = buildCaptureUrl(baseUrl, scenarioId, captureMode);
          process.stdout.write(`room-capture: goto ${scenarioId} mode=${captureMode}\n`);
          // Prefer "load" over networkidle — WebGL/XR pages often never go fully idle.
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });

          const live = await waitForStationShell(page, 180_000);
          if (live.shellVisible === false || live.floorVisible === false) {
            throw new Error(
              `environment shell hidden for ${scenarioId} (shellVisible=${String(live.shellVisible)} floorVisible=${String(live.floorVisible)}); refuse empty-stage photograph`,
            );
          }

          const frameNote = await reframeCameraForRoom(page);
          process.stdout.write(`room-capture: ${scenarioId} live env=${live.environmentId} depth=${String(live.roomDepthMeters)} floor=${String(live.floorColor)} cam=${frameNote}\n`);

          // Let one render frame settle after reframe.
          await page.waitForTimeout(700);

          const imageName = `${scenarioId}-room.png`;
          const imagePath = path.join(outputDir, imageName);
          await page.screenshot({ path: imagePath, fullPage: false });

          // Re-read after screenshot so facts match the drawn frame.
          const liveAfter = await readLiveShellFromPage(page);
          pageReadings.push({
            scenarioId,
            imagePath: imageName,
            liveShell: {
              environmentId: liveAfter.environmentId || live.environmentId,
              floorColor: liveAfter.floorColor ?? live.floorColor,
              roomDepthMeters: liveAfter.roomDepthMeters ?? live.roomDepthMeters,
              roomWidthMeters: liveAfter.roomWidthMeters ?? live.roomWidthMeters,
              roomHeightMeters: liveAfter.roomHeightMeters ?? live.roomHeightMeters,
              shellVisible: liveAfter.shellVisible,
              floorVisible: liveAfter.floorVisible,
              encounterFloorTheme: liveAfter.encounterFloorTheme,
              captureMode,
              cameraFraming: liveAfter.cameraFraming || frameNote,
            },
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      }

      const manifest = buildRoomCaptureManifest({ pageReadings });
      const manifestPath = path.join(outputDir, ROOM_CAPTURE_MANIFEST_NAME);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      process.stdout.write(`room-capture: wrote ${manifestPath} (${manifest.entries.length} entries)\n`);
      return manifest;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let outputDir = ROOM_CAPTURE_OUTPUT_DIR;
  let captureMode = ROOM_CAPTURE_MODE;
  const scenarioIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--output-dir" && args[i + 1]) {
      outputDir = args[++i]!;
    } else if (arg === "--capture-mode" && args[i + 1]) {
      captureMode = args[++i]!;
    } else if (arg === "--scenario" && args[i + 1]) {
      scenarioIds.push(args[++i]!);
    }
  }

  const manifest = await captureStationEnvironmentRooms({
    outputDir,
    captureMode,
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : undefined,
  });

  // Fail closed if the two primary settings did not differ live (second contract).
  const ed = manifest.entries.find((e) => e.scenarioId.includes("ed_chest_pain") || e.liveShell.environmentId.includes("ed_exam"));
  const home = manifest.entries.find(
    (e) => e.scenarioId.includes("telehealth") || e.liveShell.environmentId.includes("telehealth"),
  );
  if (ed && home) {
    if (ed.liveShell.environmentId === home.liveShell.environmentId) {
      throw new Error("ED and telehealth reported the same live environmentId");
    }
    if (ed.liveShell.floorColor === home.liveShell.floorColor) {
      throw new Error("ED and telehealth reported the same live floorColor");
    }
    if (ed.liveShell.roomDepthMeters === home.liveShell.roomDepthMeters) {
      throw new Error("ED and telehealth reported the same live roomDepthMeters");
    }
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("ui-xr-environment-room-capture.ts")
    || process.argv[1].endsWith("ui-xr-environment-room-capture.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
