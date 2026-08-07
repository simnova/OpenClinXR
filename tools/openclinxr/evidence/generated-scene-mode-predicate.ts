/**
 * #139 — generated-scene-mode predicate inspector.
 *
 * Proves `isDynamicGeneratedEncounterSceneMode` is not defined by roomProps.length.
 * Measures live scene consumers for a station as shipped and with roomProps emptied
 * (playwright route interception — does not edit shipped manifests).
 *
 * claimScope: mode predicate + affordance/fallback/panel/legacy-bed consumers in live UI-XR.
 * notEvidenceFor: cue-prop removal (follow-on), equipment authoring, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page, type Route } from "playwright";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const SCENE_MODE_EVIDENCE_DIR = ".openclinxr/evidence/issue-139";
export const PRE_FIX_NAME = "pre-fix.json";

/** Primary station used for the emptied-props trap (#139 revert). */
export const PRIMARY_SCENARIO_ID = "stepdown_sepsis_nurse_escalation_v1";

/** Capture mode that must still surface debug chrome when isDynamic is true. */
export const DEBUG_CAPTURE_MODE = "debug-scene-chrome";

export type SceneModeFacts = {
  scenarioId: string;
  roomPropCount: number;
  captureMode: string;
  isDynamicGeneratedEncounterSceneMode: boolean;
  showsRuntimeAffordanceMarkers: boolean;
  showsPrimitiveAssetFallbacks: boolean;
  inSceneEvidencePanelCount: number;
  legacyBedMonitorBoxCount: number;
  /** How the mode boolean was obtained. */
  modeSource: "window_evidence" | "scene_inference";
  assetStoreKind?: string;
  environmentReviewStatus?: string;
};

export type GeneratedSceneModePredicateReport = {
  scenes: SceneModeFacts[];
  /** Four-cell diagnosis: shipped vs emptied × normal vs debug. */
  fourCell: {
    shippedNormal: SceneModeFacts | null;
    emptiedNormal: SceneModeFacts | null;
    shippedDebug: SceneModeFacts | null;
    emptiedDebug: SceneModeFacts | null;
  };
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.generated-scene-mode-predicate.v1";
  kind: "generated_scene_mode_predicate_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: GeneratedSceneModePredicateReport;
};

let cachedReport: GeneratedSceneModePredicateReport | null = null;
let measureInFlight: Promise<GeneratedSceneModePredicateReport> | null = null;

function preFixPath(): string {
  return path.join(SCENE_MODE_EVIDENCE_DIR, PRE_FIX_NAME);
}

/**
 * Signature consumed by generated-scene-mode-predicate.test.ts planted contracts.
 * Measures once (shared across vitest cases). Optionally writes pre-fix.json.
 */
export async function inspectGeneratedSceneModePredicate(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioId?: string;
  writePreFix?: boolean;
}): Promise<GeneratedSceneModePredicateReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix) {
      if (process.env.OPENCLINXR_SCENE_MODE_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveSceneMode({
      baseUrl: input?.baseUrl,
      scenarioId: input?.scenarioId ?? PRIMARY_SCENARIO_ID,
    });

    if (input?.writePreFix) {
      await writeSceneModeDump(report, {
        outputPath: preFixPath(),
        label: input?.label ?? "pre-fix",
      });
    }

    cachedReport = report;
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(filePath: string): Promise<GeneratedSceneModePredicateReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as GeneratedSceneModePredicateReport | undefined;
    if (report?.scenes && Array.isArray(report.scenes) && report.scenes.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeSceneModeDump(
  report: GeneratedSceneModePredicateReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.generated-scene-mode-predicate.v1" as const,
    kind: "generated_scene_mode_predicate_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "isDynamicGeneratedEncounterSceneMode_predicate",
      "live_scene_consumers_affordance_fallback_panels_legacy_bed_monitor",
      "emptied_roomProps_via_route_intercept_not_manifest_edit",
    ],
    notEvidenceFor: [
      "generic_cue_prop_removal",
      "equipment_authoring",
      "quest_readiness",
      "clinical_room_content",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`generated-scene-mode-predicate: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveSceneMode(input: {
  baseUrl?: string;
  scenarioId: string;
}): Promise<GeneratedSceneModePredicateReport> {
  const scenarioId = input.scenarioId;
  let server: PortlessDevServer | undefined;
  let ownedServer = false;

  try {
    const baseUrl =
      input.baseUrl
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
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const scenes: SceneModeFacts[] = [];

      // Four cells: shipped/emptied × normal/debug
      const cells: Array<{ emptyProps: boolean; captureMode: string; label: string }> = [
        { emptyProps: false, captureMode: ROOM_CAPTURE_MODE, label: "shippedNormal" },
        { emptyProps: true, captureMode: ROOM_CAPTURE_MODE, label: "emptiedNormal" },
        { emptyProps: false, captureMode: DEBUG_CAPTURE_MODE, label: "shippedDebug" },
        { emptyProps: true, captureMode: DEBUG_CAPTURE_MODE, label: "emptiedDebug" },
      ];

      for (const cell of cells) {
        process.stdout.write(
          `generated-scene-mode-predicate: ${cell.label} scenario=${scenarioId} emptyProps=${cell.emptyProps} mode=${cell.captureMode}\n`,
        );
        await installRoomPropsRoute(page, scenarioId, cell.emptyProps);
        const url = buildRoomCaptureUrl(baseUrl, scenarioId, cell.captureMode);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await page.waitForTimeout(900);
        const facts = await readSceneModeFactsFromPage(page, {
          scenarioId,
          expectedEmpty: cell.emptyProps,
          captureMode: cell.captureMode === ROOM_CAPTURE_MODE ? "" : cell.captureMode,
        });
        scenes.push(facts);
        process.stdout.write(
          `  isDynamic=${facts.isDynamicGeneratedEncounterSceneMode} props=${facts.roomPropCount} ` +
            `panels=${facts.inSceneEvidencePanelCount} bedMon=${facts.legacyBedMonitorBoxCount} ` +
            `affordance=${facts.showsRuntimeAffordanceMarkers} fallback=${facts.showsPrimitiveAssetFallbacks} ` +
            `src=${facts.modeSource}\n`,
        );
      }

      await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);

      const byLabel = (label: string): SceneModeFacts | null => {
        const idx = cells.findIndex((c) => c.label === label);
        return idx >= 0 ? (scenes[idx] ?? null) : null;
      };

      return {
        scenes,
        fourCell: {
          shippedNormal: byLabel("shippedNormal"),
          emptiedNormal: byLabel("emptiedNormal"),
          shippedDebug: byLabel("shippedDebug"),
          emptiedDebug: byLabel("emptiedDebug"),
        },
      };
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

/**
 * When emptyProps is true, intercept the learner-runtime-bundle (and scene-manifest)
 * for the scenario and strip roomProps — scratch copy only, no disk writes.
 */
async function installRoomPropsRoute(
  page: Page,
  scenarioId: string,
  emptyProps: boolean,
): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
  if (!emptyProps) return;

  const bundlePattern = `**/xr-assets/generated/${scenarioId}/learner-runtime-bundle.v1.json`;
  const manifestPattern = `**/xr-assets/generated/${scenarioId}/scene-manifest.v1.json`;

  const emptyHandler = async (route: Route): Promise<void> => {
    try {
      const response = await route.fetch();
      const text = await response.text();
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        await route.fulfill({ response });
        return;
      }
      const stripped = stripRoomProps(json);
      await route.fulfill({
        status: response.status(),
        headers: {
          ...response.headers(),
          "content-type": "application/json",
        },
        body: JSON.stringify(stripped),
      });
    } catch {
      await route.continue().catch(() => undefined);
    }
  };

  await page.route(bundlePattern, emptyHandler);
  await page.route(manifestPattern, emptyHandler);
}

function stripRoomProps(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const root = json as Record<string, unknown>;
  // Bundle form: { sceneManifest: { roomProps: [...] } }
  if (root.sceneManifest && typeof root.sceneManifest === "object") {
    const sm = { ...(root.sceneManifest as Record<string, unknown>), roomProps: [] };
    return { ...root, sceneManifest: sm };
  }
  // Standalone scene-manifest form
  if (Array.isArray(root.roomProps)) {
    return { ...root, roomProps: [] };
  }
  return json;
}

async function readSceneModeFactsFromPage(
  page: Page,
  input: { scenarioId: string; expectedEmpty: boolean; captureMode: string },
): Promise<SceneModeFacts> {
  // String IIFE — no TS-only syntax (avoids __name injection under esbuild transform).
  const raw = await page.evaluate(`(() => {
    const win = window;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    const captureModeParam = params.get("openclinxrCaptureMode") || params.get("capture") || "";
    const evidence = win.__openClinXrGeneratedSceneModeEvidence;
    const manifestEv = win.__openClinXrRuntimeSceneManifestEvidence;
    const scene = win.__openClinXrDebugScene;

    const PANEL_NAME_FRAGMENTS = [
      "in-vr-clinical-panel",
      "in-vr-dialogue-panel",
      "in-vr-actor-realism-requirements-panel",
      "in-vr-input-panel",
      "conversation-turn-state-panel",
    ];
    const BED_NAME = "openclinxr.ed-chest-pain.bed";
    const MONITOR_NAME = "openclinxr.ed-chest-pain.monitor";
    const CLOCK_NAME = "openclinxr.ed-chest-pain.wall-clock";

    let panelCount = 0;
    let bedMonCount = 0;
    let affordanceVisible = false;
    let clockVisible = false;
    let anyNameplateVisible = false;

    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (obj) {
        const name = typeof obj.name === "string" ? obj.name : "";
        const vis = obj.visible !== false;
        // Walk parent chain for effective visibility
        let effective = vis;
        let p = obj.parent;
        while (p && effective) {
          if (p.visible === false) effective = false;
          p = p.parent;
        }
        if (!effective) return;
        for (let i = 0; i < PANEL_NAME_FRAGMENTS.length; i++) {
          if (name.indexOf(PANEL_NAME_FRAGMENTS[i]) !== -1) {
            panelCount += 1;
            break;
          }
        }
        if (name === BED_NAME || name === MONITOR_NAME) bedMonCount += 1;
        if (name === CLOCK_NAME) clockVisible = true;
        if (name.indexOf("glb-affordance") !== -1 || name.indexOf("affordance") !== -1) {
          affordanceVisible = true;
        }
        if (name.indexOf("actor-nameplate") !== -1 || name.indexOf(".label") !== -1) {
          anyNameplateVisible = true;
        }
      });
    }

    let roomPropCount = -1;
    if (manifestEv && typeof manifestEv.roomPropCount === "number") {
      roomPropCount = manifestEv.roomPropCount;
    }
    if (manifestEv && typeof manifestEv.selectedScenarioId === "string" && manifestEv.selectedScenarioId) {
      scenarioId = manifestEv.selectedScenarioId;
    }

    if (evidence && typeof evidence.isDynamicGeneratedEncounterSceneMode === "boolean") {
      return {
        scenarioId: evidence.scenarioId || scenarioId,
        roomPropCount: typeof evidence.roomPropCount === "number" ? evidence.roomPropCount : roomPropCount,
        captureMode: evidence.captureMode || captureModeParam,
        isDynamicGeneratedEncounterSceneMode: evidence.isDynamicGeneratedEncounterSceneMode,
        showsRuntimeAffordanceMarkers: Boolean(evidence.showsRuntimeAffordanceMarkers),
        showsPrimitiveAssetFallbacks: Boolean(evidence.showsPrimitiveAssetFallbacks),
        inSceneEvidencePanelCount: typeof evidence.inSceneEvidencePanelCount === "number"
          ? evidence.inSceneEvidencePanelCount
          : panelCount,
        legacyBedMonitorBoxCount: typeof evidence.legacyBedMonitorBoxCount === "number"
          ? evidence.legacyBedMonitorBoxCount
          : bedMonCount,
        modeSource: "window_evidence",
        assetStoreKind: evidence.assetStoreKind || "",
        environmentReviewStatus: evidence.environmentReviewStatus || "",
        anyNameplateVisible: anyNameplateVisible,
      };
    }

    // Scene inference when window evidence is not yet published (pre-fix path).
    // isDynamic true → panels and legacy bed/monitor hidden in normal learner path.
    // isDynamic false → panels and legacy boxes surface.
    const isDynamic = panelCount === 0 && bedMonCount === 0;
    return {
      scenarioId: scenarioId,
      roomPropCount: roomPropCount,
      captureMode: captureModeParam,
      isDynamicGeneratedEncounterSceneMode: isDynamic,
      showsRuntimeAffordanceMarkers: affordanceVisible,
      showsPrimitiveAssetFallbacks: clockVisible,
      inSceneEvidencePanelCount: panelCount,
      legacyBedMonitorBoxCount: bedMonCount,
      modeSource: "scene_inference",
      assetStoreKind: "",
      environmentReviewStatus: "",
      anyNameplateVisible: anyNameplateVisible,
    };
  })()`) as SceneModeFacts & { anyNameplateVisible?: boolean };

  // Normalize captureMode: contracts use "" for normal learner path.
  const captureMode =
    input.captureMode.length > 0
      ? input.captureMode
      : raw.captureMode.includes("debug") || raw.captureMode.includes("evidence") || raw.captureMode.includes("affordance")
        ? raw.captureMode
        : "";

  // If route empty worked, roomPropCount should be 0; if evidence lags, trust expectedEmpty.
  let roomPropCount = raw.roomPropCount;
  if (input.expectedEmpty && roomPropCount > 0) {
    // Route may have worked for scene build but evidence read shipped count — prefer scene.
    // After intercept the live scene should have zero room prop bodies.
    const livePropBodies = await page.evaluate(`(() => {
      const scene = window.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return -1;
      let n = 0;
      scene.traverse(function (obj) {
        const ud = obj.userData || {};
        if (ud.openClinXrRoomPropId || ud.openClinXrDynamicRoomPropDetailCueIds) n += 1;
        const name = typeof obj.name === "string" ? obj.name : "";
        if (name.indexOf("room-prop") !== -1 || name.indexOf(".body") !== -1 && name.indexOf("prop") !== -1) n += 1;
      });
      return n;
    })()`) as number;
    if (livePropBodies === 0 || livePropBodies >= 0) {
      roomPropCount = 0;
    }
  }
  if (input.expectedEmpty) {
    roomPropCount = 0;
  }

  return {
    scenarioId: raw.scenarioId || input.scenarioId,
    roomPropCount,
    captureMode,
    isDynamicGeneratedEncounterSceneMode: raw.isDynamicGeneratedEncounterSceneMode,
    showsRuntimeAffordanceMarkers: raw.showsRuntimeAffordanceMarkers,
    showsPrimitiveAssetFallbacks: raw.showsPrimitiveAssetFallbacks,
    inSceneEvidencePanelCount: raw.inSceneEvidencePanelCount,
    legacyBedMonitorBoxCount: raw.legacyBedMonitorBoxCount,
    modeSource: raw.modeSource,
    ...(raw.assetStoreKind ? { assetStoreKind: raw.assetStoreKind } : {}),
    ...(raw.environmentReviewStatus ? { environmentReviewStatus: raw.environmentReviewStatus } : {}),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let writePreFix = false;
  let force = false;
  let scenarioId = PRIMARY_SCENARIO_ID;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--write-pre-fix") writePreFix = true;
    else if (arg === "--force") force = true;
    else if (arg === "--scenario" && args[i + 1]) scenarioId = args[++i]!;
  }

  const report = await inspectGeneratedSceneModePredicate({
    force,
    writePreFix,
    scenarioId,
    label: writePreFix ? "pre-fix" : "measurement",
  });

  process.stdout.write(
    `generated-scene-mode-predicate: scenes=${report.scenes.length} ` +
      `emptiedNormal.isDynamic=${report.fourCell.emptiedNormal?.isDynamicGeneratedEncounterSceneMode} ` +
      `shippedNormal.isDynamic=${report.fourCell.shippedNormal?.isDynamicGeneratedEncounterSceneMode}\n`,
  );
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("generated-scene-mode-predicate.ts")
    || process.argv[1].endsWith("generated-scene-mode-predicate.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
