/**
 * #122 — live humanoid slot-to-actor assignment inspector.
 *
 * Staged ids are read from the LIVE scene's `userData.openClinXrActorId` on slot
 * roots (`openClinXrSlotKind` present) — not from resolver functions in isolation.
 * Declared humanoids come from the scenario bank cast. Residual not-staged actors
 * are read from `browserPageWindow.__openClinXrActorSlotAssignment` when the runtime publishes it.
 *
 * claimScope: which person each humanoid slot stages (or does not).
 * notEvidenceFor: wardrobe, posture, placement, clinical realism, Quest readiness.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

export const ACTOR_SLOT_ASSIGNMENT_DIR = ".openclinxr/evidence/actor-slot-assignment";
export const PRE_FIX_NAME = "pre-fix.json";

export type StationStaging = {
  scenarioId: string;
  declaredHumanoidActorIds: string[];
  stagedActorIds: string[];
  notStagedActorIds: { actorId: string; reason: string }[];
};

export type ActorSlotAssignmentReport = {
  stations: StationStaging[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.actor-slot-assignment.v1";
  kind: "actor_slot_assignment_live";
  label: string;
  generatedAt: string;
  /** #141 — refuse cache when HEAD or tracked worktree dirtiness moves. */
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  report: ActorSlotAssignmentReport;
};

let cachedReport: ActorSlotAssignmentReport | null = null;
let measureInFlight: Promise<ActorSlotAssignmentReport> | null = null;

function preFixPath(): string {
  return path.join(ACTOR_SLOT_ASSIGNMENT_DIR, PRE_FIX_NAME);
}

function declaredHumanoidActorIds(scenarioId: string): string[] {
  const cast = resolveScenarioActorCast(scenarioId);
  if (cast.length > 0) return cast.map((c) => c.actorId);
  const scenario = scenarioBank.find((s) => s.scenarioId === scenarioId);
  if (!scenario) return [];
  return scenario.actors
    .filter((a) => {
      const role = a.role.toLowerCase();
      if (role === "system") return false;
      if (/_phone_|_tablet_|telehealth_system/iu.test(a.actorId)) return false;
      return true;
    })
    .map((a) => a.actorId);
}

/**
 * Signature consumed by actor-slot-assignment.test.ts planted contracts.
 * Measures once across the full shipped cast bank (shared across vitest cases).
 */
export async function inspectActorSlotAssignment(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
}): Promise<ActorSlotAssignmentReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      // Prefer live measure for contracts; disk is for pre-fix proof only unless forced.
      if (process.env.OPENCLINXR_ACTOR_SLOT_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveSlotAssignment({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writePreFix) {
      await writeSlotAssignmentDump(report, {
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

async function tryReadArtifact(filePath: string): Promise<ActorSlotAssignmentReport | null> {
  // #141: refuse stale stamps (missing/mismatch → null). Fresh stamps still serve.
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as ActorSlotAssignmentReport | undefined;
    if (
      report?.stations
      && Array.isArray(report.stations)
      && report.stations.length > 0
    ) {
      return report;
    }
    return null;
  });
}

export async function writeSlotAssignmentDump(
  report: ActorSlotAssignmentReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.actor-slot-assignment.v1" as const,
    kind: "actor_slot_assignment_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "live_scene_userData_openClinXrActorId_on_slot_roots",
      "declared_humanoids_from_scenario_cast_bank",
      "not_staged_residual_when_published_by_runtime",
    ],
    notEvidenceFor: [
      "wardrobe",
      "posture_quality",
      "placement_geometry",
      "clinical_realism",
      "quest_readiness",
    ],
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`actor-slot-assignment: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveSlotAssignment(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<ActorSlotAssignmentReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("inspectActorSlotAssignment: listShippedCastScenarioIds returned empty");
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
        const stations: StationStaging[] = [];
        for (const scenarioId of scenarios) {
          process.stdout.write(`actor-slot-assignment: goto ${scenarioId}\n`);
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForSlotRoots(page, 180_000);
          await page.waitForTimeout(700);
          const live = await readLiveSlotAssignmentFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const declared = declaredHumanoidActorIds(sid);
          const row: StationStaging = {
            scenarioId: sid,
            declaredHumanoidActorIds: declared,
            stagedActorIds: live.stagedActorIds,
            notStagedActorIds: live.notStagedActorIds,
          };
          stations.push(row);
          process.stdout.write(
            `  ${sid} declared=[${declared.join(",")}] staged=[${live.stagedActorIds.join(",")}] `
            + `notStaged=${JSON.stringify(live.notStagedActorIds)}\n`,
          );
        }
        return { stations };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

async function waitForSlotRoots(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = browserPageWindow as unknown as {
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
 * Prefers slot roots carrying openClinXrSlotKind; falls back to unique actor ids on scene.
 */
export async function readLiveSlotAssignmentFromPage(page: Page): Promise<{
  scenarioId: string;
  stagedActorIds: string[];
  notStagedActorIds: { actorId: string; reason: string }[];
}> {
  return page.evaluate(`(() => {
    const win = browserPageWindow;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(browserPageWindow.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }

    const SLOT_ORDER = ["primary_patient", "clinical_team", "family_or_observer", "additional_cast"];
    const byKind = {};
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        const kind = object.userData && object.userData.openClinXrSlotKind;
        if (typeof kind !== "string" || kind.length === 0) return;
        // Prefer the outermost slot root (no ancestor also tagged with slotKind).
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
        // Keep first sighting per kind; empty id is meaningful (unfilled slot).
        if (!(kind in byKind)) byKind[kind] = id;
      });
    }

    const stagedActorIds = [];
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const kind = SLOT_ORDER[i];
      if (kind in byKind) stagedActorIds.push(byKind[kind]);
    }
    // Include any unexpected slot kinds after the canonical order.
    for (const kind of Object.keys(byKind)) {
      if (SLOT_ORDER.indexOf(kind) < 0) stagedActorIds.push(byKind[kind]);
    }

    let notStagedActorIds = [];
    const published = win.__openClinXrActorSlotAssignment;
    if (published && Array.isArray(published.notStagedActorIds)) {
      notStagedActorIds = published.notStagedActorIds.map(function (n) {
        return {
          actorId: typeof n.actorId === "string" ? n.actorId : "",
          reason: typeof n.reason === "string" ? n.reason : "",
        };
      }).filter(function (n) { return n.actorId.length > 0; });
    } else if (scene && scene.userData && Array.isArray(scene.userData.openClinXrNotStagedActorIds)) {
      notStagedActorIds = scene.userData.openClinXrNotStagedActorIds.map(function (n) {
        return {
          actorId: n && typeof n.actorId === "string" ? n.actorId : "",
          reason: n && typeof n.reason === "string" ? n.reason : "",
        };
      }).filter(function (n) { return n.actorId.length > 0; });
    }

    return { scenarioId: scenarioId, stagedActorIds: stagedActorIds, notStagedActorIds: notStagedActorIds };
  })()`) as Promise<{
    scenarioId: string;
    stagedActorIds: string[];
    notStagedActorIds: { actorId: string; reason: string }[];
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
  inspectActorSlotAssignment({ writePreFix, force, label: writePreFix ? "pre-fix" : "cli" })
    .then((report) => {
      process.stdout.write(`stations=${report.stations.length}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
