/**
 * HB-05 — the face-preserving rung keeps every face triangle.
 *
 * RED (planted 2026-09-11): asserts the face-preserving ladder report at
 * docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json
 * against the LIVE GLBs. The five HB-03 over-budget bodies get a decimated
 * rung that keeps every face triangle (faceRetentionRatio 1) and every
 * joint, or a measured per-body noSurvivingRung reason.
 *
 * Face = meshes whose name matches /eye|brow|lash|teeth|tongue/i, the same
 * rule HB-03 used. Known-good: HB-03's five raw-rung bodies (retention 1,
 * joints 137, inside budget).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json");

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
});