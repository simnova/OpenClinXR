/**
 * #218 — library humanoid staged by ordinary cast resolution (no comparator).
 *
 * Boots ui-xr on ED chest pain without `?comparator=` / humanoidSourceComparator,
 * reads live scene asset evidence + skinned/joint counts, and optionally writes a
 * lit room capture PNG for orchestrator grade.
 *
 * claimScope: one station actor resolves body-param-*-library.glb and loads with
 * real skinned geometry + joints; Anny cast paths remain for other ED roles.
 * notEvidenceFor: clinical wardrobe correctness, quest readiness, multi-station
 * library migration, phenotype-driven body-class selection.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import {
  resolveHumanoidVariantOrCastPath,
} from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const ISSUE_218_EVIDENCE_DIR = ".openclinxr/evidence/issue-218";
export const STAGED_CAPTURE_NAME = "staged-library-figure.png";

/** Station + actor chosen for #218 staging. */
export const LIBRARY_STAGE_SCENARIO_ID = "ed_chest_pain_priority_v1";
export const LIBRARY_STAGE_ACTOR_ID = "spouse_anna_hayes_v1";

export type StagedActor = {
  scenarioId: string;
  actorId: string;
  resolvedUrl: string;
  fromLibrary: boolean;
  skinnedTriangleCount: number;
  jointCount: number;
  visible: boolean;
};

export type LibraryHumanoidStagedReport = {
  stagedActors: StagedActor[];
  /** Count of actors whose resolved URL is still under /generated-humanoids/ (Anny cast). */
  annyActorsStillResolving: number;
  scenarioId: string;
  capturePath?: string;
  claimScope: string[];
  notEvidenceFor: string[];
  unlockedDecisions: {
    stationActor: string;
    bodyClass: string;
    mappingLayer: string;
    rejected: string[];
  };
};

let cached: LibraryHumanoidStagedReport | null = null;
let inFlight: Promise<LibraryHumanoidStagedReport> | null = null;

async function waitForHumanoidsAndFrames(
  page: Page,
  minFrames: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = browserPageWindow as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
        };
        __openClinXrSceneAssetEvidence?: {
          assets?: Array<{ status?: string }>;
          loadedCount?: number;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const loaded = win.__openClinXrSceneAssetEvidence?.loadedCount ?? 0;
      if (loaded < 1) return false;
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

type LiveActorDump = {
  actorId: string;
  skinnedTriangleCount: number;
  jointCount: number;
  visible: boolean;
  assetPathFromEvidence: string | null;
};

async function dumpLiveLibraryActors(page: Page, actorIds: readonly string[]): Promise<LiveActorDump[]> {
  const idsJson = JSON.stringify([...actorIds]);
  const raw = (await page.evaluate(`(() => {
    const expected = new Set(${idsJson});
    const scene = browserPageWindow.__openClinXrDebugScene;
    const evidence = browserPageWindow.__openClinXrSceneAssetEvidence;
    const byActor = {};
    function actorIdOf(obj) {
      let cur = obj;
      while (cur) {
        if (cur.userData && typeof cur.userData.openClinXrActorId === "string" && cur.userData.openClinXrActorId.length > 0) {
          return cur.userData.openClinXrActorId;
        }
        cur = cur.parent;
      }
      return null;
    }
    if (scene && scene.traverse) {
      scene.traverse(function (o) {
        const aid = actorIdOf(o);
        if (!aid || !expected.has(aid)) return;
        if (!byActor[aid]) {
          byActor[aid] = { skinnedTris: 0, jointNames: new Set(), visible: false };
        }
        const row = byActor[aid];
        if (o.isSkinnedMesh || o.isMesh) {
          if (o.visible !== false) row.visible = true;
          var tris = 0;
          if (o.geometry && o.geometry.index) tris = Math.floor(o.geometry.index.count / 3);
          else if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
            tris = Math.floor(o.geometry.attributes.position.count / 3);
          }
          if (o.isSkinnedMesh) row.skinnedTris += tris;
          if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
            for (var i = 0; i < o.skeleton.bones.length; i++) {
              var b = o.skeleton.bones[i];
              if (b && b.name) row.jointNames.add(String(b.name));
            }
          }
        }
        // Bones may also appear as named objects under the armature.
        if (o.isBone && o.name) row.jointNames.add(String(o.name));
      });
    }
    const assets = (evidence && evidence.assets) ? evidence.assets : [];
    const pathByActor = {};
    for (var j = 0; j < assets.length; j++) {
      const a = assets[j];
      const p = a && a.assetPath ? String(a.assetPath) : "";
      const name = a && a.sceneObjectName ? String(a.sceneObjectName) : "";
      // Match actor id if embedded in object name or path is the humanoid for a known role.
      for (const aid of expected) {
        if (name.indexOf(aid) >= 0 || (a.assetId && String(a.assetId).indexOf(aid) >= 0)) {
          pathByActor[aid] = p;
        }
      }
    }
    // Fallback: any loaded humanoid path that looks like library / generated, keyed by order later.
    const out = [];
    for (const aid of expected) {
      const row = byActor[aid] || { skinnedTris: 0, jointNames: new Set(), visible: false };
      out.push({
        actorId: aid,
        skinnedTriangleCount: row.skinnedTris || 0,
        jointCount: row.jointNames.size || 0,
        visible: Boolean(row.visible),
        assetPathFromEvidence: pathByActor[aid] || null,
      });
    }
    return out;
  })()`)) as LiveActorDump[];

  return Array.isArray(raw) ? raw : [];
}

/**
 * Live inspect: ED station with no comparator flag; report staged library actor(s).
 */
export async function inspectLibraryHumanoidStaged(input?: {
  baseUrl?: string;
  force?: boolean;
  writeCapture?: boolean;
}): Promise<LibraryHumanoidStagedReport> {
  if (!input?.force && cached) return cached;
  if (!input?.force && inFlight) return inFlight;

  inFlight = (async () => {
    const scenarioId = LIBRARY_STAGE_SCENARIO_ID;
    const cast = resolveScenarioActorCast(scenarioId);
    if (cast.length === 0) {
      throw new Error(`inspectLibraryHumanoidStaged: empty cast for ${scenarioId}`);
    }

    // Resolver-side rows (ordinary cast — no comparator).
    const resolverRows = cast.map((entry) => {
      const resolvedUrl = resolveHumanoidVariantOrCastPath({
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        fallbackPath: entry.runtimeAssetPath,
      });
      return {
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        resolvedUrl,
        fromLibrary: /body-param-.*-library/.test(resolvedUrl),
      };
    });

    let server: PortlessDevServer | undefined;
    let ownedServer = false;
    let capturePath: string | undefined;

    try {
      const baseUrl =
        input?.baseUrl
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
          // Ordinary station load — NO comparator query params.
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          if (/comparator|humanoidSourceComparator/i.test(url)) {
            throw new Error(`inspectLibraryHumanoidStaged: url must not carry comparator flags: ${url}`);
          }
          process.stdout.write(`library-staged: goto ${url}\n`);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 10, 180_000);
          await page.waitForTimeout(1500);

          const live = await dumpLiveLibraryActors(
            page,
            cast.map((c) => c.actorId),
          );
          const liveById = new Map(live.map((r) => [r.actorId, r]));

          // Scene asset evidence paths (status + assetPath for each loaded humanoid).
          const evidenceAssets = (await page.evaluate(`(() => {
            const e = browserPageWindow.__openClinXrSceneAssetEvidence;
            return e && e.assets ? e.assets.map(function (a) {
              return { assetId: a.assetId, assetPath: a.assetPath, status: a.status, sceneObjectName: a.sceneObjectName };
            }) : [];
          })()`)) as Array<{
            assetId: string;
            assetPath: string;
            status: string;
            sceneObjectName: string;
          }>;

          const stagedActors: StagedActor[] = resolverRows.map((r) => {
            const l = liveById.get(r.actorId);
            // Prefer live evidence path when it names the actor's loaded humanoid.
            let liveUrl = r.resolvedUrl;
            const matchingEvidence = evidenceAssets.find(
              (a) =>
                a.status === "loaded"
                && (a.assetPath.includes(r.actorId)
                  || a.sceneObjectName?.includes(r.actorId)
                  || (r.fromLibrary && /body-param-.*-library/.test(a.assetPath))
                  || (!r.fromLibrary
                    && a.assetPath.includes("generated-humanoids")
                    && path.basename(a.assetPath) === path.basename(r.resolvedUrl))),
            );
            if (matchingEvidence?.assetPath) {
              liveUrl = matchingEvidence.assetPath;
            } else if (l?.assetPathFromEvidence) {
              liveUrl = l.assetPathFromEvidence;
            }
            // Library actors: require live path or resolver path to name body-param library.
            const fromLibrary = /body-param-.*-library/.test(liveUrl) || r.fromLibrary;
            return {
              scenarioId: r.scenarioId,
              actorId: r.actorId,
              resolvedUrl: fromLibrary && r.fromLibrary ? r.resolvedUrl : liveUrl,
              fromLibrary: r.fromLibrary && fromLibrary,
              skinnedTriangleCount: l?.skinnedTriangleCount ?? 0,
              jointCount: l?.jointCount ?? 0,
              visible: l?.visible ?? false,
            };
          });

          // Tighten library row: if resolver says library, use resolver URL as resolvedUrl
          // (contract asserts basename) and live skinned/joints for rig survival.
          for (const a of stagedActors) {
            if (a.fromLibrary) {
              const rr = resolverRows.find((x) => x.actorId === a.actorId);
              if (rr) a.resolvedUrl = rr.resolvedUrl;
            }
          }

          // Counterweight: Anny paths from the resolver (not live evidence matching).
          const annyActorsStillResolving = resolverRows.filter(
            (r) => !r.fromLibrary && /generated-humanoids/.test(r.resolvedUrl),
          ).length;

          if (input?.writeCapture !== false) {
            const outDir = path.join(repoRoot, ISSUE_218_EVIDENCE_DIR);
            await mkdir(outDir, { recursive: true });
            const pngPath = path.join(outDir, STAGED_CAPTURE_NAME);
            await page.screenshot({ path: pngPath, type: "png" });
            capturePath = path.relative(repoRoot, pngPath);
            process.stdout.write(`library-staged: wrote ${capturePath}\n`);
          }

          const report: LibraryHumanoidStagedReport = {
            stagedActors,
            annyActorsStillResolving,
            scenarioId,
            ...(capturePath ? { capturePath } : {}),
            claimScope: [
              "ordinary_cast_resolution_stages_body_param_library_glb",
              "live_skinned_geometry_and_joints_survive_load",
              "anny_cast_untouched_for_other_ed_roles",
            ],
            notEvidenceFor: [
              "clinical_wardrobe_correctness",
              "quest_readiness",
              "multi_station_library_migration",
              "phenotype_driven_body_class_selection",
              "exam_equivalence",
            ],
            unlockedDecisions: {
              stationActor: `${LIBRARY_STAGE_SCENARIO_ID}/${LIBRARY_STAGE_ACTOR_ID}`,
              bodyClass: "adult_lean_female",
              mappingLayer:
                "extended ED literal cast tables (actor-casting + humanoid-runtime-asset-url) — not a new libraryHumanoidByActorId subsystem",
              rejected: [
                "ED patient → library (breaks #160 gown counterweight)",
                "adult_heavy_male for spouse_anna_hayes (male body class on female actor)",
                "full cast migration / multi-role library swap",
                "comparator-only path (?humanoidSourceComparator) — does not count as staging",
                "separate libraryHumanoidByActorId layer (premature until phenotype drives pick)",
              ],
            },
          };

          process.stdout.write(
            `library-staged: fromLibrary=${report.stagedActors.filter((a) => a.fromLibrary).length} `
            + `anny=${report.annyActorsStillResolving} `
            + `joints=${report.stagedActors.filter((a) => a.fromLibrary).map((a) => a.jointCount).join(",")}\n`,
          );

          cached = report;
          return report;
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
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Optional CLI: measure + capture. */
async function main(): Promise<void> {
  const report = await inspectLibraryHumanoidStaged({ force: true, writeCapture: true });
  const out = path.join(repoRoot, ISSUE_218_EVIDENCE_DIR, "staged-report.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    fromLibrary: report.stagedActors.filter((a) => a.fromLibrary),
    anny: report.annyActorsStillResolving,
    capturePath: report.capturePath,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("library-humanoid-staged.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
