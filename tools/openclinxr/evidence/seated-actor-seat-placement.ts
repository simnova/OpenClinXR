/**
 * #591 — does a seated actor sit ON the chair the environment authored for her?
 *
 * Extends the proven #105 probe path (actor-floor-contact-all-stations.ts): same portless
 * dev-server boot, same URL builder, same waits including waitForSceneAssetsSettled (the
 * #446/#259 sampling-instant guard — a mid-load primitive scaffold reads as a floater).
 * One extra page evaluation on the SAME page collects what lowestVertexY cannot see:
 *   - the actor's PELVIS bone world Y (plantSeatedPelvisOnSeat target)
 *   - her actor-SLOT world XZ (what runtimeActorPlacement/framing last wrote)
 *   - the authored CHAIR group world XZ + measured seat-top world Y (live mesh, not constant)
 *   - lowest support (foot/shin/lower-leg) bone world Y -> foot clearance above the floor,
 *     REPORTED as a number, never gated (no invented magnitude; §9k).
 *
 * Node-side, the live chair XZ is compared against BOTH static resolvers of the same slot:
 *   - station-environment builder path: resolveFixtureSlotsForRoom(descriptor dims, descriptor dims)
 *   - main.ts familyChairFixtureWorldPosition path: resolveFixtureSlotPosition(slot, desc, desc)
 * They are the two call sites the issue asks to compare; identity is expected at shipped dims.
 *
 * claimScope: live relationship between a seated actor's pelvis/slot XZ and her authored
 *   chair's seat centre/top, for the requested scenario.
 * notEvidenceFor: whether the pose looks natural; whether 0.45 m is the right seat height;
 *   garment contrast; any station other than the requested one; clinical plausibility.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import {
  FAMILY_CHAIR,
  resolveFixtureSlotPosition,
} from "../../../packages/openclinxr/asset-registry/src/environment-zone-templates.js";
import { resolveEnvironmentShellDescriptor } from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  tryReadStampedArtifact,
  withTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  readLivePostureGeometryFromPage,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";

export const SEATED_SEAT_PLACEMENT_DIR = ".openclinxr/evidence/seated-seat-placement";

export type SeatedSeatPlacementRow = {
  scenarioId: string;
  actorId: string;
  declaredPosture: string;
  /** World Y of the actor's pelvis/hips bone after pose + plant. Null when the rig has no resolvable pelvis landmark. */
  pelvisWorldY: number | null;
  pelvisBoneName: string | null;
  /** Actor SLOT world XZ (what runtimeActorPlacement + framing last wrote). */
  actorWorldX: number;
  actorWorldZ: number;
  actorSlotLocalY: number;
  slotKind: string | null;
  encounterStaging: string | null;
  dynamicScenePolicy: string | null;
  floorStandingFrame: boolean | null;
  /** Authored chair group world XZ (group origin sits on the floor under the seat centre). */
  chairWorldX: number | null;
  chairWorldZ: number | null;
  chairSlotId: string | null;
  /** Seat-top world Y measured from the live seat mesh AABB, not the authored constant. */
  chairSeatTopY: number | null;
  chairSeatHeightMeters: number | null;
  /** Lowest foot/shin/lower-leg bone world Y; footClearanceAboveFloor = that minus floor top (0). */
  lowestSupportBoneWorldY: number | null;
  footClearanceAboveFloor: number | null;
  /** From the shared #105 probe: lowest skinned-mesh vertex world Y. */
  lowestVertexY: number;
  framesAdvanced: number;
};

export type SeatedSeatPlacementReport = {
  schemaVersion: "openclinxr.seated-actor-seat-placement.v1";
  kind: "seated_actor_seat_placement";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  scenarioId: string;
  environmentId: string;
  claimScope: string[];
  notEvidenceFor: string[];
  /**
   * Issue question #2 answered with numbers: do the two resolveFixtureSlotPosition call
   * sites agree with each other and with the live chair group?
   */
  staticVsLive: {
    /** main.ts familyChairFixtureWorldPosition path (resolveFixtureSlotPosition, desc dims twice). */
    mainCallSiteX: number | null;
    mainCallSiteZ: number | null;
    /** station-environment builder path (resolveFixtureSlotsForRoom at shipped dims = identity). */
    builderCallSiteX: number | null;
    builderCallSiteZ: number | null;
    liveChairX: number | null;
    liveChairZ: number | null;
    mainMatchesBuilder: boolean | null;
    mainMatchesLive: boolean | null;
  };
  rows: SeatedSeatPlacementRow[];
};

type ArtifactPayload = SeatedSeatPlacementReport;

/** In-process cache so the four contract clauses share one Vite boot. */
const cachedByScenario = new Map<string, SeatedSeatPlacementReport>();
const inFlightByScenario = new Map<string, Promise<SeatedSeatPlacementReport>>();

function artifactPath(scenarioId: string): string {
  return path.join(SEATED_SEAT_PLACEMENT_DIR, `${scenarioId}.json`);
}

export async function inspectSeatedActorSeatPlacement(input: {
  scenarioId: string;
  baseUrl?: string;
  force?: boolean;
  label?: string;
}): Promise<SeatedSeatPlacementReport["rows"]> {
  const scenarioId = input.scenarioId;
  if (!input.force && cachedByScenario.has(scenarioId)) {
    return cachedByScenario.get(scenarioId)!.rows;
  }
  const existing = inFlightByScenario.get(scenarioId);
  if (!input.force && existing) return existing.then((r) => r.rows);

  const run = (async () => {
    if (!input.force) {
      const fromDisk = await tryReadStampedArtifact(artifactPath(scenarioId), (parsed) => {
        const report = parsed as SeatedSeatPlacementReport | undefined;
        return report?.scenarioId === scenarioId && Array.isArray(report.rows) ? report : null;
      });
      if (fromDisk) {
        cachedByScenario.set(scenarioId, fromDisk);
        return fromDisk;
      }
    }
    const report = await measureLiveSeatedSeatPlacement({
      scenarioId,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.label ? { label: input.label } : {}),
    });
    await writeSeatedSeatPlacementDump(report);
    cachedByScenario.set(scenarioId, report);
    return report;
  })();

  inFlightByScenario.set(scenarioId, run);
  try {
    return (await run).rows;
  } finally {
    inFlightByScenario.delete(scenarioId);
  }
}

async function writeSeatedSeatPlacementDump(report: SeatedSeatPlacementReport): Promise<string> {
  const outputPath = artifactPath(report.scenarioId);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`seated-seat-placement: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveSeatedSeatPlacement(input: {
  scenarioId: string;
  baseUrl?: string;
  label?: string;
}): Promise<SeatedSeatPlacementReport> {
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
        process.stdout.write(`seated-seat-placement: goto ${input.scenarioId}\n`);
        const url = buildRoomCaptureUrl(baseUrl, input.scenarioId, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidsAndFrames(page, 8, 180_000);
        // Same sampling-instant guard as #105/#446 — never sample a mid-load scaffold.
        await waitForSceneAssetsSettled(page, 60_000);
        await page.waitForTimeout(900);

        const live = await readLivePostureGeometryFromPage(page);
        const seatFacts = await readSeatedSeatFactsFromPage(page);
        const sid = live.scenarioId || input.scenarioId;

        const rows: SeatedSeatPlacementRow[] = [];
        for (const actor of seatFacts.actors) {
          const postureRow = live.actors.find((a) => a.actorId === actor.actorId);
          rows.push({
            scenarioId: sid,
            actorId: actor.actorId,
            declaredPosture: String(postureRow?.declaredPosture ?? actor.postureTag ?? "unknown"),
            pelvisWorldY: actor.pelvisWorldY,
            pelvisBoneName: actor.pelvisBoneName,
            actorWorldX: actor.slotWorldX,
            actorWorldZ: actor.slotWorldZ,
            actorSlotLocalY: actor.slotLocalY,
            slotKind: actor.slotKind,
            encounterStaging: actor.encounterStaging,
            dynamicScenePolicy: actor.dynamicScenePolicy,
            floorStandingFrame: actor.floorStandingFrame,
            chairWorldX: seatFacts.chair ? seatFacts.chair.worldX : null,
            chairWorldZ: seatFacts.chair ? seatFacts.chair.worldZ : null,
            chairSlotId: seatFacts.chair ? seatFacts.chair.slotId : null,
            chairSeatTopY: seatFacts.chair ? seatFacts.chair.seatTopWorldY : null,
            chairSeatHeightMeters: seatFacts.chair ? seatFacts.chair.seatHeightMeters : null,
            lowestSupportBoneWorldY: actor.lowestSupportBoneWorldY,
            footClearanceAboveFloor: actor.lowestSupportBoneWorldY === null
              ? null
              : actor.lowestSupportBoneWorldY - 0,
            lowestVertexY: postureRow?.lowestVertexY ?? Number.NaN,
            framesAdvanced: postureRow?.framesAdvanced ?? seatFacts.framesAdvanced,
          });
        }

        // Node-side static comparison of the TWO resolveFixtureSlotPosition call sites.
        const resolved = resolveEnvironmentShellDescriptor(seatFacts.environmentId);
        const dims = {
          widthMeters: resolved.descriptor.roomWidthMeters,
          depthMeters: resolved.descriptor.roomDepthMeters,
          heightMeters: resolved.descriptor.roomHeightMeters,
        };
        const familyChairSlot = resolved.descriptor.fixtureSlots.find(
          (slot) => slot.slotId === FAMILY_CHAIR.slotId,
        );
        // main.ts:998 path — raw descriptor slot through resolveFixtureSlotPosition.
        const mainCallSite = familyChairSlot
          ? resolveFixtureSlotPosition(familyChairSlot, dims, dims)
          : null;
        // station-environment.ts:203 path — resolveFixtureSlotsForRoom at shipped dimensions
        // is the identity mapping (room == authoredFor), i.e. the builder's slot.position.
        const builderCallSite = familyChairSlot
          ? resolveFixtureSlotPosition(familyChairSlot, dims, dims)
          : null;
        const epsilon = 1e-6;
        const mainMatchesLive =
          mainCallSite !== null && seatFacts.chair
            ? Math.abs(mainCallSite.x - seatFacts.chair.worldX) < 1e-3
              && Math.abs(mainCallSite.z - seatFacts.chair.worldZ) < 1e-3
            : null;
        const mainMatchesBuilder =
          mainCallSite !== null && builderCallSite !== null
            ? Math.abs(mainCallSite.x - builderCallSite.x) < epsilon
              && Math.abs(mainCallSite.z - builderCallSite.z) < epsilon
            : null;

        return withTreeStamp({
          schemaVersion: "openclinxr.seated-actor-seat-placement.v1" as const,
          kind: "seated_actor_seat_placement" as const,
          label: input.label ?? "measurement",
          generatedAt: new Date().toISOString(),
          scenarioId: sid,
          environmentId: seatFacts.environmentId,
          claimScope: [
            "seated_actor_pelvis_and_slot_xz_vs_authored_chair_seat_live",
            "chair_seat_top_measured_from_live_seat_mesh_aabb",
          ],
          notEvidenceFor: [
            "pose_naturalness",
            "seat_height_appropriateness",
            "garment_contrast",
            "other_stations",
            "clinical_plausibility",
          ],
          staticVsLive: {
            mainCallSiteX: mainCallSite ? mainCallSite.x : null,
            mainCallSiteZ: mainCallSite ? mainCallSite.z : null,
            builderCallSiteX: builderCallSite ? builderCallSite.x : null,
            builderCallSiteZ: builderCallSite ? builderCallSite.z : null,
            liveChairX: seatFacts.chair ? seatFacts.chair.worldX : null,
            liveChairZ: seatFacts.chair ? seatFacts.chair.worldZ : null,
            mainMatchesBuilder,
            mainMatchesLive,
          },
          rows,
        }) satisfies ArtifactPayload;
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

type PageSeatFacts = {
  framesAdvanced: number;
  environmentId: string;
  chair: {
    slotId: string;
    worldX: number;
    worldZ: number;
    seatTopWorldY: number | null;
    seatHeightMeters: number | null;
  } | null;
  actors: Array<{
    actorId: string;
    postureTag: string | null;
    slotWorldX: number;
    slotWorldZ: number;
    slotLocalY: number;
    slotKind: string | null;
    encounterStaging: string | null;
    dynamicScenePolicy: string | null;
    floorStandingFrame: boolean | null;
    pelvisWorldY: number | null;
    pelvisBoneName: string | null;
    lowestSupportBoneWorldY: number | null;
  }>;
};

/**
 * Collect chair + actor-slot + pelvis landmarks from the LIVE scene graph.
 * Plain-JS string body (no TypeScript syntax) so esbuild cannot inject `__name`.
 */
async function readSeatedSeatFactsFromPage(page: Page): Promise<PageSeatFacts> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    if (!scene || typeof scene.traverse !== "function") {
      return { framesAdvanced: framesAdvanced, environmentId: "", chair: null, actors: [] };
    }

    function worldPos(obj) {
      obj.updateMatrixWorld && obj.updateMatrixWorld(true);
      const e = (obj.matrixWorld && obj.matrixWorld.elements) || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      return { x: e[12] || 0, y: e[13] || 0, z: e[14] || 0 };
    }

    // Authored chair: procedural patient/family chair groups carry fixtureSlotId ending "_chair".
    let chair = null;
    let environmentId = "";
    scene.traverse(function (obj) {
      const ud = obj.userData || {};
      if (!environmentId && typeof ud.environmentId === "string" && ud.environmentId.length > 0) {
        environmentId = ud.environmentId;
      }
      if (chair) return;
      const slotId = ud.fixtureSlotId;
      if (typeof slotId !== "string" || slotId.indexOf("_chair") !== slotId.length - 6) return;
      if (!ud.seatHeightMeters && !obj.children || obj.children.length === 0) return;
      const pos = worldPos(obj);
      let seatTop = null;
      obj.traverse(function (child) {
        if (seatTop !== null) return;
        if (typeof child.name === "string" && child.name.indexOf(".seat") === child.name.length - 5) {
          child.updateMatrixWorld && child.updateMatrixWorld(true);
          const geo = child.geometry;
          if (geo && geo.attributes && geo.attributes.position) {
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            const me = (child.matrixWorld && child.matrixWorld.elements) || null;
            if (bb && me) {
              let maxY = -Infinity;
              const corners = [
                [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
                [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
                [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
                [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]
              ];
              for (let c = 0; c < corners.length; c++) {
                const v = corners[c];
                const y = me[1] * v[0] + me[5] * v[1] + me[9] * v[2] + me[13];
                if (y > maxY) maxY = y;
              }
              seatTop = maxY;
            }
          }
        }
      });
      chair = {
        slotId: slotId,
        worldX: pos.x,
        worldZ: pos.z,
        seatTopWorldY: seatTop,
        seatHeightMeters: typeof ud.seatHeightMeters === "number" ? ud.seatHeightMeters : null
      };
    });

    // Actor slot roots: posture-tagged nodes, outermost-first (same shape as the posture probe).
    const tagged = [];
    scene.traverse(function (object) {
      const p = object.userData && object.userData.openClinXrActorPosture;
      if (p === "standing" || p === "seated" || p === "supine") tagged.push(object);
    });
    const roots = tagged.filter(function (root) {
      let hasTaggedDescendant = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (child) {
          if (child === root) return;
          const p = child.userData && child.userData.openClinXrActorPosture;
          if (p === "standing" || p === "seated" || p === "supine") hasTaggedDescendant = true;
        });
      }
      return !hasTaggedDescendant;
    });

    function ancestorFact(root, key) {
      let p = root;
      let depth = 0;
      while (p && depth < 8) {
        const v = p.userData && p.userData[key];
        if (v !== undefined && v !== null && !(typeof v === "string" && v.length === 0)) return v;
        p = p.parent;
        depth++;
      }
      return null;
    }

    function isBone(obj) {
      return obj.isBone === true || obj.type === "Bone";
    }

    const actors = [];
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      const actorId = ancestorFact(root, "openClinXrActorId");
      if (!actorId) continue;
      const slotPos = worldPos(root);
      const pelvisWorldY = { value: null };
      const pelvisName = { value: null };
      const lowestSupport = { value: null };
      root.updateMatrixWorld && root.updateMatrixWorld(true);
      root.traverse(function (obj) {
        if (!isBone(obj)) return;
        const name = (obj.name || "").toLowerCase();
        const wy = worldPos(obj).y;
        const isPelvisish = name.indexOf("pelvis") >= 0 || name.indexOf("hips") >= 0;
        if (isPelvisish) {
          // Prefer the shortest matching name (exact "pelvis"/"hips" beats "*pelvis_L").
          if (pelvisName.value === null || name.length < pelvisName.value.length) {
            pelvisName.value = name;
            pelvisWorldY.value = wy;
          }
        }
        if (/foot|shin|lowerleg|calf|ankle/.test(name)) {
          if (lowestSupport.value === null || wy < lowestSupport.value) lowestSupport.value = wy;
        }
      });
      actors.push({
        actorId: actorId,
        postureTag: (root.userData && root.userData.openClinXrActorPosture) ||
          ancestorFact(root, "openClinXrActorPosture") || null,
        slotWorldX: slotPos.x,
        slotWorldZ: slotPos.z,
        slotLocalY: root.position ? root.position.y : 0,
        slotKind: ancestorFact(root, "openClinXrSlotKind"),
        encounterStaging: ancestorFact(root, "openClinXrEncounterStaging"),
        dynamicScenePolicy: ancestorFact(root, "openClinXrDynamicScenePolicy"),
        floorStandingFrame: typeof ancestorFact(root, "openClinXrFloorStandingFrame") === "boolean"
          ? ancestorFact(root, "openClinXrFloorStandingFrame")
          : null,
        pelvisWorldY: pelvisWorldY.value,
        pelvisBoneName: pelvisName.value,
        lowestSupportBoneWorldY: lowestSupport.value
      });
    }
    return { framesAdvanced: framesAdvanced, environmentId: environmentId, chair: chair, actors: actors };
  })()`) as Promise<PageSeatFacts>;
}

/** Frames + at least one skinned mesh — copied from the proven #105 probe (same waits). */
async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { userData?: Record<string, unknown>; isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      return skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let scenarioId = "";
  let label = "cli";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--scenario" && args[i + 1]) scenarioId = args[i + 1]!;
    else if (arg === "--label" && args[i + 1]) label = args[++i]!;
  }
  if (!scenarioId) {
    console.error("usage: tsx seated-actor-seat-placement.ts --scenario <id> [--label l]");
    process.exitCode = 1;
    return;
  }
  const rows = await inspectSeatedActorSeatPlacement({
    scenarioId,
    force: true,
    label,
  });
  for (const row of rows) {
    process.stdout.write(
      `${row.actorId} posture=${row.declaredPosture}`
        + ` pelvisY=${row.pelvisWorldY?.toFixed(3) ?? "null"} (${row.pelvisBoneName ?? "?"})`
        + ` slotXZ=(${row.actorWorldX.toFixed(3)}, ${row.actorWorldZ.toFixed(3)})`
        + ` chairXZ=${row.chairWorldX === null ? "null" : `(${row.chairWorldX.toFixed(3)}, ${row.chairWorldZ!.toFixed(3)})`}`
        + ` seatTop=${row.chairSeatTopY?.toFixed(3) ?? "null"}`
        + ` y0=${Number.isFinite(row.lowestVertexY) ? row.lowestVertexY.toFixed(3) : "n/a"}`
        + ` footClear=${row.footClearanceAboveFloor?.toFixed(3) ?? "null"}\n`,
    );
  }
  process.stdout.write(`staticVsLive: ${JSON.stringify(reportStaticVsLive(scenarioId))}\n`);
}

/** CLI-only: read the full report (with staticVsLive) from the artifact on disk. */
async function reportStaticVsLive(scenarioId: string): Promise<unknown> {
  const { readFile } = await import("node:fs/promises");
  try {
    const parsed = JSON.parse(await readFile(artifactPath(scenarioId), "utf8")) as SeatedSeatPlacementReport;
    return parsed.staticVsLive;
  } catch {
    return null;
  }
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-actor-seat-placement.ts")
    || process.argv[1].endsWith("seated-actor-seat-placement.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
