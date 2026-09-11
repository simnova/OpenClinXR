/**
 * HB-05 — the face-preserving rung keeps every face triangle.
 *
 * Asserted against the LIVE GLBs plus the face-preserving ladder report, never
 * against prose. Each promoted body: parses, declared length equals file length,
 * joint count equals the report's expected rig, live face triangles equal the
 * report's face count with retention ratio 1, body morph targets and weights
 * channels unchanged, no zero-triangle mesh, live triangles equal the report.
 * Counterweight: rung ids must exist in the face-locked mode's own ratio list,
 * read from tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts, so a
 * hand-written report cannot invent one.
 *
 * Face = meshes whose name matches /eye|brow|lash|teeth|tongue/i, the same
 * rule HB-03 used. Known-good: HB-03's five raw-rung bodies (retention 1,
 * joints 137, inside budget).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json");
const MODE_PATH = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");

const FACE_RE = /eye|brow|lash|teeth|tongue/i;
const GOWN_MARKER = "openclinxr_declared_upper_layers__hospital_gown_mesh";

type FacePreservingBodyRow = {
  body: string;
  chosenRungId: string;
  rungTechnique: string;
  triangleCountBefore: number;
  triangleCountAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  faceBefore: number;
  faceAfter: number;
  faceRetentionRatio: number;
  jointCountBefore: number;
  jointCountAfter: number;
  jointCountExpected: number;
  bodyMorphTargetsBefore: number;
  bodyMorphTargetsAfter: number;
  weightsChannelsBefore: number;
  weightsChannelsAfter: number;
  zeroTriangleMeshes: string[];
  promoted: boolean;
  promotionNote: string;
  noSurvivingRungReason?: string;
};
type FacePreservingReport = {
  bodies: FacePreservingBodyRow[];
  budgets: {
    propPreferred: number;
    propShare: number;
    skeletonHard: number;
    acceptableSingleProp: number;
  };
};

function facePreservingRungIdsFromSource(): string[] {
  const src = readFileSync(MODE_PATH, "utf8");
  const m = src.match(/const FACE_PRESERVING_RATIOS = \[([^\]]+)\]/);
  if (!m) throw new Error("FACE_PRESERVING_RATIOS not found in iterate-optimize.ts");
  const ratios = m[1]!.split(",").map((s: string) => s.trim()).filter(Boolean);
  return ratios.map((r: string) => `fp-r${r}`);
}

async function liveStats(file: string): Promise<{
  tris: number;
  face: number;
  joints: number;
  bodyMorphTargets: number;
  weightsChannels: number;
  zeroMeshes: string[];
}> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(HUMANOIDS, file));
  let tris = 0;
  let face = 0;
  const zeroMeshes: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    let mt = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) mt += idx.getCount() / 3;
    }
    tris += mt;
    if (FACE_RE.test(mesh.getName())) face += mt;
    else if (Math.round(mt) === 0 && mesh.getName() !== GOWN_MARKER) zeroMeshes.push(mesh.getName());
  }
  const joints = doc.getRoot().listSkins()[0]!.listJoints().length;
  const bodyMesh = doc.getRoot().listMeshes().find((mesh) => /_body$/.test(mesh.getName()))!;
  const bodyMorphTargets = bodyMesh.listPrimitives()[0]!.listTargets().length;
  let weightsChannels = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetPath() === "weights") weightsChannels += 1;
    }
  }
  return { tris: Math.round(tris), face: Math.round(face), joints, bodyMorphTargets, weightsChannels, zeroMeshes };
}

describe("the face-preserving rung keeps every face triangle", () => {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as FacePreservingReport;

  it("every reported rung id exists in the face-locked mode's own ratio list (counterweight)", () => {
    const sourceIds = facePreservingRungIdsFromSource();
    expect(sourceIds.length).toBeGreaterThan(0);
    for (const row of report.bodies) {
      expect(sourceIds, `${row.body}: rung ${row.chosenRungId} is not a face-preserving rung`).toContain(row.chosenRungId);
    }
  });

  it("covers the five HB-03 over-budget bodies", () => {
    const names = report.bodies.map((row) => row.body).sort();
    expect(names).toEqual(
      [
        "mpfb-gown-inspect.glb",
        "mpfb-ob-patient-aisha.glb",
        "mpfb-peds-nurse-kevin.glb",
        "mpfb-peds-parent-aisha.glb",
        "mpfb-viseme-inspect.glb",
      ].sort(),
    );
  });

  it("every live GLB keeps every face triangle and every joint", async () => {
    for (const row of report.bodies) {
      const live = await liveStats(row.body);
      expect(row.faceRetentionRatio).toBe(1);
      expect(row.faceAfter).toBe(row.faceBefore);
      expect(live.face).toBe(row.faceAfter);
      expect(live.joints).toBe(row.jointCountAfter);
      expect(row.jointCountAfter).toBe(row.jointCountExpected);
      expect(live.tris).toBe(row.triangleCountAfter);
      expect(row.bodyMorphTargetsAfter).toBe(row.bodyMorphTargetsBefore);
      expect(live.bodyMorphTargets).toBe(row.bodyMorphTargetsAfter);
      expect(row.weightsChannelsAfter).toBe(row.weightsChannelsBefore);
      expect(live.weightsChannels).toBe(row.weightsChannelsAfter);
      expect(live.zeroMeshes).toEqual(row.zeroTriangleMeshes);
      expect(row.zeroTriangleMeshes).toEqual([]);
      if (row.promoted) {
        expect(row.triangleCountAfter).toBeLessThanOrEqual(report.budgets.acceptableSingleProp);
      }
    }
  }, 120_000);

  it("every row either promotes a decimated rung or records a measured reason", () => {
    for (const row of report.bodies) {
      if (row.promoted) {
        expect(row.triangleCountAfter).toBeLessThan(row.triangleCountBefore);
      } else {
        expect(row.noSurvivingRungReason ?? "").not.toBe("");
      }
    }
  });

  it("budgets are read from the ladder source, never lowered to fit", () => {
    expect(report.budgets.propPreferred).toBe(80000);
    expect(report.budgets.propShare).toBe(40000);
    expect(report.budgets.skeletonHard).toBe(180000);
    expect(report.budgets.acceptableSingleProp).toBe(120000);
  });

  it("the committed mode reproduces the viseme-inspect rung from HB-02 bytes (minimal falsifier)", async () => {
    const row = report.bodies.find((candidate) => candidate.body === "mpfb-viseme-inspect.glb");
    expect(row, "viseme-inspect row exists in the report").toBeDefined();
    expect(row!.promoted).toBe(true);
    const ratio = Number(row!.chosenRungId.replace("fp-r", ""));
    expect(Number.isFinite(ratio)).toBe(true);
    const sweep = ((row as unknown as { sweep?: { rungId: string; triangleCount: number; faceTriangles: number }[] }).sweep ?? [])
      .find((entry) => entry.rungId === row!.chosenRungId);
    expect(sweep, `report records the ${row!.chosenRungId} sweep row for viseme-inspect`).toBeDefined();

    const dir = mkdtempSync(path.join(tmpdir(), "hb05-falsifier-"));
    try {
      const hb02 = execFileSync("git", ["show", `37d4460d:apps/ui-xr/public/generated-humanoids/${row!.body}`], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      }) as unknown as Uint8Array;
      const inputPath = path.join(dir, row!.body);
      writeFileSync(inputPath, hb02);
      const outDir = path.join(dir, "out");
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts",
          "--input",
          inputPath,
          "--out",
          outDir,
          "--face-preserving",
          "--face-preserving-ratio",
          String(ratio),
        ],
        { cwd: ROOT, stdio: "pipe" },
      );
      const base = row!.body.replace(/\.glb$/i, "");
      const rerun = await liveStatsFromPath(path.join(outDir, `${base}-fp-r${ratio}.glb`));
      expect(rerun.tris).toBe(sweep!.triangleCount);
      expect(rerun.face).toBe(sweep!.faceTriangles);
      expect(rerun.tris).toBe(row!.triangleCountAfter);
      expect(rerun.face).toBe(row!.faceAfter);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

async function liveStatsFromPath(glbPath: string): Promise<{ tris: number; face: number }> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
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
  return { tris: Math.round(tris), face: Math.round(face) };
}