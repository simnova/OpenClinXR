// Face-realism stage 1 helper: the tone anchor of a case whose tone token has
// no recorded anchor, measured from the case goal_front by tone-anchor.py and
// gated against the instrument calibration. Case values come from case-inputs.json.
import path from "node:path";
import { repoRoot } from "../repo-root.js";
import { ASSET_STORE_ROOT, readJsonFile, runMisePython } from "./shared.js";

export const TONE_ANCHOR_REL = "tools/openclinxr/asset-pipeline/skin/families/tone-anchor.py";
export const TONE_ANCHOR_REPORT_REL = "tools/openclinxr/asset-pipeline/skin/families/tone-anchor-report.json";

/** Pure gate for an instrument-measured anchor (exported for the counterweight test). */
export function toneAnchorGate(input: {
  distances: Record<string, number>;
  pick: string;
  nearestPick: string;
  noise: number;
  recordedPicksReproduced: boolean;
  pinned: number[] | null;
  anchor: number[];
}): { pass: boolean; detail: string; margin: number; marginOverNoise: number } {
  const ranked = Object.values(input.distances).sort((a, b) => a - b);
  const margin = ranked.length >= 2 ? Math.round((ranked[1]! - ranked[0]!) * 100) / 100 : 0;
  const ratio = input.noise > 0 ? Math.round((margin / input.noise) * 100) / 100 : 0;
  const pinMatch =
    input.pinned !== null &&
    input.pinned.length === 3 &&
    input.pinned.every((v, i) => Math.abs(v - input.anchor[i]!) < 0.005);
  const reasons: string[] = [];
  if (!input.recordedPicksReproduced) reasons.push("the instrument does not reproduce the recorded picks of its calibration subjects");
  if (!(ratio >= 1)) reasons.push(`margin ${margin} / calibration noise ${input.noise} = ${ratio} < 1`);
  if (input.pick !== input.nearestPick) reasons.push(`pick ${input.pick} != tone-report nearest ${input.nearestPick}`);
  if (input.pinned === null) reasons.push("case-inputs tone_anchor_lab is unpinned");
  else if (!pinMatch) reasons.push(`measured anchor ${JSON.stringify(input.anchor)} != case-inputs tone_anchor_lab ${JSON.stringify(input.pinned)}`);
  return {
    pass: reasons.length === 0,
    detail:
      reasons.length === 0
        ? `margin ${margin} / calibration noise ${input.noise} = ${ratio} >= 1; pick ${input.pick}; anchor equals the case-inputs pin`
        : reasons.join("; "),
    margin,
    marginOverNoise: ratio,
  };
}

export function measureToneAnchor(
  caseId: string,
  caseRec: Record<string, unknown>,
  recordFile: string,
  tone: string,
  families: Record<string, { forehead?: [number, number, number] }>,
  nearest: Record<string, string>,
): {
  anchor: [number, number, number];
  source: Record<string, unknown>;
  gate: { pass: boolean; detail: string; margin: number; marginOverNoise: number };
} {
  const record = readJsonFile(recordFile) as {
    cases?: Record<string, { references?: { goal_front?: { output?: { store_relpath?: unknown; sha256?: unknown } } } }>;
  };
  const out = record.cases?.[caseId]?.references?.goal_front?.output;
  if (typeof out?.store_relpath !== "string" || typeof out?.sha256 !== "string") {
    throw new Error(`tone report holds no anchor for ${tone} and the record names no goal_front image to measure one from`);
  }
  const imageAbs = path.join(ASSET_STORE_ROOT, out.store_relpath);
  const raw = runMisePython(
    [path.join(repoRoot(), TONE_ANCHOR_REL), "--image", imageAbs, "--expect-sha256", out.sha256],
    600_000,
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .at(-1);
  const row = JSON.parse(raw ?? "{}") as { lab?: [number, number, number]; image_sha256?: string };
  if (!Array.isArray(row.lab) || row.lab.length !== 3) {
    throw new Error("tone-anchor.py returned no Lab anchor: refused");
  }
  const calibration = readJsonFile(path.join(repoRoot(), TONE_ANCHOR_REPORT_REL)) as {
    calibration?: { noise_dLab_max_disagreement_with_recorded_anchor?: number; recorded_picks_reproduced?: Record<string, boolean> };
  };
  const noise = Number(calibration.calibration?.noise_dLab_max_disagreement_with_recorded_anchor ?? 0);
  const reproduced = Object.values(calibration.calibration?.recorded_picks_reproduced ?? {});
  const distances: Record<string, number> = {};
  for (const [family, info] of Object.entries(families)) {
    const mean = info.forehead;
    if (mean === undefined) continue;
    distances[family] = Math.sqrt(
      (row.lab[0] - mean[0]) ** 2 + (row.lab[1] - mean[1]) ** 2 + (row.lab[2] - mean[2]) ** 2,
    );
  }
  const pick = Object.entries(distances).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "";
  const pinnedRaw = (caseRec["tone_anchor_lab"] as { value?: unknown } | undefined)?.value;
  const pinned = Array.isArray(pinnedRaw) ? (pinnedRaw as number[]) : null;
  const gate = toneAnchorGate({
    distances,
    pick,
    nearestPick: nearest[tone] ?? "",
    noise,
    recordedPicksReproduced: reproduced.length > 0 && reproduced.every((v) => v === true),
    pinned,
    anchor: row.lab,
  });
  return {
    anchor: row.lab,
    source: {
      kind: "goal_front measurement (tone-anchor.py)",
      image: imageAbs,
      image_sha256: row.image_sha256 ?? null,
      calibration: TONE_ANCHOR_REPORT_REL,
      calibration_noise_dLab: noise,
    },
    gate,
  };
}

