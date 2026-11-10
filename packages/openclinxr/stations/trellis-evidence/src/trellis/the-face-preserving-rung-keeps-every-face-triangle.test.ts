import { repoRoot } from "@openclinxr/factory-station-core/runner";
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
 *
 * ## DEMOTED ROW (ci-w9 P3)
 *
 * peds-parent-aisha's Sep11 fp-r0.4 output did not survive the Sep30 mouth
 * rebuild (afe8abced): its row no longer promotes a rung and instead records
 * a measured noSurvivingRungReason, keeping ratio-1 and 137-joint floors on
 * the re-measured source (face 33360, tris 73012). previousFaceBefore preserves
 * the pre-rebuild 52778. This is a deliberate rebuild, not a silent loss, so
 * the row is re-pinned — not DEFECT.
 *
 * ## POST-RUNG STAGES (cap10 option B, tsk_27e0cec12cab410d)
 *
 * A row whose shipped GLB gained geometry after the rung keeps the rung output in
 * rungTrisAfter/rungFaceAfter and lists each later stage in postRungStages with deltas copied
 * from a tracked, sha-pinned source (the sidecar's teethSwapB1 block). triangleCountAfter and
 * faceAfter stay live because the-decimated-humanoid-keeps-its-face-and-rig and
 * measure-decimation-rows.ts read them as live. Asserted: rungFaceAfter == faceBefore,
 * live == rung + sum(deltas), the source sha matches disk, and the fitted mouth tris of the live
 * GLB minus the source's preImageMouthTris equal the delta.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ROOT = repoRoot();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-postopt-ladder-face-preserving-2026-09-11.json");
const MODE_PATH = path.join(ROOT, "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts");

const FACE_RE = /eye|brow|lash|teeth|tongue/i;

function readRepoFile(relPath: string): Buffer | undefined {
  const abs = path.join(ROOT, relPath);
  return existsSync(abs) ? readFileSync(abs) : undefined;
}
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
  remeasureNote?: string;
  previousFaceBefore?: number;
  rungTrisAfter?: number;
  rungFaceAfter?: number;
  postRungStages?: PostRungStage[];
};
type PostRungStage = {
  stage: string;
  card: string;
  trisDelta: number;
  faceDelta: number;
  source: string;
  sourceSha256: string;
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

const MOUTH_RE = { teeth: /teeth/i, tongue: /tongue/i };

/**
 * Every reason a post-rung row does not bind live = rung + deltas to its sources. Empty = bound.
 * Pure over its inputs so the counterweight clause can feed it mutated rows.
 */
function postRungErrors(
  row: Pick<FacePreservingBodyRow, "body" | "faceBefore" | "rungTrisAfter" | "rungFaceAfter" | "postRungStages">,
  live: { tris: number; face: number; sha256: string; mouth: { teeth: number; tongue: number } },
  readSource: (relPath: string) => Buffer | undefined,
): string[] {
  const errors: string[] = [];
  const stages = row.postRungStages ?? [];
  if (stages.length === 0) return [`${row.body}: no postRungStages`];
  if (row.rungTrisAfter === undefined || row.rungFaceAfter === undefined) errors.push(`${row.body}: rung record missing`);
  if (row.rungFaceAfter !== row.faceBefore) errors.push(`${row.body}: rungFaceAfter ${row.rungFaceAfter} != faceBefore ${row.faceBefore}`);
  const sumTris = stages.reduce((a, st) => a + st.trisDelta, 0);
  const sumFace = stages.reduce((a, st) => a + st.faceDelta, 0);
  if (live.tris !== (row.rungTrisAfter ?? NaN) + sumTris) errors.push(`${row.body}: live tris ${live.tris} != rung ${row.rungTrisAfter} + ${sumTris}`);
  if (live.face !== (row.rungFaceAfter ?? NaN) + sumFace) errors.push(`${row.body}: live face ${live.face} != rung ${row.rungFaceAfter} + ${sumFace}`);
  for (const st of stages) {
    if (!st.source || !st.sourceSha256) {
      errors.push(`${row.body}: stage ${st.stage} has no source/sourceSha256`);
      continue;
    }
    const bytes = readSource(st.source.split("#", 1)[0]!);
    if (!bytes) {
      errors.push(`${row.body}: stage source ${st.source} is not on disk`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== st.sourceSha256) errors.push(`${row.body}: stage source sha does not match disk`);
    if (st.stage !== "mouth-swap") continue;
    const block = (JSON.parse(bytes.toString("utf8")) as { teethSwapB1?: { output?: { sha256?: string }; preImageMouthTris?: { teeth: number; tongue: number } } }).teethSwapB1;
    const pre = block?.preImageMouthTris;
    if (!pre) {
      errors.push(`${row.body}: source has no teethSwapB1.preImageMouthTris`);
      continue;
    }
    if (block?.output?.sha256 !== live.sha256) errors.push(`${row.body}: teethSwapB1.output.sha256 does not pin the live GLB`);
    const mouthDelta = live.mouth.teeth + live.mouth.tongue - pre.teeth - pre.tongue;
    if (st.trisDelta !== mouthDelta) errors.push(`${row.body}: trisDelta ${st.trisDelta} != live mouth - preImageMouthTris ${mouthDelta}`);
    if (st.faceDelta !== mouthDelta) errors.push(`${row.body}: faceDelta ${st.faceDelta} != live mouth - preImageMouthTris ${mouthDelta}`);
  }
  return errors;
}

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
  sha256: string;
  mouth: { teeth: number; tongue: number };
}> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(HUMANOIDS, file));
  let tris = 0;
  let face = 0;
  const zeroMeshes: string[] = [];
  const mouth = { teeth: 0, tongue: 0 };
  for (const mesh of doc.getRoot().listMeshes()) {
    let mt = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) mt += idx.getCount() / 3;
    }
    tris += mt;
    if (MOUTH_RE.teeth.test(mesh.getName())) mouth.teeth += mt;
    else if (MOUTH_RE.tongue.test(mesh.getName())) mouth.tongue += mt;
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
  const sha256 = createHash("sha256").update(readFileSync(path.join(HUMANOIDS, file))).digest("hex");
  return { tris: Math.round(tris), face: Math.round(face), joints, bodyMorphTargets, weightsChannels, zeroMeshes, sha256, mouth };
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
      if (row.postRungStages) {
        // Supersedes faceAfter == faceBefore for rows with a post-rung stage: the rung kept every
        // face triangle (rungFaceAfter == faceBefore) and the stage deltas account for the rest.
        // Do not delete or widen this to make a stage-less row pass; add the stage with its source.
        expect(postRungErrors(row, live, readRepoFile)).toEqual([]);
      } else {
        expect(row.faceAfter, `${row.body}: live face moved after the rung; record the stage in postRungStages (cap10 option B), never raise faceBefore`).toBe(row.faceBefore);
      }
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

  it("a post-rung stage that does not bind to its source fails (counterweight)", async () => {
    const row = report.bodies.find((candidate) => candidate.body === "mpfb-viseme-inspect.glb")!;
    expect(row.postRungStages?.length, "viseme-inspect carries the mouth-swap stage").toBe(1);
    const live = await liveStats(row.body);
    expect(postRungErrors(row, live, readRepoFile)).toEqual([]);
    const stage = row.postRungStages![0]!;
    const mutate = (st: Partial<PostRungStage>, extra: Partial<FacePreservingBodyRow> = {}) =>
      postRungErrors({ ...row, ...extra, postRungStages: [{ ...stage, ...st }] }, live, readRepoFile);
    expect(mutate({ trisDelta: stage.trisDelta + 1 }).join("\n")).toMatch(/live tris .* != rung/);
    expect(mutate({ trisDelta: stage.trisDelta + 1, faceDelta: stage.faceDelta }, { rungTrisAfter: row.rungTrisAfter! - 1 }).join("\n")).toMatch(/trisDelta .* != live mouth/);
    expect(mutate({ source: "" }).join("\n")).toMatch(/no source/);
    expect(mutate({ sourceSha256: "0".repeat(64) }).join("\n")).toMatch(/sha does not match disk/);
    expect(mutate({}, { faceBefore: row.faceBefore + 6928 }).join("\n")).toMatch(/rungFaceAfter .* != faceBefore/);
    expect(postRungErrors(row, { ...live, sha256: "f".repeat(64) }, readRepoFile).join("\n")).toMatch(/does not pin the live GLB/);
  }, 60_000);

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

  it("the demoted row preserves its pre-rebuild face as history", () => {
    const row = report.bodies.find((candidate) => candidate.body === "mpfb-peds-parent-aisha.glb");
    expect(row, "peds-parent row exists in the HB-05 report").toBeDefined();
    expect(row!.promoted).toBe(false);
    expect(row!.noSurvivingRungReason ?? "").not.toBe("");
    expect(row!.previousFaceBefore).toBe(52778);
    expect(row!.faceBefore).toBe(33360);
    expect(row!.faceAfter).toBe(33360);
  });

  it("every re-measured row cites a superseding commit that touched its GLB", () => {
    expect(String((report as { generated?: unknown }).generated)).toContain("repin-decimation-rows.py");
    for (const row of report.bodies) {
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

  it("the committed mode reproduces the viseme-inspect rung from the promoted (tightjeans) lineage (minimal falsifier)", async () => {
    const row = report.bodies.find((candidate) => candidate.body === "mpfb-viseme-inspect.glb");
    expect(row, "viseme-inspect row exists in the report").toBeDefined();
    expect(row!.promoted).toBe(true);
    const ratio = Number(row!.chosenRungId.replace("fp-r", ""));
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBe(0.4);
    const sweep = ((row as unknown as { sweep?: { rungId: string; triangleCount: number; faceTriangles: number; inputLineage?: string }[] }).sweep ?? [])
      .find((entry) => entry.rungId === row!.chosenRungId && entry.inputLineage?.includes("tightjeans"));
    expect(sweep, `report records the ${row!.chosenRungId} sweep row for viseme-inspect on the tightjeans lineage`).toBeDefined();

    const dir = mkdtempSync(path.join(tmpdir(), "hb05-falsifier-"));
    try {
      const tightjeans = execFileSync("git", ["show", `57e27730:apps/ui-xr/public/generated-humanoids/${row!.body}`], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
      }) as unknown as Uint8Array;
      const inputPath = path.join(dir, row!.body);
      writeFileSync(inputPath, tightjeans);
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
      expect(rerun.tris).toBe(row!.rungTrisAfter ?? row!.triangleCountAfter);
      expect(rerun.face).toBe(row!.rungFaceAfter ?? row!.faceAfter);
      const live = await liveStats(row!.body);
      const stages = row!.postRungStages ?? [];
      expect(live.tris).toBe(rerun.tris + stages.reduce((a, st) => a + st.trisDelta, 0));
      expect(live.face).toBe(rerun.face + stages.reduce((a, st) => a + st.faceDelta, 0));
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