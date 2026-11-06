// Face-realism stage 8: albedo_embed (st-vitfamily D1c; D3a/D3b chain in R2).
//
// Embeds the stage-3 composed family albedo into the stage-4 GLB's skin
// material baseColor at 4096 px, through the sheet hook's albedo-only mode
// (mpfb_skin_sheet.py --embed-albedo). No re-bake, no Imagine/model call:
// both inputs are replayed from the stage record and sha-checked before the
// embed runs.
//
// D3a/D3b preparation chain: the raw stage3-colour-out.png may carry painted
// brows (mesh-brow cases) or an island-edge tone step. A case may record a
// prepared albedo chain in `prepared_albedo`: an ordered list of
// {step, path, sha256} links whose last link is the PNG to embed (e.g. Aisha:
// brow clear via tools/openclinxr/asset-pipeline/skin/face-replay/brow_form.py
// --brow-form mesh + temple-seam feather). Every link is existence- and
// sha-verified and recorded in rec.inputs ahead of the embed; without the
// field the raw stage3-colour-out.png is embedded directly.
//
// Case data lives only in case-inputs.json. This module names no case: the
// subject key comes from the case's recorded materializer_argv, and the skin
// material names stay in the sheet hook's SUBJECT_SKIN_MATERIALS map.
import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import {
  caseValue,
  emptyStageRecord,
  runMisePython,
  sha256File,
  type StageIO,
  type StageRecord,
} from "./shared.js";

/** Sheet-hook path (kept local: shared.ts bytes are bound by the brow
 * argv-proof in face-realism-evidence, so no new export there). */
const SKIN_SHEET_REL = "tools/openclinxr/asset-pipeline/skin/mpfb_skin_sheet.py";

/** Albedo embed size (px). 4096 matches the stage-3 compose output; drop to
 * 2048 only if a loader/test refuses 4096 (the refusal is printed). */
export const ALBEDO_EMBED_SIZE = 4096;

/** Subject key from the recorded bake argv (mirrors stages-b.ts
 * stage4OutputStem; never hard-coded per case). */
export function albedoEmbedSubject(caseRec: Record<string, unknown>): string {
  const bakeArgv = caseValue<string[]>(caseRec, "materializer_argv");
  const tokenAfter = (flag: string): string => {
    const i = bakeArgv.indexOf(flag);
    return i >= 0 && typeof bakeArgv[i + 1] === "string" ? bakeArgv[i + 1]! : "";
  };
  return tokenAfter("--reference") || tokenAfter("--eye-colour-reference");
}

export function runAlbedoEmbed(
  caseRec: Record<string, unknown>,
  stages: StageRecord[],
  outDir: string,
): StageRecord {
  const rec = emptyStageRecord(8, "albedo_embed");
  const t0 = Date.now();
  const refuse = (blockReason: string, wanted: string, detail: string): StageRecord => ({
    ...rec,
    ran: false,
    blocked: true,
    blockReason,
    wanted,
    gate: { pass: false, detail },
    wallSeconds: (Date.now() - t0) / 1000,
  });

  const stage3 = stages.find((entry) => entry.stage === 3);
  const colourOut = stage3?.outputs.find((entry) => entry.path.endsWith("stage3-colour-out.png"));
  if (colourOut === undefined || !existsSync(colourOut.path)) {
    return refuse(
      "stage-3 stage3-colour-out.png missing from the stage record: refused",
      "a completed stage-3 skin_chain with stage3-colour-out.png",
      "no stage-3 albedo to embed",
    );
  }
  if (sha256File(colourOut.path) !== colourOut.sha256) {
    return refuse(
      `stage-3 colour output sha mismatch at ${colourOut.path}: refused`,
      "the recorded stage-3 albedo byte-identical to its record",
      "stage-3 albedo sha mismatch",
    );
  }
  const stage4 = stages.find((entry) => entry.stage === 4);
  const glbIn = stage4?.outputs[0];
  if (glbIn === undefined || !existsSync(glbIn.path)) {
    return refuse(
      "stage-4 output GLB missing from the stage record: refused",
      "a completed stage-4 lid_conform_bake with its output GLB",
      "no stage-4 GLB to embed into",
    );
  }
  if (sha256File(glbIn.path) !== glbIn.sha256) {
    return refuse(
      `stage-4 GLB sha mismatch at ${glbIn.path}: refused`,
      "the recorded stage-4 GLB byte-identical to its record",
      "stage-4 GLB sha mismatch",
    );
  }
  const subject = albedoEmbedSubject(caseRec);
  if (subject.length === 0) {
    return refuse(
      "no --reference/--eye-colour-reference subject in materializer_argv: refused",
      "the case's recorded bake argv naming its subject",
      "subject unknown; skin material key refused",
    );
  }

  // D3a/D3b: optional prepared-albedo chain. Each link is {step, path,
  // sha256}; the last link is the PNG to embed. All links are verified and
  // recorded so the stage record reproduces the exact input (path + sha).
  const inputs: StageIO[] = [{ path: colourOut.path, sha256: colourOut.sha256 }];
  let albedoPath = colourOut.path;
  let albedoSha = colourOut.sha256;
  const prepRaw = (caseRec["prepared_albedo"] ?? []) as Array<Record<string, unknown>>;
  if (prepRaw.length > 0) {
    for (const link of prepRaw) {
      const lp = String(link["path"] ?? "");
      const ls = String(link["sha256"] ?? "");
      if (lp.length === 0 || ls.length === 0 || !existsSync(lp)) {
        return refuse(
          `prepared-albedo link missing at ${lp || "(no path)"}: refused`,
          "every prepared_albedo link present on disk",
          "prepared-albedo chain broken",
        );
      }
      if (sha256File(lp) !== ls) {
        return refuse(
          `prepared-albedo sha mismatch at ${lp}: refused`,
          "every prepared_albedo link byte-identical to its record",
          "prepared-albedo sha mismatch",
        );
      }
      inputs.push({ path: lp, sha256: ls });
    }
    const last = prepRaw[prepRaw.length - 1]!;
    albedoPath = String(last["path"]);
    albedoSha = String(last["sha256"]);
  }

  const stem = path.basename(glbIn.path, ".glb");
  const outGlb = path.join(outDir, `${stem}-family-albedo.glb`);
  const sheet = path.join(repoRoot(), SKIN_SHEET_REL);
  const argv = [sheet, "--embed-albedo", glbIn.path, outGlb, albedoPath, `--subject=${subject}`];
  rec.script = SKIN_SHEET_REL;
  rec.argv = argv;
  inputs.push({ path: glbIn.path, sha256: glbIn.sha256 });
  rec.inputs = inputs;

  let stdout: string;
  try {
    stdout = runMisePython(argv, 600_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...rec,
      ran: false,
      blocked: true,
      blockReason: `albedo embed failed: ${message.slice(0, 300)}`,
      wanted: `${SKIN_SHEET_REL} --embed-albedo completing on the stage-4 GLB`,
      gate: { pass: false, detail: "embed did not complete" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  const marker = "SKIN_ALBEDO_EMBEDDED ";
  const markerAt = stdout.lastIndexOf(marker);
  let report: Record<string, unknown> = {};
  if (markerAt >= 0) {
    try {
      report = JSON.parse(stdout.slice(markerAt + marker.length).split("\n")[0]!) as Record<string, unknown>;
    } catch {
      report = { unparsed: true };
    }
  }
  if (!existsSync(outGlb)) {
    return {
      ...rec,
      ran: false,
      blocked: true,
      blockReason: `embed exited without writing ${outGlb}: refused`,
      wanted: `${SKIN_SHEET_REL} --embed-albedo writing its output GLB`,
      gate: { pass: false, detail: "embed did not produce its output" },
      wallSeconds: (Date.now() - t0) / 1000,
    };
  }
  const outSha = sha256File(outGlb);
  const albedoShaOk = report["albedoSha256"] === albedoSha;
  const outShaOk = report["sha256"] === outSha;
  rec.outputs = [{ path: outGlb, sha256: outSha }];
  rec.ran = true;
  rec.gate = {
    pass: albedoShaOk && outShaOk,
    detail:
      albedoShaOk && outShaOk
        ? `embedded ${albedoSha.slice(0, 12)} into ${path.basename(glbIn.path)} skin ${String(report["material"])} at ${String(report["size"])}px -> ${outSha.slice(0, 12)}`
        : `embed report shas disagree (albedo ${albedoShaOk}, output ${outShaOk}): refused`,
  };
  rec.wallSeconds = (Date.now() - t0) / 1000;
  rec.extra = { report, preparedChain: prepRaw.length > 0 };
  return rec;
}
