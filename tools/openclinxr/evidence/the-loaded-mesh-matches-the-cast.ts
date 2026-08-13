/**
 * #366 — the loaded humanoid mesh must belong to the cast path the SSOT chose.
 *
 * Resolution is not loading. #111 proved the pure function `resolveHumanoidVariantOrCastPath`
 * agrees with `resolveScenarioActorCast`, but the running scene is what a learner sees, and
 * `runtimeHumanoidVariantAssetPath` in `apps/ui-xr/src/main.ts` is a SECOND resolution site
 * with its own scenario branches. This module measures the LIVE scene: for every cast slot it
 * records the SSOT-resolved path against the path the GLTFLoader was actually handed
 * (`userData.openClinXrAssetPath`) and the mesh name that ended up in the slot.
 *
 * claimScope: path identity of the loaded GLB vs the casting SSOT, read live from the scene.
 * notEvidenceFor: mesh quality, wardrobe fit, clinical realism, Quest readiness, capture framing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  resolveScenarioActorCast,
  type ScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { spawnPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
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
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";

export const ISSUE_366_EVIDENCE_DIR = ".openclinxr/evidence/issue-366";
export const CAST_LOAD_TRUTH_NAME = "cast-load-truth.json";

/**
 * The three stations with an explicit MPFB cast table. Peds is the #366 defect
 * (its three roles are MPFB per #335); ED and OB are the NOT-TESTED neighbours the
 * issue asked to check. Enumerated from the cast SSOT, never hardcoded per-actor.
 */
const DEFAULT_SCENARIO_IDS = [
  "peds_asthma_parent_anxiety_v1",
  "ed_chest_pain_priority_v1",
  "ob_headache_preeclampsia_triage_v1",
] as const;

export type CastLoadTruthRow = {
  scenarioId: string;
  actorId: string;
  role: string;
  /** What the casting SSOT says this actor should load. */
  resolvedPath: string;
  /** The path the GLTFLoader was handed, read live from openClinXrAssetPath. */
  loadedFromPath: string | null;
  /** Primary skinned mesh name under the loaded humanoid root (dot-stripped by three.js §6v). */
  loadedMeshName: string | null;
  /** All child mesh names under the loaded root (diagnostic, capped). */
  childMeshNames: string[];
  /** True when the live root exists and loadedFromPath === resolvedPath. */
  match: boolean;
  /** True when a live root carrying this actor id was found (slot actually staged+loaded). */
  staged: boolean;
};

export type CastLoadTruthReport = {
  scenarioIds: string[];
  rows: CastLoadTruthRow[];
  renderedDefinition: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

type ArtifactPayload = {
  schemaVersion: "openclinxr.cast-load-truth.v1";
  kind: "cast_load_truth_live";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  claimScope: string[];
  notEvidenceFor: string[];
  renderedDefinition: string;
  report: CastLoadTruthReport;
};

const RENDERED_DEFINITION =
  "a live scene root carrying userData.openClinXrAssetPath (the path runtimeHumanoidVariantAssetPath "
  + "handed the GLTFLoader) plus userData.openClinXrActorId; loadedMeshName prefers a body-identifying "
  + "skinned mesh name (body/basemesh/anny_base/torso/_mesh) and falls back to the largest skinned mesh. "
  + "Rejected: SSOT-only path identity without a live loaded root.";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let cachedReport: CastLoadTruthReport | null = null;
let measureInFlight: Promise<CastLoadTruthReport> | null = null;

function castLoadTruthPath(): string {
  return path.join(repoRoot, ISSUE_366_EVIDENCE_DIR, CAST_LOAD_TRUTH_NAME);
}

/** Slotted humanoid actors for a station — the three runtime shell slots (patient/clinical/family). */
function slottedActorIds(cast: readonly ScenarioActorCast[]): Set<string> {
  const humanoids = cast.filter(
    (a) => a.role.toLowerCase() !== "system" && !/_phone_|_tablet_|telehealth_system/iu.test(a.actorId),
  );
  const patient = humanoids.find((a) => a.role.toLowerCase() === "patient")?.actorId;
  const clinical = humanoids.find((a) =>
    ["nurse", "respiratory_therapist", "nurse_observer", "consultant"].includes(a.role.toLowerCase()),
  )?.actorId;
  const family = humanoids.find(
    (a) =>
      ["spouse", "parent", "family", "consultant"].includes(a.role.toLowerCase())
      && a.actorId !== clinical,
  )?.actorId;
  return new Set([patient, clinical, family].filter((id): id is string => Boolean(id)));
}

/**
 * Enumerate cast slots dynamically from `resolveScenarioActorCast` and measure the LIVE scene
 * for each. Signature consumed by the-loaded-mesh-matches-the-cast.test.ts.
 */
export async function inspectLoadedMeshMatchesCast(input?: {
  baseUrl?: string;
  force?: boolean;
  label?: string;
  scenarioIds?: string[];
  /** When true, (re)write cast-load-truth.json — the deliverable artifact. */
  writeArtifact?: boolean;
}): Promise<CastLoadTruthReport> {
  if (!input?.force && !input?.writeArtifact && cachedReport) return cachedReport;
  if (!input?.force && !input?.writeArtifact && measureInFlight) return measureInFlight;

  measureInFlight = (async () => {
    if (!input?.force && !input?.writeArtifact && !input?.scenarioIds && !input?.baseUrl) {
      if (process.env.OPENCLINXR_CAST_LOAD_TRUTH_USE_DISK === "1") {
        const fromDisk = await tryReadStampedArtifact(castLoadTruthPath(), (parsed) => {
          const report = parsed.report as CastLoadTruthReport | undefined;
          if (report?.rows && Array.isArray(report.rows) && report.rows.length > 0) return report;
          return null;
        });
        if (fromDisk) {
          cachedReport = fromDisk;
          return fromDisk;
        }
      }
    }

    const report = await measureLiveCastLoad({
      baseUrl: input?.baseUrl,
      scenarioIds: input?.scenarioIds,
    });

    if (input?.writeArtifact) {
      await writeCastLoadTruthDump(report, { label: input?.label ?? "measurement" });
    }

    if (!input?.scenarioIds && !input?.baseUrl) cachedReport = report;
    return report;
  })();

  try {
    return await measureInFlight;
  } finally {
    measureInFlight = null;
  }
}

export async function writeCastLoadTruthDump(
  report: CastLoadTruthReport,
  input?: { label?: string },
): Promise<string> {
  const outputPath = castLoadTruthPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = withTreeStamp({
    schemaVersion: "openclinxr.cast-load-truth.v1" as const,
    kind: "cast_load_truth_live" as const,
    label: input?.label ?? "measurement",
    generatedAt: new Date().toISOString(),
    claimScope: report.claimScope,
    notEvidenceFor: report.notEvidenceFor,
    renderedDefinition: report.renderedDefinition,
    report,
  }) satisfies ArtifactPayload;
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`cast-load-truth: wrote ${outputPath}\n`);
  return outputPath;
}

async function measureLiveCastLoad(input: {
  baseUrl?: string;
  scenarioIds?: string[];
}): Promise<CastLoadTruthReport> {
  const scenarioIds =
    input.scenarioIds && input.scenarioIds.length > 0
      ? input.scenarioIds
      : [...DEFAULT_SCENARIO_IDS];

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
        const rows: CastLoadTruthRow[] = [];
        for (const scenarioId of scenarioIds) {
          const cast = resolveScenarioActorCast(scenarioId);
          if (cast.length === 0) {
            process.stdout.write(`cast-load-truth: skip ${scenarioId} (no cast)\n`);
            continue;
          }
          const slots = slottedActorIds(cast);
          process.stdout.write(
            `cast-load-truth: goto ${scenarioId} cast=[${cast.map((c) => c.actorId).join(",")}]\n`,
          );
          const url = buildRoomCaptureUrl(baseUrl, scenarioId, ROOM_CAPTURE_MODE);
          await page.goto(url, { waitUntil: "load", timeout: 180_000 });
          await waitForStationShell(page, 180_000);
          // Frames advance before the humanoid GLBs settle; then every asset reports loaded|failed.
          await waitForSceneAssetsSettled(page, 60_000);
          await page.waitForTimeout(500);

          const live = await readLiveCastLoadFromPage(page);
          const byId = new Map(live.roots.map((r) => [r.actorId, r]));

          for (const entry of cast) {
            const resolvedPath = entry.runtimeAssetPath;
            const root = byId.get(entry.actorId);
            const staged = Boolean(root);
            const loadedFromPath = root?.loadedFromPath ?? null;
            rows.push({
              scenarioId,
              actorId: entry.actorId,
              role: entry.role,
              resolvedPath,
              loadedFromPath,
              loadedMeshName: root?.loadedMeshName ?? null,
              childMeshNames: root?.childMeshNames ?? [],
              match: staged && loadedFromPath === resolvedPath,
              staged,
            });
          }

          // Diagnostic: live roots not in the cast (should not happen; surfaced, not asserted).
          for (const root of live.roots) {
            if (cast.some((c) => c.actorId === root.actorId)) continue;
            rows.push({
              scenarioId,
              actorId: root.actorId,
              role: "unmapped",
              resolvedPath: "",
              loadedFromPath: root.loadedFromPath,
              loadedMeshName: root.loadedMeshName,
              childMeshNames: root.childMeshNames,
              match: false,
              staged: true,
            });
          }

          const slotNote = [...slots].join(",");
          for (const r of rows.filter((x) => x.scenarioId === scenarioId && cast.some((c) => c.actorId === x.actorId))) {
            process.stdout.write(
              `  ${r.actorId}: resolved=${r.resolvedPath} loaded=${r.loadedFromPath ?? "null"} `
              + `mesh=${r.loadedMeshName ?? "null"} match=${r.match}\n`,
            );
          }
          process.stdout.write(`  slotted=[${slotNote}]\n`);
        }

        return {
          scenarioIds: [...scenarioIds],
          rows,
          renderedDefinition: RENDERED_DEFINITION,
          claimScope: [
            "casting_ssot_runtimeAssetPath_identity",
            "live_scene_userData_openClinXrAssetPath_identity",
            "loaded_mesh_name_read_from_live_scene",
          ],
          notEvidenceFor: [
            "mesh_quality",
            "wardrobe_fit",
            "clinical_realism",
            "quest_readiness",
            "capture_framing",
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
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

type LiveCastRoot = {
  actorId: string;
  loadedFromPath: string;
  loadedMeshName: string | null;
  childMeshNames: string[];
};

/**
 * Read the LIVE scene: every root carrying `openClinXrAssetPath` (the path
 * `runtimeHumanoidVariantAssetPath` handed the GLTFLoader) plus its actor id.
 * String IIFE so tsx/esbuild cannot inject `__name` into the browser.
 */
export async function readLiveCastLoadFromPage(page: Page): Promise<{
  scenarioId: string;
  roots: LiveCastRoot[];
}> {
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const params = new URLSearchParams(window.location.search);
    let scenarioId = params.get("openclinxrScenarioId") || params.get("scenarioId") || "";
    const slot = win.__openClinXrActorSlotAssignment;
    if (slot && typeof slot.scenarioId === "string" && slot.scenarioId) scenarioId = slot.scenarioId;

    const byActorId = {};
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        const assetPath = object.userData && typeof object.userData.openClinXrAssetPath === "string"
          ? object.userData.openClinXrAssetPath
          : "";
        if (!assetPath) return;
        // Actor id on this node or its nearest ancestor.
        let actorId = (object.userData && typeof object.userData.openClinXrActorId === "string")
          ? object.userData.openClinXrActorId
          : "";
        let p = object.parent;
        let depth = 0;
        while ((!actorId) && p && depth < 8) {
          actorId = (p.userData && typeof p.userData.openClinXrActorId === "string")
            ? p.userData.openClinXrActorId
            : "";
          p = p.parent;
          depth += 1;
        }
        if (!actorId) return;

        const names = [];
        let primary = null;
        let primaryTris = -1;
        if (typeof object.traverse === "function") {
          object.traverse(function (c) {
            if (c === object) return;
            if (!(c.isMesh || c.isSkinnedMesh)) return;
            if (c.name) names.push(c.name);
            if (!c.isSkinnedMesh || !c.name) return;
            // Prefer a body-identifying name so loadedMeshName names the body, not a
            // footwear/garment sliver; fall back to the largest skinned mesh.
            const geo = c.geometry;
            let tris = 0;
            if (geo) {
              const index = geo.index;
              if (index && typeof index.count === "number") tris = Math.floor(index.count / 3);
              else {
                const pos = geo.attributes && geo.attributes.position;
                if (pos && typeof pos.count === "number") tris = Math.floor(pos.count / 3);
              }
            }
            if (tris > primaryTris) { primaryTris = tris; primary = c.name; }
          });
          if (primary && !/body|basemesh|anny_base|torso|_mesh\b/i.test(primary)) {
            object.traverse(function (c) {
              if (c === object) return;
              if (!(c.isSkinnedMesh && c.name)) return;
              if (/body|basemesh|anny_base|torso|_mesh\b/i.test(c.name)) { primary = c.name; }
            });
          }
        }
        if (!primary && names.length > 0) primary = names[0];

        const prev = byActorId[actorId];
        if (!prev || names.length > prev.childMeshNames.length) {
          byActorId[actorId] = {
            actorId: actorId,
            loadedFromPath: assetPath,
            loadedMeshName: primary || null,
            childMeshNames: names.slice(0, 24),
          };
        }
      });
    }

    return {
      scenarioId: scenarioId,
      roots: Object.keys(byActorId).map(function (k) { return byActorId[k]; }),
    };
  })()`) as Promise<{
    scenarioId: string;
    roots: LiveCastRoot[];
  }>;
}

// CLI: write the deliverable artifact (or remeasure).
if (
  typeof process !== "undefined"
  && process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const writeArtifact = process.argv.includes("--write-artifact");
  const force = process.argv.includes("--force");
  inspectLoadedMeshMatchesCast({
    writeArtifact: writeArtifact || force,
    force: force || writeArtifact,
    label: writeArtifact ? "cast-load-truth" : "cli",
  })
    .then((report) => {
      process.stdout.write(`rows=${report.rows.length}\n`);
      let mismatches = 0;
      for (const r of report.rows) {
        if (r.staged && !r.match) mismatches += 1;
      }
      process.stdout.write(`staged_mismatches=${mismatches}\n`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
