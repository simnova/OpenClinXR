// Face-realism stages 1-3: family/tone pick, skin layers, skin chain.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import {
  FACE_REALISM_REPLAY_REL,
  manifestOutputPng,
  planChainManifest,
  runReplayChain,
  STATION_CHAINED_STAGES,
  type Stage3ChainOptions,
  type Stage3ChainResult,
  type Stage3ManifestDoc,
} from "./chain.js";
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
import { resolveRunManifest, runFamilyBaseSubStage, stage3EntryKind } from "./stage3-entry.js";
import { measureToneAnchor } from "./tone-anchor.js";
import {
  cfgLeaf,
  cfgLeafSource,
  cfgPinOrNull,
  cfgValue,
  checkSha,
  pinGate,
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
  const recordedAnchor = toneReport.tone_anchors_Lab?.[tone];
  // A token with no recorded anchor gets one from the case's own goal_front
  // image through the calibrated instrument (tone-anchor.py); no goal_front
  // or an uncalibrated instrument leaves the stage refused.
  const measured = recordedAnchor === undefined ? measureToneAnchor(caseId, caseRec, recordFile, tone, toneReport.families ?? {}, toneReport.nearest ?? {}) : null;
  const anchor = recordedAnchor ?? measured?.anchor;
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
  const gatePass =
    reproduced && pick === expectedFamily && pick === nearestPick && (measured === null || measured.gate.pass);
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
    ...(measured !== null ? { anchor_source: measured.source, anchor_gate: measured.gate } : {}),
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
      detail:
        (reproduced
          ? `tone-check.py reproduced ${TONE_REPORT_REL} byte-identical; pick ${pick} == nearest[${tone}] ${nearestPick}`
          : `tone-check.py rewrote ${TONE_REPORT_REL} (before ${before.slice(0, 12)} after ${after.slice(0, 12)}); pick ${pick}`) +
        (measured !== null ? `; anchor measured from goal_front: ${measured.gate.detail}` : ""),
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

/**
 * Executes the manifest in order as segments: consecutive replay-run
 * stages go through replay.py as one invocation; each station-chained
 * stage (beard_shadow, detail_bands) runs standalone in its position; a
 * replay-run stage AFTER a station-chained stage runs in a further
 * replay.py invocation whose --albedo is the previous segment's final.
 *
 * A later replay segment name-skips every other stage EXCEPT derive:
 * derive must run (never name-skipped) so that, with --skip-ao and the
 * existing derive_out, it takes replay.py's "derive outputs already
 * exist, skipping" path (replay.py:116), which seeds ao_png,
 * occupancy_png, lipuv_npz, landmarks_uv_json and every *_mask input for
 * the segment's stages. Name-skipping derive instead would leave those
 * inputs unseeded (--skip-stages passes inputs through untouched,
 * replay.py:304) and the segment would refuse at replay.py:87
 * ("Missing input kind ..."). Later segments always pass --skip-ao, so
 * the AO bake runs at most once (in the first segment).
 */
export function runStage3Chain(options: Stage3ChainOptions): Stage3ChainResult {
  const { caseRec, manifestDoc, manifestAbs, chainSubject, glbAbs, albedoIn, storeDir, skipAo, skipStages } = options;
  const plan = planChainManifest(
    manifestDoc as { stages?: Array<{ name?: unknown; output_paths?: unknown }> },
    skipStages,
  );
  const skipped = new Set(skipStages);
  const chained = new Set<string>(STATION_CHAINED_STAGES);
  type Segment = { kind: "replay"; stages: Array<{ name: string; outputPng: string | null }> } | { kind: "standalone"; name: string };
  const segments: Segment[] = [];
  let pending: Array<{ name: string; outputPng: string | null }> = [];
  for (const stage of plan.ordered) {
    if (!skipped.has(stage.name)) {
      pending.push({ name: stage.name, outputPng: stage.outputPng });
      continue;
    }
    if (!chained.has(stage.name)) {
      throw new Error(`skipped chain stage ${stage.name} has no standalone runner: refused`);
    }
    if (pending.length > 0) {
      segments.push({ kind: "replay", stages: pending });
      pending = [];
    }
    segments.push({ kind: "standalone", name: stage.name });
  }
  if (pending.length > 0) segments.push({ kind: "replay", stages: pending });
  const standaloneNames = new Set(
    plan.ordered.filter((stage) => skipped.has(stage.name) && chained.has(stage.name)).map((stage) => stage.name),
  );
  // Case-declared skips that match no manifest stage (e.g. apply_occ) are
  // no-ops in every invocation; carrying them keeps the segment-0 argv
  // byte-identical to the pre-segmentation single invocation.
  const nonManifestSkips = skipStages.filter(
    (name) => !plan.ordered.some((stage) => stage.name === name),
  );
  const colourCfg = caseValue<Record<string, unknown>>(caseRec, "stage3_colour");
  const socketPin = cfgPinOrNull(colourCfg, "expected_chain_socket_sha256");
  const socketExpected = socketPin ?? "";
  const socketExpectedSource = cfgLeafSource(colourCfg, "expected_chain_socket_sha256");
  const records: SubStage[] = [];
  let manifestSha256 = "";
  let currentAlbedo = albedoIn;
  let finalStageName = "";
  let finalFile = albedoIn;
  const priorReplayed = new Set<string>();
  let segmentIndex = 0;
  for (const segment of segments) {
    if (segment.kind === "standalone") {
      const outFile = path.join(storeDir, manifestOutputPng(manifestDoc, segment.name));
      records.push(
        segment.name === "beard_shadow"
          ? runBeardSubStage(caseRec, currentAlbedo, storeDir, outFile)
          : runDetailSubStage(caseRec, chainSubject, manifestDoc, currentAlbedo, outFile, storeDir),
      );
      currentAlbedo = outFile;
      finalStageName = segment.name;
      finalFile = outFile;
      continue;
    }
    const segSkips = [...new Set([...nonManifestSkips, ...standaloneNames, ...[...priorReplayed].filter((name) => name !== "derive")])];
    const segSkipAo = segmentIndex === 0 ? skipAo : true;
    const replayed = runReplayChain({
      subject: chainSubject,
      manifestFile: manifestAbs,
      glbFile: glbAbs,
      albedoFile: currentAlbedo,
      storeDir,
      skipAo: segSkipAo,
      skipStages: segSkips,
    });
    manifestSha256 = replayed.manifestSha256;
    const chainArgv = [
      "--manifest",
      manifestAbs,
      "--subject",
      chainSubject,
      "--store",
      storeDir,
      "--glb",
      glbAbs,
      "--albedo",
      currentAlbedo,
      ...(segSkipAo ? ["--skip-ao"] : []),
      ...(segSkips.length > 0 ? ["--skip-stages", segSkips.join(",")] : []),
    ];
    const socketInSegment = segment.stages.some((entry) => entry.name === "socket");
    const socketPng = path.join(storeDir, manifestOutputPng(manifestDoc, "socket"));
    const chainGate = !socketInSegment
      ? {
          pass: true,
          detail: `replay segment ${segmentIndex} ran ${segment.stages.map((entry) => entry.name).join(",")} (no socket gate in this segment)`,
        }
      : (() => {
          return pinGate("chain socket", sha256File(socketPng), socketPin);
        })();
    const record: SubStage = {
      script: FACE_REALISM_REPLAY_REL,
      argv: chainArgv,
      inputs: [
        { path: glbAbs, sha256: sha256File(glbAbs) },
        { path: currentAlbedo, sha256: sha256File(currentAlbedo) },
        { path: manifestAbs, sha256: manifestSha256 },
      ],
      outputs: readdirSync(storeDir)
        .filter(
          (entry) =>
            entry.startsWith("albedo_") ||
            entry === "roughness.png" ||
            entry === "eye-mask-union.png",
        )
        .sort()
        .map((entry) => {
          const abs = path.join(storeDir, entry);
          return { path: abs, sha256: sha256File(abs) };
        }),
      ran: true,
      gate: chainGate,
    };
    const deriveAo = path.join(storeDir, "derive_out", "ao.png");
    if (existsSync(deriveAo)) {
      record.outputs.push({ path: deriveAo, sha256: sha256File(deriveAo) });
    }
    records.push(record);
    for (const entry of segment.stages) {
      const out = entry.outputPng;
      if (out !== null) {
        if (out.startsWith("albedo_")) currentAlbedo = path.join(storeDir, out);
        finalStageName = entry.name;
        finalFile = path.join(storeDir, out);
      }
      if (entry.name !== "derive") priorReplayed.add(entry.name);
    }
    segmentIndex += 1;
  }
  const finalAbs = path.isAbsolute(finalFile) ? finalFile : path.join(storeDir, finalFile);
  const finalSha256 = sha256File(finalAbs);
  const socketPng = path.join(storeDir, manifestOutputPng(manifestDoc, "socket"));
  return {
    plan,
    records,
    manifestSha256,
    socketExpected,
    socketExpectedSource,
    socketActual: sha256File(socketPng),
    finalAbs,
    finalStageName,
    finalSha256,
  };
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
  const glbSha = entryString(caseRec, "stage3_glb", "sha256", "value");
  checkSha(glbAbs, glbSha);
  const entryKind = stage3EntryKind(caseRec);
  const entrySubStages: SubStage[] = [];
  if (entryKind === "family_base") entrySubStages.push(runFamilyBaseSubStage(caseRec, outDir));
  else {
    const compose = runComposeSubStage(caseRec, outDir);
    entrySubStages.push(compose, runColourSubStage(caseRec, compose.outputs[0]!.path, outDir));
  }
  const colourOut = entrySubStages.at(-1)!.outputs[0]!.path;
  const chainFile =
    recordChainManifest !== undefined && recordChainManifest.length > 0
      ? recordChainManifest
      : (caseValue<string>(caseRec, "chain_manifest") as string);
  let manifestAbs = path.isAbsolute(chainFile) ? chainFile : path.join(repoRoot(), chainFile);
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
  const resolved = resolveRunManifest(readJsonFile(manifestAbs) as Stage3ManifestDoc, manifestAbs, chainSubject, glbSha, outDir);
  const manifestDoc = resolved.manifestDoc;
  manifestAbs = resolved.manifestAbs;
  const manifestGlbOverride = resolved.override;
  const deriveSize = caseValue<number>(caseRec, "derive_size");
  const deriveParams = manifestDoc.stages?.find((stage) => stage.name === "derive")?.parameters;
  if (deriveParams?.["size"] !== deriveSize) {
    throw new Error(
      `chain derive size ${String(deriveParams?.["size"])} != case derive_size ${String(deriveSize)}: refused`,
    );
  }
  const chained = runStage3Chain({
    caseRec,
    manifestDoc,
    manifestAbs,
    chainSubject,
    glbAbs,
    albedoIn: colourOut,
    storeDir: outDir,
    skipAo: false,
    skipStages,
  });
  const plan = chained.plan;
  const replayed = { manifestSha256: chained.manifestSha256, executedChainStages: plan.executed };
  const socketSha = chained.socketActual;
  const socketExpected = chained.socketExpected;
  const socketSource = chained.socketExpectedSource;
  const chainRecords = chained.records;
  const finalAbs = chained.finalAbs;
  const finalSha256 = chained.finalSha256;
  const finalStageName = chained.finalStageName;
  const subStages = [...entrySubStages, ...chainRecords];
  const firstReplay = chainRecords.find((sub) => sub.script === FACE_REALISM_REPLAY_REL);
  const inputs: StageIO[] = [
    ...entrySubStages.flatMap((sub) => sub.inputs),
    ...chainRecords.flatMap((sub) => sub.inputs),
  ];
  const outputs: StageIO[] = [
    ...entrySubStages.flatMap((sub) => sub.outputs),
    ...chainRecords.flatMap((sub) => sub.outputs),
  ];
  rec.script = FACE_REALISM_REPLAY_REL;
  rec.argv = firstReplay?.argv ?? [];
  rec.note =
    entryKind === "family_base"
      ? "family base (stage-2 output at the derive size) -> manifest segments in order (replay runs interleaved with standalone beard/detail; see extra.subStages and extra.executedChainStages); no goal-derived donor island or colour solve exists for this case, so compose and colour do not run; the final albedo is the last executed manifest stage output"
      : "compose -> colour -> manifest segments in order (replay runs interleaved with standalone beard/detail; see extra.subStages and extra.executedChainStages); the final albedo is the last executed manifest stage output";
  rec.inputs = inputs;
  rec.outputs = outputs;
  rec.ran = true;
  const failed = subStages.filter((sub) => !sub.gate.pass);
  // Stage-level known-good keys the FINAL manifest stage by stage name
  // (detail_bands -> stage3_detail, beard_shadow -> stage3_beard); a final
  // stage with no pin passes through on the sub-stage gates, recorded.
  const finalCfgKey = finalStageName === "detail_bands" ? "stage3_detail" : finalStageName === "beard_shadow" ? "stage3_beard" : null;
  const finalCfg = finalCfgKey !== null ? caseValue<Record<string, unknown>>(caseRec, finalCfgKey) : null;
  const finalPin = finalCfg !== null ? cfgPinOrNull(finalCfg, "expected_out_sha256") : finalSha256;
  const finalExpected = finalPin ?? "";
  const finalExpectedSource =
    finalCfg !== null ? cfgLeafSource(finalCfg, "expected_out_sha256") : "no pin for the final stage; sub-stage gates decide";
  rec.gate = {
    pass: failed.length === 0 && finalPin !== null && finalSha256 === finalExpected,
    detail:
      failed.length === 0 && finalPin !== null && finalSha256 === finalExpected
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
    // The station executes every manifest stage in manifest order: the
    // replay ran the unskipped ones, the standalone sub-stages chained the
    // skipped ones in position. replayExecutedChainStages is the replay's
    // own list (manifest minus skips); executedChainStages is the
    // station-level list (every manifest stage).
    executedChainStages: plan.ordered.map((stage) => stage.name),
    replayExecutedChainStages: replayed.executedChainStages,
    manifestSha256: replayed.manifestSha256,
    manifestPlan: plan,
    socketExpected,
    socketExpectedSource: socketSource,
    socketActual: socketSha,
    finalAlbedo: { file: finalAbs, sha256: finalSha256, stage: finalStageName },
    ...(entryKind === "family_base" ? { entry: entryKind } : {}),
    ...(manifestGlbOverride !== null ? { manifestGlbOverride } : {}),
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
