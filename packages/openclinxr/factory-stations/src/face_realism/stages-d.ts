// Face-realism stages 5-6: eye flags, face fit.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core";
import { runFitForStage } from "./fit-bake.js";
import {
  caseValue,
  emptyStageRecord,
  entryString,
  FIT_DIR_REL,
  FIT_REL,
  MATERIALIZE_REL,
  readJsonFile,
  runMisePython,
  sha256File,
  type StageRecord,
} from "./shared.js";

export function runStage5(caseRec: Record<string, unknown>, outDir: string): StageRecord {
  const rec = emptyStageRecord(5, "eye_flags");
  const t0 = Date.now();
  const eyeshade = replayEyeShade();
  const flags = caseRec["eye_flags"] as Record<string, { value?: unknown }>;
  const doc = {
    asset: flags["asset"]?.value ?? null,
    cornea: flags["cornea"]?.value ?? null,
    texture: flags["texture"]?.value ?? null,
    shell: flags["shell"]?.value === false ? "off" : String(flags["shell"]?.value ?? "off"),
  };
  const abs = path.join(outDir, "stage5-eyesflags.json");
  writeFileSync(abs, `${JSON.stringify(doc, null, 1)}\n`);
  const bakeArgv = caseValue<string[]>(caseRec, "materializer_argv");
  const eyeArgv = bakeArgv.filter((token, index) => {
    if (!token.startsWith("--eye-")) return false;
    void index;
    return true;
  });
  const eyeTextureToken = bakeArgv.includes("--eye-texture")
    ? (bakeArgv[bakeArgv.indexOf("--eye-texture") + 1] as string | undefined)
    : undefined;
  const fullEyeArgv = [...eyeArgv];
  if (eyeTextureToken !== undefined && !fullEyeArgv.includes(eyeTextureToken)) {
    fullEyeArgv.push(eyeTextureToken);
  }
  rec.script = MATERIALIZE_REL;
  rec.argv = fullEyeArgv;
  rec.note = "flags resolved from the recorded bake argv; JSON written by the station (no subprocess: the hand run names code, not a script)";
  rec.outputs = [{ path: abs, sha256: sha256File(abs) }];
  rec.ran = true;
  rec.gate = {
    pass: doc.shell === "off" && eyeshade.gate.pass,
    detail: `eye flag record matches the case inputs (shell off); eyeshade ${eyeshade.gate.pass ? "replays" : "REFUSED"} ${eyeshade.reportSha256.slice(0, 12)}`,
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = { eyeshade };
  return rec;
}

/**
 * Eyeshade replay pins (card tsk_e0afe706b7a5f071): the runtime eye-shading
 * constants the lab graded (sclera env attenuation, lid-contact band and
 * darken) plus the sha of the stored gate report. Replay reads the stored
 * bytes and the landed shader source; no re-render, no model call. Carried
 * as a stage flag on stage 5 (eye_flags), not a new stage: the station
 * keeps its 7-stage chain.
 */
export const EYE_SHADE_REPORT_REL =
  "tools/openclinxr/asset-pipeline/realism-head/eye-realism/eye-runtime-shading-report.json";
export const EYE_SCLERA_SHADE_REL =
  "packages/openclinxr/xr-scene/src/eye-shader/eye-sclera-shade.ts";
export const EYE_SHADE_ATTEN = 0.35;
export const EYE_SHADE_BAND_M = 0.007;
export const EYE_SHADE_DARKEN = 0.85;

export type EyeShadeReplay = {
  atten: number;
  bandM: number;
  darken: number;
  report: string;
  reportSha256: string;
  source: string;
  gate: { pass: boolean; detail: string };
};

/**
 * Replays the eyeshade record: the stored report's constants must equal the
 * pinned values and the landed shader source must pin the same numerals.
 * Reads stored bytes only (report JSON + shader source text).
 */
export function replayEyeShade(): EyeShadeReplay {
  const reportAbs = path.join(repoRoot(), EYE_SHADE_REPORT_REL);
  const sourceAbs = path.join(repoRoot(), EYE_SCLERA_SHADE_REL);
  const report = readJsonFile(reportAbs) as {
    constants?: { scleraEnvAtten?: unknown; lidBandM?: unknown; lidDarken?: unknown };
  };
  const reportSha256 = sha256File(reportAbs);
  const src = readFileSync(sourceAbs, "utf8");
  const constantsMatch =
    report.constants?.scleraEnvAtten === EYE_SHADE_ATTEN &&
    report.constants?.lidBandM === EYE_SHADE_BAND_M &&
    report.constants?.lidDarken === EYE_SHADE_DARKEN;
  const sourcePins =
    src.includes(`EYE_SCLERA_ENV_ATTEN = ${String(EYE_SHADE_ATTEN)}`) &&
    src.includes(`EYE_LID_BAND_M = ${String(EYE_SHADE_BAND_M)}`) &&
    src.includes(`EYE_LID_DARKEN = ${String(EYE_SHADE_DARKEN)}`);
  const pass = constantsMatch && sourcePins;
  return {
    atten: EYE_SHADE_ATTEN,
    bandM: EYE_SHADE_BAND_M,
    darken: EYE_SHADE_DARKEN,
    report: EYE_SHADE_REPORT_REL,
    reportSha256,
    source: EYE_SCLERA_SHADE_REL,
    gate: {
      pass,
      detail: pass
        ? `eyeshade replays from the stored record: atten ${String(EYE_SHADE_ATTEN)}, band ${String(EYE_SHADE_BAND_M)}m, darken ${String(EYE_SHADE_DARKEN)}; report ${reportSha256.slice(0, 12)}; shader source pins the same numerals`
        : `eyeshade replay refused: report constants match=${String(constantsMatch)}, shader source pins=${String(sourcePins)} (see ${EYE_SHADE_REPORT_REL})`,
    },
  };
}

export function runStage6(caseRec: Record<string, unknown>, outDir: string): StageRecord {
  const rec = emptyStageRecord(6, "face_fit");
  const t0 = Date.now();
  const fitCase = caseValue<string>(caseRec, "fit_case");
  const fitDir = path.join(repoRoot(), FIT_DIR_REL);
  rec.script = FIT_REL;
  rec.argv = ["--case", fitCase];
  let fit: ReturnType<typeof runFitForStage>;
  try {
    fit = runFitForStage(fitCase, outDir, "stage6");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...rec,
      ran: false,
      blocked: true,
      blockReason: `face-fit failed: ${message.slice(0, 300)}`,
      wanted: `${FIT_REL} --case completing for the case`,
      gate: { pass: false, detail: "fit did not complete" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  const weightsName = `fit_weights_${fitCase}.json`;
  const weightsOut = fit.weightsCopyPath;
  const fileWeightsOut = fit.fileWeightsCopyPath;
  const report = readJsonFile(path.join(fitDir, "fit-report.json")) as {
    cases?: Record<string, Record<string, unknown>>;
  };
  const caseEntry = report.cases?.[fitCase] ?? {};
  const restored = fit.restored;
  const weightsSha = sha256File(weightsOut);
  const knownSha = sha256File(path.join(fitDir, weightsName));
  const beatsSweep = caseEntry["beatsSweep"] === true;
  const targetsAbs = path.join(fitDir, "any-subject-targets.json");
  rec.inputs = [{ path: targetsAbs, sha256: sha256File(targetsAbs) }];
  rec.outputs = [
    { path: weightsOut, sha256: weightsSha },
    { path: fileWeightsOut, sha256: sha256File(fileWeightsOut) },
  ];
  rec.byproducts = [
    { path: path.join(outDir, "stage6-fit.log"), sha256: sha256File(path.join(outDir, "stage6-fit.log")) },
  ];
  rec.ran = true;
  rec.gate = {
    pass: weightsSha === knownSha && beatsSweep && restored,
    detail: `fit weights match the tracked file (${weightsSha.slice(0, 12)}); beatsSweep=${beatsSweep}; tracked files restored=${restored}`,
    knownGood: {
      name: weightsName,
      expected: knownSha,
      expectedSource: `${FIT_DIR_REL}/${weightsName} (tracked, read live)`,
      actual: weightsSha,
    },
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = {
    caseEntry,
    restored,
    note: "fit ran in place; tracked files snapshotted before and restored byte-identical after; outputs are copies in the out dir",
  };
  return rec;
}
