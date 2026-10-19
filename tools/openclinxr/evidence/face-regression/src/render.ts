/**
 * Render resolution for the whole-face regression check.
 *
 * For each case the check reads case-inputs.json + case-run-report.json, takes
 * the latest run whose status is "completed", and derives:
 *   - GLB = the stage-4 lid-conform GLB output of that run;
 *   - skinOverride.baseColor = the stage-3 final albedo;
 *   - normal + roughness from the same run dir.
 * Every input is re-hashed and refused on mismatch with the record BEFORE any
 * render. A case with no completed run is listed "absent" — there is no
 * substitute.
 *
 * The actual portrait is produced by the existing skin-realism capture tool
 * (spawned, never copied/forked) with an explicit --glb: without it that tool
 * silently renders the shipped apps/ui-xr Aisha GLB. The tool's output JSON
 * glb.sha256 is asserted equal to the record sha, so a stale GLB cannot render
 * unrecognised.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export const CAPTURE_TOOL = "tools/openclinxr/evidence/skin-realism/runtime-portrait-capture.ts";

export type RunRecord = {
  status: string;
  stages?: Array<{ stage?: number; name?: string; outputs?: Array<{ path?: string; sha256?: string }> }>;
  outputs?: Array<{ path?: string; sha256?: string }>;
};

export type CaseRunReport = { cases: Record<string, { runs: Record<string, RunRecord> }> };

export type CaseRunResolution =
  | { status: "ok"; caseId: string; runId: string; reason: string }
  | { status: "absent"; caseId: string; reason: string }
  | { status: "refused"; caseId: string; reason: string };

/** Latest run with status "completed" (highest trailing run-number, else last key). */
export function pickLatestCompletedRun(runs: Record<string, RunRecord>): { runId: string; run: RunRecord } | null {
  const completed = Object.entries(runs).filter(([, r]) => r?.status === "completed");
  if (completed.length === 0) return null;
  const num = (k: string): number => {
    const m = /(\d+)\s*$/.exec(k);
    return m ? Number(m[1]) : -1;
  };
  completed.sort((a, b) => num(a[0]) - num(b[0]));
  const [runId, run] = completed[completed.length - 1]!;
  return { runId, run };
}

export function resolveCaseRun(input: {
  caseId: string;
  caseIds?: string[];
  runReport: CaseRunReport;
}): CaseRunResolution {
  const { caseId } = input;
  if (input.caseIds && !input.caseIds.includes(caseId)) {
    return { status: "refused", caseId, reason: `refused: ${caseId} is not a case in case-inputs.json` };
  }
  const runs = input.runReport.cases?.[caseId]?.runs ?? {};
  const picked = pickLatestCompletedRun(runs);
  if (!picked) {
    return { status: "absent", caseId, reason: `absent: ${caseId} has no run with status "completed"; no substitute` };
  }
  return { status: "ok", caseId, runId: picked.runId, reason: `latest completed run ${picked.runId}` };
}

export type ShaCheck = { ok: boolean; mismatches: Array<{ path: string; expected: string; actual: string }>; missing: string[] };

export function verifyInputShas(input: {
  inputs: Array<{ path: string; sha256: string }>;
  hashFile: (p: string) => string;
}): ShaCheck {
  const mismatches: Array<{ path: string; expected: string; actual: string }> = [];
  const missing: string[] = [];
  for (const { path, sha256 } of input.inputs) {
    if (!existsSync(path)) {
      missing.push(path);
      continue;
    }
    const actual = input.hashFile(path);
    if (actual !== sha256) mismatches.push({ path, expected: sha256, actual });
  }
  return { ok: mismatches.length === 0 && missing.length === 0, mismatches, missing };
}

export type CaseRenderInputs = {
  glb: string;
  albedo: string;
  normal: string;
  roughness: string;
  recordShas: Array<{ path: string; sha256: string }>;
};

/** Stage outputs of a run, newest run only. */
export function stageOutputs(run: RunRecord, stageNumber: number): Array<{ path: string; sha256: string }> {
  const rows: Array<{ path: string; sha256: string }> = [];
  for (const stage of run.stages ?? []) {
    if (stage.stage !== stageNumber) continue;
    for (const o of stage.outputs ?? []) {
      if (typeof o.path === "string" && typeof o.sha256 === "string") rows.push({ path: o.path, sha256: o.sha256 });
    }
  }
  return rows;
}

export function resolveCaseRenderInputs(input: {
  caseId: string;
  store: string;
  runReport: CaseRunReport;
}): { ok: true; inputs: CaseRenderInputs } | { ok: false; status: string; reason: string } {
  const runs = input.runReport.cases?.[input.caseId]?.runs ?? {};
  const picked = pickLatestCompletedRun(runs);
  if (!picked) return { ok: false, status: "absent", reason: `${input.caseId}: no completed run` };
  const runDir = join(input.store, input.caseId, picked.runId);
  const glb = stageOutputs(picked.run, 4)[0]?.path ?? null;
  const albedo = stageOutputs(picked.run, 3).find((o) => /albedo/i.test(o.path))?.path ?? stageOutputs(picked.run, 3)[0]?.path ?? null;
  if (!glb) return { ok: false, status: "refused", reason: `${input.caseId}: no stage-4 lid-conform GLB output in ${picked.runId}` };
  if (!albedo) return { ok: false, status: "refused", reason: `${input.caseId}: no stage-3 final albedo in ${picked.runId}` };
  const normal = existsSync(join(runDir, "skin-normal.png")) ? join(runDir, "skin-normal.png") : join(runDir, "aisha-lidconform.skin-normal.png");
  const roughness = join(runDir, "roughness.png");
  const recordShas = [
    ...stageOutputs(picked.run, 4),
    ...stageOutputs(picked.run, 3),
  ];
  return { ok: true, inputs: { glb, albedo, normal, roughness, recordShas } };
}

export function writeCaseVariant(input: {
  variantPath: string;
  caseId: string;
  glbAbs: string;
  albedo: string;
  normal: string;
  roughness: string;
}): string {
  const variant = {
    id: `face-regression-${input.caseId}`,
    materialOverrides: [],
    portrait: true,
    productEnvironmentId: "ob_triage_room_v1",
    renderSize: 1280,
    rigOverride: null,
    skinOverride: {
      baseColorUrl: input.albedo,
      normalScale: 0.5,
      normalUrl: input.normal,
      roughness: 1.0,
      roughnessMapUrl: input.roughness,
    },
    views: [0, 25],
  };
  mkdirSync(dirname(input.variantPath), { recursive: true });
  writeFileSync(input.variantPath, `${JSON.stringify(variant, null, 0)}\n`, "utf8");
  return input.variantPath;
}

export type RenderOutcome = {
  ok: boolean;
  runDir: string;
  views: Array<{ yaw: number; png: string; sha256: string }>;
  glbSha256: string | null;
  planted: boolean;
  plantLabel?: string;
  refusal?: string;
};

/**
 * Spawn the existing capture tool in variant mode with an explicit --glb and
 * assert the tool's output JSON glb.sha256 equals the record sha.
 */
export function renderCase(input: {
  cwd: string;
  caseId: string;
  runDir: string;
  recordGlbSha256: string;
  variantPath: string;
  glbAbs: string;
  albedo: string;
  normal: string;
  roughness: string;
  plantLabel?: string;
  tsx?: string;
}): RenderOutcome {
  const planted = Boolean(input.plantLabel);
  writeCaseVariant(input);
  const variantId = `face-regression-${input.caseId}`;
  const proc = spawnSync(
    "pnpm",
    ["exec", "tsx", CAPTURE_TOOL, "--variant", input.variantPath, "--out", input.runDir, "--glb", resolve(input.glbAbs)],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const jsonPath = join(input.runDir, `${variantId}.json`);
  if (proc.status !== 0 || !existsSync(jsonPath)) {
    return {
      ok: false, runDir: input.runDir, views: [], glbSha256: null, planted, plantLabel: input.plantLabel,
      refusal: `capture refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`,
    };
  }
  const record = JSON.parse(readFileSync(jsonPath, "utf8")) as {
    glb?: { sha256?: string };
    views?: Array<{ yaw: number; png: string; sha256: string }>;
  };
  const glbSha256 = record.glb?.sha256 ?? null;
  if (glbSha256 !== input.recordGlbSha256) {
    return {
      ok: false, runDir: input.runDir, views: [], glbSha256, planted, plantLabel: input.plantLabel,
      refusal: `rendered GLB sha ${glbSha256} != record sha ${input.recordGlbSha256}`,
    };
  }
  const views = (record.views ?? []).map((v) => ({ yaw: v.yaw, png: v.png, sha256: v.sha256 }));
  const renderJson = { caseId: input.caseId, glbSha256, planted, plantLabel: input.plantLabel ?? null, recordGlbSha256: input.recordGlbSha256, views };
  writeFileSync(join(input.runDir, "render.json"), `${JSON.stringify(renderJson, null, 2)}\n`, "utf8");
  return { ok: true, runDir: input.runDir, views, glbSha256, planted, plantLabel: input.plantLabel };
}

export function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}
