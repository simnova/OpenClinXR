/**
 * #178 — hm08 calibration anchor: historical lying before-column + collision-safe inspect.
 *
 * claimScope: calibration-anchor / pre-fix guard behavior for hm08 upright-export only.
 * notEvidenceFor: production promotion, clinical validity, Quest readiness, hm08 adoption.
 *
 * The historical lying row lives in a TRACKED seed JSON under tools/ so a clean clone has a
 * before-column. Live product GLBs under .openclinxr/evidence/ may be upright and must not
 * hard-abort the suite.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensurePreFix, measureGlbAxes } from "./hm08-upright-export.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Tracked seed — survives clean clone; #134 cagematch never writes here. */
export const LYING_CALIBRATION_SEED_PATH = path.join(
  HERE,
  "hm08-lying-calibration-seed.json",
);

const EVIDENCE_134 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-134");
const EVIDENCE_156 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-156");
/** Legacy path #134 still writes; no longer treated as a preserved lying control. */
const PATH_134_CANDIDATE = path.join(EVIDENCE_134, "hm08-rig-carry-candidate.glb");
/** Upright product from #156. */
const PATH_156_UPRIGHT = path.join(EVIDENCE_156, "hm08-rig-carry-candidate-upright.glb");
/** Lying control out of #134 write reach (optional live re-export with old flags). */
const PATH_156_LYING_CONTROL = path.join(
  EVIDENCE_156,
  "hm08-rig-carry-candidate-lying-control.glb",
);
const TREATMENT_TABLE_PATH = path.join(EVIDENCE_156, "treatment-table.json");

const CLAIM_SCOPE = "hm08_calibration_anchor_only_no_promotion";
const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "learner_readiness",
  "clinical_validity",
  "hm08_production_adoption",
  "b_plus_visual_realism_gate",
];

export type LyingCalibrationSeed = {
  schemaVersion: string;
  historicalLyingRow: {
    meshW: number;
    meshH: number;
    meshD: number;
    meshLongestAxis: string;
    jointLongestAxis: string;
    verdict: string;
    treatment?: string;
    meshMinY?: number;
    jointSpanY?: number;
    triangleCount?: number;
    rootIsIdentity?: boolean;
  };
  treatmentTable: Array<{
    label: string;
    meshLongestAxis: string;
    jointLongestAxis: string;
    verdict: string;
    meshW?: number;
    meshH?: number;
    meshD?: number;
    jointSpanY?: number;
    triangleCount?: number;
    rootIsIdentity?: boolean;
    exportYup?: boolean;
    forceZUpStanding?: boolean;
    meshMinY?: number;
  }>;
  notEvidenceFor?: string[];
};

export type AnchorFile = {
  path: string;
  exists: boolean;
  sha256: string | null;
  meshW: number | null;
  meshH: number | null;
  meshD: number | null;
  longestAxis: string | null;
};

export type CalibrationAnchorReport = {
  historicalRow: {
    source: string;
    trackedInGit: boolean;
    meshW: number;
    meshH: number;
    meshD: number;
    longestAxis: string;
    verdict: string;
  } | null;
  anchors: AnchorFile[];
  anchorsCollide: boolean;
  treatmentRows: {
    label: string;
    meshLongestAxis: string;
    jointLongestAxis: string;
    verdict: string;
  }[];
  ensurePreFixThrewOnUprightAnchor: boolean;
  liveAnchorDelta: {
    path: string;
    meshW: number;
    meshH: number;
    meshD: number;
    longestAxis: string;
    note: string;
  } | null;
  claimScope: string;
  notEvidenceFor: string[];
};

export function loadLyingCalibrationSeed(): LyingCalibrationSeed {
  if (!existsSync(LYING_CALIBRATION_SEED_PATH)) {
    throw new Error(
      `tracked lying calibration seed missing at ${LYING_CALIBRATION_SEED_PATH}`,
    );
  }
  return JSON.parse(readFileSync(LYING_CALIBRATION_SEED_PATH, "utf8")) as LyingCalibrationSeed;
}

function isTrackedInGit(absPath: string): boolean {
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/");
  const r = spawnSync("git", ["ls-files", "--error-unmatch", rel], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return r.status === 0;
}

function sha256File(absPath: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(absPath));
  return h.digest("hex");
}

async function describeAnchor(absPath: string): Promise<AnchorFile> {
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, "/");
  if (!existsSync(absPath)) {
    return {
      path: rel,
      exists: false,
      sha256: null,
      meshW: null,
      meshH: null,
      meshD: null,
      longestAxis: null,
    };
  }
  const sha = sha256File(absPath);
  try {
    const m = await measureGlbAxes(absPath);
    return {
      path: rel,
      exists: true,
      sha256: sha,
      meshW: m.meshWidth,
      meshH: m.meshHeight,
      meshD: m.meshDepth,
      longestAxis: m.meshLongestAxis,
    };
  } catch {
    return {
      path: rel,
      exists: true,
      sha256: sha,
      meshW: null,
      meshH: null,
      meshD: null,
      longestAxis: null,
    };
  }
}

function treatmentRowsFromDiskOrSeed(): {
  label: string;
  meshLongestAxis: string;
  jointLongestAxis: string;
  verdict: string;
}[] {
  if (existsSync(TREATMENT_TABLE_PATH)) {
    try {
      const cached = JSON.parse(readFileSync(TREATMENT_TABLE_PATH, "utf8")) as {
        treatments?: Array<{
          treatment: string;
          meshLongestAxis: string;
          jointLongestAxis: string;
        }>;
        rows?: Array<{
          treatment: string;
          meshLongestAxis: string;
          jointLongestAxis: string;
          pass: boolean;
        }>;
      };
      if (Array.isArray(cached.rows) && cached.rows.length > 0) {
        return cached.rows.map((r) => ({
          label: r.treatment,
          meshLongestAxis: r.meshLongestAxis,
          jointLongestAxis: r.jointLongestAxis,
          verdict: r.pass ? "PASS" : "FAIL",
        }));
      }
      if (Array.isArray(cached.treatments) && cached.treatments.length > 0) {
        return cached.treatments.map((t) => {
          const pass =
            t.meshLongestAxis === "y" && t.jointLongestAxis === "y";
          return {
            label: t.treatment,
            meshLongestAxis: t.meshLongestAxis,
            jointLongestAxis: t.jointLongestAxis,
            verdict: pass ? "PASS" : "FAIL",
          };
        });
      }
    } catch {
      /* fall through to seed */
    }
  }
  const seed = loadLyingCalibrationSeed();
  return seed.treatmentTable.map((t) => ({
    label: t.label,
    meshLongestAxis: t.meshLongestAxis,
    jointLongestAxis: t.jointLongestAxis,
    verdict: t.verdict,
  }));
}

/**
 * Contract surface for #178 planted tests.
 * Reads historical row from TRACKED seed; never requires live product to match broken shape.
 */
export async function inspectHm08CalibrationAnchor(): Promise<CalibrationAnchorReport> {
  const seed = loadLyingCalibrationSeed();
  const hist = seed.historicalLyingRow;
  const seedRel = path
    .relative(REPO_ROOT, LYING_CALIBRATION_SEED_PATH)
    .replace(/\\/g, "/");

  let threw = false;
  try {
    await ensurePreFix();
  } catch {
    threw = true;
  }

  // Two product paths that used to collide + optional lying control out of #134 reach.
  const anchors = await Promise.all([
    describeAnchor(PATH_134_CANDIDATE),
    describeAnchor(PATH_156_UPRIGHT),
    describeAnchor(PATH_156_LYING_CONTROL),
  ]);

  const a134 = anchors[0]!;
  const a156 = anchors[1]!;
  const anchorsCollide =
    Boolean(a134.exists && a156.exists && a134.sha256 && a156.sha256) &&
    a134.sha256 === a156.sha256;

  let liveAnchorDelta: CalibrationAnchorReport["liveAnchorDelta"] = null;
  const livePath = existsSync(PATH_156_UPRIGHT)
    ? PATH_156_UPRIGHT
    : existsSync(PATH_134_CANDIDATE)
      ? PATH_134_CANDIDATE
      : null;
  if (livePath) {
    try {
      const live = await measureGlbAxes(livePath);
      const disagrees =
        Math.abs(live.meshHeight - hist.meshH) > 0.02 ||
        Math.abs(live.meshDepth - hist.meshD) > 0.02 ||
        live.meshLongestAxis !== hist.meshLongestAxis;
      if (disagrees) {
        liveAnchorDelta = {
          path: path.relative(REPO_ROOT, livePath).replace(/\\/g, "/"),
          meshW: live.meshWidth,
          meshH: live.meshHeight,
          meshD: live.meshDepth,
          longestAxis: live.meshLongestAxis,
          note:
            "Live product no longer matches historical lying row — expected after #156 upright fix. Historical row remains in tracked seed.",
        };
      }
    } catch {
      /* missing/unreadable glb */
    }
  }

  return {
    historicalRow: {
      source: seedRel,
      trackedInGit: isTrackedInGit(LYING_CALIBRATION_SEED_PATH),
      meshW: hist.meshW,
      meshH: hist.meshH,
      meshD: hist.meshD,
      longestAxis: hist.meshLongestAxis,
      verdict: hist.verdict,
    },
    anchors,
    anchorsCollide,
    treatmentRows: treatmentRowsFromDiskOrSeed(),
    ensurePreFixThrewOnUprightAnchor: threw,
    liveAnchorDelta,
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: [
      ...NOT_EVIDENCE_FOR,
      ...(seed.notEvidenceFor ?? []).filter((x) => !NOT_EVIDENCE_FOR.includes(x)),
    ],
  };
}
