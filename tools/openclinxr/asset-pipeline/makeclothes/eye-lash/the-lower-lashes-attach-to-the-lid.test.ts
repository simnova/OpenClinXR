import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { materializeSingleFile } from "../../../evidence/fixtures/ci-cleanup-inputs.js";

/**
 * CARD tsk_0a4a6ccf5ebb0da0 (lash-tick): the lower lashes attach to the lid.
 *
 * The face-defects eye-tick row (findings.json) shows a detached dark dash,
 * area 61 px at bbox (625,582,15,17) in S/eyeshell/final/eyeshell1-front.png
 * at 1024, below the image-right eye; the shonolash (no-lash) control has no
 * dash, so the cause sits on the lash mesh. T2b (this card) replaces the old
 * T2 blanket lower-drop with a selective detach-drop: each lower-lash card
 * (connected tuft) is scored against the lower lid-margin loop (body
 * eye-opening boundary, topology-derived) by tipDrop and length, and dropped
 * only past population MAD bars. Hiding all lower lashes fails this card.
 *
 * RED: the bake input carries the detached central-R cluster (world x
 * 0.0288-0.0349: 10 cards, len up to 3.3mm vs med 1.85, tips at the global
 * floor). GREEN: the baked output keeps >=95% of cards per eye, keeps every
 * remaining lower card within the loop-derived bars, drops the dash-zone
 * cluster, and still passes blink-follow on both sides.
 *
 * claimScope: byte measurement on the pinned bake input below; the input GLB
 * is never written (outputs go to os.tmpdir). notEvidenceFor:
 * clinical_validity, production_asset_readiness; pixel grade lives in the
 * lash-tick store sheet (human-graded).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/lash_blink_follow.py",
);
const MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/manifest.json",
);
const INPUT = join(
  REPO_ROOT,
  ".openclinxr/realism-spike/eyemesh/aisha-hp-cornea.glb",
);

type SideRow = {
  cardsBase: number;
  cardsDrop: number;
  cardsKeep: number;
  lowerBase: number;
  tipDropThrMm: number;
  lenThrMm: number;
  maxKeptTipDropMm: number;
  maxKeptLenMm: number;
  droppedCx: number[];
};

type BakeReport = {
  t2b: { treatment: string; trisTotal: number; trisKeep: number; sides: Record<string, SideRow> };
  a3: unknown;
};

type BlinkRow = { lidMarginVerts: number; sameDirection: boolean; travelPct: number; pass: boolean };
type MeasureReport = { lashPrimTargets: number; pass: boolean; blinkFollow: Record<string, BlinkRow> };

function runTool(args: string[]): string {
  return execFileSync("mise", ["exec", "--", "python3", TOOL, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function bakeOnce(): { out: string; report: BakeReport } {
  const dir = mkdtempSync(join(tmpdir(), "lashtick-"));
  const out = join(dir, "lash-t2b.glb");
  const raw = runTool([INPUT, out]);
  expect(existsSync(out), "baked output written to tmpdir (never the repo)").toBe(true);
  return { out, report: JSON.parse(raw) as BakeReport };
}

let shared: { out: string; report: BakeReport } | null = null;
let inputBytes: Buffer | null = null;

beforeAll(() => {
  // ci-w10: the bake input is machine-local (gitignored). Materialize it from
  // the asset store first; the manifest pins sha256 + bytes and a missing
  // store throws a named `[ci-cleanup]` error.
  materializeSingleFile(
    join(REPO_ROOT, "tools/openclinxr/asset-pipeline/makeclothes/eye-lash/eyemesh-input.manifest.json"),
    REPO_ROOT,
  );
  expect(existsSync(INPUT), INPUT).toBe(true);
  inputBytes = readFileSync(INPUT);
  shared = bakeOnce();
  expect(shared.out.length).toBeGreaterThan(0);
}, 600000);

describe("the lower lashes attach to the lid", () => {
  it("(1) manifest records the T2b selective treatment with the CC0 licence", () => {
    expect(existsSync(MANIFEST), MANIFEST).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      tool: string;
      treatment: string;
      licence: { rights: string; header: string; requiredRecordPhrases: string[] };
    };
    expect(m.tool).toBe("lash_blink_follow.py");
    expect(m.treatment).toMatch(/T2b/);
    expect(m.licence.rights).toBe("cc0");
    expect(m.licence.header.length).toBeGreaterThan(0);
    expect(m.licence.requiredRecordPhrases).toContain("CC0 1.0");
  });

  it("(2) RED: the bake input still carries the detached dash-zone cluster", () => {
    const { report } = shared!;
    // The tool reports what it drops: the dash-zone R cluster must be in it.
    const r = report.t2b.sides["R"]!;
    const dashZone = r.droppedCx.filter((x) => x >= 0.028 && x <= 0.035);
    expect(dashZone.length, `R droppedCx in dash zone [0.028,0.035]: ${r.droppedCx}`).toBeGreaterThanOrEqual(3);
    // Input bytes untouched by the bake.
    expect(readFileSync(INPUT).equals(inputBytes!), "input GLB bytes unchanged").toBe(true);
  });

  it("(3) GREEN: the baked output keeps >=95% of cards per eye, all attached", () => {
    const { report } = shared!;
    expect(report.t2b.treatment).toMatch(/T2b/);
    for (const side of ["L", "R"]) {
      const row = report.t2b.sides[side]!;
      expect(row.cardsBase).toBeGreaterThan(400);
      expect(row.cardsKeep / row.cardsBase, `${side} keep ratio >= 0.95`).toBeGreaterThanOrEqual(0.95);
      expect(row.maxKeptTipDropMm, `${side} every kept lower card within the loop tipDrop bar`).toBeLessThanOrEqual(
        row.tipDropThrMm,
      );
      expect(row.maxKeptLenMm, `${side} every kept lower card within the length bar`).toBeLessThanOrEqual(
        row.lenThrMm,
      );
    }
  });

  it("(4) GREEN: the baked output still follows blink on both sides", () => {
    const { out } = shared!;
    const raw = runTool([out, "--measure"]);
    const m = JSON.parse(raw) as MeasureReport;
    expect(m.lashPrimTargets).toBe(6);
    for (const side of ["L", "R"]) {
      const row = m.blinkFollow[side]!;
      expect(row.lidMarginVerts, `${side} lid-margin verts > 0`).toBeGreaterThan(0);
      expect(row.sameDirection, `${side} same direction as lid`).toBe(true);
      expect(row.travelPct, `${side} >= 80% lid travel`).toBeGreaterThanOrEqual(80);
      expect(row.pass, `${side} passes`).toBe(true);
    }
    expect(m.pass).toBe(true);
  });
});

// NOT TESTED: pixel grade (store lash-tick sheet, human-graded); gaze at
// +25/-25 deg (compat-eyes card); the eyeshell studio variant framing.
