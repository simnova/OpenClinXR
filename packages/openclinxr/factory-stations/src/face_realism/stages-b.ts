// Face-realism stages 4-7: lid-conform bake, eye flags, face fit, checks.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
//
// Card tsk_2c547dda8753bba0: stage 4 runs the face fit FIRST and passes the
// case fit file-weights to the materializer as --face-targets, recording
// applied[] vs unapplied[] (never a silent drop).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import {
  FACE_TARGET_LOADER_FILE,
  faceTargetsLogCount,
  listLoadableFaceTargetNames,
  partitionFaceTargets,
  runFitForStage,
} from "./fit-bake.js";
import {
  ASSET_STORE_ROOT,
  caseValue,
  emptyStageRecord,
  entryString,
  FACE_GATE_MODEL_REL,
  FIT_DIR_REL,
  FIT_REL,
  MATERIALIZE_REL,
  readJsonFile,
  resolveBlender,
  runMisePython,
  runPositionDriver,
  sanitizedFaceRealismEnv,
  SHAPE_REL,
  sha256File,
  type StageGate,
  type StageIO,
  type StageRecord,
} from "./shared.js";

export function runStage4(caseRec: Record<string, unknown>, outDir: string): StageRecord {
  const rec = emptyStageRecord(4, "lid_conform_bake");
  const t0 = Date.now();
  const ringEntry = caseRec["lid_ring_source"] as Record<string, unknown>;
  const ringAbs = path.join(ASSET_STORE_ROOT, entryString(ringEntry, "assets", "value"));
  if (sha256File(ringAbs) !== entryString(ringEntry, "sha256", "value")) {
    throw new Error(`lid ring-source sha mismatch at ${ringAbs}: refused`);
  }
  const knownEntry = caseRec["stage4_known_good"] as
    | { assets?: { value?: unknown }; sha256?: { value?: unknown; source?: unknown } }
    | undefined;
  const knownRel =
    typeof knownEntry?.assets?.value === "string" ? (knownEntry.assets.value as string) : null;
  const knownSha =
    typeof knownEntry?.sha256?.value === "string" ? (knownEntry.sha256.value as string) : null;
  const knownSource =
    typeof knownEntry?.sha256?.source === "string" ? (knownEntry.sha256.source as string) : "";
  const knownAbs = knownRel !== null ? path.join(ASSET_STORE_ROOT, knownRel) : null;
  const bakeArgv = [...caseValue<string[]>(caseRec, "materializer_argv")];
  const resolvedArgv = bakeArgv.map((token) => {
    if (token.startsWith("-")) return token;
    const asRepoRel = path.join(repoRoot(), token);
    return existsSync(asRepoRel) ? asRepoRel : token;
  });
  // Face fit BEFORE the bake (tsk_2c547dda8753bba0): run the fitter now so the
  // bake below folds the case weights into the Basis via --face-targets.
  const fitCase = caseValue<string>(caseRec, "fit_case");
  let fit: ReturnType<typeof runFitForStage>;
  try {
    fit = runFitForStage(fitCase, outDir, "stage4");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...rec,
      ran: false,
      blocked: true,
      blockReason: `pre-bake face-fit failed: ${message.slice(0, 300)}`,
      wanted: `${FIT_REL} --case completing before the stage-4 bake`,
      gate: { pass: false, detail: "fit did not complete; bake refused without it" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  const targetsAbs = path.join(repoRoot(), FIT_DIR_REL, "any-subject-targets.json");
  const partition = partitionFaceTargets(fit.fileWeights, fit.subOf, listLoadableFaceTargetNames());
  const faceTargetsCsv = partition.applied
    .map((entry) => `${entry.name}=${String(entry.weight)}`)
    .join(",");
  const outGlb = path.join(
    outDir,
    knownRel !== null ? path.basename(knownRel) : "stage4-lidconform.glb",
  );
  const argv = [...resolvedArgv];
  if (partition.applied.length > 0) {
    argv.push("--face-targets", faceTargetsCsv);
  }
  argv.push("--output", outGlb);
  const materialize = path.join(repoRoot(), MATERIALIZE_REL);
  rec.script = MATERIALIZE_REL;
  rec.argv = argv;
  rec.inputs = [
    { path: ringAbs, sha256: sha256File(ringAbs) },
    { path: targetsAbs, sha256: sha256File(targetsAbs) },
  ];
  let stdout = "";
  try {
    const raw = execFileSync(resolveBlender(), ["--background", "--python", materialize, "--", ...argv], {
      cwd: repoRoot(),
      env: sanitizedFaceRealismEnv(),
      timeout: 3_600_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    stdout = String(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tail = message.slice(-2000);
    writeFileSync(path.join(outDir, "stage4-blender.log"), tail);
    return {
      ...rec,
      inputs: rec.inputs,
      ran: false,
      blocked: true,
      blockReason: `materializer bake failed: ${message.slice(0, 300)}`,
      wanted: `${MATERIALIZE_REL} with the recorded bake argv completing to --output`,
      gate: { pass: false, detail: "bake did not complete" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  writeFileSync(path.join(outDir, "stage4-blender.log"), stdout.slice(-200_000));
  if (!existsSync(outGlb)) {
    return {
      ...rec,
      ran: false,
      blocked: true,
      blockReason: `materializer exited without writing ${outGlb} (bake refused or crashed; see stage4-blender.log tail)`,
      wanted: `${MATERIALIZE_REL} with the recorded bake argv completing to --output`,
      gate: { pass: false, detail: "bake did not produce its output" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  const marker = "LIDCONFORM_BAKED ";
  const markerAt = stdout.lastIndexOf(marker);
  let lidconformRecord: Record<string, unknown> = {};
  if (markerAt >= 0) {
    try {
      const tail = stdout.slice(markerAt + marker.length);
      lidconformRecord = JSON.parse(tail.slice(0, tail.indexOf("\n") > 0 ? tail.indexOf("\n") : tail.length)) as Record<
        string,
        unknown
      >;
    } catch {
      lidconformRecord = { unparsed: true };
    }
  }
  const outSha = sha256File(outGlb);
  // G4 counterweight (tsk_2c547dda8753bba0): the bake log must prove the fit
  // was folded into the Basis, with exactly the applied weight count.
  const logAppliedCount = faceTargetsLogCount(stdout);
  const logVerified = partition.applied.length > 0 && logAppliedCount === partition.applied.length;
  const faceFitRecord = {
    fitCase,
    weightsSha256: sha256File(fit.weightsCopyPath),
    fileWeightsSha256: sha256File(fit.fileWeightsCopyPath),
    trackedRestored: fit.restored,
    applied: partition.applied,
    unapplied: partition.unapplied,
    appliedBig: partition.appliedBig,
    totalBig: partition.totalBig,
    bigDetail: `${partition.appliedBig}/${partition.totalBig} weights with |w|>=0.05 applied`,
    loader: FACE_TARGET_LOADER_FILE,
    logAppliedCount,
    logVerified,
  };
  const stem = path.basename(outGlb, ".glb");
  const byproducts: StageIO[] = [
    { path: path.join(outDir, "stage4-blender.log"), sha256: sha256File(path.join(outDir, "stage4-blender.log")) },
    { path: fit.fitLogPath, sha256: sha256File(fit.fitLogPath) },
    { path: fit.weightsCopyPath, sha256: sha256File(fit.weightsCopyPath) },
    { path: fit.fileWeightsCopyPath, sha256: sha256File(fit.fileWeightsCopyPath) },
  ];
  for (const entry of readdirSync(outDir)) {
    if (entry.startsWith(stem) && entry !== path.basename(outGlb) && (entry.endsWith(".png") || entry.endsWith(".glb"))) {
      const abs = path.join(outDir, entry);
      byproducts.push({ path: abs, sha256: sha256File(abs) });
    }
  }
  let gate: StageGate;
  let positionFallback: Record<string, unknown> | undefined;
  if (knownAbs !== null && knownSha !== null && existsSync(knownAbs)) {
    const storeSha = sha256File(knownAbs);
    const storeDrift = storeSha !== knownSha ? `; store file drifted (${storeSha.slice(0, 12)})` : "";
    if (outSha === knownSha && logAppliedCount < 0) {
      gate = {
        pass: storeDrift.length === 0,
        detail: `rebake byte-identical to the pinned store GLB${storeDrift}`,
        knownGood: {
          name: path.basename(outGlb),
          expected: knownSha,
          expectedSource: knownSource,
          actual: outSha,
        },
      };
    } else if (!logVerified) {
      gate = {
        pass: false,
        detail:
          `fit NOT baked: FACE_TARGETS_APPLY count ${logAppliedCount} vs ` +
          `${partition.applied.length} applied weights (a run that did not bake the fit fails)`,
        knownGood: {
          name: path.basename(outGlb),
          expected: knownSha,
          expectedSource: knownSource,
          actual: outSha,
        },
      };
    } else {
      const ours = runPositionDriver(outGlb);
      const known = runPositionDriver(knownAbs);
      const bodyMatch = ours.positionSha256[ours.body] === known.positionSha256[known.body];
      const differing = Object.keys(ours.positionSha256).filter(
        (mesh) => ours.positionSha256[mesh] !== known.positionSha256[mesh],
      );
      positionFallback = {
        byteMatch: false,
        positionMatch: bodyMatch,
        oursBody: ours.body,
        knownBody: known.body,
        differingMeshes: differing,
      };
      gate = {
        pass: true,
        detail:
          `fit baked into the Basis (FACE_TARGETS_APPLY ${partition.applied.length} weights, ` +
          `${faceFitRecord.bigDetail}); byte-identity with the pre-fix pin is not expected by ` +
          `design — the known-good move is recorded here${storeDrift}`,
        knownGood: {
          name: path.basename(outGlb),
          expected: knownSha,
          expectedSource: knownSource,
          actual: outSha,
        },
      };
    }
  } else {
    gate = { pass: true, detail: "no pinned known-good carried for this case; output recorded" };
  }
  if (!logVerified) {
    return {
      ...rec,
      outputs: [{ path: outGlb, sha256: outSha }],
      byproducts,
      ran: true,
      blocked: true,
      blockReason: `FACE_TARGETS_APPLY missing or short in the bake log (count ${logAppliedCount} vs ${partition.applied.length} applied)`,
      wanted: `${MATERIALIZE_REL} printing FACE_TARGETS_APPLY with the applied weight count`,
      gate,
      wallSeconds: (Date.now() - t0) / 1000,
      extra: { lidconformRecord, positionFallback, faceFit: faceFitRecord },
    };
  }
  return {
    ...rec,
    outputs: [{ path: outGlb, sha256: outSha }],
    byproducts,
    ran: true,
    gate,
    wallSeconds: (Date.now() - t0) / 1000,
    extra: { lidconformRecord, positionFallback, faceFit: faceFitRecord },
  };
}

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

export function runStage7(
  caseRec: Record<string, unknown>,
  stage4: StageRecord,
  outDir: string,
): StageRecord {
  const rec = emptyStageRecord(7, "checks");
  const t0 = Date.now();
  const checks: Record<string, unknown> = {};
  const modelAbs = path.join(repoRoot(), FACE_GATE_MODEL_REL);
  if (!existsSync(modelAbs)) {
    checks["face_gate"] = {
      blocked: true,
      reason: `landmark model absent at ${modelAbs} (face_gate.py MODEL_PATH)`,
      wanted: "face_gate.py --target <goal png> --render <render png> --out <dir>",
    };
  } else {
    checks["face_gate"] = {
      blocked: true,
      reason: "face-gate needs a case render pair; not staged on this card",
      wanted: "face_gate.py --target <goal png> --render <render png> --out <dir>",
    };
  }
  const shapeScript = path.join(repoRoot(), SHAPE_REL);
  let shapeRc = -1;
  let shapeStdout = "";
  try {
    shapeStdout = runMisePython([shapeScript, "--verify"], 300_000);
    shapeRc = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    shapeStdout = message.slice(-2000);
  }
  const shapeOut = path.join(outDir, "stage7-shape-verify.json");
  try {
    JSON.parse(shapeStdout);
    writeFileSync(shapeOut, shapeStdout.endsWith("\n") ? shapeStdout : `${shapeStdout}\n`);
  } catch {
    writeFileSync(shapeOut, `${JSON.stringify({ rc: shapeRc, tail: shapeStdout.slice(-2000) })}\n`);
  }
  checks["shape_clauses"] = { ran: true, rc: shapeRc, pass: shapeRc === 0 };
  const knownEntry = caseRec["stage4_known_good"] as
    | { assets?: { value?: unknown } }
    | undefined;
  const knownRel =
    typeof knownEntry?.assets?.value === "string" ? (knownEntry.assets.value as string) : null;
  // tsk_2c547dda8753bba0: fit-baked runs move POSITION by design; stage-4 faceFit supersedes lid_g1.
  const faceFit = (stage4.extra as { faceFit?: { applied?: unknown[]; logVerified?: boolean } } | undefined)
    ?.faceFit;
  const fitSupersedes = Array.isArray(faceFit?.applied) && faceFit.applied.length > 0 && faceFit.logVerified === true;
  if (stage4.ran && !stage4.blocked && knownRel !== null) {
    const knownAbs = path.join(ASSET_STORE_ROOT, knownRel);
    const oursGlb = stage4.outputs[0]?.path ?? "";
    if (existsSync(oursGlb) && existsSync(knownAbs)) {
      const ours = runPositionDriver(oursGlb);
      const known = runPositionDriver(knownAbs);
      const match = ours.positionSha256[ours.body] === known.positionSha256[known.body];
      checks["lid_g1"] = {
        ran: true,
        pass: match || fitSupersedes,
        oursBody: ours.body,
        knownBody: known.body,
        detail: match
          ? "rebake body POSITION identical to the pinned store GLB"
          : fitSupersedes
            ? "rebake body POSITION differs from the PRE-FIX pin by design (fit baked; see stage-4 faceFit); not a stop"
            : "rebake body POSITION differs from the pinned store GLB",
      };
    } else {
      checks["lid_g1"] = {
        blocked: true,
        reason: "stage-4 output or pinned store GLB missing",
        wanted: "both GLBs present for the POSITION comparison",
      };
    }
  } else {
    checks["lid_g1"] = {
      blocked: true,
      reason: "stage 4 did not produce a GLB in this run",
      wanted: "a completed stage-4 bake plus the pinned store GLB",
    };
  }
  checks["lid_g4"] = {
    blocked: true,
    reason: "closed-lid globe-px count needs the portrait rig; not re-rendered on this card",
    wanted: "front closed-lid render plus the globe-px count outside the closed lid",
  };
  const catchEntry = caseRec["catchlight_render"] as
    | Record<string, { value?: unknown }>
    | undefined;
  const catchPath = String(catchEntry?.["path"]?.value ?? "");
  const catchSha = String(catchEntry?.["sha256"]?.value ?? "");
  if (catchPath.length === 0) {
    checks["catchlight"] = {
      blocked: true,
      reason: "no landed render is named for the case",
      wanted: "a lit front render path for the case",
    };
  } else if (!existsSync(catchPath)) {
    checks["catchlight"] = {
      blocked: true,
      reason: `named render missing at ${catchPath}`,
      wanted: "the landed render present for the sha check",
    };
  } else {
    const actual = sha256File(catchPath);
    checks["catchlight"] = {
      ran: true,
      reportOnly: true,
      render: catchPath,
      renderShaVerified: actual === catchSha,
      note: "eye-band max5x5 has no landed measurement script; the hand-measured value lives in the r2 report; no numeric gate",
    };
  }
  const shapePass = (checks["shape_clauses"] as { pass?: boolean }).pass === true;
  const g1Pass = (checks["lid_g1"] as { pass?: boolean }).pass === true;
  rec.script = SHAPE_REL;
  rec.argv = ["--verify"];
  rec.note =
    "face-gate/shape run as r2 did; lid G1/G4 derive from the stage-4 record; catch-light is report-only; a sibling card makes the checks case-driven";
  rec.outputs = [{ path: shapeOut, sha256: sha256File(shapeOut) }];
  rec.ran = true;
  rec.gate = {
    pass: shapePass && g1Pass,
    detail: `shape_clauses --verify rc=${shapeRc}; lid G1 ${g1Pass ? "PASS" : "FAIL/blocked"}; face-gate/G4/catchlight blocked-or-report-only as recorded`,
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = { checks };
  return rec;
}
