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
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import {
  buildStage4Gate,
  FACE_TARGET_LOADER_FILE,
  faceTargetsLogCount,
  listLoadableFaceTargetNames,
  partitionFaceTargets,
  runFitForStage,
  type Stage4FaceFit,
} from "./fit-bake.js";
import {
  ASSET_STORE_ROOT,
  browFormArgv,
  caseValue,
  emptyStageRecord,
  entryString,
  FACE_GATE_MODEL_REL,
  FIT_DIR_REL,
  FIT_REL,
  MATERIALIZE_REL,
  R3_REPORT_REL,
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

/**
 * Default stage-4 output stem for a case that pins no `stage4_known_good`.
 *
 * The materializer's #377 guard keys the anatomical eye target by output GLB
 * stem (EYE_DIAMETER_TARGET_MM). The old shared default `stage4-lidconform`
 * is keyed for nobody, so such a bake refuses mid-run — and registering it
 * would be worse: one entry would size every unknown case alike, seating a
 * child's globe in an adult socket. So the default is derived from the bake's
 * own case (else the --reference / --eye-colour-reference subject), matching
 * the `<case>-eyeglobe-base` ring-source naming the pre-conform base bake
 * already uses (tsk_083b92e9c7ca5d7b).
 */
export function stage4OutputStem(caseRec: Record<string, unknown>, caseId?: string): string {
  const argv = caseValue<string[]>(caseRec, "materializer_argv");
  const tokenAfter = (flag: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && typeof argv[i + 1] === "string" ? argv[i + 1]! : "";
  };
  const subject = tokenAfter("--reference") || tokenAfter("--eye-colour-reference");
  const base = caseId || subject || "stage4";
  return `${base.replace(/[^A-Za-z0-9._-]+/g, "_")}-lidconform`;
}

export function runStage4(caseRec: Record<string, unknown>, outDir: string, caseId?: string): StageRecord {
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
  // h1 landing safety: the fit bake is OPT-IN per case (case-inputs.json
  // fit_bake, absent = off). Off reproduces the pre-fix bake exactly: no fit
  // pre-step, no --face-targets, byte/POSITION gate against the pin.
  const fitBakeEnabled =
    (caseRec["fit_bake"] as { value?: unknown } | undefined)?.value === true;
  const fitCase = caseValue<string>(caseRec, "fit_case");
  let fit: ReturnType<typeof runFitForStage> | null = null;
  let partition: ReturnType<typeof partitionFaceTargets> | null = null;
  let faceTargetsCsv = "";
  if (fitBakeEnabled) {
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
    partition = partitionFaceTargets(fit.fileWeights, fit.subOf, listLoadableFaceTargetNames());
    faceTargetsCsv = partition.applied
      .map((entry) => `${entry.name}=${String(entry.weight)}`)
      .join(",");
  }
  const targetsAbs = path.join(repoRoot(), FIT_DIR_REL, "any-subject-targets.json");
  const outGlb = path.join(
    outDir,
    knownRel !== null ? path.basename(knownRel) : `${stage4OutputStem(caseRec, caseId)}.glb`,
  );
  const argv = [...resolvedArgv];
  if (partition !== null && partition.applied.length > 0) {
    argv.push("--face-targets", faceTargetsCsv);
  }
  // CARD tsk_27220fbaeb48dab4: a texture case passes --brow-form texture so
  // the materializer skips the eyebrow fit; a mesh case (or absent) passes
  // no flag and bakes exactly as before.
  argv.push(...browFormArgv(caseRec));
  argv.push("--output", outGlb);
  const materialize = path.join(repoRoot(), MATERIALIZE_REL);
  rec.script = MATERIALIZE_REL;
  rec.argv = argv;
  rec.inputs =
    fit === null
      ? [{ path: ringAbs, sha256: sha256File(ringAbs) }]
      : [
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
  // G4 counterweight: with the fit bake on, the log must prove the fit was
  // folded into the Basis with exactly the applied weight count.
  const logAppliedCount = faceTargetsLogCount(stdout);
  const logVerified =
    partition !== null && partition.applied.length > 0 && logAppliedCount === partition.applied.length;
  const faceFitRecord: Stage4FaceFit =
    fit === null || partition === null
      ? null
      : {
          fitCase,
          fitBakeOptIn: true,
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
  ];
  if (fit !== null) {
    byproducts.push(
      { path: fit.fitLogPath, sha256: sha256File(fit.fitLogPath) },
      { path: fit.weightsCopyPath, sha256: sha256File(fit.weightsCopyPath) },
      { path: fit.fileWeightsCopyPath, sha256: sha256File(fit.fileWeightsCopyPath) },
    );
  }
  for (const entry of readdirSync(outDir)) {
    if (entry.startsWith(stem) && entry !== path.basename(outGlb) && (entry.endsWith(".png") || entry.endsWith(".glb"))) {
      const abs = path.join(outDir, entry);
      byproducts.push({ path: abs, sha256: sha256File(abs) });
    }
  }
  const { gate, positionFallback } = buildStage4Gate({
    outSha,
    outGlb,
    knownAbs,
    knownSha,
    knownSource,
    faceFitRecord,
    logAppliedCount,
    logVerified,
  });
  if (faceFitRecord !== null && !logVerified) {
    return {
      ...rec,
      outputs: [{ path: outGlb, sha256: outSha }],
      byproducts,
      ran: true,
      blocked: true,
      blockReason: `FACE_TARGETS_APPLY missing or short in the bake log (count ${logAppliedCount} vs ${faceFitRecord.applied.length} applied)`,
      wanted: `${MATERIALIZE_REL} printing FACE_TARGETS_APPLY with the applied weight count`,
      gate,
      wallSeconds: (Date.now() - t0) / 1000,
      extra: { lidconformRecord, positionFallback, faceFit: faceFitRecord },
    };
  }
  // Post-canthus POSITION record (case-inputs stage4_position_known_good):
  // when the pre-fix pin mismatches, compare per-mesh POSITION against the
  // station's own r3-bake record instead of failing on the stale pin. The
  // stale pin is kept as an informational row only, never asserted.
  const posEntry = caseRec["stage4_position_known_good"] as
    | {
        source?: unknown;
        value?: {
          glb?: { assets?: unknown; sha256?: unknown };
          body?: { value?: unknown };
        };
      }
    | undefined;
  let finalGate = gate;
  let blockedBy: string | undefined;
  let positionR3: Record<string, unknown> | undefined;
  const knownGoodRows: Array<Record<string, unknown>> = [];
  if (posEntry !== undefined && posEntry !== null && typeof posEntry === "object" && "value" in posEntry) {
    const posValue = (posEntry as { value?: unknown }).value as {
      glb?: { assets?: unknown; sha256?: unknown };
      body?: { value?: unknown };
    };
    const r3Rel = String(posValue.glb?.assets ?? "");
    const r3Abs = path.join(ASSET_STORE_ROOT, r3Rel);
    const r3Sha = String(posValue.glb?.sha256 ?? "");
    if (sha256File(r3Abs) !== r3Sha) {
      throw new Error(`stage-4 r3 record GLB sha mismatch at ${r3Abs}: refused`);
    }
    const r3Body = String(posValue.body?.value ?? "");
    const oursPos = runPositionDriver(outGlb);
    const r3Pos = runPositionDriver(r3Abs);
    const meshes = new Set([
      ...Object.keys(oursPos.positionSha256),
      ...Object.keys(r3Pos.positionSha256),
    ]);
    const differing = [...meshes].filter(
      (mesh) => oursPos.positionSha256[mesh] !== r3Pos.positionSha256[mesh],
    );
    const r3Source = `${String(posEntry.source ?? R3_REPORT_REL)} POSITION map`;
    knownGoodRows.push({
      name: path.basename(outGlb),
      expected: knownSha ?? "",
      expectedSource: knownSource,
      actual: outSha,
      match: false,
      informational: true,
      note: "stale since 838595e7c; eye lane re-pin",
    });
    if (differing.length === 0) {
      const expected = r3Pos.positionSha256[r3Body] ?? "";
      const actual = oursPos.positionSha256[oursPos.body] ?? "";
      const r3gate: StageGate = {
        pass: expected.length > 0 && expected === actual,
        detail:
          expected.length > 0 && expected === actual
            ? `body POSITION identical to the post-canthus r3 record (${expected.slice(0, 12)})`
            : `POSITION mismatch vs the r3 record (body ${actual.slice(0, 12)} vs ${expected.slice(0, 12)})`,
        knownGood: {
          name: `${path.basename(outGlb)} POSITION`,
          expected,
          expectedSource: r3Source,
          actual,
        },
      };
      finalGate = r3gate;
      positionR3 = { match: r3gate.pass, recordGlb: r3Abs, recordGlbSha256: r3Sha, body: r3Body };
      if (!r3gate.pass) {
        blockedBy = `fresh bake drifted from the r3 POSITION record in ${R3_REPORT_REL} (body POSITION differs)`;
      }
    } else {
      positionR3 = { match: false, recordGlb: r3Abs, recordGlbSha256: r3Sha, body: r3Body, differing };
      blockedBy = `fresh bake drifted from the r3 POSITION record in ${R3_REPORT_REL} (${differing.length} meshes differ)`;
    }
  }
  return {
    ...rec,
    outputs: [{ path: outGlb, sha256: outSha }],
    byproducts,
    ran: true,
    ...(blockedBy !== undefined ? { blocked_by: blockedBy } : {}),
    gate: finalGate,
    wallSeconds: (Date.now() - t0) / 1000,
    extra: {
      lidconformRecord,
      positionFallback,
      faceFit: faceFitRecord,
      ...(positionR3 !== undefined ? { positionR3, knownGoodRows } : {}),
    },
  };
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
      const r3routed =
        !match &&
        !fitSupersedes &&
        caseRec["stage4_position_known_good"] !== undefined &&
        (stage4.extra as { positionR3?: { match?: boolean } } | undefined)?.positionR3?.match === true;
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
        ...(r3routed
          ? {
              blocked_by:
                "eye lane: any-subject-report.json base not re-pinned after 838595e7c (stage-4 POSITION matches the r3 record)",
            }
          : {}),
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
  const lidBlockedBy = (checks["lid_g1"] as { blocked_by?: unknown }).blocked_by;
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
  if (!g1Pass && typeof lidBlockedBy === "string" && lidBlockedBy.length > 0) {
    return { ...rec, blocked_by: lidBlockedBy };
  }
  return rec;
}
