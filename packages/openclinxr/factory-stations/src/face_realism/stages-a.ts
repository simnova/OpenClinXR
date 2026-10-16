// Face-realism stages 1-3: family/tone pick, skin layers, skin chain.
// Each stage runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import { runReplayChain, FACE_REALISM_REPLAY_REL, prepareFixtureReplayDir } from "./chain.js";
import {
  ASSET_STORE_ROOT,
  caseValue,
  digString,
  emptyStageRecord,
  entryString,
  FAMILIES_DIR_REL,
  pngOutputs,
  R2_REPORT_REL,
  readJsonFile,
  runMisePython,
  RUN_REPORT_REL,
  sha256File,
  STAGE2_DRIVER_REL,
  type StageIO,
  type StageRecord,
  TONE_CHECK_REL,
  TONE_REPORT_REL,
} from "./shared.js";

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
  const deriveSize = caseValue<number>(caseRec, "derive_size");
  const skipStages = caseValue<string[]>(caseRec, "stage3_skip_stages");
  const glbEntry = caseRec["stage3_glb"] as Record<string, unknown>;
  const albedoEntry = caseRec["stage3_albedo"] as Record<string, unknown>;
  const useFixture = !("assets" in glbEntry);
  let glbFile: string;
  let albedoFile: string;
  let aoFile: string | null = null;
  if (useFixture) {
    const albedoRel = entryString(albedoEntry, "file", "value");
    const albedoSha = entryString(albedoEntry, "sha256", "value");
    if (sha256File(path.join(repoRoot(), albedoRel)) !== albedoSha) {
      throw new Error(`fixture albedo sha mismatch at ${albedoRel}: refused`);
    }
    const staged = prepareFixtureReplayDir(outDir, albedoRel, deriveSize);
    albedoFile = staged.albedoFile;
    glbFile = staged.glbFile;
    aoFile = staged.aoFile;
  } else {
    glbFile = path.join(ASSET_STORE_ROOT, entryString(glbEntry, "assets", "value"));
    albedoFile = path.join(ASSET_STORE_ROOT, entryString(albedoEntry, "assets", "value"));
    if (sha256File(glbFile) !== entryString(glbEntry, "sha256", "value")) {
      throw new Error(`stage-3 GLB sha mismatch at ${glbFile}: refused`);
    }
    if (sha256File(albedoFile) !== entryString(albedoEntry, "sha256", "value")) {
      throw new Error(`stage-3 albedo sha mismatch at ${albedoFile}: refused`);
    }
  }
  const chainFile =
    recordChainManifest !== undefined && recordChainManifest.length > 0
      ? recordChainManifest
      : (caseValue<string>(caseRec, "chain_manifest") as string);
  const chainAbs = path.isAbsolute(chainFile) ? chainFile : path.join(repoRoot(), chainFile);
  let manifestAbs = chainAbs;
  if (useFixture) {
    const chain = readJsonFile(chainAbs) as { stages?: Array<{ parameters?: Record<string, unknown> }> };
    const firstStage = Array.isArray(chain.stages) ? chain.stages[0] : undefined;
    if (firstStage !== undefined) {
      firstStage.parameters = { ...(firstStage.parameters ?? {}), size: Math.round(deriveSize) };
    }
    manifestAbs = path.join(outDir, "stage3-manifest-size.json");
    writeFileSync(manifestAbs, `${JSON.stringify(chain)}\n`);
  }
  const replayed = runReplayChain({
    subject: chainSubject,
    manifestFile: manifestAbs,
    glbFile,
    albedoFile,
    storeDir: outDir,
    skipAo: useFixture,
    skipStages,
  });
  const replayProducts = pngOutputs(outDir).filter(
    (entry) =>
      path.basename(entry.path).startsWith("albedo_") ||
      path.basename(entry.path) === "roughness.png" ||
      path.basename(entry.path) === "eye-mask-union.png",
  );
  const deriveAo = path.join(outDir, "derive_out", "ao.png");
  const outputs =
    useFixture || !existsSync(deriveAo)
      ? replayProducts
      : [...replayProducts, { path: deriveAo, sha256: sha256File(deriveAo) }];
  const inputs: StageIO[] = [
    { path: glbFile, sha256: sha256File(glbFile) },
    { path: albedoFile, sha256: sha256File(albedoFile) },
    { path: manifestAbs, sha256: replayed.manifestSha256 },
  ];
  if (aoFile !== null) inputs.push({ path: aoFile, sha256: sha256File(aoFile) });
  rec.script = FACE_REALISM_REPLAY_REL;
  rec.argv = [
    "--manifest",
    manifestAbs,
    "--subject",
    chainSubject,
    "--store",
    outDir,
    "--glb",
    glbFile,
    "--albedo",
    albedoFile,
    ...(useFixture ? ["--skip-ao"] : []),
    ...(skipStages.length > 0 ? ["--skip-stages", skipStages.join(",")] : []),
  ];
  rec.inputs = inputs;
  rec.outputs = outputs;
  rec.ran = true;
  const expected = useFixture
    ? digString(readJsonFile(path.join(repoRoot(), RUN_REPORT_REL)), ["finalAlbedo", "sha256"])
    : digString(readJsonFile(path.join(repoRoot(), R2_REPORT_REL)), [
        "stages",
        "3_replay_albedo",
        "outputs_run1",
        "albedo_socket.png",
      ]);
  const expectedSource = useFixture
    ? `${RUN_REPORT_REL} key finalAlbedo.sha256`
    : `${R2_REPORT_REL} key stages.3_replay_albedo.outputs_run1.albedo_socket.png`;
  rec.gate = {
    pass: replayed.finalSha256 === expected,
    detail:
      replayed.finalSha256 === expected
        ? `final ${replayed.finalName} matches the pinned known-good`
        : `final ${replayed.finalName} ${(replayed.finalSha256 ?? "null").slice(0, 12)} vs known-good ${expected.slice(0, 12)}`,
    knownGood: {
      name: replayed.finalName,
      expected,
      expectedSource,
      actual: replayed.finalSha256 ?? "",
    },
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = {
    executedChainStages: replayed.executedChainStages,
    manifestSha256: replayed.manifestSha256,
  };
  return { record: rec, finalSha256: replayed.finalSha256 };
}
