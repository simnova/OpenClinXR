// Face-realism stage 3 entry: a case with no goal-derived donor island or
// colour solve enters the skin chain from its own stage-2 output.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { caseValue, runMisePython, sha256File } from "./shared.js";
import type { Stage3ManifestDoc } from "./chain.js";
import type { SubStage } from "./stages-c.js";

const FAMILY_ENTRY = "stage2-family-output";
const STAGE3_FAMILY_BASE_DRIVER_REL =
  "packages/openclinxr/factory-stations/src/face_realism/drivers/stage3_family_base.py";

/**
 * Stage-3 entry kind for a case. A case whose compose/colour rows carry an
 * `entry` of stage2-family-output has no goal-derived donor island or colour
 * solve and enters the chain from its own stage-2 output; any other row is
 * goal-derived and runs compose + colour. Mixed rows refuse: one case cannot
 * be half goal-derived.
 */
export function stage3EntryKind(caseRec: Record<string, unknown>): "goal_derived" | "family_base" {
  const isFamily = (key: string): boolean => {
    const value = (caseRec[key] as { value?: unknown } | undefined)?.value;
    if (value === null || typeof value !== "object") return false;
    return ((value as Record<string, unknown>)["entry"] as { value?: unknown } | undefined)?.value === FAMILY_ENTRY;
  };
  const compose = isFamily("stage3_compose");
  const colour = isFamily("stage3_colour");
  if (compose !== colour) {
    throw new Error("stage-3 compose and colour rows disagree on the entry (family base vs goal derived): refused");
  }
  return compose ? "family_base" : "goal_derived";
}

export function runFamilyBaseSubStage(caseRec: Record<string, unknown>, outDir: string): SubStage {
  const stage2Out = path.join(outDir, "stage2-layers.png");
  if (!existsSync(stage2Out)) {
    throw new Error(`stage-3 family entry needs the stage-2 output at ${stage2Out}: refused`);
  }
  const deriveSize = caseValue<number>(caseRec, "derive_size");
  const outPng = path.join(outDir, "stage3-family-base.png");
  const driver = path.join(repoRoot(), STAGE3_FAMILY_BASE_DRIVER_REL);
  const argv = ["--in", stage2Out, "--size", String(deriveSize), "--out", outPng];
  const raw = runMisePython([driver, ...argv], 600_000)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  const report = JSON.parse(raw ?? "{}") as { out_size?: number[]; out_sha256?: string };
  const outSha = sha256File(outPng);
  const sized = Array.isArray(report.out_size) && report.out_size[0] === deriveSize && report.out_size[1] === deriveSize;
  return {
    script: STAGE3_FAMILY_BASE_DRIVER_REL,
    argv,
    inputs: [{ path: stage2Out, sha256: sha256File(stage2Out) }],
    outputs: [{ path: outPng, sha256: outSha }],
    ran: true,
    gate: {
      pass: sized && report.out_sha256 === outSha,
      detail: sized
        ? `stage-2 output carried to the derive size ${String(deriveSize)} (report sha == file sha ${outSha.slice(0, 12)})`
        : `family base is ${JSON.stringify(report.out_size)}, derive size ${String(deriveSize)}`,
    },
  };
}


/**
 * The case record is the source of the stage-3 GLB; replay.py verifies the GLB
 * against the manifest subject's glb_sha256. When the two name different files
 * the station runs a run-local manifest copy carrying the case's sha (recorded
 * in extra.manifestGlbOverride); equal shas run the repo manifest untouched, so
 * a case whose manifest row agrees is byte-for-byte unchanged.
 */
export function resolveRunManifest(
  manifestDoc: Stage3ManifestDoc,
  manifestAbs: string,
  chainSubject: string,
  glbSha: string,
  outDir: string,
): {
  manifestDoc: Stage3ManifestDoc;
  manifestAbs: string;
  override: { from: string; to: string; manifest: string } | null;
} {
  type Doc = Stage3ManifestDoc & { subjects?: Record<string, { glb_sha256?: unknown }> };
  const doc = manifestDoc as Doc;
  const manifestGlbSha = doc.subjects?.[chainSubject]?.glb_sha256;
  if (typeof manifestGlbSha !== "string" || manifestGlbSha === glbSha) {
    return { manifestDoc, manifestAbs, override: null };
  }
  const local = JSON.parse(JSON.stringify(doc)) as Doc;
  local.subjects![chainSubject]!.glb_sha256 = glbSha;
  const localAbs = path.join(outDir, "chain-manifest.run.json");
  writeFileSync(localAbs, `${JSON.stringify(local, null, 1)}\n`);
  return { manifestDoc: local, manifestAbs: localAbs, override: { from: manifestGlbSha, to: glbSha, manifest: localAbs } };
}
