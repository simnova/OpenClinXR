import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import {
  CANONICAL_HUMANOID_BONES,
  GENERATED_HUMAN_RIGGING_BODY_PROFILES,
  type GeneratedHumanRiggingBodyProfile,
  type GeneratedHumanRiggingReport,
  runGeneratedHumanRiggingArtifactsCli,
} from "./generated-human-rigging-artifacts.js";

type VariantMatrixReport = {
  schemaVersion: "openclinxr.generated-human-rigging-variant-matrix.v1";
  generatedAt: string;
  claimBoundary: "local_static_rigging_matrix_not_visual_or_production_readiness";
  adversarialReviewers: Array<"ux-friction-critic" | "clinical-safety-critic" | "implementation-plan-gap-attacker">;
  screenshotArtifact: string;
  bodyProfiles: Array<{
    bodyProfile: GeneratedHumanRiggingBodyProfile;
    reportPath: string;
    glbPath: string;
    passed: boolean;
    blockers: string[];
    requiredBoneCoverage: { observed: number; required: number };
    requiredEmbodimentNodeCoverage: { missing: string[] };
    requiredMorphTargetCoverage: { missing: string[] };
  }>;
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

function defaultVariantMatrixReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `generated-human-rigging-variant-matrix-${date.toISOString().slice(0, 10)}.json`);
}

function defaultVariantMatrixScreenshotPath(date = new Date()): string {
  return path.join("docs/openclinxr/screenshots", `generated-human-rigging-variant-matrix-${date.toISOString().slice(0, 10)}.png`);
}

async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes("--validate-latest")) {
    const reportPath = defaultVariantMatrixReportPath();
    const report = JSON.parse(await readFile(reportPath, "utf8")) as VariantMatrixReport;
    const validation = validateVariantMatrixReport(report);
    if (!validation.ok) {
      process.stderr.write(`${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Validated ${reportPath}\n`);
    return;
  }

  const generatedAt = new Date();
  const reportPath = defaultVariantMatrixReportPath(generatedAt);
  const screenshotArtifact = defaultVariantMatrixScreenshotPath(generatedAt);
  const profiles = [];

  for (const bodyProfile of GENERATED_HUMAN_RIGGING_BODY_PROFILES) {
    const outputRoot = path.join(".openclinxr/asset-production/ed-chest-pain/generated-human-rigging-variant-matrix", bodyProfile);
    const profileReportPath = path.join("docs/openclinxr", `generated-human-rigging-artifacts-${bodyProfile}-${generatedAt.toISOString().slice(0, 10)}.json`);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    await runGeneratedHumanRiggingArtifactsCli([
      "--body-profile",
      bodyProfile,
      "--output-root",
      outputRoot,
      "--report",
      profileReportPath,
    ]);
    const profileRunFailed = process.exitCode !== undefined && process.exitCode !== 0;
    process.exitCode = previousExitCode;
    const riggingReport = JSON.parse(await readFile(profileReportPath, "utf8")) as GeneratedHumanRiggingReport;
    profiles.push({
      bodyProfile,
      reportPath: profileReportPath,
      glbPath: riggingReport.artifacts.glbPath,
      passed: riggingReport.verdict.passed && !profileRunFailed,
      blockers: riggingReport.verdict.blockers,
      requiredBoneCoverage: {
        observed: riggingReport.output.semanticInventory.requiredBoneNames.length - riggingReport.output.semanticInventory.missingRequiredBoneNames.length,
        required: riggingReport.output.semanticInventory.requiredBoneNames.length,
      },
      requiredEmbodimentNodeCoverage: {
        missing: riggingReport.output.semanticInventory.missingRequiredEmbodimentNodeNames,
      },
      requiredMorphTargetCoverage: {
        missing: riggingReport.output.semanticInventory.missingRequiredMorphTargetNames,
      },
    });
  }

  await writeVariantMatrixPng(screenshotArtifact, profiles);
  const blockers = [
    ...profiles.flatMap((profile) => profile.passed ? [] : [`body_profile_failed:${profile.bodyProfile}`]),
    ...profiles.flatMap((profile) => profile.requiredBoneCoverage.observed === profile.requiredBoneCoverage.required ? [] : [`body_profile_bone_coverage_incomplete:${profile.bodyProfile}`]),
    ...profiles.flatMap((profile) => profile.requiredEmbodimentNodeCoverage.missing.map((nodeName) => `body_profile_embodiment_node_missing:${profile.bodyProfile}:${nodeName}`)),
    ...profiles.flatMap((profile) => profile.requiredMorphTargetCoverage.missing.map((targetName) => `body_profile_morph_target_missing:${profile.bodyProfile}:${targetName}`)),
  ];
  const report: VariantMatrixReport = {
    schemaVersion: "openclinxr.generated-human-rigging-variant-matrix.v1",
    generatedAt: generatedAt.toISOString(),
    claimBoundary: "local_static_rigging_matrix_not_visual_or_production_readiness",
    adversarialReviewers: ["ux-friction-critic", "clinical-safety-critic", "implementation-plan-gap-attacker"],
    screenshotArtifact,
    bodyProfiles: profiles,
    verdict: {
      passed: blockers.length === 0,
      blockers,
    },
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const validation = validateVariantMatrixReport(report);
  if (!validation.ok) {
    process.stderr.write(`${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Wrote ${reportPath}\n`);
}

function validateVariantMatrixReport(report: VariantMatrixReport): { ok: boolean; errors: string[] } {
  const errors = [
    report.schemaVersion === "openclinxr.generated-human-rigging-variant-matrix.v1" ? undefined : "/schemaVersion must be openclinxr.generated-human-rigging-variant-matrix.v1",
    report.claimBoundary === "local_static_rigging_matrix_not_visual_or_production_readiness" ? undefined : "/claimBoundary must preserve local static boundary",
    existsSync(report.screenshotArtifact) ? undefined : "/screenshotArtifact must exist",
    report.adversarialReviewers.includes("ux-friction-critic") ? undefined : "/adversarialReviewers must include ux-friction-critic",
    report.adversarialReviewers.includes("clinical-safety-critic") ? undefined : "/adversarialReviewers must include clinical-safety-critic",
    report.adversarialReviewers.includes("implementation-plan-gap-attacker") ? undefined : "/adversarialReviewers must include implementation-plan-gap-attacker",
    ...GENERATED_HUMAN_RIGGING_BODY_PROFILES.map((profile) => report.bodyProfiles.some((entry) => entry.bodyProfile === profile) ? undefined : `/bodyProfiles must include ${profile}`),
    ...report.bodyProfiles.flatMap((entry) => [
      existsSync(entry.reportPath) ? undefined : `/bodyProfiles/${entry.bodyProfile}/reportPath must exist`,
      existsSync(entry.glbPath) ? undefined : `/bodyProfiles/${entry.bodyProfile}/glbPath must exist`,
      entry.passed ? undefined : `/bodyProfiles/${entry.bodyProfile}/passed must be true`,
      entry.requiredBoneCoverage.observed === CANONICAL_HUMANOID_BONES.length ? undefined : `/bodyProfiles/${entry.bodyProfile}/requiredBoneCoverage must cover all bones`,
      entry.requiredBoneCoverage.required === CANONICAL_HUMANOID_BONES.length ? undefined : `/bodyProfiles/${entry.bodyProfile}/requiredBoneCoverage required count must match canonical bones`,
      entry.requiredEmbodimentNodeCoverage.missing.length === 0 ? undefined : `/bodyProfiles/${entry.bodyProfile}/requiredEmbodimentNodeCoverage missing nodes`,
      entry.requiredMorphTargetCoverage.missing.length === 0 ? undefined : `/bodyProfiles/${entry.bodyProfile}/requiredMorphTargetCoverage missing targets`,
    ]),
    report.verdict.passed ? undefined : "/verdict/passed must be true",
  ].filter((error): error is string => typeof error === "string");
  return { ok: errors.length === 0, errors };
}

async function writeVariantMatrixPng(filePath: string, profiles: VariantMatrixReport["bodyProfiles"]): Promise<void> {
  const width = 1024;
  const height = 512;
  const bytes = Buffer.alloc((width * 4 + 1) * height);
  const palette = [
    [35, 99, 132, 255],
    [66, 122, 92, 255],
    [134, 94, 60, 255],
    [126, 73, 104, 255],
  ];
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    bytes[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const profileIndex = Math.min(Math.floor(x / (width / profiles.length)), profiles.length - 1);
      const profile = profiles[profileIndex];
      const [r, g, b, a] = palette[profileIndex] ?? [80, 80, 80, 255];
      const centerX = (profileIndex + 0.5) * (width / profiles.length);
      const bodyWidth = 34 + profileIndex * 8;
      const headRadius = profile.bodyProfile === "pediatric_school_age" ? 21 : 26;
      const torsoTop = profile.bodyProfile === "pediatric_school_age" ? 180 : 140;
      const torsoBottom = profile.bodyProfile === "pediatric_school_age" ? 350 : 390;
      const inHead = (x - centerX) ** 2 + (y - 104) ** 2 < headRadius ** 2;
      const inTorso = Math.abs(x - centerX) < bodyWidth && y > torsoTop && y < torsoBottom;
      const inRigLine = Math.abs(x - centerX) < 3 && y > 108 && y < 430;
      const inShoulder = Math.abs(y - 185) < 3 && Math.abs(x - centerX) < bodyWidth + 42;
      const inGround = y > 456;
      const active = inHead || inTorso || inRigLine || inShoulder || inGround;
      bytes[offset] = active ? r : 245;
      bytes[offset + 1] = active ? g : 248;
      bytes[offset + 2] = active ? b : 250;
      bytes[offset + 3] = a;
    }
  }
  const labels = ["ADULT", "PEDIATRIC", "OLDER", "BARIATRIC"];
  profiles.forEach((profile, index) => {
    const centerX = Math.round((index + 0.5) * (width / profiles.length));
    const label = labels[index] ?? profile.bodyProfile.toUpperCase();
    drawText(bytes, width, height, label, centerX - Math.floor(label.length * 18 / 2), 28, 3, [15, 23, 42, 255]);
    drawText(bytes, width, height, profile.passed ? "PASS" : "FAIL", centerX - 36, 420, 3, profile.passed ? [22, 101, 52, 255] : [185, 28, 28, 255]);
    drawText(bytes, width, height, "BONES", centerX - 45, 444, 2, [51, 65, 85, 255]);
    drawText(bytes, width, height, "FACE", centerX - 36, 466, 2, [51, 65, 85, 255]);
  });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, encodePng(width, height, bytes));
}

const font5x7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
};

function drawText(
  bytes: Buffer,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number, number],
): void {
  let cursorX = x;
  for (const char of text) {
    if (char === " ") {
      cursorX += 6 * scale;
      continue;
    }
    const glyph = font5x7[char];
    if (!glyph) {
      cursorX += 6 * scale;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      const glyphRow = glyph[row];
      if (glyphRow === undefined) {
        throw new Error(`Missing font glyph row ${row} for character ${char}.`);
      }
      for (let col = 0; col < glyphRow.length; col += 1) {
        if (glyphRow[col] !== "1") continue;
        fillRect(bytes, width, height, cursorX + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursorX += 6 * scale;
  }
}

function fillRect(
  bytes: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number],
): void {
  for (let yy = y; yy < y + rectHeight; yy += 1) {
    if (yy < 0 || yy >= height) continue;
    for (let xx = x; xx < x + rectWidth; xx += 1) {
      if (xx < 0 || xx >= width) continue;
      const offset = yy * (width * 4 + 1) + 1 + xx * 4;
      bytes[offset] = color[0];
      bytes[offset + 1] = color[1];
      bytes[offset + 2] = color[2];
      bytes[offset + 3] = color[3];
    }
  }
}

function encodePng(width: number, height: number, rgbaScanlines: Buffer): Buffer {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(rgbaScanlines);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
