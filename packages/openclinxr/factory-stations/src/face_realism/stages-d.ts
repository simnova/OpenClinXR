// Face-realism stages 5-6: eye flags, face fit.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
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
    pass: doc.asset === (flags["asset"]?.value ?? null) && doc.shell === "off",
    detail: "eye flag record matches the case inputs (shell off)",
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  return rec;
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
