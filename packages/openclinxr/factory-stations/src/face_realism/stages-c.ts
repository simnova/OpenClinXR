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
  const script = path.join(repoRoot(), BEARD_REL);
  const outPng = path.join(outDir, "albedo_beard.png");
  const argv = [
    "--landmarks",
    landmarks,
    "--lips-mask",
    lipsMask,
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
  return {
    script: BEARD_REL,
    argv,
    inputs: [
      { path: landmarks, sha256: sha256File(landmarks) },
      { path: lipsMask, sha256: sha256File(lipsMask) },
      { path: facecoreMask, sha256: sha256File(facecoreMask) },
      { path: socketPng, sha256: sha256File(socketPng) },
    ],
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
