import { repoRoot } from "@openclinxr/factory-station-core/runner";
/**
 * HB-03 — the decimated humanoid keeps its face and rig.
 *
 * Asserted against the LIVE GLBs plus the ladder report, never against prose.
 * No GLB on disk was rewritten by this card (STOP branch, requirement 2), so
 * every row's after-values equal the live bytes; the test nets exactly that.
 * Each body: parses, declared length equals file length, joint count equals
 * the report's expected rig (137, or 138 on gown bodies whose skin binds one
 * extra neutral_bone), live face triangles retain at least the ratio the
 * report records (never a hardcoded number), the chosen rung is not
 * "collapsed". Counterweight: the report's rung id must exist in the ladder
 * source's own rung list, so a hand-written report cannot invent one.
 *
 * ## SUPERSEDED FOR PROMOTED BODIES (HB-05)
 *
 * HB-05 promoted a face-preserving decimated rung for five of these bodies and
 * rewrote their live GLBs, so the HB-03 rows below no longer describe the live
 * bytes for those bodies. For a body with a promoted HB-05 row in
 * docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json, every
 * assertion in this file runs against the HB-05 row as the current record; the
 * HB-03 row stays as the historical record of the pre-decimation bytes. Bodies
 * without a promoted HB-05 row keep asserting against the HB-03 row. Nothing
 * below is deleted or weakened: the same clauses run, only the record they read
 * for promoted bodies moved forward. The rung-id counterweight keeps checking
 * HB-03 rows against the ladder's RATIOS in vr-postopt-ladder.ts; for bodies
 * present in the HB-05 report (promoted or demoted) it checks the HB-05 row's
 * fp-r id against FACE_PRESERVING_RATIOS in
 * tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts.
 *
 * ## DEMOTED ROW (ci-w9 P3)
 *
 * The Sep30 mouth rebuild (afe8abced) gave peds-parent-aisha rebuilt geometry,
 * so its HB-05 row no longer promotes a decimated rung: it records a measured
 * noSurvivingRungReason and keeps ratio-1 / 137-joint floors on the re-measured
 * source. This file therefore asserts the re-pinned HB-03 row for that body
 * (after-values equal the live bytes, history preserved in previousFaceBefore
 * and remeasureNote), and the rung check reads its rung from the HB-05 report.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = repoRoot();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json");
const HB05_REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json");
const LADDER_PATH = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts");
const FACE_MODE_PATH = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");

const FACE_RE = /eye|brow|lash|teeth|tongue/i;

type LadderBodyRow = {
  body: string;
  chosenRungId: string;
  triangleCountBefore: number;
  triangleCountAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  featureSurvival: string;
  faceBefore: number;
  faceAfter: number;
  faceRetentionRatio: number;
  jointCountBefore: number;
  jointCountAfter: number;
  jointCountExpected: number;
  promoted: boolean;
  remeasureNote?: string;
};
type LadderReport = { bodies: LadderBodyRow[]; rungIds: string[] };
type Hb05BodyRow = {
  body: string;
  chosenRungId: string;
  triangleCountBefore: number;
  triangleCountAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  featureSurvival: string;
  faceBefore: number;
  faceAfter: number;
  faceRetentionRatio: number;
  jointCountBefore: number;
  jointCountAfter: number;
  jointCountExpected: number;
  promoted: boolean;
  remeasureNote?: string;
};
type Hb05Report = { bodies: Hb05BodyRow[] };

/** Current record per body: the promoted HB-05 row where one exists, else the HB-03 row. */
function currentRows(hb03: LadderReport, hb05: Hb05Report): LadderBodyRow[] {
  const promoted = new Map(hb05.bodies.filter((row) => row.promoted).map((row) => [row.body, row]));
  return hb03.bodies.map((row) => promoted.get(row.body) ?? row);
}

function facePreservingRungIdsFromSource(): string[] {
  const src = readFileSync(FACE_MODE_PATH, "utf8");
  const m = src.match(/const FACE_PRESERVING_RATIOS = \[([^\]]+)\]/);
  if (!m) throw new Error("FACE_PRESERVING_RATIOS not found in iterate-optimize.ts");
  const ratios = m[1]!.split(",").map((s: string) => s.trim()).filter(Boolean);
  return ratios.map((r: string) => `fp-r${r}`);
}

function ladderRungIdsFromSource(): string[] {
  const src = readFileSync(LADDER_PATH, "utf8");
  const m = src.match(/const RATIOS = \[([^\]]+)\]/);
  if (!m) throw new Error("RATIOS not found in vr-postopt-ladder.ts");
  const ratios = m[1]!.split(",").map((s: string) => s.trim()).filter(Boolean);
  return ["raw", ...ratios.map((r: string) => `r${r}`)];
}

async function liveStats(file: string): Promise<{ tris: number; face: number; joints: number }> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(HUMANOIDS, file));
  let tris = 0;
  let face = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    let mt = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) mt += idx.getCount() / 3;
    }
    tris += mt;
    if (FACE_RE.test(mesh.getName())) face += mt;
  }
  const joints = doc.getRoot().listSkins()[0]!.listJoints().length;
  return { tris: Math.round(tris), face: Math.round(face), joints };
}

describe("the decimated humanoid keeps its face and rig", () => {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as LadderReport;
  const hb05 = JSON.parse(readFileSync(HB05_REPORT_PATH, "utf8")) as Hb05Report;
  const rows = currentRows(report, hb05);

  it("every reported rung id exists in the ladder source's own rung list (counterweight)", () => {
    const sourceIds = ladderRungIdsFromSource();
    expect(report.rungIds).toEqual(sourceIds);
    expect(report.bodies.length).toBeGreaterThan(0);
    const faceIds = facePreservingRungIdsFromSource();
    const hb05ByBody = new Map(hb05.bodies.map((row) => [row.body, row]));
    for (const row of report.bodies) {
      const hb05Row = hb05ByBody.get(row.body);
      if (hb05Row) {
        expect(faceIds, `${row.body}: rung ${hb05Row.chosenRungId} is not a face-preserving rung`).toContain(hb05Row.chosenRungId);
      } else {
        expect(sourceIds, `${row.body}: rung ${row.chosenRungId} is not a ladder rung`).toContain(row.chosenRungId);
      }
    }
  });

  it("every live GLB parses and its declared length equals its file length", () => {
    for (const row of rows) {
      const bytes = readFileSync(path.join(HUMANOIDS, row.body));
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
      expect(row.bytesAfter).toBe(bytes.byteLength);
    }
  });

  it("joint count is unchanged and equals the report's expected rig", async () => {
    for (const row of rows) {
      const live = await liveStats(row.body);
      expect(live.joints).toBe(row.jointCountAfter);
      expect(row.jointCountAfter).toBe(row.jointCountBefore);
      expect(row.jointCountAfter).toBe(row.jointCountExpected);
    }
  });

  it("face triangles retain at least the ratio the report records, and the rung did not collapse", async () => {
    for (const row of rows) {
      const live = await liveStats(row.body);
      expect(live.face).toBeGreaterThanOrEqual(Math.floor(row.faceBefore * row.faceRetentionRatio));
      expect(row.faceAfter).toBe(live.face);
      expect(row.featureSurvival).not.toBe("collapsed");
      expect(live.tris).toBe(row.triangleCountAfter);
    }
  }, 120_000);

  it("every re-measured row cites a superseding commit that touched its GLB", () => {
    const repin = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/repin-decimation-rows.py");
    expect(existsSync(repin), `re-pin producer missing: ${repin}`).toBe(true);
    expect(String((report as { generated?: unknown }).generated)).toContain("repin-decimation-rows.py");
    expect(String((hb05 as { generated?: unknown }).generated)).toContain("repin-decimation-rows.py");
    for (const row of rows) {
      const note = row.remeasureNote;
      if (!note) continue;
      const tokens = note.match(/\b[0-9a-f]{7,40}\b/g) ?? [];
      expect(tokens.length, `${row.body}: remeasureNote cites no commit`).toBeGreaterThan(0);
      const history = execFileSync("git", ["log", "--format=%H", "--", `apps/ui-xr/public/generated-humanoids/${row.body}`], {
        cwd: ROOT,
        encoding: "utf8",
      }) as unknown as string;
      const full = history.trim().split("\n");
      const cited = tokens.filter((t) => full.some((h) => h.startsWith(t)));
      expect(cited.length, `${row.body}: remeasureNote cites no commit from this body's history`).toBeGreaterThan(0);
      const fabricated = tokens.filter((t) => /[a-f]/.test(t) && !full.some((h) => h.startsWith(t)));
      expect(fabricated, `${row.body}: remeasureNote cites unknown commits`).toEqual([]);
    }
  });
});
