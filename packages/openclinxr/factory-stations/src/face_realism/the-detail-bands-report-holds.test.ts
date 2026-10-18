import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The detail-bands report holds (card tsk_68c071233175cae2).
 *
 * Assertions recompute from the two tracked reports (the wrinkle
 * wrinkle-scale-report.json and this card's detail-bands-report.json):
 * G1 executed lists from the manifest + case skips, G2/G3 midpoints from
 * the wrinkle pre/post bands and the station bands, run A == run B, and
 * store shas recomputed from the store when it is present. No band number
 * is restated here; everything is read from the two files.
 */

/** Local repo-root walk: repo-root.js is entrypoint-reachable, so importing
 * it here would count against the test-internal-import ceiling. */
function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

const FACE_DIR = "packages/openclinxr/factory-stations/src/face_realism";
const WRINKLE_REL = "tools/openclinxr/asset-pipeline/skin/face-replay/wrinkle-scale-report.json";
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";

type Bands = Record<string, Record<string, { crease: number; pore: number }>>;

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(testRepoRoot(), rel), "utf8")) as Record<string, unknown>;
}

function shaFile(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function positionShas(glb: string): string {
  const root = testRepoRoot();
  return execFileSync(
    "python3",
    [
      join(root, FACE_DIR, "drivers", "stage4_position_shas.py"),
      "--lid-conform-dir",
      join(root, "tools/openclinxr/asset-pipeline/realism-head/lid-conform"),
      "--glb",
      glb,
    ],
    { encoding: "utf8" },
  );
}

describe("the detail-bands report holds", () => {
  it("(G1) executed stage lists equal the manifest order and the manifest minus skips", () => {
    const root = testRepoRoot();
    const manifest = readJson("tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json") as {
      stages: Array<{ name: string }>;
    };
    const manifestNames = manifest.stages.map((stage) => stage.name);
    const inputs = readJson(join(FACE_DIR, "case-inputs.json")) as {
      cases: Record<string, { stage3_skip_stages: { value: string[] } }>;
    };
    const report = readJson(join(FACE_DIR, "detail-bands-report.json")) as unknown as {
      subjects: Record<string, { executedChainStages: string[]; replayExecutedChainStages: string[]; runA: string; runB: string }>;
    };
    const subjects = report.subjects;
    const caseFor: Record<string, string> = { body2: "body2", aisha: "aisha" };
    for (const [subject, rows] of Object.entries(subjects)) {
      expect(rows.executedChainStages).toEqual(manifestNames);
      const skips = new Set(inputs.cases[caseFor[subject]]!.stage3_skip_stages.value);
      expect(rows.replayExecutedChainStages).toEqual(manifestNames.filter((name) => !skips.has(name)));
    }
  });

  it("(G2/G3) station forehead bands lie past the midpoint from wrinkle PRE toward wrinkle POST", () => {
    const wrinkle = readJson(WRINKLE_REL) as {
      pre: Record<string, { bands: Bands }>;
      post: Record<string, { bands: Bands }>;
    };
    const report = readJson(join(FACE_DIR, "detail-bands-report.json")) as {
      subjects: Record<string, { stationBands: Bands; gates: Record<string, { pre: number; post: number; station: number; midpoint: number; past_midpoint: boolean; margin: number; margin_exceeds_noise: boolean }> }>;
    };
    const renderFor: Record<string, string> = { body2: "render_body2", aisha: "render_aisha" };
    for (const [subject, rows] of Object.entries(report.subjects)) {
      for (const region of ["forehead"] as const) {
        for (const band of ["crease", "pore"] as const) {
          const pre = wrinkle.pre[renderFor[subject]]!.bands[region]![band]!;
          const post = wrinkle.post[subject]!.bands[region]![band]!;
          const station = rows.stationBands[region]![band]!;
          const mid = (pre + post) / 2;
          const towardPost = post > pre ? station >= mid : station <= mid;
          expect(towardPost, `${subject} ${region} ${band}: station ${station} past midpoint ${mid} (pre ${pre}, post ${post})`).toBe(true);
          const key = `${region}_${band}`;
          expect(rows.gates[key]!.midpoint).toBeCloseTo(mid, 4);
          expect(rows.gates[key]!.past_midpoint).toBe(true);
          expect(rows.gates[key]!.station).toBe(station);
          expect(rows.gates[key]!.margin_exceeds_noise).toBe(true);
        }
      }
    }
  });

  it("(run A == run B) stage-3 albedo and stage-4 per-mesh POSITION match per subject", () => {
    const report = readJson(join(FACE_DIR, "detail-bands-report.json")) as {
      subjects: Record<string, { runAEqualsRunB: { stage3AlbedoSha256: boolean; stage4PositionEqual: boolean } }>;
      child: { refusals: Array<{ stage: number; file: string; line: number }> };
    };
    for (const rows of Object.values(report.subjects)) {
      expect(rows.runAEqualsRunB.stage3AlbedoSha256).toBe(true);
      expect(rows.runAEqualsRunB.stage4PositionEqual).toBe(true);
    }
    expect(report.child.refusals.length).toBeGreaterThan(0);
    for (const refusal of report.child.refusals) {
      expect(typeof refusal.file).toBe("string");
      expect(refusal.line).toBeGreaterThan(0);
    }
  });

  it(existsSync(STORE_ROOT) ? "(store) report shas recompute from the store" : "(store absent: sha verification skipped)", () => {
    if (!existsSync(STORE_ROOT)) return;
    const report = readJson(join(FACE_DIR, "detail-bands-report.json")) as {
      subjects: Record<string, { finalAlbedo: { file: string; sha256: string }; stationBandsRender: string; stationBandsRenderSha256: string }>;
      child: { runA: string; runB: string };
      sheets: Array<{ path: string; sha256: string }>;
      noise: { render1: string; render1Sha256: string };
      byteIdentity: Record<string, { station: string }>;
    };
    const checked: string[] = [];
    for (const rows of Object.values(report.subjects)) {
      expect(shaFile(rows.finalAlbedo.file), rows.finalAlbedo.file).toBe(rows.finalAlbedo.sha256);
      checked.push(rows.finalAlbedo.file);
      expect(shaFile(rows.stationBandsRender), rows.stationBandsRender).toBe(rows.stationBandsRenderSha256);
      checked.push(rows.stationBandsRender);
    }
    for (const sheet of report.sheets) {
      expect(shaFile(sheet.path), sheet.path).toBe(sheet.sha256);
      checked.push(sheet.path);
    }
    expect(shaFile(report.noise.render1), report.noise.render1).toBe(report.noise.render1Sha256);
    checked.push(report.noise.render1);
    expect(checked.length).toBeGreaterThan(6);
  }, 300_000);

  it(existsSync(STORE_ROOT) ? "(store) run A/B stage-4 POSITION maps recompute equal" : "(store absent: POSITION verification skipped)", () => {
    if (!existsSync(STORE_ROOT)) return;
    const report = readJson(join(FACE_DIR, "detail-bands-report.json")) as {
      subjects: Record<string, { runA: string; runB: string; runAEqualsRunB: { stage4PositionMapRunA: Record<string, string>; stage4PositionMapRunB: Record<string, string> } }>;
    };
    for (const [subject, rows] of Object.entries(report.subjects)) {
      const glbIn = (run: string): string => {
        const dir = join(STORE_ROOT, run);
        const hit = readdirSync(dir).find((entry) => entry.endsWith("-lidconform.glb"));
        if (hit === undefined) throw new Error(`no lidconform GLB in ${dir}`);
        return join(dir, hit);
      };
      const posA = JSON.parse(positionShas(glbIn(rows.runA))) as { positionSha256: Record<string, string> };
      const posB = JSON.parse(positionShas(glbIn(rows.runB))) as { positionSha256: Record<string, string> };
      expect(posA.positionSha256, `${subject} run A POSITION recomputes`).toEqual(
        rows.runAEqualsRunB.stage4PositionMapRunA,
      );
      expect(posB.positionSha256, `${subject} run B POSITION recomputes`).toEqual(
        rows.runAEqualsRunB.stage4PositionMapRunB,
      );
    }
  }, 600_000);
});
