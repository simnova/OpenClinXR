// Face-realism stage-3 sub-stages: compose, colour, and beard shadow.
// Each runs its landed script as a subprocess; case values come from
// case-inputs.json (no case is named here).
import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import {
  ASSET_STORE_ROOT,
  BEARD_REL,
  caseValue,
  COLOUR_REL,
  COMPOSE_REL,
  readJsonFile,
  runMisePython,
  sha256File,
  type StageIO,
} from "./shared.js";

export type SubStage = {
  script: string;
  argv: string[];
  inputs: StageIO[];
  outputs: StageIO[];
  ran: boolean;
  gate: { pass: boolean; detail: string };
};

export function cfgLeaf(cfg: Record<string, unknown>, key: string, field: string): string {
  const node = cfg[key] as Record<string, unknown> | undefined;
  const value = node?.[field];
  if (typeof value !== "string") {
    throw new Error(`stage-3 config ${key}.${field} is not a string (see case-inputs.json)`);
  }
  return value;
}

export function cfgLeafSource(cfg: Record<string, unknown>, key: string): string {
  return cfgLeaf(cfg, key, "source");
}

export function cfgValue<T>(cfg: Record<string, unknown>, key: string): T {
  const node = cfg[key] as { value?: unknown } | undefined;
  if (node === undefined || node === null || typeof node !== "object" || !("value" in node)) {
    throw new Error(`stage-3 config ${key} has no value (see case-inputs.json)`);
  }
  return (node as { value: T }).value;
}

export function storeAbs(storeRel: string): string {
  return path.join(ASSET_STORE_ROOT, storeRel);
}

export function checkSha(abs: string, expected: string): void {
  const actual = sha256File(abs);
  if (actual !== expected) {
    throw new Error(`stage-3 input sha mismatch at ${abs}: got ${actual.slice(0, 12)} want ${expected.slice(0, 12)}: refused`);
  }
}

export function runComposeSubStage(caseRec: Record<string, unknown>, outDir: string): SubStage {
  const cfg = caseValue<Record<string, unknown>>(caseRec, "stage3_compose");
  const baseAbs = storeAbs(cfgLeaf(cfg, "base_skin", "assets"));
  const donorAbs = storeAbs(cfgLeaf(cfg, "locked_island", "assets"));
  checkSha(baseAbs, cfgLeaf(cfg, "base_skin", "sha256"));
  checkSha(donorAbs, cfgLeaf(cfg, "locked_island", "sha256"));
  const script = path.join(repoRoot(), COMPOSE_REL);
  const argv = [
    "--base-skin",
    baseAbs,
    "--locked-island",
    donorAbs,
    "--locked-sha",
    cfgLeaf(cfg, "locked_sha", "value"),
  ];
  const inputs: StageIO[] = [
    { path: baseAbs, sha256: sha256File(baseAbs) },
    { path: donorAbs, sha256: sha256File(donorAbs) },
  ];
  if ("masks" in cfg) {
    const masksAbs = storeAbs(cfgLeaf(cfg, "masks", "assets"));
    const wantShas = (cfg["masks"] as { shas?: Record<string, string> }).shas ?? {};
    for (const name of Object.keys(wantShas).sort()) {
      const abs = path.join(masksAbs, name);
      checkSha(abs, wantShas[name] as string);
      inputs.push({ path: abs, sha256: sha256File(abs) });
    }
    const sideAbs = storeAbs(cfgLeaf(cfg, "side_map", "assets"));
    checkSha(sideAbs, cfgLeaf(cfg, "side_map", "sha256"));
    argv.push("--masks", masksAbs, "--side-map", sideAbs);
    inputs.push({ path: sideAbs, sha256: sha256File(sideAbs) });
  } else {
    const glbAbs = storeAbs(cfgLeaf(cfg, "glb_masks", "assets"));
    checkSha(glbAbs, cfgLeaf(cfg, "glb_masks", "sha256"));
    argv.push("--glb", glbAbs);
    inputs.push({ path: glbAbs, sha256: sha256File(glbAbs) });
  }
  const box = cfgValue<number[]>(cfg, "island_box");
  argv.push(
    "--input-space",
    cfgValue<string>(cfg, "input_space"),
    "--island-box",
    ...box.map((v) => String(Math.round(v))),
  );
  if (cfgValue<boolean>(cfg, "skip_join")) argv.push("--skip-join");
  const outPng = path.join(outDir, "stage3-compose-out.png");
  const reportJson = path.join(outDir, "stage3-compose-report.json");
  argv.push("--out", outPng, "--report", reportJson);
  runMisePython([script, ...argv], 600_000);
  const outSha = sha256File(outPng);
  const expected = cfgLeaf(cfg, "expected_out_sha256", "value");
  return {
    script: COMPOSE_REL,
    argv,
    inputs,
    outputs: [
      { path: outPng, sha256: outSha },
      { path: reportJson, sha256: sha256File(reportJson) },
    ],
    ran: true,
    gate: {
      pass: outSha === expected,
      detail:
        outSha === expected
          ? `compose output matches the pinned known-good (${outSha.slice(0, 12)})`
          : `compose output ${outSha.slice(0, 12)} vs known-good ${expected.slice(0, 12)}`,
    },
  };
}

export function runColourSubStage(
  caseRec: Record<string, unknown>,
  composeOut: string,
  outDir: string,
): SubStage {
  const cfg = caseValue<Record<string, unknown>>(caseRec, "stage3_colour");
  const inputCfg = cfg["input_albedo"] as { value?: unknown; assets?: unknown } | undefined;
  const chained = inputCfg?.value === "stage3-compose-output";
  const albedoAbs = chained ? composeOut : storeAbs(cfgLeaf(cfg, "input_albedo", "assets"));
  if (!chained) checkSha(albedoAbs, cfgLeaf(cfg, "input_albedo", "sha256"));
  const maskAbs = storeAbs(cfgLeaf(cfg, "albedo_mask", "assets"));
  checkSha(maskAbs, cfgLeaf(cfg, "albedo_mask", "sha256"));
  const siblingMaskIos: StageIO[] = [];
  if ("masks" in cfg) {
    const masksAbs = storeAbs(cfgLeaf(cfg, "masks", "assets"));
    const wantShas = (cfg["masks"] as { shas?: Record<string, string> }).shas ?? {};
    for (const name of Object.keys(wantShas).sort()) {
      const abs = path.join(masksAbs, name);
      checkSha(abs, wantShas[name] as string);
      siblingMaskIos.push({ path: abs, sha256: sha256File(abs) });
    }
  }
  const paramsCfg = cfg["params"] as { repo?: unknown; assets?: unknown; sha256?: unknown } | undefined;
  const paramsAbs =
    typeof paramsCfg?.repo === "string"
      ? path.join(repoRoot(), paramsCfg.repo)
      : storeAbs(String(paramsCfg?.assets ?? ""));
  checkSha(paramsAbs, String(paramsCfg?.sha256 ?? ""));
  const script = path.join(repoRoot(), COLOUR_REL);
  const outPng = path.join(outDir, "stage3-colour-out.png");
  const reportJson = path.join(outDir, "stage3-colour-report.json");
  const argv = [
    "--replay",
    "--input-albedo",
    albedoAbs,
    "--albedo-mask",
    maskAbs,
    "--params",
    paramsAbs,
    "--out",
    outPng,
    "--report",
    reportJson,
  ];
  runMisePython([script, ...argv], 600_000);
  const outSha = sha256File(outPng);
  const report = readJsonFile(reportJson) as { output_sha256?: unknown };
  const reported = typeof report.output_sha256 === "string" ? report.output_sha256 : "";
  const expected = (cfg["expected_out_sha256"] as { value?: unknown } | undefined)?.value;
  const pass =
    typeof expected === "string" ? outSha === expected && reported === outSha : reported === outSha;
  return {
    script: COLOUR_REL,
    argv,
    inputs: [
      { path: albedoAbs, sha256: sha256File(albedoAbs) },
      { path: maskAbs, sha256: sha256File(maskAbs) },
      ...siblingMaskIos,
      { path: paramsAbs, sha256: sha256File(paramsAbs) },
    ],
    outputs: [
      { path: outPng, sha256: outSha },
      { path: reportJson, sha256: sha256File(reportJson) },
    ],
    ran: true,
    gate: {
      pass,
      detail:
        typeof expected === "string"
          ? outSha === expected
            ? `colour output matches the pinned known-good (${outSha.slice(0, 12)})`
            : `colour output ${outSha.slice(0, 12)} vs known-good ${String(expected).slice(0, 12)}`
          : `colour replay truthful (report ${reported.slice(0, 12)} == file ${outSha.slice(0, 12)}); chain socket gated next`,
    },
  };
}

export function runBeardSubStage(
  caseRec: Record<string, unknown>,
  socketPng: string,
  outDir: string,
  outFile: string = path.join(outDir, "albedo_beard.png"),
): SubStage {
  const cfg = caseValue<Record<string, unknown>>(caseRec, "stage3_beard");
  const weight = cfgValue<number>(cfg, "weight");
  const seed = cfgValue<number>(cfg, "seed");
  const texelsPerMm = cfgValue<number>(cfg, "texels_per_mm");
  const deriveOut = path.join(outDir, "derive_out");
  const landmarks = path.join(deriveOut, "landmarks-uv.json");
  const lipsMask = path.join(deriveOut, "mask-lips.png");
  const facecoreMask = path.join(deriveOut, "mask-facecore.png");
  for (const file of [landmarks, lipsMask, facecoreMask, socketPng]) {
    if (!existsSync(file)) throw new Error(`beard input missing at ${file}: refused`);
  }
  // Vermilion from the lips-stage albedo (replay.py beard_shadow branch):
  // the SAME union mask detail hugs, so grain and beard meet it with no
  // seam. The derive lips mask stays as --lips-mask (treatment geometry).
  const lipsStageAlbedo = path.join(outDir, "albedo_lips.png");
  const lipsAlbedo = existsSync(lipsStageAlbedo) ? lipsStageAlbedo : socketPng;
  const vermilionMask = buildVermilionUnion(outDir, lipsAlbedo, deriveOut);
  const script = path.join(repoRoot(), BEARD_REL);
  const outPng = outFile;
  const argv = [
    "--landmarks",
    landmarks,
    "--lips-mask",
    lipsMask,
    "--vermilion-mask",
    vermilionMask,
    "--facecore-mask",
    facecoreMask,
    "--weight",
    String(weight),
    "--seed",
    String(seed),
    "--texels-per-mm",
    String(texelsPerMm),
    socketPng,
    outPng,
  ];
  runMisePython([script, ...argv], 600_000);
  const outSha = sha256File(outPng);
  const expected = cfgLeaf(cfg, "expected_out_sha256", "value");
  const inputs: StageIO[] = [
    { path: landmarks, sha256: sha256File(landmarks) },
    { path: lipsMask, sha256: sha256File(lipsMask) },
    { path: vermilionMask, sha256: sha256File(vermilionMask) },
    { path: facecoreMask, sha256: sha256File(facecoreMask) },
    { path: socketPng, sha256: sha256File(socketPng) },
  ];
  if (lipsAlbedo !== socketPng) {
    inputs.push({ path: lipsAlbedo, sha256: sha256File(lipsAlbedo) });
  }
  return {
    script: BEARD_REL,
    argv,
    inputs,
    outputs: [{ path: outPng, sha256: outSha }],
    ran: true,
    gate: {
      pass: outSha === expected,
      detail:
        outSha === expected
          ? `beard output matches the pinned known-good (${outSha.slice(0, 12)})`
          : `beard output ${outSha.slice(0, 12)} vs known-good ${expected.slice(0, 12)}`,
    },
  };
}

/**
 * Visible-lip union shared by beard + detail (replay.py _vermilion_union).
 * Segmented from the lips-stage albedo with the derive lips mask as the
 * base region (same inputs as replay.py run_stage beard_shadow branch);
 * saved under the stage out dir for provenance. Deterministic on fixed
 * inputs (morphology + percentiles, no RNG), so re-runs agree byte for
 * byte. Spawns the tracked function; never a copy.
 */
export function buildVermilionUnion(storeDir: string, albedoPng: string, deriveOut: string): string {
  const faceReplayDir = path.join(repoRoot(), FACE_REPLAY_DIR_REL);
  const code = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(faceReplayDir)})`,
    "from pathlib import Path",
    "from replay import _vermilion_union",
    `out = _vermilion_union(Path(${JSON.stringify(storeDir)}), Path(${JSON.stringify(albedoPng)}), Path(${JSON.stringify(deriveOut)}))`,
    "print(str(out))",
  ].join("\n");
  const stdout = runMisePython(["-c", code], 600_000);
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const unionAbs = lines.length > 0 ? (lines[lines.length - 1] as string) : path.join(storeDir, "lip-vermilion-albedo-union.png");
  if (!existsSync(unionAbs)) throw new Error(`vermilion union missing at ${unionAbs}: refused`);
  return unionAbs;
}

/**
 * Beard weight carried into detail (replay.py detail_bands branch): at 0
 * the under-lower-lip band is spared the crease removal; positive weights
 * keep the legacy full-crease path. A case record without stage3_beard
 * carries no flag (the script default), never a throw.
 */
export function detailBeardWeightArgv(caseRec: Record<string, unknown>): string[] {
  const entry = caseRec["stage3_beard"];
  if (entry === null || typeof entry !== "object" || !("value" in entry)) return [];
  const cfg = caseValue<Record<string, unknown>>(caseRec, "stage3_beard");
  return ["--beard-weight", String(cfgValue<number>(cfg, "weight"))];
}

// Detail-band stage: argv mirrors the tracked replay.py run_stage
// detail_bands branch (same masks, same parameters, same order), but runs
// as its own subprocess AFTER beard_shadow so the manifest order
// beard_shadow -> detail_bands is honoured. Gains come from the manifest
// (base parameters + the subject override), never hard-coded here.
const DETAIL_REL = "tools/openclinxr/asset-pipeline/skin/face-replay/detail_bands.py";
const FACE_REPLAY_DIR_REL = "tools/openclinxr/asset-pipeline/skin/face-replay";
const STAGE3_DETAIL_MASKS_DRIVER_REL =
  "packages/openclinxr/factory-stations/src/face_realism/drivers/stage3_detail_masks.py";

function detailParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (value === undefined || value === null) {
    throw new Error(`chain manifest detail_bands parameters hold no ${key}: refused`);
  }
  return String(value);
}

export function runDetailSubStage(
  caseRec: Record<string, unknown>,
  chainSubject: string,
  manifestDoc: {
    stages?: Array<{ name?: unknown; output_paths?: unknown; parameters?: unknown }>;
    subjects?: Record<string, { overrides?: Record<string, Record<string, unknown>> }>;
  },
  detailInPng: string,
  outFile: string,
  outDir: string,
): SubStage {
  const def = (manifestDoc.stages ?? []).find((stage) => String(stage.name ?? "") === "detail_bands");
  if (def === undefined) {
    throw new Error("chain manifest holds no detail_bands stage: refused");
  }
  const paths = def.output_paths as Record<string, unknown> | undefined;
  const manifestOut = Object.values(paths ?? {}).find(
    (value): value is string => typeof value === "string" && value.endsWith(".png"),
  );
  if (manifestOut === undefined || path.basename(outFile) !== manifestOut) {
    throw new Error(
      `detail output ${path.basename(outFile)} != manifest output_paths (${String(manifestOut)}): refused`,
    );
  }
  const baseParams = (def.parameters ?? {}) as Record<string, unknown>;
  const subjectOverrides = manifestDoc.subjects?.[chainSubject]?.overrides?.["detail_bands"] ?? {};
  const params = { ...baseParams, ...subjectOverrides };
  const deriveOut = path.join(outDir, "derive_out");
  const lipsAlbedo = path.join(outDir, "albedo_lips.png");
  const driver = path.join(repoRoot(), STAGE3_DETAIL_MASKS_DRIVER_REL);
  const masksArgv = [
    "--face-replay-dir",
    path.join(repoRoot(), FACE_REPLAY_DIR_REL),
    "--albedo",
    detailInPng,
    "--derive-out",
    deriveOut,
    "--store",
    outDir,
  ];
  if (existsSync(lipsAlbedo)) masksArgv.push("--albedo-lips", lipsAlbedo);
  const masks = JSON.parse(
    runMisePython([driver, ...masksArgv], 600_000),
  ) as { eyes_mask?: unknown; brows_mask?: unknown; lips_mask?: unknown };
  const eyesMask = String(masks.eyes_mask ?? "");
  const browsMask = String(masks.brows_mask ?? "");
  const lipsMask = String(masks.lips_mask ?? "");
  if (!existsSync(eyesMask) || !existsSync(browsMask) || !existsSync(lipsMask)) {
    throw new Error("detail exclusion masks missing after the masks driver: refused");
  }
  const script = path.join(repoRoot(), DETAIL_REL);
  const reportJson = path.join(outDir, "stage3-detail-report.json");
  const argv = [
    detailInPng,
    outFile,
    "--facecore-mask",
    path.join(deriveOut, "mask-facecore.png"),
    "--scalp-mask",
    path.join(deriveOut, "mask-scalp.png"),
    "--lips-mask",
    lipsMask,
    "--eyes-mask",
    eyesMask,
    "--brows-mask",
    browsMask,
    ...detailBeardWeightArgv(caseRec),
    "--texels-per-mm",
    detailParam(params, "texels_per_mm"),
    "--seed",
    detailParam(params, "seed"),
    "--crease-gain",
    detailParam(params, "crease_gain"),
    "--pore-gain",
    detailParam(params, "pore_gain"),
    "--pore-noise-hi-mm",
    detailParam(params, "pore_noise_hi_mm"),
    "--pore-detrend-mm",
    String(params["pore_detrend_mm"] ?? 12.0),
    "--feather-mm",
    detailParam(params, "feather_mm"),
    "--lips-hug-mm",
    detailParam(params, "lips_hug_mm"),
    "--lips-feather-mm",
    detailParam(params, "lips_feather_mm"),
    "--scalp-fringe-mm",
    detailParam(params, "scalp_fringe_mm"),
    "--report-out",
    reportJson,
  ];
  runMisePython([script, ...argv], 600_000);
  const outSha = sha256File(outFile);
  const detailCfg = caseValue<Record<string, unknown>>(caseRec, "stage3_detail");
  const expected = cfgLeaf(detailCfg, "expected_out_sha256", "value");
  const inputs: StageIO[] = [
    { path: detailInPng, sha256: sha256File(detailInPng) },
    { path: path.join(deriveOut, "mask-facecore.png"), sha256: sha256File(path.join(deriveOut, "mask-facecore.png")) },
    { path: path.join(deriveOut, "mask-scalp.png"), sha256: sha256File(path.join(deriveOut, "mask-scalp.png")) },
    { path: eyesMask, sha256: sha256File(eyesMask) },
    { path: browsMask, sha256: sha256File(browsMask) },
    { path: lipsMask, sha256: sha256File(lipsMask) },
  ];
  const outputs: StageIO[] = [{ path: outFile, sha256: outSha }];
  if (existsSync(reportJson)) outputs.push({ path: reportJson, sha256: sha256File(reportJson) });
  return {
    script: DETAIL_REL,
    argv,
    inputs,
    outputs,
    ran: true,
    gate: {
      pass: outSha === expected,
      detail:
        outSha === expected
          ? `detail output matches the pinned known-good (${outSha.slice(0, 12)})`
          : `detail output ${outSha.slice(0, 12)} vs known-good ${expected.slice(0, 12)}`,
    },
  };
}
