// Face-realism stages 1-3: family/tone pick, skin layers, skin chain.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import { runReplayChain, planChainManifest, FACE_REALISM_REPLAY_REL } from "./chain.js";
import {
  ASSET_STORE_ROOT,
  caseValue,
  emptyStageRecord,
  entryString,
  FAMILIES_DIR_REL,
  readJsonFile,
  runMisePython,
  sha256File,
  STAGE2_DRIVER_REL,
  type StageIO,
  type StageRecord,
  TONE_CHECK_REL,
  TONE_REPORT_REL,
} from "./shared.js";
import {
  cfgLeaf,
  cfgLeafSource,
  cfgValue,
  checkSha,
  runBeardSubStage,
  runColourSubStage,
  runComposeSubStage,
  runDetailSubStage,
  storeAbs,
  type SubStage,
} from "./stages-c.js";

export function runStage1(
  caseId: string,
  caseRec: Record<string, unknown>,
  recordPath: string,
  outDir: string,
): StageRecord {
  const rec = emptyStageRecord(1, "family_tone");
  const t0 = Date.now();
  const toneScript = path.join(repoRoot(), TONE_CHECK_REL);
  const toneReportFile = path.join(repoRoot(), TONE_REPORT_REL);
  const recordFile = path.isAbsolute(recordPath)
    ? recordPath
    : path.join(repoRoot(), recordPath);
  rec.script = TONE_CHECK_REL;
  rec.argv = [];
  const toneShaBefore = sha256File(toneReportFile);
  rec.inputs = [
    { path: toneReportFile, sha256: toneShaBefore },
    { path: recordFile, sha256: sha256File(recordFile) },
  ];
  const before = toneShaBefore;
  runMisePython([toneScript], 600_000);
  const after = sha256File(toneReportFile);
  const reproduced = before === after;
  const toneReport = readJsonFile(toneReportFile) as {
    nearest?: Record<string, string>;
    tone_anchors_Lab?: Record<string, [number, number, number]>;
    families?: Record<string, { assets?: string; sha256?: string; forehead?: [number, number, number] }>;
  };
  const record = readJsonFile(recordFile) as {
    cases?: Record<string, { phenotype_tone?: unknown }>;
  };
  const tone = String(record.cases?.[caseId]?.phenotype_tone ?? "");
  const expectedFamily = caseValue<string>(caseRec, "family");
  const anchor = toneReport.tone_anchors_Lab?.[tone];
  if (anchor === undefined) {
    throw new Error(`tone report holds no anchor for the case tone (see ${TONE_REPORT_REL})`);
  }
  const distances: Record<string, number> = {};
  for (const [family, info] of Object.entries(toneReport.families ?? {})) {
    const mean = info.forehead;
    if (mean === undefined) continue;
    distances[family] = Math.sqrt(
      (anchor[0] - mean[0]) ** 2 + (anchor[1] - mean[1]) ** 2 + (anchor[2] - mean[2]) ** 2,
    );
  }
  const pick = Object.entries(distances).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "";
  const nearestPick = toneReport.nearest?.[tone] ?? "";
  const gatePass = reproduced && pick === expectedFamily && pick === nearestPick;
  const familyAssets = String(toneReport.families?.[pick]?.assets ?? "");
  const familyAbs = path.join(ASSET_STORE_ROOT, familyAssets);
  const pickDoc = {
    phenotype_tone: tone,
    anchor_lab: anchor,
    distances_dLab: distances,
    pick,
    family_sha256: existsSync(familyAbs) ? sha256File(familyAbs) : null,
    method: "tone-report min dLab anchor vs family forehead mean (tone-check.py)",
    gate: `pick == tone-report nearest[${tone}]: ${pick === nearestPick ? "PASS" : "FAIL"}`,
  };
  const pickOut = writeStage1Pick(outDir, pickDoc);
  return {
    ...rec,
    inputs: [
      { path: toneReportFile, sha256: after },
      { path: recordFile, sha256: sha256File(recordFile) },
    ],
    outputs: [pickOut],
    ran: true,
    gate: {
      pass: gatePass,
      detail: reproduced
        ? `tone-check.py reproduced ${TONE_REPORT_REL} byte-identical; pick ${pick} == nearest[${tone}] ${nearestPick}`
        : `tone-check.py rewrote ${TONE_REPORT_REL} (before ${before.slice(0, 12)} after ${after.slice(0, 12)}); pick ${pick}`,
    },
    wallSeconds: (Date.now() - t0) / 1000,
  };
}

function writeStage1Pick(outDir: string, pickDoc: Record<string, unknown>): StageIO {
  const abs = path.join(outDir, "stage1-tone-pick.json");
  writeFileSync(abs, `${JSON.stringify(pickDoc, null, 1)}\n`);
  return { path: abs, sha256: sha256File(abs) };
}

export function runStage2(caseRec: Record<string, unknown>, outDir: string): StageRecord {
  const rec = emptyStageRecord(2, "skin_layers");
  const t0 = Date.now();
  const familyRel = entryString(caseRec, "family_png", "assets", "value");
  const familySha = entryString(caseRec, "family_png", "sha256", "value");
  const weights = caseValue<Record<string, number>>(caseRec, "layer_weights");
  const familyAbs = path.join(ASSET_STORE_ROOT, familyRel);
  if (sha256File(familyAbs) !== familySha) {
    throw new Error(`family PNG sha mismatch at ${familyAbs}: refused`);
  }
  const outPng = path.join(outDir, "stage2-layers.png");
  const driver = path.join(repoRoot(), STAGE2_DRIVER_REL);
  const driverArgv = [
    "--families-dir",
    path.join(repoRoot(), FAMILIES_DIR_REL),
    "--family",
    familyRel,
    "--weights",
    JSON.stringify(weights),
    "--out",
    outPng,
  ];
  runMisePython([driver, ...driverArgv], 600_000);
  const outSha = sha256File(outPng);
  const allZero = Object.values(weights).every((w) => Number(w) === 0);
  rec.script = "tools/openclinxr/asset-pipeline/skin/families/skin_layers.py";
  rec.driver = STAGE2_DRIVER_REL;
  rec.argv = driverArgv;
  rec.inputs = [{ path: familyAbs, sha256: familySha }];
  rec.outputs = [{ path: outPng, sha256: outSha }];
  rec.ran = true;
  rec.gate = allZero
    ? {
        pass: outSha === familySha,
        detail:
          outSha === familySha
            ? "all-zero weights are a byte copy of the picked family PNG"
            : `all-zero output differs from the family PNG (${outSha.slice(0, 12)} vs ${familySha.slice(0, 12)})`,
      }
    : { pass: true, detail: "non-zero weights applied; no pinned byte target for this case" };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  return rec;
}

export function runStage3(
  caseRec: Record<string, unknown>,
  recordChainManifest: string | undefined,
  outDir: string,
): { record: StageRecord; finalSha256: string | null } {
  const rec = emptyStageRecord(3, "skin_chain");
  const t0 = Date.now();
  const chainSubject = caseValue<string>(caseRec, "chain_subject");
  const skipStages = caseValue<string[]>(caseRec, "stage3_skip_stages");
  const glbAbs = storeAbs(entryString(caseRec, "stage3_glb", "assets", "value"));
  checkSha(glbAbs, entryString(caseRec, "stage3_glb", "sha256", "value"));
  const compose = runComposeSubStage(caseRec, outDir);
  const composeOut = compose.outputs[0]!.path;
  const colour = runColourSubStage(caseRec, composeOut, outDir);
  const colourOut = colour.outputs[0]!.path;
  const chainFile =
    recordChainManifest !== undefined && recordChainManifest.length > 0
      ? recordChainManifest
      : (caseValue<string>(caseRec, "chain_manifest") as string);
  const manifestAbs = path.isAbsolute(chainFile) ? chainFile : path.join(repoRoot(), chainFile);
  for (const entry of readdirSync(outDir)) {
    if (
      entry.startsWith("albedo_") ||
      entry === "roughness.png" ||
      entry === "eye-mask-union.png" ||
      entry === "brow-mask-union.png" ||
      entry === "lip-vermilion-albedo-union.png"
    ) {
      const abs = path.join(outDir, entry);
      try {
        rmSync(abs);
      } catch {
        throw new Error(`stage-3 cannot clear stale chain product at ${abs}: refused`);
      }
    }
  }
  const manifestDoc = readJsonFile(manifestAbs) as {
    stages?: Array<{ name?: unknown; output_paths?: unknown; parameters?: Record<string, unknown> }>;
    subjects?: Record<string, { overrides?: Record<string, Record<string, unknown>> }>;
  };
  // Manifest-driven output filename: the station never hard-codes which
  // file a chain stage writes; the manifest's output_paths is the source.
  const manifestOutputPng = (stageName: string): string => {
    const def = manifestDoc.stages?.find((stage) => String(stage.name ?? "") === stageName);
    const out = Object.values((def?.output_paths ?? {}) as Record<string, unknown>).find(
      (value): value is string => typeof value === "string" && value.endsWith(".png"),
    );
    if (def === undefined || out === undefined) {
      throw new Error(`chain manifest holds no png output for stage ${stageName}: refused`);
    }
    return out;
  };
  const deriveSize = caseValue<number>(caseRec, "derive_size");
  const deriveParams = manifestDoc.stages?.find((stage) => stage.name === "derive")?.parameters;
  if (deriveParams?.["size"] !== deriveSize) {
    throw new Error(
      `chain derive size ${String(deriveParams?.["size"])} != case derive_size ${String(deriveSize)}: refused`,
    );
  }
  const replayed = runReplayChain({
    subject: chainSubject,
    manifestFile: manifestAbs,
    glbFile: glbAbs,
    albedoFile: colourOut,
    storeDir: outDir,
    skipAo: false,
    skipStages,
  });
  const chainArgv = [
    "--manifest",
    manifestAbs,
    "--subject",
    chainSubject,
    "--store",
    outDir,
    "--glb",
    glbAbs,
    "--albedo",
    colourOut,
    ...(skipStages.length > 0 ? ["--skip-stages", skipStages.join(",")] : []),
  ];
  const socketPng = path.join(outDir, manifestOutputPng("socket"));
  const socketSha = sha256File(socketPng);
  const colourCfg = caseValue<Record<string, unknown>>(caseRec, "stage3_colour");
  const socketExpected = cfgLeaf(colourCfg, "expected_chain_socket_sha256", "value");
  const socketSource = cfgLeafSource(colourCfg, "expected_chain_socket_sha256");
  const chainGate =
    socketSha === socketExpected
      ? { pass: true, detail: `chain socket matches the pinned known-good (${socketSha.slice(0, 12)})` }
      : {
          pass: false,
          detail: `chain socket ${socketSha.slice(0, 12)} vs known-good ${socketExpected.slice(0, 12)}`,
        };
  const chain: SubStage = {
    script: FACE_REALISM_REPLAY_REL,
    argv: chainArgv,
    inputs: [
      { path: glbAbs, sha256: sha256File(glbAbs) },
      { path: colourOut, sha256: sha256File(colourOut) },
      { path: manifestAbs, sha256: replayed.manifestSha256 },
    ],
    outputs: readdirSync(outDir)
      .filter(
        (entry) =>
          entry.startsWith("albedo_") ||
          entry === "roughness.png" ||
          entry === "eye-mask-union.png",
      )
      .sort()
      .map((entry) => {
        const abs = path.join(outDir, entry);
        return { path: abs, sha256: sha256File(abs) };
      }),
    ran: true,
    gate: chainGate,
  };
  const deriveAo = path.join(outDir, "derive_out", "ao.png");
  if (existsSync(deriveAo)) {
    chain.outputs.push({ path: deriveAo, sha256: sha256File(deriveAo) });
  }
  // Standalone sub-stages run in manifest position: replay skipped them
  // (the case's stage3_skip_stages), so the station chains them here in
  // manifest order on the chain's current albedo. The order comes from the
  // manifest plan, never from a hard-coded list here; the dispatch below is
  // keyed by stage name (the beard argv is the landed standalone argv,
  // without replay's --vermilion-mask, so replay must not run it: the
  // pins and the wrinkle lineage both record the standalone behaviour).
  const skipped = new Set(skipStages);
  const plan = planChainManifest(
    manifestDoc as { stages?: Array<{ name?: unknown; output_paths?: unknown }> },
    skipStages,
  );
  let currentAlbedo = colourOut;
  const standalone: SubStage[] = [];
  for (const stage of plan.stages) {
    if (!skipped.has(stage.name)) {
      if (stage.outputPng !== null && stage.outputPng.startsWith("albedo_")) {
        currentAlbedo = path.join(outDir, stage.outputPng);
      }
      continue;
    }
    const outFile = path.join(outDir, manifestOutputPng(stage.name));
    if (stage.name === "beard_shadow") {
      standalone.push(runBeardSubStage(caseRec, currentAlbedo, outDir, outFile));
    } else if (stage.name === "detail_bands") {
      standalone.push(runDetailSubStage(caseRec, chainSubject, manifestDoc, currentAlbedo, outFile, outDir));
    } else {
      throw new Error(`skipped chain stage ${stage.name} has no standalone runner: refused`);
    }
    currentAlbedo = outFile;
  }
  const finalFile = plan.finalOutput ?? currentAlbedo;
  const finalAbs = path.isAbsolute(finalFile) ? finalFile : path.join(outDir, finalFile);
  const finalSha256 = sha256File(finalAbs);
  const finalStageName = [...plan.stages].reverse().find((stage) => stage.outputPng !== null)?.name ?? "";
  const subStages = [compose, colour, chain, ...standalone];
  const inputs: StageIO[] = [
    ...compose.inputs,
    ...colour.inputs,
    ...chain.inputs,
    ...standalone.flatMap((sub) => sub.inputs),
  ];
  const outputs: StageIO[] = [
    ...compose.outputs,
    ...colour.outputs,
    ...chain.outputs,
    ...standalone.flatMap((sub) => sub.outputs),
  ];
  rec.script = FACE_REALISM_REPLAY_REL;
  rec.argv = chainArgv;
  rec.note =
    "compose -> colour -> replay (manifest minus skips) -> skipped stages standalone in manifest position (see extra.subStages and extra.executedChainStages); the final albedo is the last executed manifest stage output";
  rec.inputs = inputs;
  rec.outputs = outputs;
  rec.ran = true;
  const failed = subStages.filter((sub) => !sub.gate.pass);
  // Stage-level known-good keys the FINAL manifest stage by stage name
  // (detail_bands -> stage3_detail, beard_shadow -> stage3_beard); a final
  // stage with no pin passes through on the sub-stage gates, recorded.
  const finalCfgKey = finalStageName === "detail_bands" ? "stage3_detail" : finalStageName === "beard_shadow" ? "stage3_beard" : null;
  const finalCfg = finalCfgKey !== null ? caseValue<Record<string, unknown>>(caseRec, finalCfgKey) : null;
  const finalExpected = finalCfg !== null ? cfgLeaf(finalCfg, "expected_out_sha256", "value") : finalSha256;
  const finalExpectedSource =
    finalCfg !== null ? cfgLeafSource(finalCfg, "expected_out_sha256") : "no pin for the final stage; sub-stage gates decide";
  rec.gate = {
    pass: failed.length === 0 && finalSha256 === finalExpected,
    detail:
      failed.length === 0 && finalSha256 === finalExpected
        ? `compose+colour+chain+standalone all match their pinned known-goods; final ${path.basename(finalAbs)} ${finalSha256.slice(0, 12)}`
        : `failing sub-stages: ${failed.map((sub) => `${sub.script.split("/").at(-1)}: ${sub.gate.detail}`).join("; ")}${finalSha256 === finalExpected ? "" : `; final ${path.basename(finalAbs)} ${finalSha256.slice(0, 12)} vs known-good ${finalExpected.slice(0, 12)}`}`,
    knownGood: {
      name: path.basename(finalAbs),
      expected: finalExpected,
      expectedSource: finalExpectedSource,
      actual: finalSha256,
    },
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = {
    executedChainStages: replayed.executedChainStages,
    manifestSha256: replayed.manifestSha256,
    manifestPlan: plan,
    socketExpected,
    socketExpectedSource: socketSource,
    socketActual: socketSha,
    finalAlbedo: { file: finalAbs, sha256: finalSha256, stage: finalStageName },
    subStages: subStages.map((sub) => ({
      script: sub.script,
      argv: sub.argv,
      inputs: sub.inputs,
      outputs: sub.outputs,
      ran: sub.ran,
      gate: sub.gate,
    })),
  };
  return { record: rec, finalSha256 };
}
