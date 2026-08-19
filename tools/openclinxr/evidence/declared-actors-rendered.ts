/**
 * #211 — declared actors must reach the live scene a learner sees.
 *
 * ## FIXED (#211) — instrument finding, not a product hole
 *
 * Pre-fix live dump (all 14 shipped stations) measured **0 missing declared
 * humanoids**. For `psych_suicidal_ideation_safety_v1` specifically:
 *   patient_jordan_reed_v1     rendered+visible  skinnedTris=32207  inside room
 *   partner_sam_reed_v1        rendered+visible  skinnedTris=38827  inside room
 *   behavioral_health_nurse_owens_v1  same band (~34k)
 * Bundle matches selected scenario (`mismatch=false`). Lit
 * `psych-station-after.png` shows all three figures. #209's multi-station panel
 * that graded empty was therefore a **capture / sheet framing artifact**, not
 * "never staged" / load-dummy / out-of-frustum. Stopped at measurement per brief
 * instrument-artifact close — no product edit, no `main.ts` touch.
 *
 * Enumerates stations/actors dynamically from the scenario bank + cast SSOT.
 * Reads LIVE roots carrying `userData.openClinXrActorId` (slot roots preferred),
 * with visible, worldPosition, and skinned triangle count under each root.
 *
 * "Rendered" (unlocked decision, recorded in report.renderedDefinition):
 *   A slot/root tagged with openClinXrActorId whose effective visible chain is
 *   true. Rejected: world-AABB-inside-room alone (placement without presence);
 *   skinned-mesh-under-root alone without actor id (orphan meshes / env humanoids).
 *
 * claimScope: declared humanoid cast vs live scene presence + non-dummy skin.
 * notEvidenceFor: wardrobe quality, posture, clinical realism, Quest readiness.
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

export const ISSUE_211_EVIDENCE_DIR = ".openclinxr/evidence/issue-211";
export const PRE_FIX_NAME = "pre-fix.json";
export const PSYCH_STATION_AFTER_PNG = "psych-station-after.png";

/** #187 load-failure dummy band sits near 1266; real cast humanoids ship 18k+. */
export const MIN_REAL_HUMANOID_SKINNED_TRIANGLES = 3000;

export type ActorRow = {
  scenarioId: string;
  actorId: string;
  declared: boolean;
  renderedInScene: boolean;
  visible: boolean;
  skinnedTriangleCount: number;
  worldPosition: { x: number; y: number; z: number } | null;
  /** Diagnostic: slot kind on the root if present. */
  slotKind?: string | null;
  /** Diagnostic: child mesh names under the actor root (capped). */
  childMeshNames?: string[];
};

export type StationActors = {
  scenarioId: string;
  actors: ActorRow[];
  /** Live slot roots observed (including empty/unfilled). */
  liveActorRootCount: number;
  bundleScenarioId?: string;
  bundleMismatch?: boolean;
};

export type DeclaredActorsRenderedReport = {
  stations: StationActors[];
  renderedDefinition: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.declared-actors-rendered.v1";
  kind: "declared_actors_rendered_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  renderedDefinition: string;
  report: DeclaredActorsRenderedReport;
};

const RENDERED_DEFINITION =
  "openClinXrActorId root (prefer openClinXrSlotKind slot root) with effective "
  + "visible=true; skinnedTriangleCount is sum of SkinnedMesh triangle counts under "
  + "that root. Rejected: AABB-in-room alone; skinned mesh without actor id.";

let cachedReport: DeclaredActorsRenderedReport | null = null;
let measureInFlight: Promise<DeclaredActorsRenderedReport> | null = null;

function preFixPath(): string {
  return path.join(ISSUE_211_EVIDENCE_DIR, PRE_FIX_NAME);
}

/**
 * Declared humanoid actor ids for a station — cast SSOT first, then bank roles.
 * Never hardcodes scenario lists.
 */
export function declaredHumanoidActorIds(scenarioId: string): string[] {
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
 * Signature consumed by declared-actors-rendered.test.ts.
 * Measures once across the full shipped cast bank (shared across vitest cases).
 */
export async function inspectDeclaredActorsRendered(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, write/overwrite pre-fix.json (must be done BEFORE product edits). */
  writePreFix?: boolean;
  /** Capture a lit PNG of psych_suicidal_ideation_safety_v1 after measure. */
  capturePsychPng?: boolean;
  psychPngPath?: string;
}): Promise<DeclaredActorsRenderedReport> {
  if (!input?.force && !input?.writePreFix && cachedReport) return cachedReport;
  if (!input?.force && !input?.writePreFix && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writePreFix && !input?.scenarioIds) {
      if (process.env.OPENCLINXR_DECLARED_ACTORS_USE_DISK === "1") {
        const fromDisk = await tryReadArtifact(preFixPath());
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveDeclaredActors({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
      capturePsychPng: input?.capturePsychPng,
      psychPngPath: input?.psychPngPath,
    });

    if (input?.writePreFix) {
      await writeDeclaredActorsDump(report, {
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

async function tryReadArtifact(filePath: string): Promise<DeclaredActorsRenderedReport | null> {
  return tryReadStampedArtifact(filePath, (parsed) => {
    const report = parsed.report as DeclaredActorsRenderedReport | undefined;
    if (report?.stations && Array.isArray(report.stations) && report.stations.length > 0) {
      return report;
    }
    return null;
  });
}

export async function writeDeclaredActorsDump(
  report: DeclaredActorsRenderedReport,
  input?: { outputPath?: string; label?: string },
): Promise<string> {
  const outputPath = input?.outputPath ?? preFixPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.declared-actors-rendered.v1" as const,
    kind: "declared_actors_rendered_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: report.claimScope,
    notEvidenceFor: report.notEvidenceFor,
    renderedDefinition: report.renderedDefinition,
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`declared-actors-rendered: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveDeclaredActors(input: {
  baseUrl?: string;
  scenarioIds?: string[];
  capturePsychPng?: boolean;
  psychPngPath?: string;
}): Promise<DeclaredActorsRenderedReport> {
  const scenarios =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : listShippedCastScenarioIds();

  if (scenarios.length === 0) {
    throw new Error("inspectDeclaredActorsRendered: listShippedCastScenarioIds returned empty");
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
        const stations: StationActors[] = [];
        for (const scenarioId of scenarios) {
          const declared = declaredHumanoidActorIds(scenarioId);
          process.stdout.write(
            `declared-actors-rendered: goto ${scenarioId} declared=[${declared.join(",")}]\n`,
          );
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          // Soft wait: frames advance even when zero humanoids (#211 empty-room class).
          await waitForFramesOrHumanoids(page, 8, 120_000);
          // #259: sampling-instant race. waitForFramesOrHumanoids returns as soon as ONE
          // skinned mesh exists anywhere in the scene; sibling GLBs (7–8 MB) may still be
          // loading, so their actor roots report skinnedTriangleCount=0 at the probe's
          // sample instant. Measured (issue-259 two-column): the same actor reports 0 tris
          // one run and 34–39k the next, and every asset reaches loaded|failed shortly
          // after. Wait for the settle signal before sampling; a failed asset counts as
          // settled, so a genuinely-broken load is still reported, not masked.
          await waitForSceneAssetsSettled(page, 60_000);
          await page.waitForTimeout(500);

          const live = await readLiveActorPresenceFromPage(page);
          const sid = live.scenarioId || scenarioId;
          const byId = new Map(live.roots.map((r) => [r.actorId, r]));

          const actors: ActorRow[] = declared.map((actorId) => {
            const root = byId.get(actorId);
            if (!root) {
              return {
                scenarioId: sid,
                actorId,
                declared: true,
                renderedInScene: false,
                visible: false,
                skinnedTriangleCount: 0,
                worldPosition: null,
                slotKind: null,
                childMeshNames: [],
              };
            }
            return {
              scenarioId: sid,
              actorId,
              declared: true,
              renderedInScene: true,
              visible: root.visible,
              skinnedTriangleCount: root.skinnedTriangleCount,
              worldPosition: root.worldPosition,
              slotKind: root.slotKind,
              childMeshNames: root.childMeshNames,
            };
          });

          // Live roots not in declared set (diagnostic only — not asserted).
          for (const root of live.roots) {
            if (declared.includes(root.actorId)) continue;
            actors.push({
              scenarioId: sid,
              actorId: root.actorId,
              declared: false,
              renderedInScene: true,
              visible: root.visible,
              skinnedTriangleCount: root.skinnedTriangleCount,
              worldPosition: root.worldPosition,
              slotKind: root.slotKind,
              childMeshNames: root.childMeshNames,
            });
          }

          stations.push({
            scenarioId: sid,
            actors,
            liveActorRootCount: live.roots.length,
            bundleScenarioId: live.bundleScenarioId,
            bundleMismatch: live.bundleMismatch,
          });

          for (const a of actors.filter((x) => x.declared)) {
            process.stdout.write(
              `  ${a.actorId}: rendered=${a.renderedInScene} visible=${a.visible} `
              + `skinnedTris=${a.skinnedTriangleCount} pos=${JSON.stringify(a.worldPosition)}\n`,
            );
          }
          process.stdout.write(
            `  liveRoots=${live.roots.length} bundle=${live.bundleScenarioId} mismatch=${live.bundleMismatch}\n`,
          );

          if (
            input.capturePsychPng
            && scenarioId === "psych_suicidal_ideation_safety_v1"
          ) {
            const pngPath =
              input.psychPngPath
              ?? path.join(ISSUE_211_EVIDENCE_DIR, PSYCH_STATION_AFTER_PNG);
            await mkdir(path.dirname(pngPath), { recursive: true });
            await page.screenshot({ path: pngPath, type: "png" });
            process.stdout.write(`declared-actors-rendered: wrote ${pngPath}\n`);
          }
        }

        return {
          stations,
          renderedDefinition: RENDERED_DEFINITION,
          claimScope: [
            "declared_humanoid_cast_from_scenario_bank_and_cast_ssot",
            "live_scene_userData_openClinXrActorId_presence",
            "skinned_triangle_count_vs_load_failure_dummy",
          ],
          notEvidenceFor: [
            "wardrobe_quality",
            "posture_quality",
            "placement_clinical_layout",
            "clinical_realism",
            "quest_readiness",
            "exam_equivalence",
          ],
        };
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

/**
 * #259: wait until every recorded scene asset reaches `loaded` or `failed`
 * (pendingCount === 0) — the "after all assets report loaded-or-failed" settle
 * condition from the two-column measurement. Bounded; on timeout we sample
 * anyway so a stuck/pending asset still surfaces as a 0-triangle actor instead
 * of hanging the suite. A `failed` asset is settled, so a genuinely-broken load
 * is reported rather than masked.
 */
export async function waitForSceneAssetsSettled(page: Page, timeoutMs: number): Promise<void> {
  const started = Date.now();
  try {
    await page.waitForFunction(
      () => {
        const win = window as unknown as {
          __openClinXrSceneAssetEvidence?: {
            pendingCount?: number;
            assets?: unknown[];
          };
        };
        const ev = win.__openClinXrSceneAssetEvidence;
        if (!ev || !Array.isArray(ev.assets) || ev.assets.length === 0) return false;
        return (ev.pendingCount ?? 0) === 0;
      },
      {},
      { timeout: Math.min(timeoutMs, 60_000) },
    );
  } catch {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining > 0) {
      await page.waitForTimeout(Math.min(remaining, 30_000));
    }
  }
}

/**
 * Prefer frames + skinned mesh; fall back to frames alone so an empty cast is measurable.
 */
async function waitForFramesOrHumanoids(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  try {
    await page.waitForFunction(
      ({ minFrames: need }) => {
        const win = window as unknown as {
          __openClinXrFrameStats?: { framesObserved?: number };
          __openClinXrDebugScene?: {
            traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
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
      { timeout: Math.min(timeoutMs, 90_000) },
    );
  } catch {
    // No skinned mesh — still require frames so shell/HUD settled.
    const remaining = Math.max(5_000, timeoutMs - (Date.now() - started));
    await page.waitForFunction(
      ({ minFrames: need }) => {
        const win = window as unknown as {
          __openClinXrFrameStats?: { framesObserved?: number };
        };
        return (win.__openClinXrFrameStats?.framesObserved ?? 0) >= need;
      },
      { minFrames },
      { timeout: remaining },
    );
  }
}

type LiveRoot = {
  actorId: string;
  visible: boolean;
  worldPosition: { x: number; y: number; z: number };
  skinnedTriangleCount: number;
  slotKind: string | null;
  childMeshNames: string[];
};

/**
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 * Prefers outermost slot roots; falls back to unique openClinXrActorId nodes.
 */
export async function readLiveActorPresenceFromPage(page: Page): Promise<{
  scenarioId: string;
  bundleScenarioId: string;
  bundleMismatch: boolean;
  roots: LiveRoot[];
}> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    if (scene && scene.userData && scene.userData.openClinXrStationEnvironment &&
        typeof scene.userData.openClinXrStationEnvironment.scenarioId === "string") {
      scenarioId = scene.userData.openClinXrStationEnvironment.scenarioId || scenarioId;
    }

    const match = win.__openClinXrRuntimeBundleScenarioMatch;
    const bundleScenarioId = (match && typeof match.bundleScenarioId === "string")
      ? match.bundleScenarioId
      : (win.__openClinXrActorSlotAssignment && typeof win.__openClinXrActorSlotAssignment.scenarioId === "string"
        ? win.__openClinXrActorSlotAssignment.scenarioId
        : "");
    const bundleMismatch = match ? match.matches === false : false;

    function effectiveVisible(obj) {
      let o = obj;
      let depth = 0;
      while (o && depth < 24) {
        if (o.visible === false) return false;
        o = o.parent;
        depth += 1;
      }
      return true;
    }

    function worldPos(obj) {
      if (obj.updateWorldMatrix) obj.updateWorldMatrix(true, false);
      // Read matrixWorld translation only — do not call getWorldPosition with a plain object
      // (three.js requires setFromMatrixPosition on the target).
      if (obj.matrixWorld && obj.matrixWorld.elements) {
        const e = obj.matrixWorld.elements;
        return { x: e[12], y: e[13], z: e[14] };
      }
      return {
        x: obj.position ? obj.position.x : 0,
        y: obj.position ? obj.position.y : 0,
        z: obj.position ? obj.position.z : 0,
      };
    }

    function skinnedTrisUnder(root) {
      let tris = 0;
      if (!root || typeof root.traverse !== "function") return 0;
      root.traverse(function (o) {
        const isSkinned = o.isSkinnedMesh === true
          || (o.type === "SkinnedMesh")
          || (o.isMesh && o.skeleton);
        if (!isSkinned) return;
        const geo = o.geometry;
        if (!geo) return;
        const index = geo.index;
        if (index && typeof index.count === "number") {
          tris += Math.floor(index.count / 3);
          return;
        }
        const pos = geo.attributes && geo.attributes.position;
        if (pos && typeof pos.count === "number") {
          tris += Math.floor(pos.count / 3);
        }
      });
      return tris;
    }

    function childMeshNames(root) {
      const names = [];
      if (!root || typeof root.traverse !== "function") return names;
      root.traverse(function (o) {
        if (o === root) return;
        if (o.isMesh || o.isSkinnedMesh || o.type === "Mesh" || o.type === "SkinnedMesh") {
          if (typeof o.name === "string" && o.name.length > 0) names.push(o.name);
        }
      });
      return names.slice(0, 24);
    }

    const byActorId = {};
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        const id = object.userData && typeof object.userData.openClinXrActorId === "string"
          ? object.userData.openClinXrActorId
          : "";
        if (!id) return;
        // Prefer outermost slot root (no ancestor also tagged with actor id).
        let ancestorHas = false;
        let p = object.parent;
        let depth = 0;
        while (p && depth < 12) {
          if (p.userData && typeof p.userData.openClinXrActorId === "string" && p.userData.openClinXrActorId.length > 0) {
            ancestorHas = true;
            break;
          }
          p = p.parent;
          depth += 1;
        }
        if (ancestorHas) return;
        const slotKind = object.userData && typeof object.userData.openClinXrSlotKind === "string"
          ? object.userData.openClinXrSlotKind
          : null;
        const row = {
          actorId: id,
          visible: effectiveVisible(object),
          worldPosition: worldPos(object),
          skinnedTriangleCount: skinnedTrisUnder(object),
          slotKind: slotKind,
          childMeshNames: childMeshNames(object),
        };
        // Prefer slot-tagged roots over non-slot if both appear.
        const prev = byActorId[id];
        if (!prev) {
          byActorId[id] = row;
        } else if (!prev.slotKind && row.slotKind) {
          byActorId[id] = row;
        } else if (row.skinnedTriangleCount > prev.skinnedTriangleCount) {
          byActorId[id] = row;
        }
      });
    }

    const roots = Object.keys(byActorId).map(function (k) { return byActorId[k]; });
    return {
      scenarioId: scenarioId,
      bundleScenarioId: bundleScenarioId,
      bundleMismatch: bundleMismatch,
      roots: roots,
    };
  })()`) as Promise<{
    scenarioId: string;
    bundleScenarioId: string;
    bundleMismatch: boolean;
    roots: LiveRoot[];
  }>;
}

// CLI: write pre-fix or remeasure / capture psych png
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writePreFix = process.argv.includes("--write-pre-fix");
  const force = process.argv.includes("--force");
  const capturePsychPng = process.argv.includes("--capture-psych-png");
  const onlyPsych = process.argv.includes("--psych-only");
  inspectDeclaredActorsRendered({
    writePreFix,
    force: force || writePreFix,
    label: writePreFix ? "pre-fix" : "cli",
    scenarioIds: onlyPsych ? ["psych_suicidal_ideation_safety_v1"] : undefined,
    capturePsychPng,
  })
    .then((report) => {
      process.stdout.write(`stations=${report.stations.length}\n`);
      let missing = 0;
      for (const s of report.stations) {
        for (const a of s.actors) {
          if (a.declared && (!a.renderedInScene || !a.visible)) missing += 1;
        }
      }
      process.stdout.write(`declared_missing_or_hidden=${missing}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
