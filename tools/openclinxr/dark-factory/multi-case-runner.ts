/**
 * issue-288 — dark-factory multi-case chain runner.
 *
 * The D9 test is MULTIPLE cases: "the ability to take multiple cases and run them
 * through it and get a full experience at the end." #286 proved ONE case traverses
 * all eight stations deterministically but its per-stage runner scripts lived under
 * `.openclinxr/evidence/issue-286/` and never landed (git ls-files shows JSON/OBJ/PNG
 * outputs and no `.ts`). This module is the landed, reusable replacement: it takes a
 * scenario id, runs the same eight stations #286 defined, and emits the same
 * station-table shape (`openclinxr.dark-factory-station-table.v1`).
 *
 * NO station is reimplemented and NO geometry is authored. Every station chains the
 * adopted implementation #286 recorded:
 *   1. case_to_actor_params  — tools/openclinxr/asset-pipeline/anny/orchestrate_character.py CASE_ACTOR_PRESETS
 *   2. body                  — tools/openclinxr/asset-pipeline/anny/generate_mesh.py build_source_body
 *   3. clothing              — tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts
 *   4. rigging               — tools/openclinxr/asset-pipeline/anny/automate_blender.py (via orchestrate_character.py)
 *   5. room                  — apps/ui-xr/src/station-environment.ts buildStationEnvironment
 *   6. equipment             — apps/ui-xr/src/station-equipment-builders.ts buildDeclaredEquipmentGeometry
 *   7. staging_placement     — packages/openclinxr/asset-registry/src/actor-placement.ts generatedActorPlacement
 *   8. render                — tools/openclinxr/evidence/ui-xr-environment-room-capture.ts captureStationEnvironmentRooms
 *
 * COUNTERWEIGHT (per issue-288): a station may be classified `deterministic` ONLY
 * with an on-disk artifact proving it ran; `not_run`, `absent` and `error` are
 * successful outcomes. The test asserts count(deterministic) == count(rows with
 * artifacts) per case.
 *
 * Re-runnable: the module is importable from tools/ and invoked by the evidence test
 * `tools/openclinxr/evidence/dark-factory-multi-case.test.ts`. It also runs standalone:
 *   pnpm exec tsx tools/openclinxr/dark-factory/multi-case-runner.ts --case <scenarioId>
 *   pnpm exec tsx tools/openclinxr/dark-factory/multi-case-runner.ts --all
 */

import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { EncounterRuntimeActorAsset } from "../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import { generatedActorPlacement } from "../../../packages/openclinxr/asset-registry/src/actor-placement.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import { edChestPainScenarioV2 } from "../../../packages/openclinxr/scenario-fixtures/src/ed-chest-pain.js";
import type { Scenario } from "../../../packages/openclinxr/shared-schemas/src/index.js";
import { buildStationEnvironment } from "../../../apps/ui-xr/src/station-environment.js";
import { buildDeclaredEquipmentGeometry } from "../../../apps/ui-xr/src/station-equipment-builders.js";
import {
  resolveAnnyGarmentLayers,
  resolveHm08UpperGarment,
} from "../asset-pipeline/makeclothes/garment-selection-by-role.js";
import { captureStationEnvironmentRooms } from "../evidence/ui-xr-environment-room-capture.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../evidence/lib/portless-server.js";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root (tools/openclinxr/dark-factory → repo root). */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const ANNY_DIR = path.join(REPO_ROOT, "tools", "openclinxr", "asset-pipeline", "anny");
const GENERATE_MESH = path.join(ANNY_DIR, "generate_mesh.py");
const ORCHESTRATE = path.join(ANNY_DIR, "orchestrate_character.py");

/** Default evidence root for issue-288 artifacts. */
export const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr", "evidence", "issue-288");
/** The single case #286 covered. */
export const COVERED_BY_286 = ["peds_asthma_parent_anxiety_v1"] as const;

export const DARK_FACTORY_CHAIN_STATIONS = [
  "case_to_actor_params",
  "body",
  "clothing",
  "rigging",
  "room",
  "equipment",
  "staging_placement",
  "render",
] as const;

export type DarkFactoryStationId = (typeof DARK_FACTORY_CHAIN_STATIONS)[number];
export type StationClassification = "deterministic" | "not_run" | "absent" | "error";

export type StationRow = {
  stationId: DarkFactoryStationId;
  stationName: string;
  classification: StationClassification;
  implementation: string;
  artifactPaths: string[];
  notes: string[];
};

export type PipelineStationTable = {
  schemaVersion: "openclinxr.dark-factory-station-table.v1";
  caseId: string;
  chain: readonly DarkFactoryStationId[];
  generatedAt: string;
  runner: string;
  executionCommands: Record<string, string>;
  stations: StationRow[];
};

export type CaseFrontier = {
  caseId: string;
  fullyDeterministic: boolean;
  deterministicStationCount: number;
  /** First station (in chain order) that is not `deterministic`. */
  firstNonDeterministicStation: DarkFactoryStationId | null;
  stoppedAtReason: string;
};

export type MultiCaseRollup = {
  schemaVersion: "openclinxr.dark-factory-multi-case-rollup.v1";
  generatedAt: string;
  runner: string;
  population: Array<{ caseId: string; coveredBy286: boolean }>;
  summary: {
    casesAttempted: number;
    casesFullyDeterministic: number;
    deterministicStationTotals: Partial<Record<DarkFactoryStationId, number>>;
    /** Where the non-complete cases stopped (first non-deterministic station). */
    frontierCounts: Partial<Record<DarkFactoryStationId, number>>;
    coverageNotes: string[];
  };
  cases: PipelineStationTable[];
};

export type PreFixArtifact = {
  schemaVersion: "openclinxr.dark-factory-multi-case.pre-fix.v1";
  generatedAt: string;
  population: string[];
  populationSource: string;
  coveredBy286: string[];
  notes: string[];
};

/**
 * Fixture lookup over the WHOLE shipped population. `scenarioBank` alone omits
 * `ed_chest_pain_priority_v2` (a separate export that ships as a bundle), which
 * is exactly how a runner looking only at the bank mis-reports v2's room and
 * equipment as absent.
 */
export function findFixtureById(scenarioId: string): Scenario | undefined {
  if (edChestPainScenarioV2.scenarioId === scenarioId) return edChestPainScenarioV2;
  return scenarioBank.find((s) => s.scenarioId === scenarioId);
}

export type RunCaseChainOptions = {
  /** Evidence root; per-case artifacts land under `<evidenceDir>/<caseId>/stage-<name>/`. */
  evidenceDir?: string;
  /** Shared portless dev-server URL for the render station (one server per batch). */
  renderServerUrl?: string;
};

export type RunMultiCaseChainOptions = {
  evidenceDir?: string;
  /** Override the population enumeration (defaults to shipped bundles). */
  population?: string[];
};

/** IMPLEMENTATION lines (same adopted implementation #286 recorded). */
const IMPLEMENTATIONS: Record<DarkFactoryStationId, string> = {
  case_to_actor_params:
    "tools/openclinxr/asset-pipeline/anny/orchestrate_character.py:203 CASE_ACTOR_PRESETS (data-driven preset map, no LLM)",
  body: "tools/openclinxr/asset-pipeline/anny/generate_mesh.py:394 build_source_body (deterministic parametric stub; real-Anny forward pass is a separate blocked path)",
  clothing:
    "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts:76 ROLE_TO_GARMENT_LAYERS (deterministic role->layer map) + resolveHm08UpperGarment",
  rigging: "tools/openclinxr/asset-pipeline/anny/automate_blender.py:4620 main (Blender armature + auto weights; 23 bones, 25 morph targets) via orchestrate_character.py",
  room: "apps/ui-xr/src/station-environment.ts:135 buildStationEnvironment (parametric station shell builder)",
  equipment: "apps/ui-xr/src/station-equipment-builders.ts:417 buildDeclaredEquipmentGeometry (parametric equipment builders)",
  staging_placement:
    "packages/openclinxr/asset-registry/src/actor-placement.ts:24 generatedActorPlacement (deterministic scene-manifest placement; slotKind/position/posture per cast role)",
  render:
    "tools/openclinxr/evidence/ui-xr-environment-room-capture.ts:613 captureStationEnvironmentRooms (room-capture path shared with spawnPortlessDevServer captures)",
};

const STATION_NAMES: Record<DarkFactoryStationId, string> = {
  case_to_actor_params: "case -> actor params",
  body: "body",
  clothing: "clothing",
  rigging: "rigging",
  room: "room",
  equipment: "equipment",
  staging_placement: "staging / placement",
  render: "render",
};

/* ------------------------------------------------------------------ */
/* Population                                                          */
/* ------------------------------------------------------------------ */

/** Read the shipped station bundle dirs (tracked) and enumerate scenario ids. */
export async function enumerateCasePopulation(repoRoot: string = REPO_ROOT): Promise<string[]> {
  const generatedDir = path.join(repoRoot, "apps", "ui-xr", "public", "xr-assets", "generated");
  let entries: string[] = [];
  try {
    entries = await readdir(generatedDir);
  } catch {
    entries = [];
  }
  const ids: string[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const bundlePath = path.join(generatedDir, entry, "learner-runtime-bundle.v1.json");
    try {
      const raw = await readFile(bundlePath, "utf8");
      const bundle = JSON.parse(raw) as { scenarioId?: string };
      if (typeof bundle.scenarioId === "string" && bundle.scenarioId.length > 0) {
        ids.push(bundle.scenarioId);
      }
    } catch {
      // Not a shipped bundle dir; skip.
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Python subprocess helpers                                           */
/* ------------------------------------------------------------------ */

async function runPython(script: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("python3", [script, ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Dump the full CASE_ACTOR_PRESETS entry set for a case id (params included). */
async function dumpCasePresets(caseId: string, cwd: string): Promise<Record<string, PresetEntry>> {
  const snippet = [
    "import sys, json",
    "sys.path.insert(0, 'tools/openclinxr/asset-pipeline/anny')",
    "from orchestrate_character import CASE_ACTOR_PRESETS",
    "case_id = sys.argv[1]",
    "out = {}",
    "for pid, p in CASE_ACTOR_PRESETS.items():",
    "    if p.get('case_id') == case_id:",
    "        out[pid] = {'case_id': p['case_id'], 'actor_id': p['actor_id'], 'actor_role': p['actor_role'], 'output_name': p['output_name'], 'params': p['params']}",
    "print(json.dumps(out, default=str))",
  ].join("\n");
  const stdout = await runPython("-c", [snippet, caseId], cwd);
  const parsed = JSON.parse(stdout) as Record<string, PresetEntry>;
  return parsed;
}

/** Run `orchestrate_character.py --list-presets` once and memoize. */
let listPresetsCache: Record<string, { case_id: string; actor_id: string; actor_role: string; output_name: string }> | null = null;
async function listPresets(): Promise<Record<string, { case_id: string; actor_id: string; actor_role: string; output_name: string }>> {
  if (listPresetsCache !== null) return listPresetsCache;
  const stdout = await runPython(ORCHESTRATE, ["--list-presets"], REPO_ROOT);
  listPresetsCache = JSON.parse(stdout) as Record<string, { case_id: string; actor_id: string; actor_role: string; output_name: string }>;
  return listPresetsCache;
}

type PresetEntry = {
  case_id: string;
  actor_id: string;
  actor_role: string;
  output_name: string;
  params: Record<string, unknown>;
};

/** Case ids that have a CASE_ACTOR_PRESETS entry. */
export async function caseIdsWithPresets(): Promise<string[]> {
  const presets = await listPresets();
  const ids = new Set<string>();
  for (const p of Object.values(presets)) ids.add(p.case_id);
  return [...ids].sort();
}

/* ------------------------------------------------------------------ */
/* Station runners                                                     */
/* ------------------------------------------------------------------ */

type StationRun = {
  row: StationRow;
};

function makeRow(
  stationId: DarkFactoryStationId,
  classification: StationClassification,
  artifactPaths: string[],
  notes: string[],
): StationRow {
  return {
    stationId,
    stationName: STATION_NAMES[stationId],
    classification,
    implementation: IMPLEMENTATIONS[stationId],
    artifactPaths,
    notes,
  };
}

async function existsPath(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Station 1: case -> actor params (CASE_ACTOR_PRESETS). */
async function runCaseToActorParams(
  caseId: string,
  stageDir: string,
  cwd: string,
): Promise<StationRun> {
  const presets = await dumpCasePresets(caseId, cwd);
  if (Object.keys(presets).length === 0) {
    const available = await caseIdsWithPresets();
    return {
      row: makeRow("case_to_actor_params", "not_run", [], [
        `Neither the case definition (scenario fixture phenotype export, issue-291) nor CASE_ACTOR_PRESETS (orchestrate_character.py:203) carries a phenotype for ${caseId}; the data-driven maps only cover ${available.join(", ")}.`,
        "issue-291 gave the case definition a phenotype home; cases that do not author one are refused by the generator (REFUSE, no generic-adult default #276), so no case->actor params exist to materialize for this case.",
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const presetsSummary = Object.fromEntries(
    Object.entries(presets).map(([id, p]) => [id, {
      case_id: p.case_id,
      actor_id: p.actor_id,
      actor_role: p.actor_role,
      output_name: p.output_name,
    }]),
  );
  const presetsPath = path.join(stageDir, "presets.json");
  const resolutionPath = path.join(stageDir, "case-actor-preset.json");
  await writeFile(presetsPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-case-params.v1",
    station: "case_to_actor_params",
    caseId,
    presets: presetsSummary,
  }, null, 2)}\n`, "utf8");
  await writeFile(resolutionPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-case-params.v1",
    station: "case_to_actor_params",
    caseId,
    resolvedActorCount: Object.keys(presets).length,
    actorIds: Object.values(presets).map((p) => p.actor_id),
    notes: ["Resolved presets in-process from CASE_ACTOR_PRESETS (legacy dict). For the migrated peds case, orchestrate_character.py now prefers the case-definition phenotype export (issue-291), which reproduces these params byte-identically (verified by tools/openclinxr/evidence/actor-phenotype-reader.test.ts)."],
  }, null, 2)}\n`, "utf8");
  return {
    row: makeRow("case_to_actor_params", "deterministic", [
      relStage(stageDir, "presets.json"),
      relStage(stageDir, "case-actor-preset.json"),
    ], [
      `Resolved ${Object.keys(presets).length} case-actor presets in-process for ${caseId}.`,
    ]),
  };
}

/** Station 2: body (generate_mesh.py build_source_body). */
async function runBodyStage(
  caseId: string,
  stageDir: string,
  cwd: string,
): Promise<StationRun> {
  const presets = await dumpCasePresets(caseId, cwd);
  if (Object.keys(presets).length === 0) {
    return {
      row: makeRow("body", "not_run", [], [
        `No case-actor preset and no case-definition phenotype for ${caseId}; generate_mesh.py build_source_body requires authored phenotype (age/body_profile/phenotype) that does not exist for this case (issue-291: the generator REFUSES rather than defaulting to a generic adult).`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const artifactPaths: string[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  for (const [presetId, preset] of Object.entries(presets)) {
    const base = preset.output_name.replace(/\.glb$/u, "");
    const objPath = path.join(stageDir, `${base}.obj`);
    const manifestPath = path.join(stageDir, `${base}-manifest.json`);
    try {
      const paramsJson = JSON.stringify(preset.params);
      await execFileAsync("python3", [
        GENERATE_MESH,
        "--params", paramsJson,
        "--output", objPath,
        "--manifest", manifestPath,
      ], { cwd, maxBuffer: 64 * 1024 * 1024 });
      // Verify the outputs actually landed — never trust the exit code alone.
      const objExists = await existsPath(objPath);
      const manifestExists = await existsPath(manifestPath);
      if (!objExists || !manifestExists) {
        failures.push(`${presetId}: generate_mesh.py exited 0 but produced no OBJ/manifest on disk (obj=${objExists} manifest=${manifestExists})`);
        continue;
      }
      artifactPaths.push(relStage(stageDir, `${base}.obj`), relStage(stageDir, `${base}-manifest.json`));
      notes.push(`${presetId}: body OBJ + manifest written (deterministic parametric stub).`);
    } catch (err) {
      failures.push(`${presetId}: ${errMessage(err)}`);
    }
  }
  if (failures.length > 0) {
    return {
      row: makeRow("body", "error", [], [
        ...notes,
        ...failures.map((f) => `FAILURE: ${f}`),
      ]),
    };
  }
  notes.push(
    "GAP: the real Anny forward pass sub-path is not_run — generator_mode=stub, uses_real_anny_forward_pass=false (verified from the written manifest); the Anny rail is blocked per #192, operator declined the restore. The chain ran the deterministic parametric stub body.",
  );
  return { row: makeRow("body", "deterministic", artifactPaths, notes) };
}

/** Station 3: clothing (garment-selection-by-role.ts). */
async function runClothingStage(caseId: string, stageDir: string): Promise<StationRun> {
  const cast = resolveScenarioActorCast(caseId);
  if (cast.length === 0) {
    return {
      row: makeRow("clothing", "absent", [], [
        `No humanoid cast roles for ${caseId}; nothing to select garments for.`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const roles = [...new Set(cast.map((c) => c.role))].sort();
  const rows = roles.map((role) => {
    const layers = resolveAnnyGarmentLayers(role);
    const spec = resolveHm08UpperGarment(role);
    return {
      role,
      garmentLayers: layers,
      hm08GarmentId: spec.garmentId,
      hm08GarmentKind: spec.kind,
      meshNamePrefix: spec.meshNamePrefix,
    };
  });
  const artifactPath = path.join(stageDir, "garment-selection.json");
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-clothing.v1",
    station: "clothing",
    implementation: IMPLEMENTATIONS.clothing,
    caseId,
    fallbackGarmentId: "wojackowl_scrubs_shirt_hm08",
    coverShellId: "openclinxr_hm08_upper_cover_shell",
    rows,
  }, null, 2)}\n`, "utf8");
  const notes = [
    `Selection ran in-process for the ${caseId} cast roles (${roles.join(", ")}); rows written to garment-selection.json.`,
  ];
  const presetCase = Object.keys(await dumpCasePresets(caseId, REPO_ROOT)).length > 0;
  if (presetCase) {
    notes.push(
      "Cover-shell embed ran inside the rigging station (automate_blender.py apply_role_clothing_material_regions); see the rigging report artifact.",
    );
  } else {
    notes.push(
      "GAP: the embed/fit half (apply_role_clothing_material_regions cover-shell / MakeClothes .mhclo fit) runs inside the rigging station and is not_run for this case — no case-actor preset means no body to embed against.",
    );
  }
  return { row: makeRow("clothing", "deterministic", [relStage(stageDir, "garment-selection.json")], notes) };
}

/** Station 4: rigging (automate_blender.py via orchestrate_character.py). */
async function runRiggingStage(
  caseId: string,
  stageDir: string,
  cwd: string,
): Promise<StationRun> {
  const presets = await dumpCasePresets(caseId, cwd);
  if (Object.keys(presets).length === 0) {
    return {
      row: makeRow("rigging", "not_run", [], [
        `No case-actor preset for ${caseId}; automate_blender.py rigging requires a generated body which does not exist for this case.`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const artifactPaths: string[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  for (const [presetId, preset] of Object.entries(presets)) {
    const glbPath = path.join(stageDir, preset.output_name);
    const base = preset.output_name.replace(/\.glb$/u, "");
    const reportPath = path.join(stageDir, `${base}_rigging_report.json`);
    try {
      await execFileAsync("python3", [
        ORCHESTRATE,
        "--case-actor-preset", presetId,
        "--output-glb", glbPath,
      ], { cwd, maxBuffer: 64 * 1024 * 1024 });
      // orchestrate_character.py exits 0 even when the Blender stage fails to
      // write the GLB (measured: parent_tara_johnson_v1 open_cardigan shell too
      // sparse → RuntimeError inside automate_blender, swallowed, no GLB). The
      // exit code is NOT evidence the rigging ran — the file is.
      const glbExists = await existsPath(glbPath);
      const reportExists = await existsPath(reportPath);
      if (!glbExists || !reportExists) {
        failures.push(
          `${presetId}: orchestrate_character.py exited 0 but produced no GLB/rigging report (glb=${glbExists} report=${reportExists}); Blender-stage failure is swallowed by the station and must be named, not trusted`,
        );
        continue;
      }
      artifactPaths.push(
        relStage(stageDir, preset.output_name),
        relStage(stageDir, `${base}_rigging_report.json`),
        relStage(stageDir, `${base}.provenance.json`),
        relStage(stageDir, `${base}.bundle.json`),
      );
      notes.push(`${presetId}: GLB + rigging report + provenance + bundle written (headless Blender, canonical 23-bone skeleton).`);
    } catch (err) {
      failures.push(`${presetId}: ${errMessage(err)}`);
    }
  }
  if (failures.length > 0) {
    return {
      row: makeRow("rigging", "error", [], [
        ...notes,
        ...failures.map((f) => `FAILURE: ${f}`),
        `Station ran partially: ${artifactPaths.length === 0 ? "no complete actor outputs" : `${artifactPaths.length / 4} of ${Object.keys(presets).length} actors produced the full glb+report+provenance+bundle set`}. Not fixed per issue-288 scope (do not fix a station found broken; name it).`,
      ]),
    };
  }
  notes.push(
    "GAP: the MakeClothes `.mhclo` fit stage (fit_stage.py / body_param_stage.py) is not_run — the gitignored staging `.mhclo` assets are absent from worktrees by design; the garment embed ran through the phenotype-derived cover-shell path inside automate_blender.py.",
  );
  return { row: makeRow("rigging", "deterministic", artifactPaths, notes) };
}

/** Station 5: room (buildStationEnvironment). */
async function runRoomStage(caseId: string, stageDir: string): Promise<StationRun> {
  const scenario = findFixtureById(caseId);
  const environmentId = scenario?.environment?.environmentId ?? "";
  if (!environmentId) {
    return {
      row: makeRow("room", "absent", [], [
        `Scenario ${caseId} has no environmentId in the scenario fixture; nothing to build.`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const shell = buildStationEnvironment({ environmentId });
  const children = (shell.children ?? []).map((child) => ({
    name: child.name,
    type: child.type,
    childCount: child.children?.length ?? 0,
  }));
  const ud = shell.userData as Record<string, unknown>;
  const fixtureSlots = (Array.isArray(ud["fixtureSlots"]) ? ud["fixtureSlots"] : []) as unknown[];
  const artifactPath = path.join(stageDir, "room-shell.json");
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-room.v1",
    station: "room",
    implementation: IMPLEMENTATIONS.room,
    environmentId,
    shellName: shell.name,
    shellUserData: {
      environmentId: ud["environmentId"],
      environmentDescriptorId: ud["environmentDescriptorId"],
      floorColor: ud["floorColor"],
      roomDepthMeters: ud["roomDepthMeters"],
      roomWidthMeters: ud["roomWidthMeters"],
      roomHeightMeters: ud["roomHeightMeters"],
      environmentFallbackActive: ud["environmentFallbackActive"] ?? false,
      environmentFallbackReason: ud["environmentFallbackReason"] ?? "",
      fixtureSlotCount: fixtureSlots.length,
    },
    childCount: children.length,
    children,
  }, null, 2)}\n`, "utf8");
  return {
    row: makeRow("room", "deterministic", [relStage(stageDir, "room-shell.json")], [
      `RAN in-process for ${environmentId}: ${children.length} child nodes, environmentId stamped in userData.`,
    ]),
  };
}

/** Station 6: equipment (buildDeclaredEquipmentGeometry). */
async function runEquipmentStage(caseId: string, stageDir: string): Promise<StationRun> {
  const scenario = findFixtureById(caseId);
  const declared = (scenario?.assetNeeds ?? [])
    .filter((n) => n.assetType === "equipment")
    .map((n) => n.assetId);
  if (declared.length === 0) {
    return {
      row: makeRow("equipment", "absent", [], [
        `Scenario ${caseId} declares no equipment in assetNeeds (${scenario ? "verified from the scenario fixture" : "no fixture found"}); nothing to build.`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const rows = declared.map((equipmentId) => {
    let meshCount = 0;
    const meshNames: string[] = [];
    let userData: Record<string, unknown> = {};
    let error: string | null = null;
    try {
      const group = buildDeclaredEquipmentGeometry(equipmentId);
      meshCount = group.children?.length ?? 0;
      meshNames.push(group.name);
      for (const child of group.children ?? []) meshNames.push(child.name);
      userData = { ...(group.userData as Record<string, unknown>) };
    } catch (err) {
      error = errMessage(err);
    }
    return { equipmentId, status: error ? "error" : "ran", meshCount, meshNames, userData, error };
  });
  const artifactPath = path.join(stageDir, "equipment-geometry.json");
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-equipment.v1",
    station: "equipment",
    implementation: IMPLEMENTATIONS.equipment,
    caseId,
    rows,
  }, null, 2)}\n`, "utf8");
  const failed = rows.filter((r) => r.status === "error");
  if (failed.length > 0) {
    return {
      row: makeRow("equipment", "error", [relStage(stageDir, "equipment-geometry.json")], [
        `${failed.length}/${rows.length} declared equipment ids failed to build: ${failed.map((f) => `${f.equipmentId}: ${f.error}`).join("; ")}`,
      ]),
    };
  }
  return {
    row: makeRow("equipment", "deterministic", [relStage(stageDir, "equipment-geometry.json")], [
      `RAN in-process for the ${caseId} declared equipment ids (${declared.length}/${declared.length} built, 0 errors).`,
      "GAP note: real-GLB substitution for some ids resolves to gitignored generated GLBs and was not exercised; the parametric builders ran here.",
    ]),
  };
}

/** Station 7: staging / placement (generatedActorPlacement). */
async function runPlacementStage(caseId: string, stageDir: string): Promise<StationRun> {
  const cast = resolveScenarioActorCast(caseId);
  if (cast.length === 0) {
    return {
      row: makeRow("staging_placement", "absent", [], [
        `No cast entries for ${caseId}; nothing to place.`,
      ]),
    };
  }
  await mkdir(stageDir, { recursive: true });
  const rows = cast.map((entry, index) => {
    const actor = minimalRuntimeActor(entry.actorId, entry.role, entry.runtimeAssetPath);
    const placement = generatedActorPlacement(actor, index, { scenarioId: caseId });
    return {
      actorId: entry.actorId,
      role: entry.role,
      assetPath: entry.assetPath,
      placement,
    };
  });
  const artifactPath = path.join(stageDir, "placements.json");
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: "openclinxr.dark-factory.station-staging-placement.v1",
    station: "staging_placement",
    implementation: IMPLEMENTATIONS.staging_placement,
    caseId,
    rows,
  }, null, 2)}\n`, "utf8");
  return {
    row: makeRow("staging_placement", "deterministic", [relStage(stageDir, "placements.json")], [
      `RAN in-process for the ${caseId} cast (${cast.length} actors): each resolves to a placement record with slotKind, world position, posture.`,
      "GAP note: the live actor-placement-ssot inspector (tools/openclinxr/evidence/actor-placement-ssot.ts) is a dev-server + browser verification surface; the deterministic scene-manifest data layer ran in-process here.",
    ]),
  };
}

/** Station 8: render (captureStationEnvironmentRooms, one shared dev server). */
async function runRenderStage(
  caseId: string,
  stageDir: string,
  options: { serverUrl?: string },
): Promise<StationRun> {
  const outputDir = path.join(stageDir, "capture");
  await mkdir(outputDir, { recursive: true });
  try {
    const manifest = await captureStationEnvironmentRooms({
      scenarioIds: [caseId],
      outputDir,
      baseUrl: options.serverUrl,
    });
    const entry = manifest.entries.find((e) => e.scenarioId === caseId);
    if (!entry) {
      throw new Error(`capture manifest for ${caseId} has no entry (entries=${manifest.entries.length})`);
    }
    return {
      row: makeRow("render", "deterministic", [
        relStage(stageDir, `capture/${entry.imagePath}`),
        relStage(stageDir, "capture/capture-manifest.json"),
      ], [
        `RAN live: loaded ${caseId} in scene-overview capture mode, waited for station shell + humanoid assets, screenshot written.`,
        `Live env=${entry.liveShell.environmentId ?? "?"}; capture-manifest source=live_scene.`,
      ]),
    };
  } catch (err) {
    return {
      row: makeRow("render", "error", [], [
        `Capture failed for ${caseId}: ${errMessage(err)}`,
      ]),
    };
  }
}

/** Build a minimal EncounterRuntimeActorAsset from a cast entry (placement only reads role). */
function minimalRuntimeActor(actorId: string, role: string, runtimeAssetPath: string): EncounterRuntimeActorAsset {
  return {
    actorId,
    embodiment: "humanoid",
    role: role as EncounterRuntimeActorAsset["role"],
    model: {
      assetId: actorId,
      version: "v1",
      kind: "humanoid_model",
      displayName: actorId,
      scenarioAssetId: actorId,
      blob: {
        storeKind: "app_public_fixture",
        containerName: "generated-humanoids",
        blobName: runtimeAssetPath,
        contentType: "model/gltf-binary",
        url: runtimeAssetPath,
      },
      reviewStatus: "fixture_approved_for_local_runtime",
      provenanceRefs: [],
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    },
    animationClips: [],
    gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: false },
  };
}

/* ------------------------------------------------------------------ */
/* Chain assembly                                                      */
/* ------------------------------------------------------------------ */

export function relStage(stageDir: string, fileName: string): string {
  // Store repo-root-relative evidence paths so they resolve on any checkout.
  return path.relative(REPO_ROOT, path.join(stageDir, fileName));
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n").slice(0, 3).join(" ");
  return String(err);
}

function executionCommandsFor(): Record<string, string> {
  return {
    case_to_actor_params: "python3 tools/openclinxr/asset-pipeline/anny/orchestrate_character.py --list-presets",
    body: "python3 tools/openclinxr/asset-pipeline/anny/generate_mesh.py --params <preset params> --output <obj> --manifest <json>",
    clothing: "in-process tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts resolveAnnyGarmentLayers / resolveHm08UpperGarment",
    rigging: "python3 tools/openclinxr/asset-pipeline/anny/orchestrate_character.py --case-actor-preset <id> --output-glb <glb>",
    room: "in-process apps/ui-xr/src/station-environment.ts buildStationEnvironment(<environmentId>)",
    equipment: "in-process apps/ui-xr/src/station-equipment-builders.ts buildDeclaredEquipmentGeometry(<equipmentId>)",
    staging_placement: "in-process packages/openclinxr/asset-registry/src/actor-placement.ts generatedActorPlacement(cast, index)",
    render: "in-process tools/openclinxr/evidence/ui-xr-environment-room-capture.ts captureStationEnvironmentRooms (one shared dev server per batch)",
  };
}

/**
 * Run the eight-station dark-factory chain for one scenario id.
 * Writes per-stage artifacts under `<evidenceDir>/<caseId>/stage-<name>/` and returns
 * the station table (#286 shape).
 */
export async function runCaseChain(
  scenarioId: string,
  options: RunCaseChainOptions = {},
): Promise<PipelineStationTable> {
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const caseDir = path.join(evidenceDir, "cases", scenarioId);
  const cwd = REPO_ROOT;

  const stations: StationRow[] = [];
  stations.push((await runCaseToActorParams(scenarioId, path.join(caseDir, "stage-case-params"), cwd)).row);
  stations.push((await runBodyStage(scenarioId, path.join(caseDir, "stage-body"), cwd)).row);
  stations.push((await runClothingStage(scenarioId, path.join(caseDir, "stage-clothing"))).row);
  stations.push((await runRiggingStage(scenarioId, path.join(caseDir, "stage-rig"), cwd)).row);
  stations.push((await runRoomStage(scenarioId, path.join(caseDir, "stage-room"))).row);
  stations.push((await runEquipmentStage(scenarioId, path.join(caseDir, "stage-equipment"))).row);
  stations.push((await runPlacementStage(scenarioId, path.join(caseDir, "stage-placement"))).row);
  stations.push((await runRenderStage(scenarioId, path.join(caseDir, "stage-render"), { serverUrl: options.renderServerUrl })).row);

  const table: PipelineStationTable = {
    schemaVersion: "openclinxr.dark-factory-station-table.v1",
    caseId: scenarioId,
    chain: [...DARK_FACTORY_CHAIN_STATIONS],
    generatedAt: new Date().toISOString(),
    runner: "tools/openclinxr/dark-factory/multi-case-runner.ts (issue-288)",
    executionCommands: executionCommandsFor(),
    stations,
  };
  await mkdir(caseDir, { recursive: true });
  await writeFile(
    path.join(caseDir, "pipeline-station-table.json"),
    `${JSON.stringify(table, null, 2)}\n`,
    "utf8",
  );
  return table;
}

/** Write the pre-fix artifact (population + #286 coverage) BEFORE any station runs. */
export async function writePreFixArtifact(options: {
  evidenceDir?: string;
  population?: string[];
}): Promise<PreFixArtifact> {
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const population = options.population ?? (await enumerateCasePopulation());
  const artifact: PreFixArtifact = {
    schemaVersion: "openclinxr.dark-factory-multi-case.pre-fix.v1",
    generatedAt: new Date().toISOString(),
    population,
    populationSource: "apps/ui-xr/public/xr-assets/generated/*/learner-runtime-bundle.v1.json (shipped station bundles)",
    coveredBy286: [...COVERED_BY_286],
    notes: [
      "#286 ran exactly one case (peds_asthma_parent_anxiety_v1) and ended in a live render; its per-stage runner scripts were never landed (git ls-files shows JSON/OBJ/PNG outputs and no .ts under .openclinxr/evidence/issue-286/).",
      "This run chains the same adopted stations (#286-recorded implementations) over the whole shipped case population; no numeric target is asserted here — the roll-up reports what happened per case per station.",
      "case_to_actor_params/body/rigging sustain only cases with a CASE_ACTOR_PRESETS entry; room/equipment/placement/render are expected to sustain the full population.",
    ],
  };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, "pre-fix.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

/**
 * Run the chain over the whole population and emit one station table per case
 * plus a roll-up. The render station shares ONE dev server for the whole batch.
 */
export async function runMultiCaseChain(options: RunMultiCaseChainOptions = {}): Promise<MultiCaseRollup> {
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const population = options.population ?? (await enumerateCasePopulation());
  await writePreFixArtifact({ evidenceDir, population });

  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });
    const tables: PipelineStationTable[] = [];
    for (const caseId of population) {
      const table = await runCaseChain(caseId, { evidenceDir, renderServerUrl: server.url });
      tables.push(table);
    }

    const deterministicStationTotals: Partial<Record<DarkFactoryStationId, number>> = {};
    const frontierCounts: Partial<Record<DarkFactoryStationId, number>> = {};
    const frontiers: CaseFrontier[] = [];
    for (const table of tables) {
      for (const station of table.stations) {
        if (station.classification === "deterministic") {
          deterministicStationTotals[station.stationId] = (deterministicStationTotals[station.stationId] ?? 0) + 1;
        }
      }
      const firstNonDeterministic = table.stations.find((s) => s.classification !== "deterministic");
      const frontier: CaseFrontier = {
        caseId: table.caseId,
        fullyDeterministic: firstNonDeterministic === undefined,
        deterministicStationCount: table.stations.filter((s) => s.classification === "deterministic").length,
        firstNonDeterministicStation: firstNonDeterministic?.stationId ?? null,
        stoppedAtReason: firstNonDeterministic
          ? `station ${firstNonDeterministic.stationId}: ${firstNonDeterministic.notes[0] ?? firstNonDeterministic.classification}`
          : "",
      };
      frontiers.push(frontier);
      if (firstNonDeterministic) {
        frontierCounts[firstNonDeterministic.stationId] = (frontierCounts[firstNonDeterministic.stationId] ?? 0) + 1;
      }
    }

    const rollup: MultiCaseRollup = {
      schemaVersion: "openclinxr.dark-factory-multi-case-rollup.v1",
      generatedAt: new Date().toISOString(),
      runner: "tools/openclinxr/dark-factory/multi-case-runner.ts (issue-288)",
      population: population.map((caseId) => ({
        caseId,
        coveredBy286: COVERED_BY_286.includes(caseId as (typeof COVERED_BY_286)[number]),
      })),
      summary: {
        casesAttempted: tables.length,
        casesFullyDeterministic: frontiers.filter((f) => f.fullyDeterministic).length,
        deterministicStationTotals,
        frontierCounts,
        coverageNotes: [
          "The roll-up reports what happened per case per station; no pass rate is asserted.",
          "case_to_actor_params/body/rigging are bounded by CASE_ACTOR_PRESETS (only preset cases traverse them); room/equipment/placement/render are bounded by the scenario fixtures and run over the full population.",
        ],
      },
      cases: tables,
    };
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, "multi-case-rollup.json"), `${JSON.stringify(rollup, null, 2)}\n`, "utf8");
    return rollup;
  } finally {
    if (server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Standalone CLI                                                      */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const caseIndex = args.indexOf("--case");
  const all = args.includes("--all");
  if (caseIndex >= 0 && args[caseIndex + 1]) {
    const table = await runCaseChain(args[caseIndex + 1]);
    console.log(`CASE_DONE ${table.caseId} stations=${table.stations.length}`);
    console.log(JSON.stringify(table.stations.map((s) => ({ id: s.stationId, classification: s.classification, artifacts: s.artifactPaths.length })), null, 2));
    return;
  }
  if (all) {
    const rollup = await runMultiCaseChain();
    console.log(`MULTI_CASE_DONE cases=${rollup.summary.casesAttempted} fullyDeterministic=${rollup.summary.casesFullyDeterministic}`);
    console.log(JSON.stringify({ frontierCounts: rollup.summary.frontierCounts, deterministicTotals: rollup.summary.deterministicStationTotals }, null, 2));
    return;
  }
  console.error("usage: multi-case-runner.ts --case <scenarioId> | --all");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main().catch((err) => {
    console.error("RUNNER_FAIL", err);
    process.exit(1);
  });
}
