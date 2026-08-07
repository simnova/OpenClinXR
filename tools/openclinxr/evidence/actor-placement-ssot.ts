/**
 * #123 — live actor placement SSOT inspector.
 *
 * Staged actors + world XZ from the LIVE scene (`openClinXrSlotKind` roots).
 * Declared placements from the shipped bundle the runtime loads (static JSON path,
 * or `window.__openClinXrActorPlacementSsot` when the runtime publishes it).
 *
 * claimScope: every staged humanoid has a placement record; no coincident XZ.
 * notEvidenceFor: layout quality, in-frame at roomCam, clinical staging, Quest readiness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { listShippedCastScenarioIds } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const ACTOR_PLACEMENT_SSOT_DIR = ".openclinxr/evidence/actor-placement-ssot";
export const PRE_FIX_NAME = "pre-fix.json";

export type StagedPlacement = {
  scenarioId: string;
  actorId: string;
  slotKind: string;
  /** True when sceneManifest.actorPlacements has an entry keyed by this actorId. */
  hasDeclaredPlacement: boolean;
  /** World position the actor actually occupies in the live scene. */
  worldX: number;
  worldZ: number;
};

export type ActorPlacementSsotReport = {
  stations: string[];
  staged: StagedPlacement[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.actor-placement-ssot.v1";
  kind: "actor_placement_ssot_live";
  label: string;
  generatedAt: string;
  measuredTree?: string;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ActorPlacementSsotReport;
};

let cachedReport: ActorPlacementSsotReport | null = null;
let measureInFlight: Promise<ActorPlacementSsotReport> | null = null;

function preFixPath(): string {
  return path.join(ACTOR_PLACEMENT_SSOT_DIR, PRE_FIX_NAME);
}

/**
 * Signature consumed by actor-placement-ssot.test.ts planted contracts.
 * Measures once across the full shipped cast bank (shared across vitest cases).
 */
export async function inspectActorPlacementSsot(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
}): Promise<ActorPlacementSsotReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_ACTOR_PLACEMENT_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLivePlacementSsot({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writePlacementSsotDump(report, {
        outputPath: preFixPath(),
        label: input?.label ?? "pre-fix",
      });
    }

    if (!input?.scenarioIds) {
      cachedReport = report;
    }
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

async function tryReadArtifact(filePath: string): Promise<ActorPlacementSsotReport | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ArtifactPayload;
    if (
      parsed?.report?.stations
      && Array.isArray(parsed.report.stations)
      && parsed.report.stations.length > 0
      && Array.isArray(parsed.report.staged)
    ) {
      return parsed.report;
    }
  } catch {
    // missing or corrupt
  }
  return null;
}

export async function writePlacementSsotDump(
  report: ActorPlacementSsotReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  let measuredTree: string | undefined;
  try {
    const { execSync } = await import("node:child_process");
    measuredTree = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    measuredTree = undefined;
  }
  const payload: ArtifactPayload = {
    schemaVersion: "openclinxr.actor-placement-ssot.v1",
    kind: "actor_placement_ssot_live",
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    ...(measuredTree ? { measuredTree } : {}),
    claimScope: [
      "live_scene_slot_root_world_xz",
      "declared_placement_from_loaded_runtime_bundle_actorPlacements",
    ],
    notEvidenceFor: [
      "layout_quality",
      "roomCam_in_frame",
      "clinical_staging_aesthetics",
      "quest_readiness",
    ],
    report,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`actor-placement-ssot: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLivePlacementSsot(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorPlacementSsotReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("inspectActorPlacementSsot: listShippedCastScenarioIds returned empty");
  }

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
      try {
        const stations: string[] = [];
        const staged: StagedPlacement[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`actor-placement-ssot: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForSlotRoots(page, 180_000);
          await page.waitForTimeout(700);
          const live = await readLivePlacementFromPage(page);
          const sid = live.scenarioId || scenarioId;
          stations.push(sid);
          for (const row of live.staged) {
            staged.push({ ...row, scenarioId: sid });
          }
          const orphans = live.staged.filter((s) => !s.hasDeclaredPlacement).map((s) => s.actorId);
          process.stdout.write(
            `  ${sid} staged=${live.staged.length} orphans=[${orphans.join(",")}] `
            + `xz=[${live.staged.map((s) => `${s.actorId}@${s.worldX.toFixed(2)},${s.worldZ.toFixed(2)}`).join("; ")}]\n`,
          );
        }
        return { stations, staged };
      } finally {
        await page.close().catch(() => undefined);
      }
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

async function waitForSlotRoots(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { userData?: Record<string, unknown> }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < 4) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let slots = 0;
      scene.traverse((object) => {
        const kind = object.userData?.openClinXrSlotKind;
        if (typeof kind === "string" && kind.length > 0) slots += 1;
      });
      return slots >= 1;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Slot roots: openClinXrSlotKind, no ancestor also tagged. World XZ from getWorldPosition.
 * Declared keys: runtime publish first, else fetch shipped learner-runtime-bundle JSON.
 */
export async function readLivePlacementFromPage(page: Page): Promise<{
  scenarioId: string;
  staged: Omit<StagedPlacement, "scenarioId">[];
}> {
  return page.evaluate(`(async () => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }

    // Declared placement keys from the bundle the runtime actually holds, or shipped JSON.
    let declaredKeys = [];
    const published = win.__openClinXrActorPlacementSsot;
    if (published && Array.isArray(published.declaredActorIds)) {
      declaredKeys = published.declaredActorIds.slice();
    } else if (published && published.actorPlacements && typeof published.actorPlacements === "object") {
      declaredKeys = Object.keys(published.actorPlacements);
    } else if (scenarioId) {
      try {
        const res = await fetch("/xr-assets/generated/" + scenarioId + "/learner-runtime-bundle.v1.json");
        if (res.ok) {
          const bundle = await res.json();
          const ap = bundle && bundle.sceneManifest && bundle.sceneManifest.actorPlacements;
          if (ap && typeof ap === "object") declaredKeys = Object.keys(ap);
        }
      } catch (e) {
        // leave empty — orphans will be reported
      }
    }
    const declaredSet = {};
    for (let i = 0; i < declaredKeys.length; i++) declaredSet[declaredKeys[i]] = true;

    const byKind = {};
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        const kind = object.userData && object.userData.openClinXrSlotKind;
        if (typeof kind !== "string" || kind.length === 0) return;
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 8) {
          if (p.userData && typeof p.userData.openClinXrSlotKind === "string" && p.userData.openClinXrSlotKind.length > 0) {
            ancestorHas = true;
            break;
          }
          p = p.parent;
          depth += 1;
        }
        if (ancestorHas) return;
        const id = object.userData && typeof object.userData.openClinXrActorId === "string"
          ? object.userData.openClinXrActorId
          : "";
        if (!id) return; // unfilled slots are not staged people
        if (!(kind in byKind)) {
          // Slot roots are scene children; local position == world XZ. Avoid getWorldPosition —
          // three.js requires a Vector3 target and page.evaluate must not invent one.
          let worldX = 0;
          let worldZ = 0;
          if (object.matrixWorld && object.matrixWorld.elements) {
            const e = object.matrixWorld.elements;
            worldX = e[12];
            worldZ = e[14];
          } else if (object.position) {
            worldX = object.position.x;
            worldZ = object.position.z;
          }
          byKind[kind] = { actorId: id, slotKind: kind, worldX: worldX, worldZ: worldZ };
        }
      });
    }

    const SLOT_ORDER = ["primary_patient", "clinical_team", "family_or_observer", "additional_cast"];
    const staged = [];
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const kind = SLOT_ORDER[i];
      if (kind in byKind) {
        const row = byKind[kind];
        staged.push({
          actorId: row.actorId,
          slotKind: row.slotKind,
          hasDeclaredPlacement: Boolean(declaredSet[row.actorId]),
          worldX: row.worldX,
          worldZ: row.worldZ,
        });
      }
    }
    for (const kind of Object.keys(byKind)) {
      if (SLOT_ORDER.indexOf(kind) < 0) {
        const row = byKind[kind];
        staged.push({
          actorId: row.actorId,
          slotKind: row.slotKind,
          hasDeclaredPlacement: Boolean(declaredSet[row.actorId]),
          worldX: row.worldX,
          worldZ: row.worldZ,
        });
      }
    }

    return { scenarioId: scenarioId, staged: staged };
  })()`) as Promise<{
    scenarioId: string;
    staged: Omit<StagedPlacement, "scenarioId">[];
  }>;
}

// CLI: write pre-fix or remeasure
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const force = process.argv.includes("--force");
  inspectActorPlacementSsot({ writePreFix, force, label: writePreFix ? "pre-fix" : "cli" })
    .then((report) => {
      process.stdout.write(`stations=${report.stations.length} staged=${report.staged.length}\n`);
      const orphans = report.staged.filter((s) => !s.hasDeclaredPlacement);
      process.stdout.write(`orphans=${orphans.length}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
