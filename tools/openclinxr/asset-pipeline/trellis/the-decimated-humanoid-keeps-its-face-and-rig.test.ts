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
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json");
const LADDER_PATH = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/vr-postopt-ladder.ts");

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
};
type LadderReport = { bodies: LadderBodyRow[]; rungIds: string[] };

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

  it("every reported rung id exists in the ladder source's own rung list (counterweight)", () => {
    const sourceIds = ladderRungIdsFromSource();
    expect(report.rungIds).toEqual(sourceIds);
    expect(report.bodies.length).toBeGreaterThan(0);
    for (const row of report.bodies) {
      expect(sourceIds, `${row.body}: rung ${row.chosenRungId} is not a ladder rung`).toContain(row.chosenRungId);
    }
  });

  it("every live GLB parses and its declared length equals its file length", () => {
    for (const row of report.bodies) {
      const bytes = readFileSync(path.join(HUMANOIDS, row.body));
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
      expect(row.bytesAfter).toBe(bytes.byteLength);
    }
  });

  it("joint count is unchanged and equals the report's expected rig", async () => {
    for (const row of report.bodies) {
      const live = await liveStats(row.body);
      expect(live.joints).toBe(row.jointCountAfter);
      expect(row.jointCountAfter).toBe(row.jointCountBefore);
      expect(row.jointCountAfter).toBe(row.jointCountExpected);
    }
  });

  it("face triangles retain at least the ratio the report records, and the rung did not collapse", async () => {
    for (const row of report.bodies) {
      const live = await liveStats(row.body);
      expect(live.face).toBeGreaterThanOrEqual(Math.floor(row.faceBefore * row.faceRetentionRatio));
      expect(row.faceAfter).toBe(live.face);
      expect(row.featureSurvival).not.toBe("collapsed");
      expect(live.tris).toBe(row.triangleCountAfter);
    }
  }, 120_000);
});
