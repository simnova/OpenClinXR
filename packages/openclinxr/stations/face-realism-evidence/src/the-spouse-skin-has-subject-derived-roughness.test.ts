import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SCRIPT = path.join(
  REPO,
  "tools/openclinxr/asset-pipeline/skin/roughness-breakup/apply_roughness_breakup.py",
);
const TARGET = path.join(
  REPO,
  "apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb",
);
const KNOWN_GOOD = path.join(
  REPO,
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
);
const DERIVE = path.join(
  REPO,
  "tools/openclinxr/asset-pipeline/skin/roughness-breakup/derive-inputs",
);

type Metrics = {
  tZoneMean: number;
  cheekMean: number;
  lipMean: number;
  minimum: number;
  maximum: number;
  standardDeviation: number;
  texels: { tZone: number; cheek: number; lips: number; coverage: number };
  baseline: {
    green: number;
    value: number;
    facecoreMedian: number;
    facecoreTexels: number;
    bodyOffFaceMinimum: number;
    bodyOffFaceMaximum: number;
    bodyOffFaceTexels: number;
    bodyOffFaceNonBaselineTexels: number;
  };
  maskGeometry: {
    oldTZoneLongAxisExtent: number;
    oldScalpOverlapTexels: number;
    tZoneLongAxisExtent: number;
    facecoreLongAxisExtent: number;
    scalpOverlapTexels: number;
    activeTZoneTexels: number;
  };
  gradientProbe: {
    roughSoftDiskMaxGradientGreen: number;
    r3HardClipMaxGradientGreen: number;
    targetNonLipMaxGradientGreen: number;
    targetLipEdgeMaxGradientGreen: number;
    roughLipEdgeMaxGradientGreen: number;
    lipTreatmentExcludedTexels: number;
  };
};

type Report = {
  mapSha256: string;
  knownGoodMapSha256: string;
  mapDiffersFromKnownGood: boolean;
  target: Metrics;
  knownGood: Metrics;
  packing: {
    redUnique: number[];
    blueUnique: number[];
    roughnessFactor: number;
    metallicFactor: number;
    texCoord: number;
    sampler: number;
  };
  counterweights: {
    baseColorUnchanged: boolean;
    preExistingBufferViewsUnchanged: boolean;
    inputJsonReconstructs: boolean;
    parsedJsonDiff: string[];
  };
  deriveInputs: Record<string, string>;
  defectProbe: {
    oldDiskLowerLidOverlapTexels: { nose: number; chin: number; forehead: number };
    oldLipFeatherLowerLidOverlapTexels: number;
    correctedTLowerLidOverlapTexels: number;
    correctedTScalpOverlapTexels: number;
  };
};

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// lash-follow r8 (tsk_381fda384bdda8dc) repacked the shipped partner GLB after this stage, so the
// stage's own output is the git blob the lash sidecar records as its input (pre-repack origin/main).
const ROUGHNESS_STAGE_OUTPUT_BLOB = "ad7ce69ead0327abe57d20f14cb84282b2def193";

function stageOutputGlb(): string {
  const provenance = JSON.parse(readFileSync(TARGET.replace(/\.glb$/, ".provenance.json"), "utf8")) as {
    stages?: { stage: string; outputSha256: string }[];
    lashFollowR8?: { inputSha256: string };
  };
  const bytes = execFileSync("git", ["cat-file", "blob", ROUGHNESS_STAGE_OUTPUT_BLOB], {
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
  });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const roughness = provenance.stages?.find((row) => row.stage === "subject_derived_roughness_breakup_v3");
  if (digest !== roughness?.outputSha256 || digest !== provenance.lashFollowR8?.inputSha256) {
    throw new Error(`blob ${ROUGHNESS_STAGE_OUTPUT_BLOB} is not the recorded roughness output (${digest})`);
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), "spouse-roughness-")), "stage-output.glb");
  writeFileSync(file, bytes);
  return file;
}

function inspect(glb: string = TARGET): Report {
  return JSON.parse(
    execFileSync(
      "mise",
      [
        "exec",
        "--",
        "python3",
        SCRIPT,
        "--check",
        "--glb",
        glb,
        "--derive-dir",
        DERIVE,
        "--known-good",
        KNOWN_GOOD,
      ],
      { cwd: REPO, encoding: "utf8" },
    ),
  ) as Report;
}

describe("the spouse skin has subject-derived roughness", () => {
  const report = inspect();

  it("makes the T-zone smoother than the cheek and pins the lip roughness", () => {
    expect(report.target.tZoneMean).toBeLessThan(report.target.cheekMean);
    expect(Math.abs(report.target.lipMean - 0.45)).toBeLessThanOrEqual(1 / 255);
    expect(report.target.texels.tZone).toBeGreaterThan(4_000);
    expect(report.target.texels.cheek).toBeGreaterThan(5_000);
    expect(report.target.texels.lips).toBeGreaterThan(1_000);
    expect(report.knownGood.tZoneMean).toBeGreaterThan(0);
    expect(report.knownGood.cheekMean).toBeGreaterThan(0);
    expect(report.knownGood.lipMean).toBeGreaterThan(0);
  });

  it("keeps every covered roughness texel positive with real variation", () => {
    expect(report.target.minimum).toBeGreaterThan(0);
    expect(report.target.maximum).toBeGreaterThan(report.target.minimum);
    expect(report.target.standardDeviation).toBeGreaterThan(0.01);
    expect(report.knownGood.minimum).toBeGreaterThan(0);
    expect(report.knownGood.maximum).toBeGreaterThan(report.knownGood.minimum);
    expect(report.knownGood.standardDeviation).toBeGreaterThan(0);
    expect(report.packing).toEqual({
      redUnique: [255],
      blueUnique: [255],
      roughnessFactor: 1,
      metallicFactor: 0,
      texCoord: 0,
      sampler: 0,
    });
  });

  it("anchors the face and body to the shipped baseline and excludes scalp and lower lids", () => {
    const shippedBaseline = Math.round(0.78 * 255) / 255;
    expect(report.target.baseline.green).toBe(199);
    expect(report.target.baseline.value).toBe(shippedBaseline);
    expect(Math.abs(report.target.baseline.facecoreMedian - shippedBaseline)).toBeLessThanOrEqual(
      1 / 255,
    );
    expect(report.target.baseline.bodyOffFaceMinimum).toBe(shippedBaseline);
    expect(report.target.baseline.bodyOffFaceMaximum).toBe(shippedBaseline);
    expect(report.target.baseline.bodyOffFaceNonBaselineTexels).toBe(0);
    expect(report.target.maskGeometry.tZoneLongAxisExtent).toBeLessThanOrEqual(
      report.target.maskGeometry.facecoreLongAxisExtent,
    );
    expect(report.target.maskGeometry.oldTZoneLongAxisExtent).toBeGreaterThan(
      report.target.maskGeometry.facecoreLongAxisExtent,
    );
    expect(report.target.maskGeometry.oldScalpOverlapTexels).toBeGreaterThan(0);
    expect(report.target.maskGeometry.scalpOverlapTexels).toBe(0);
    expect(report.defectProbe.oldLipFeatherLowerLidOverlapTexels).toBe(0);
    expect(report.defectProbe.oldDiskLowerLidOverlapTexels.nose).toBeGreaterThan(0);
    expect(report.defectProbe.oldDiskLowerLidOverlapTexels.forehead).toBeGreaterThan(0);
    expect(report.defectProbe.oldDiskLowerLidOverlapTexels.chin).toBe(0);
    expect(report.defectProbe.correctedTLowerLidOverlapTexels).toBe(0);
    expect(report.defectProbe.correctedTScalpOverlapTexels).toBe(0);
  });

  it("feathers every T-zone exclusion to ROUGH's own derived gradient bound", () => {
    const probe = report.target.gradientProbe;
    expect(probe.roughSoftDiskMaxGradientGreen).toBeGreaterThan(0);
    expect(probe.r3HardClipMaxGradientGreen).toBeGreaterThan(
      probe.roughSoftDiskMaxGradientGreen,
    );
    expect(probe.targetNonLipMaxGradientGreen).toBeLessThanOrEqual(
      probe.roughSoftDiskMaxGradientGreen,
    );
    expect(probe.lipTreatmentExcludedTexels).toBeGreaterThan(report.target.texels.lips);
    expect(probe.targetLipEdgeMaxGradientGreen).toBeLessThanOrEqual(
      probe.roughLipEdgeMaxGradientGreen,
    );
  });

  it("changes only the appended map and the skin material binding", () => {
    const stage = inspect(stageOutputGlb());
    expect(stage.mapSha256, "stage output carries the shipped roughness map").toBe(report.mapSha256);
    expect(stage.counterweights.baseColorUnchanged).toBe(true);
    expect(stage.counterweights.preExistingBufferViewsUnchanged).toBe(true);
    expect(stage.counterweights.inputJsonReconstructs).toBe(true);
    expect(stage.counterweights.parsedJsonDiff).toEqual([
      "bufferViews[64] appended",
      "images[5] appended",
      "textures[5] appended with sampler 0",
      "buffers[0].byteLength 9210520 -> 9219595",
      "materials[4].pbrMetallicRoughness.metallicRoughnessTexture added",
      "materials[4].pbrMetallicRoughness.roughnessFactor 0.7799999713897705 -> 1.0",
      "asset.extras.openClinXrSubjectRoughnessBreakup added",
    ]);
  });

  it("binds this subject's tracked derive inputs rather than the known-good map", () => {
    expect(report.mapDiffersFromKnownGood).toBe(true);
    expect(report.mapSha256).not.toBe(report.knownGoodMapSha256);
    expect(readFileSync(SCRIPT, "utf8")).not.toContain("mpfb-peds-parent-aisha.glb");
    const expected = Object.fromEntries(
      ["ao.png", "landmarks-uv.json", "mask-facecore.png", "mask-lips.png", "mask-scalp.png"].map(
        (name) => [
          `tools/openclinxr/asset-pipeline/skin/roughness-breakup/derive-inputs/${name}`,
          sha256(path.join(DERIVE, name)),
        ],
      ),
    );
    expect(report.deriveInputs).toEqual(expected);
    expect(Object.keys(report.deriveInputs).every((item) => !item.includes(".openclinxr"))).toBe(true);
  });
});
