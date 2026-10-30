// Alternative to MakeClothes mhclo hair; pack not vendored.
// Not evidence of a worn-headset or clinical claim.
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { factoryStationSchemas } from "@openclinxr/factory-station-core/runner";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import type { StationPlanResult, StationRunner } from "@openclinxr/factory-station-core/runner";
import { spawnBlenderProcess } from "@openclinxr/factory-station-core/runner";
import { planHairEditor } from "./plan.js";

export const HAIR_EDITOR_STAGE_REL = "packages/openclinxr/factory-stations/src/hair_editor/apply_hair_editor.py";
export const HAIR_EDITOR_BLEND_ENV = "OPENCLINXR_HAIR_EDITOR_BLEND";
export const HAIR_EDITOR_STOP_REASON = "install Hair editor pack";

export function planHairEditorStation(input: unknown): StationPlanResult {
  const checked = factoryStationSchemas.hair_editor["~standard"].validate(input);
  if (checked.issues !== undefined) return checked;
  const plan = planHairEditor(checked.value as { actorId: string; family: string; hairAsset: string; targetReadJson: string; round: number });
  if ((plan["status"] as string) === "issues") {
    return { issues: ((plan["issues"] as string[]) ?? []).map((message) => ({ message })) };
  }
  return {
    value: checked.value,
    plan: {
      mode: "dry-run",
      stationId: "hair_editor",
      ...plan,
      bakerId: "hair_editor",
      stageId: "hair_editor",
      stageScript: path.join(repoRoot(), HAIR_EDITOR_STAGE_REL),
      stageScriptRel: HAIR_EDITOR_STAGE_REL,
      processIsolation: "fresh_subprocess",
    },
  };
}

export async function runHairEditor(input: unknown): Promise<Record<string, unknown>> {
  const planned = planHairEditorStation(input);
  if (planned.issues !== undefined) {
    return { stationId: "hair_editor", status: "issues", stop: true, issues: planned.issues, plan: null };
  }
  const blendPath = process.env[HAIR_EDITOR_BLEND_ENV];
  if (blendPath === undefined || blendPath.length === 0 || !existsSync(blendPath)) {
    return {
      stationId: "hair_editor",
      status: "blocked",
      stop: true,
      stop_reason: HAIR_EDITOR_STOP_REASON,
      plan: planned.plan,
    };
  }
  const tmpFile = path.join(os.tmpdir(), `hair-editor-plan-${process.pid}.json`);
  writeFileSync(tmpFile, JSON.stringify(planned.plan), "utf8");
  const rawInput = (input ?? {}) as { outDir?: unknown; targetReadJson?: unknown };
  const macrosFile = path.join(os.tmpdir(), `hair-editor-macros-${process.pid}.json`);
  let macrosJson = "{}";
  try {
    const parsed = JSON.parse(String(rawInput.targetReadJson ?? "{}")) as { macros?: unknown };
    if (parsed.macros !== undefined) macrosJson = JSON.stringify(parsed.macros);
  } catch {
    macrosJson = "{}";
  }
  writeFileSync(macrosFile, macrosJson, "utf8");
  const outDir = typeof rawInput.outDir === "string" && rawInput.outDir.length > 0
    ? rawInput.outDir
    : path.join(os.tmpdir(), `hair-editor-out-${process.pid}`);
  const stageScript = path.join(repoRoot(), HAIR_EDITOR_STAGE_REL);
  const result = await spawnBlenderProcess("blender", ["--background", "--python", stageScript, "--", "--apply", "--plan", tmpFile, "--macros", macrosFile, "--out", outDir, "--blend", blendPath], {
    cwd: repoRoot(),
    timeoutMs: 600_000,
  });
  return {
    stationId: "hair_editor",
    status: result.code === 0 ? "applied" : "failed",
    stop: true,
    plan: planned.plan,
    blenderExit: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export const hairEditorRunner: StationRunner = {
  stationId: "hair_editor",
  validate: (value) => factoryStationSchemas.hair_editor["~standard"].validate(value),
  plan: planHairEditorStation,
  run: (value) => runHairEditor(value),
};
