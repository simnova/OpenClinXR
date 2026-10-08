import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORED_STAGING_SOLUTIONS } from "../../../packages/openclinxr/scenario-fixtures/src/staging-solver-authored.js";
import type { GateReading } from "../evidence/station-capture/gate-geometry.js";
import {
  captureStationEnvironmentRooms,
  shippedStationIds,
} from "../evidence/ui-xr-environment-room-capture.js";
import { writeAuthoredSolutions } from "./authored-output.js";
import { type CameraSearchResult, solveLayouts } from "./camera-search.js";
import { searchClinicalLayouts } from "./layout-search.js";
import { cacheObservedGate, cacheSnapshotRaw, readFreshSnapshot } from "./snapshot-cache.js";
import type { CachedSceneSnapshot, StagingSolveResult } from "./staging-types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_ROOT = path.join(REPO_ROOT, "docs/openclinxr/staging-solver");
const AFTER_DIR = path.join(OUTPUT_ROOT, "after");

function gateFromManifest(entry: {
  liveShell: {
    actorContainment?: { contained: number; total: number };
    actorVisibility?: GateReading["crownChest"];
    meanFacingDeg?: number;
    nearOcclusion?: { fraction: number; nearRayCount: number };
  };
}): GateReading {
  const containment = entry.liveShell.actorContainment ?? { contained: 0, total: 0 };
  const crownChest = entry.liveShell.actorVisibility ?? [];
  const facing = entry.liveShell.meanFacingDeg ?? 180;
  const near = entry.liveShell.nearOcclusion ?? { fraction: 1, nearRayCount: 144 };
  const visibleActors = crownChest.filter((row) => row.crownVisible && row.chestVisible).length;
  return {
    containedActors: containment.contained, totalActors: containment.total, visibleActors, crownChest,
    meanFacingDeg: facing, nearOcclusionFraction: near.fraction, nearRayCount: near.nearRayCount,
    minMargin: -1,
    gatePass: containment.total > 0 && containment.contained === containment.total
      && visibleActors === containment.total && facing <= 90 && near.fraction <= 0.1,
  };
}

function parseArgs(argv: string[]): { cases: string[]; refreshSnapshot: boolean; capture: boolean; apply: boolean; retainedOnly: boolean } {
  let one: string | undefined, all = false, refreshSnapshot = false, capture = true, apply = true, retainedOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--case" && argv[index + 1]) one = argv[++index];
    else if (argv[index] === "--all") all = true;
    else if (argv[index] === "--refresh-snapshot") refreshSnapshot = true;
    else if (argv[index] === "--no-capture") capture = false;
    else if (argv[index] === "--no-apply") apply = false;
    else if (argv[index] === "--retained-only") retainedOnly = true;
  }
  if (Boolean(one) === all) throw new Error("pass exactly one of --case <id> or --all");
  if (capture && !apply) throw new Error("--no-apply requires --no-capture");
  return { cases: one ? [one] : shippedStationIds(), refreshSnapshot, capture, apply, retainedOnly };
}

async function snapshotsFor(cases: string[], refresh: boolean): Promise<Map<string, CachedSceneSnapshot>> {
  const output = new Map<string, CachedSceneSnapshot>();
  const missing: string[] = [];
  for (const scenarioId of cases) {
    if (!refresh) {
      const cached = await readFreshSnapshot(REPO_ROOT, scenarioId);
      if (cached) { output.set(scenarioId, cached); continue; }
    }
    missing.push(scenarioId);
  }
  if (missing.length === 0) return output;
  for (const scenarioId of missing) process.stdout.write(`staging-solver: snapshot ${scenarioId}\n`);
  const manifest = await captureStationEnvironmentRooms({
    scenarioIds: missing,
    outputDir: path.join(REPO_ROOT, ".openclinxr/staging-solver/snapshot-captures"),
    onSnapshot: async (scenarioId, raw) => { output.set(scenarioId, await cacheSnapshotRaw(raw, REPO_ROOT, scenarioId)); },
  });
  for (const entry of manifest.entries) {
    const snapshot = output.get(entry.scenarioId);
    const eye = entry.liveShell.cameraEye;
    const look = entry.liveShell.cameraLook;
    const fov = entry.liveShell.cameraFov;
    if (!snapshot || !eye || !look || typeof fov !== "number") continue;
    output.set(entry.scenarioId, await cacheObservedGate(snapshot, REPO_ROOT, {
      eye, look, fov, aspect: 1440 / 900,
    }, gateFromManifest(entry)));
  }
  return output;
}

function predictedResult(scenarioId: string, snapshot: CachedSceneSnapshot): { row: StagingSolveResult; solution: CameraSearchResult | null } {
  const started = performance.now();
  const layoutSearch = searchClinicalLayouts(snapshot);
  const unchanged = layoutSearch.layouts.find((layout) => layout.every((row) => row.persistPlacement === false));
  const protectedBaseline = snapshot.observedGate?.gatePass === true && snapshot.observedCamera && unchanged
    ? { camera: snapshot.observedCamera, gate: snapshot.observedGate, layout: unchanged }
    : null;
  const solution = protectedBaseline ?? (layoutSearch.layouts.length > 0 ? solveLayouts(snapshot, layoutSearch.layouts) : null);
  return {
    solution,
    row: {
      scenarioId,
      feasible: solution?.gate.gatePass === true,
      ...(solution?.gate.gatePass === true ? {} : { bindingConstraint: layoutSearch.bindingConstraint ?? "no gate pass inside clinical templates" }),
      solveMs: Number((performance.now() - started).toFixed(1)),
      predictedGate: solution?.gate ?? null,
      realGate: null,
      slots: solution?.layout.map(({ box: _box, standing: _standing, ...row }) => row) ?? [],
      camera: solution?.camera ?? null,
    },
  };
}

async function captureReal(
  cases: string[],
  rows: Map<string, StagingSolveResult>,
  stagedSolutions: ReadonlyMap<string, CameraSearchResult> = new Map(),
): Promise<void> {
  mkdirSync(AFTER_DIR, { recursive: true });
  const allEntries: Awaited<ReturnType<typeof captureStationEnvironmentRooms>>["entries"] = [];
  let manifestTemplate: Awaited<ReturnType<typeof captureStationEnvironmentRooms>> | undefined;
  for (const scenarioId of cases) {
      const row = rows.get(scenarioId);
      if (!row) continue;
      try {
        // Inject only cameras belonging to the treatment currently staged in
        // generated bundles. Protected baselines must load their real product
        // camera, otherwise the live no-regression check becomes circular.
        const solvedCamera = stagedSolutions.get(scenarioId)?.camera
          ?? AUTHORED_STAGING_SOLUTIONS[scenarioId]?.camera
          ?? null;
        const manifest = await captureStationEnvironmentRooms({ scenarioIds: [scenarioId], outputDir: AFTER_DIR,
          ...(solvedCamera ? { stagingCameraByScenario: { [scenarioId]: solvedCamera } } : {}),
          ignoreModuleAuthoredCamera: true,
        });
        const entry = manifest.entries[0];
        if (!entry) throw new Error("capture manifest has no entry");
        manifestTemplate ??= manifest;
        allEntries.push(entry);
        const real = gateFromManifest(entry);
        row.realGate = real;
        const predicted = row.predictedGate;
        if (predicted && stagedSolutions.has(scenarioId)) row.parity = {
          visibilityDelta: Math.abs(predicted.visibleActors - real.visibleActors),
          nearDelta: Math.abs(predicted.nearOcclusionFraction - real.nearOcclusionFraction),
          containmentDelta: Math.abs(predicted.containedActors - real.containedActors),
        };
      } catch (error) {
        row.bindingConstraint = `real capture failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  if (manifestTemplate) {
    writeFileSync(path.join(AFTER_DIR, "capture-manifest.json"), `${JSON.stringify({
      ...manifestTemplate,
      generatedAt: new Date().toISOString(),
      entries: allEntries,
    }, null, 2)}\n`, "utf8");
  }
}

async function applySolutions(refreshCases: Iterable<string>, solutions: ReadonlyMap<string, CameraSearchResult>): Promise<void> {
  await writeAuthoredSolutions(REPO_ROOT, solutions, AUTHORED_STAGING_SOLUTIONS);
  // The UI consumes scenario-fixtures through its built package export. Rebuild
  // after writing the authored solution so the runtime capture cannot grade a
  // previous solver result while the report describes the new one.
  execFileSync("pnpm", ["--filter", "@openclinxr/scenario-fixtures", "build"], {
    cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, OPENCLINXR_WORKER: "1" },
  });
  for (const scenarioId of refreshCases) {
    execFileSync("pnpm", ["asset:generated-station-bundle", "--", "--scenario-id", scenarioId, "--refresh-public-placements"], {
      cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, OPENCLINXR_WORKER: "1" },
    });
  }
}

type PublicBundleBackup = Map<string, Array<{ path: string; bytes: Buffer }>>;

function backupPublicBundles(scenarioIds: Iterable<string>): PublicBundleBackup {
  return new Map([...scenarioIds].map((scenarioId) => [scenarioId, [
    "learner-runtime-bundle.v1.json",
    "scene-manifest.v1.json",
  ].map((name) => {
    const target = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated", scenarioId, name);
    return { path: target, bytes: readFileSync(target) };
  })]));
}

function restorePublicBundles(backups: PublicBundleBackup, scenarioIds: Iterable<string>): void {
  for (const scenarioId of scenarioIds) {
    for (const file of backups.get(scenarioId) ?? []) writeFileSync(file.path, file.bytes);
  }
}

function restoreObservedBaseline(row: StagingSolveResult, snapshot: CachedSceneSnapshot): void {
  const unchanged = searchClinicalLayouts(snapshot).layouts.find((layout) => layout.every((item) => item.persistPlacement === false));
  row.feasible = snapshot.observedGate?.gatePass === true;
  row.bindingConstraint = "solver candidate rejected by live gate; retained observed baseline";
  row.predictedGate = snapshot.observedGate ?? null;
  row.camera = snapshot.observedCamera ?? null;
  row.slots = unchanged?.map(({ box: _box, standing: _standing, ...item }) => item) ?? [];
  row.realGate = null;
  delete row.parity;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshots = await snapshotsFor(args.cases, args.refreshSnapshot);
  const rows = new Map<string, StagingSolveResult>();
  const solutions = new Map<string, CameraSearchResult>();
  for (const scenarioId of args.cases) {
    const snapshot = snapshots.get(scenarioId);
    if (!snapshot) continue;
    const solved = predictedResult(scenarioId, snapshot);
    rows.set(scenarioId, solved.row);
    // Already-passing live baselines are protected above and do not need a new
    // authored record. Only previously failing rooms enter the treatment set.
    if (solved.solution?.gate.gatePass && snapshot.observedGate?.gatePass !== true) {
      solutions.set(scenarioId, solved.solution);
    }
    process.stdout.write(`staging-solver: ${scenarioId} gate=${String(solved.row.predictedGate?.gatePass ?? false)} solveMs=${String(solved.row.solveMs)}\n`);
  }
  if (args.retainedOnly) {
    for (const [scenarioId] of [...solutions]) {
      if (AUTHORED_STAGING_SOLUTIONS[scenarioId]) continue;
      solutions.delete(scenarioId);
      const snapshot = snapshots.get(scenarioId);
      const row = rows.get(scenarioId);
      if (snapshot && row) restoreObservedBaseline(row, snapshot);
    }
  }
  const publicBackups = args.apply ? backupPublicBundles(solutions.keys()) : new Map();
  if (args.apply) {
    await applySolutions(solutions.keys(), solutions);
  }
  if (args.capture) {
    await captureReal(args.cases, rows, solutions);
    if (args.apply) {
      const accepted = new Map([...solutions].filter(([scenarioId]) => rows.get(scenarioId)?.realGate?.gatePass === true));
      if (accepted.size !== solutions.size) {
        const rejected = [...solutions.keys()].filter((scenarioId) => !accepted.has(scenarioId));
        for (const scenarioId of solutions.keys()) {
          if (accepted.has(scenarioId)) continue;
          const snapshot = snapshots.get(scenarioId);
          const row = rows.get(scenarioId);
          if (snapshot && row) restoreObservedBaseline(row, snapshot);
        }
        process.stdout.write(`staging-solver: live promotion accepted ${String(accepted.size)}/${String(solutions.size)} candidates; restoring rejected baselines\n`);
        restorePublicBundles(publicBackups, rejected);
        await applySolutions(accepted.keys(), accepted);
        await captureReal(args.cases, rows, accepted);
      }
    }
  }
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const report = {
    schemaVersion: "openclinxr.staging-solver-results.v1",
    parityTolerance: { visibilityActors: 0, containmentActors: 0, nearFraction: 1 / 144,
      source: "one 16x9 ray cell; counts are exact integers" },
    cases: Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(path.join(OUTPUT_ROOT, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const mismatches = [...rows.values()].filter((row) => row.parity
    && (row.parity.visibilityDelta > 0 || row.parity.containmentDelta > 0 || row.parity.nearDelta > 1 / 144));
  for (const row of mismatches) process.stderr.write(`staging-solver: PARITY MISMATCH ${row.scenarioId} ${JSON.stringify(row.parity)}\n`);
  if (mismatches.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
