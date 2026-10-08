import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scenarioBank } from "@openclinxr/scenario-fixtures";
import { INFINIGEN_ENVIRONMENT_ASSETS } from "@openclinxr/xr-runtime-state";
import type { Page } from "playwright";
import { collectSweepScene } from "../evidence/station-capture/camera-sweep-scene.js";
import type { GateCamera, GateReading } from "../evidence/station-capture/gate-geometry.js";
import type { CachedSceneSnapshot, SolverPlacement, SupportSurface } from "./staging-types.js";

type BankScenario = (typeof scenarioBank)[number];
type BankActor = BankScenario["actors"][number];

const CACHE_ROOT = ".openclinxr/staging-solver";

function fixtureScenarioId(scenarioId: string): string {
  return scenarioId === "ed_chest_pain_priority_v2" ? "ed_chest_pain_priority_v1" : scenarioId;
}

function fileHashPart(filePath: string): Buffer {
  return existsSync(filePath) ? readFileSync(filePath) : Buffer.from(`missing:${filePath}`);
}

export function snapshotInputHash(repoRoot: string, scenarioId: string): string {
  const bundlePath = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated", scenarioId, "learner-runtime-bundle.v1.json");
  const scenario = scenarioBank.find((row: BankScenario) => row.scenarioId === fixtureScenarioId(scenarioId));
  const environmentId = scenario?.environment?.environmentId as keyof typeof INFINIGEN_ENVIRONMENT_ASSETS | undefined;
  const roomUrl = environmentId ? INFINIGEN_ENVIRONMENT_ASSETS[environmentId] : undefined;
  const roomPath = roomUrl ? path.join(repoRoot, "apps/ui-xr/public", roomUrl.replace(/^\//, "")) : "missing-room";
  return createHash("sha256").update(fileHashPart(bundlePath)).update(fileHashPart(roomPath)).digest("hex");
}

export function snapshotPath(repoRoot: string, scenarioId: string): string {
  return path.join(repoRoot, CACHE_ROOT, scenarioId, "scene-snapshot.json");
}

export async function readFreshSnapshot(repoRoot: string, scenarioId: string): Promise<CachedSceneSnapshot | null> {
  const target = snapshotPath(repoRoot, scenarioId);
  if (!existsSync(target)) return null;
  const snapshot = JSON.parse(await readFile(target, "utf8")) as CachedSceneSnapshot;
  const currentHash = snapshotInputHash(repoRoot, scenarioId);
  if (snapshot.inputHash !== currentHash) {
    throw new Error(`stale snapshot refused for ${scenarioId}: cached=${snapshot.inputHash} current=${currentHash}; pass --refresh-snapshot`);
  }
  return snapshot;
}

export async function cacheObservedGate(
  snapshot: CachedSceneSnapshot,
  repoRoot: string,
  observedCamera: GateCamera,
  observedGate: GateReading,
): Promise<CachedSceneSnapshot> {
  const enriched = { ...snapshot, observedCamera, observedGate };
  await writeFile(snapshotPath(repoRoot, snapshot.scenarioId), `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

function currentPlacementOf(actor: { placement?: unknown }): SolverPlacement {
  const raw = actor.placement as Partial<SolverPlacement> | undefined;
  const support = raw?.supportSurface;
  const supportSurface: SupportSurface = support === "stretcher" || support === "bed" || support === "exam_table"
    || support === "chair" || support === "none" ? support : "none";
  const offset = raw?.plantOffsetMeters;
  return {
    supportSurface,
    plantOffsetMeters: {
      x: Number(offset?.x ?? 0),
      y: Number(offset?.y ?? 0),
      z: Number(offset?.z ?? 0),
    },
    ...(typeof raw?.headingRadians === "number" ? { headingRadians: raw.headingRadians } : {}),
  };
}

export async function captureAndCacheSnapshot(
  page: Page,
  repoRoot: string,
  scenarioId: string,
): Promise<CachedSceneSnapshot> {
  const raw = await collectSweepScene(page);
  return cacheSnapshotRaw(raw, repoRoot, scenarioId);
}

export async function cacheSnapshotRaw(
  raw: Awaited<ReturnType<typeof collectSweepScene>>,
  repoRoot: string,
  scenarioId: string,
): Promise<CachedSceneSnapshot> {
  if ("error" in raw) throw new Error(`snapshot ${scenarioId}: ${raw.error}`);
  const scenario = scenarioBank.find((row: BankScenario) => row.scenarioId === fixtureScenarioId(scenarioId));
  if (!scenario) throw new Error(`scenario fixture missing for ${scenarioId}`);
  const byId = new Map(scenario.actors.map((actor: BankActor) => [actor.actorId, actor] as const));
  const actors = raw.actors.map((actor: (typeof raw.actors)[number]) => {
    const source = byId.get(actor.id);
    if (!source) throw new Error(`snapshot actor ${actor.id} absent from ${scenarioId} fixture`);
    return {
      ...actor,
      role: source.role,
      currentPlacement: currentPlacementOf(source),
      bodyDimensions: [
        actor.box.max[0] - actor.box.min[0],
        actor.box.max[1] - actor.box.min[1],
        actor.box.max[2] - actor.box.min[2],
      ] as [number, number, number],
    };
  });
  const snapshot: CachedSceneSnapshot = {
    ...raw,
    schemaVersion: "openclinxr.staging-solver-snapshot.v1",
    scenarioId,
    inputHash: snapshotInputHash(repoRoot, scenarioId),
    capturedAt: new Date().toISOString(),
    actors,
  };
  const target = snapshotPath(repoRoot, scenarioId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}
