/**
 * #219 — library figure finish parity (clinical idle arm hang + footwear) vs Anny cast.
 *
 * Boots ED chest pain (no comparator), measures live wrist lateral offset for every
 * staged actor, classifies rail from the resolved asset path, and derives the idle
 * tolerance FROM the Anny actors in the same scene (not a chosen number).
 *
 * claimScope: library figure wrist hang within Anny-derived band; footwear meshes on
 * library figure; Anny footwear not regressed.
 * notEvidenceFor: lower-body garment channel, clinical costume realism, quest readiness,
 * multi-station library migration.
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
export const ISSUE_219_EVIDENCE_DIR = ".openclinxr/evidence/issue-219";
export const PRE_FIX_NAME = "pre-fix.json";
export const GRADE_PNG_NAME = "finish-parity-grade.png";

export const LIBRARY_STAGE_SCENARIO_ID = "ed_chest_pain_priority_v1";

export type FigureFinish = {
  scenarioId: string;
  actorId: string;
  rail: "library" | "anny";
  resolvedUrl: string;
  /** Horizontal wrist offset from the torso axis, metres. T-pose is large; clinical idle is small. */
  wristLateralOffsetMeters: number;
  /** Left upper_arm local rotation after frame loop (diagnostic: never-applied vs clobbered). */
  upperArmLLocalRotation: { x: number; y: number; z: number };
  clinicalIdleBonesTouched: string[];
  footwearMeshNames: string[];
  footwearTriangleCount: number;
};

export type LibraryFigureFinishParityReport = {
  figures: FigureFinish[];
  annyBaseline: {
    medianWristLateralOffsetMeters: number;
    toleranceMeters: number;
    source: string;
  };
  scenarioId: string;
  capturePath?: string;
  claimScope: string[];
  notEvidenceFor: string[];
  ambientFailureClass?: string;
};

let cached: LibraryFigureFinishParityReport | null = null;
let inFlight: Promise<LibraryFigureFinishParityReport> | null = null;

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

type LiveFigureDump = {
  actorId: string;
  wristLateralOffsetMeters: number;
  upperArmLLocalRotation: { x: number; y: number; z: number };
  clinicalIdleBonesTouched: string[];
  footwearMeshNames: string[];
  footwearTriangleCount: number;
  skinnedTriangleCount: number;
};

/**
 * Live dump: wrist lateral (hand.L vs torso mid-line), upper_armL local rot, footwear meshes.
 * String IIFE so esbuild cannot inject __name into the browser.
 */
async function dumpLiveFigureFinish(page: Page, actorIds: readonly string[]): Promise<LiveFigureDump[]> {
  const idsJson = JSON.stringify([...actorIds]);
  const raw = (await page.evaluate(`(() => {
    const expected = new Set(${idsJson});
    const scene = browserPageWindow.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return [];

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

    function worldPos(o) {
      if (typeof o.updateWorldMatrix === "function") o.updateWorldMatrix(true, false);
      else if (typeof o.updateMatrixWorld === "function") o.updateMatrixWorld(true);
      const e = o.matrixWorld && o.matrixWorld.elements;
      if (!e) return { x: 0, y: 0, z: 0 };
      return { x: e[12], y: e[13], z: e[14] };
    }

    function norm(name) {
      return String(name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
    }

    function isFootwearName(name) {
      return /footwear|shoe|boot|slipper|sandal|sneaker|sock/i.test(String(name || ""));
    }

    // Collect actor roots (deepest openClinXrActorPosture or first openClinXrActorId carriers with skin).
    const byActor = {};
    for (const aid of expected) {
      byActor[aid] = {
        roots: [],
        bones: {},
        footwearNames: new Set(),
        footwearTris: 0,
        skinnedTris: 0,
        clinicalIdleBones: [],
        rootMid: null,
      };
    }

    scene.traverse(function (o) {
      const aid = actorIdOf(o);
      if (!aid || !expected.has(aid)) return;
      const row = byActor[aid];
      if (o.userData && o.userData.openClinXrActorId === aid) {
        row.roots.push(o);
        if (Array.isArray(o.userData.openClinXrClinicalIdleBonesTouched)) {
          row.clinicalIdleBones = o.userData.openClinXrClinicalIdleBonesTouched.slice();
        }
      }
      const n = o.name || "";
      const nn = norm(n);
      if (o.isBone || o.type === "Bone" || nn.includes("upper_arm") || nn.includes("hand") || nn.includes("forearm")) {
        row.bones[n] = o;
      }
      if (o.isSkinnedMesh || o.isMesh) {
        var tris = 0;
        if (o.geometry && o.geometry.index) tris = Math.floor(o.geometry.index.count / 3);
        else if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
          tris = Math.floor(o.geometry.attributes.position.count / 3);
        }
        if (o.isSkinnedMesh) row.skinnedTris += tris;
        if (isFootwearName(n) || (o.userData && o.userData.openClinXrFootwear)) {
          row.footwearNames.add(n);
          row.footwearTris += tris;
        }
      }
      // Also walk skeleton bones for name map
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
        for (var i = 0; i < o.skeleton.bones.length; i++) {
          var b = o.skeleton.bones[i];
          if (b && b.name) row.bones[b.name] = b;
        }
      }
    });

    function findBone(bones, part, side) {
      var keys = Object.keys(bones);
      for (var i = 0; i < keys.length; i++) {
        var name = keys[i];
        var n = norm(name);
        var hasSide = side === "L"
          ? (n.endsWith("l") || n.includes("left") || n.includes("_l"))
          : (n.endsWith("r") || n.includes("right") || n.includes("_r"));
        if (!hasSide) continue;
        if (part === "upper" && (n.includes("upper_arm") || n.includes("upperarm") || n === "leftarm" || n === "rightarm")) return bones[name];
        if (part === "hand" && (n.includes("hand") || n.includes("wrist")) && !n.includes("index") && !n.includes("finger")) return bones[name];
      }
      return null;
    }

    const out = [];
    for (const aid of expected) {
      const row = byActor[aid];
      const root = row.roots[0] || null;
      let midX = 0, midZ = 0;
      if (root) {
        const rp = worldPos(root);
        midX = rp.x;
        midZ = rp.z;
      }
      const handL = findBone(row.bones, "hand", "L");
      const upperL = findBone(row.bones, "upper", "L");
      let lateral = 0;
      if (handL) {
        const hp = worldPos(handL);
        const dx = hp.x - midX;
        const dz = hp.z - midZ;
        lateral = Math.sqrt(dx * dx + dz * dz);
      }
      var urot = { x: 0, y: 0, z: 0 };
      if (upperL && upperL.rotation) {
        urot = { x: upperL.rotation.x || 0, y: upperL.rotation.y || 0, z: upperL.rotation.z || 0 };
      }
      out.push({
        actorId: aid,
        wristLateralOffsetMeters: lateral,
        upperArmLLocalRotation: urot,
        clinicalIdleBonesTouched: row.clinicalIdleBones,
        footwearMeshNames: Array.from(row.footwearNames),
        footwearTriangleCount: row.footwearTris,
        skinnedTriangleCount: row.skinnedTris,
      });
    }
    return out;
  })()`)) as LiveFigureDump[];
  return Array.isArray(raw) ? raw : [];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

/**
 * Tolerance from Anny actors in this scene only.
 * Floor 0.04 m so tiny jitter does not fail; ceiling-scale: half the Anny median itself
 * so a T-pose (~0.5–0.7 m) cannot clear a ~0.15–0.25 m idle band by accident.
 * Reference is independent of the library treatment (#151 circular-eps ban).
 */
function deriveAnnyTolerance(annyLaterals: number[]): {
  medianWristLateralOffsetMeters: number;
  toleranceMeters: number;
  source: string;
} {
  const med = median(annyLaterals);
  // Spread among Anny actors when multiple; otherwise 40% of median, min 0.04, max 0.12.
  let spread = 0;
  if (annyLaterals.length >= 2) {
    const minV = Math.min(...annyLaterals);
    const maxV = Math.max(...annyLaterals);
    spread = maxV - minV;
  }
  const tol = Math.min(0.12, Math.max(0.04, spread > 0.01 ? spread * 1.5 + 0.02 : med * 0.4));
  return {
    medianWristLateralOffsetMeters: med,
    toleranceMeters: tol,
    source: "anny_actors_same_scene_median_wrist_lateral",
  };
}

export async function inspectLibraryFigureFinishParity(input?: {
  baseUrl?: string;
  force?: boolean;
  writeCapture?: boolean;
  writePreFix?: boolean;
}): Promise<LibraryFigureFinishParityReport> {
  if (!input?.force && !input?.writePreFix && cached) return cached;
  if (!input?.force && !input?.writePreFix && inFlight) return inFlight;

  inFlight = (async () => {
    const scenarioId = LIBRARY_STAGE_SCENARIO_ID;
    const cast = resolveScenarioActorCast(scenarioId);
    if (cast.length === 0) {
      throw new Error(`inspectLibraryFigureFinishParity: empty cast for ${scenarioId}`);
    }

    const resolverRows = cast.map((entry) => {
      const resolvedUrl = resolveHumanoidVariantOrCastPath({
        scenarioId,
        actorId: entry.actorId,
        role: entry.role,
        fallbackPath: entry.runtimeAssetPath,
      });
      const fromLibrary = /body-param-.*-library/.test(resolvedUrl);
      return {
        actorId: entry.actorId,
        role: entry.role,
        resolvedUrl,
        rail: (fromLibrary ? "library" : "anny") as "library" | "anny",
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
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          if (/comparator|humanoidSourceComparator/i.test(url)) {
            throw new Error(`inspectLibraryFigureFinishParity: url must not carry comparator flags: ${url}`);
          }
          process.stdout.write(`finish-parity: goto ${url}\n`);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          await waitForHumanoidsAndFrames(page, 12, 180_000);
          // Clinical idle re-applies every frame after mixer — settle several cycles.
          await page.waitForTimeout(1800);

          const live = await dumpLiveFigureFinish(
            page,
            cast.map((c) => c.actorId),
          );
          const liveById = new Map(live.map((r) => [r.actorId, r]));

          const figures: FigureFinish[] = resolverRows.map((r) => {
            const l = liveById.get(r.actorId);
            return {
              scenarioId,
              actorId: r.actorId,
              rail: r.rail,
              resolvedUrl: r.resolvedUrl,
              wristLateralOffsetMeters: l?.wristLateralOffsetMeters ?? 0,
              upperArmLLocalRotation: l?.upperArmLLocalRotation ?? { x: 0, y: 0, z: 0 },
              clinicalIdleBonesTouched: l?.clinicalIdleBonesTouched ?? [],
              footwearMeshNames: l?.footwearMeshNames ?? [],
              footwearTriangleCount: l?.footwearTriangleCount ?? 0,
            };
          });

          const annyLaterals = figures
            .filter((f) => f.rail === "anny")
            .map((f) => f.wristLateralOffsetMeters)
            .filter((v) => v > 0.01);
          const annyBaseline = deriveAnnyTolerance(
            annyLaterals.length > 0
              ? annyLaterals
              : figures.filter((f) => f.rail === "anny").map((f) => f.wristLateralOffsetMeters),
          );

          if (input?.writeCapture !== false) {
            const outDir = path.join(repoRoot, ISSUE_219_EVIDENCE_DIR);
            await mkdir(outDir, { recursive: true });
            const pngPath = path.join(outDir, GRADE_PNG_NAME);
            await page.screenshot({ path: pngPath, type: "png" });
            capturePath = path.relative(repoRoot, pngPath);
            process.stdout.write(`finish-parity: wrote ${capturePath}\n`);
          }

          const library = figures.filter((f) => f.rail === "library");
          const ambientFailureClass = library.length === 0
            ? "no_library_actor_in_cast"
            : library.every((f) => f.footwearTriangleCount === 0)
              ? "library_barefoot_because_body_param_export_never_called_embed_role_footwear_shells"
              : library.some((f) => {
                  const d = Math.abs(f.wristLateralOffsetMeters - annyBaseline.medianWristLateralOffsetMeters);
                  return d > annyBaseline.toleranceMeters;
                })
                ? "library_arm_hang_differs_from_anny_same_scene"
                : "library_finish_within_anny_band";

          const report: LibraryFigureFinishParityReport = {
            figures,
            annyBaseline,
            scenarioId,
            ...(capturePath ? { capturePath } : {}),
            ambientFailureClass,
            claimScope: [
              "library_wrist_lateral_within_anny_derived_band",
              "library_footwear_meshes_present",
              "anny_footwear_counterweight",
            ],
            notEvidenceFor: [
              "lower_body_garment_channel",
              "clinical_costume_realism",
              "quest_readiness",
              "multi_station_library_migration",
              "exam_equivalence",
            ],
          };

          for (const f of figures) {
            process.stdout.write(
              `  ${f.rail}/${f.actorId} lateral=${f.wristLateralOffsetMeters.toFixed(3)}m `
              + `upper_armL=(${f.upperArmLLocalRotation.x.toFixed(3)},${f.upperArmLLocalRotation.y.toFixed(3)},${f.upperArmLLocalRotation.z.toFixed(3)}) `
              + `footwearTris=${f.footwearTriangleCount} idleBones=${f.clinicalIdleBonesTouched.length}\n`,
            );
          }
          process.stdout.write(
            `finish-parity: annyMedian=${annyBaseline.medianWristLateralOffsetMeters.toFixed(3)} `
            + `tol=${annyBaseline.toleranceMeters.toFixed(3)} ambient=${ambientFailureClass}\n`,
          );

          if (input?.writePreFix) {
            const outDir = path.join(repoRoot, ISSUE_219_EVIDENCE_DIR);
            await mkdir(outDir, { recursive: true });
            const prePath = path.join(outDir, PRE_FIX_NAME);
            await writeFile(
              prePath,
              `${JSON.stringify({
                schemaVersion: "openclinxr.library-figure-finish-parity.v1",
                kind: "pre_fix",
                generatedAt: new Date().toISOString(),
                ambientFailureClass,
                report,
              }, null, 2)}\n`,
              "utf8",
            );
            process.stdout.write(`finish-parity: wrote pre-fix ${path.relative(repoRoot, prePath)}\n`);
          }

          if (!input?.writePreFix) {
            cached = report;
          }
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

/** CLI: measure + optional pre-fix + grade capture. */
async function main(): Promise<void> {
  const writePreFix = process.argv.includes("--pre-fix");
  const report = await inspectLibraryFigureFinishParity({
    force: true,
    writeCapture: true,
    writePreFix,
  });
  const out = path.join(repoRoot, ISSUE_219_EVIDENCE_DIR, "finish-parity-report.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ambientFailureClass: report.ambientFailureClass,
    annyBaseline: report.annyBaseline,
    figures: report.figures.map((f) => ({
      actorId: f.actorId,
      rail: f.rail,
      lateral: f.wristLateralOffsetMeters,
      upperArmL: f.upperArmLLocalRotation,
      footwearTris: f.footwearTriangleCount,
      idleBones: f.clinicalIdleBonesTouched,
    })),
    capturePath: report.capturePath,
  }, null, 2));
}

if (
  import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("library-figure-finish-parity.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
