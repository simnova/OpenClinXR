import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Accessor, type Animation, type AnimationChannel } from "@gltf-transform/core";

export const BODY_RIG_APPENDAGE_MOTION_CAGEMATCH_SCHEMA_VERSION = "openclinxr.body-rig-appendage-motion-cagematch.v1" as const;

const DEFAULT_RUN_ID = "2026-06-07-two-test-models";
const DEFAULT_REPORT_PATH = "apps/arena/model-vetting-studio/public/cagematch/body-rigging/2026-06-07-two-test-models/model-vetting-report.json";
const DEFAULT_OUTPUT_ROOT = ".openclinxr/evidence/body-rigging/appendage-motion-cagematch";

type MotionRegion = "head" | "torso" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg" | "other";

type CliOptions = {
  sourceReportPath: string;
  outputRoot: string;
  runId: string;
};

type ChannelMotion = {
  targetNodeName: string;
  targetPath: string;
  region: MotionRegion;
  sampleCount: number;
  maxTranslationMeters: number;
  maxRotationDegrees: number;
  maxScaleDelta: number;
  moves: boolean;
};

type AnimationMotion = {
  clipName: string;
  channelCount: number;
  movingChannelCount: number;
  movingRegions: MotionRegion[];
  regionSummaries: Record<MotionRegion, RegionSummary>;
  strongestChannels: ChannelMotion[];
};

type RegionSummary = {
  movingChannelCount: number;
  maxTranslationMeters: number;
  maxRotationDegrees: number;
  maxScaleDelta: number;
  present: boolean;
  moves: boolean;
};

type CandidateMotion = {
  candidateId: string;
  actorDisplayRole: string;
  sourceGlbPath: string;
  resolvedGlbPath: string;
  selectedBodyMotionClipName: string | null;
  animations: AnimationMotion[];
  selectedClipMotion: AnimationMotion | null;
  appendageMovement: Record<Exclude<MotionRegion, "other">, boolean>;
  confirmsDifferentPosesAcrossAppendages: boolean;
  blockers: string[];
};

type BodyRigAppendageMotionCagematchReport = {
  schemaVersion: typeof BODY_RIG_APPENDAGE_MOTION_CAGEMATCH_SCHEMA_VERSION;
  generatedAt: string;
  claimScope: "raw_glb_animation_channel_appendage_motion_cagematch_not_visual_realism_or_readiness";
  runId: string;
  sourceReportPath: string;
  candidates: CandidateMotion[];
  comparison: {
    annyCandidateId: string | null;
    mpfbCandidateId: string | null;
    summary: string;
    annyMovesSameAppendageBreadthAsMpfb: boolean;
  };
  notEvidenceFor: string[];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBodyRigAppendageMotionCagematch(options);
  const outputDir = path.join(options.outputRoot, options.runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "body-rig-appendage-motion-cagematch.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "body-rig-appendage-motion-cagematch.md"), renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({ reportPath: path.join(outputDir, "body-rig-appendage-motion-cagematch.json"), comparison: report.comparison }, null, 2)}\n`);
}

export async function runBodyRigAppendageMotionCagematch(options: Partial<CliOptions> = {}): Promise<BodyRigAppendageMotionCagematchReport> {
  const sourceReportPath = options.sourceReportPath ?? DEFAULT_REPORT_PATH;
  const runId = options.runId ?? DEFAULT_RUN_ID;
  const sourceReport = JSON.parse(await readFile(sourceReportPath, "utf8")) as {
    candidates: Array<{
      candidateId: string;
      actorDisplayRole: string;
      sourceGlbPath: string;
      roleAnimationHandoff?: { roleSpecificClipNames?: string[] };
    }>;
    notEvidenceFor?: string[];
  };
  const io = new NodeIO();
  const candidates: CandidateMotion[] = [];
  for (const candidate of sourceReport.candidates) {
    const resolvedGlbPath = resolvePublicGlbPath(candidate.sourceGlbPath);
    const document = await io.read(resolvedGlbPath);
    const selectedBodyMotionClipName = candidate.roleAnimationHandoff?.roleSpecificClipNames?.[0] ?? null;
    const animations = document.getRoot().listAnimations().map((animation) => analyzeAnimation(animation));
    const selectedClipMotion = animations.find((animation) => animation.clipName === selectedBodyMotionClipName) ?? null;
    const appendageMovement = summarizeAppendageMovement(selectedClipMotion);
    const movingAppendageCount = Object.values(appendageMovement).filter(Boolean).length;
    candidates.push({
      candidateId: candidate.candidateId,
      actorDisplayRole: candidate.actorDisplayRole,
      sourceGlbPath: candidate.sourceGlbPath,
      resolvedGlbPath,
      selectedBodyMotionClipName,
      animations,
      selectedClipMotion,
      appendageMovement,
      confirmsDifferentPosesAcrossAppendages: movingAppendageCount >= 4,
      blockers: selectedClipMotion
        ? blockersForAppendageMovement(appendageMovement)
        : ["selected_body_motion_clip_missing_from_glb"],
    });
  }
  const anny = candidates.find((candidate) => /anny/iu.test(candidate.candidateId) || /anny/iu.test(candidate.actorDisplayRole)) ?? null;
  const mpfb = candidates.find((candidate) => /mpfb|makehuman/iu.test(candidate.candidateId) || /mpfb|makehuman/iu.test(candidate.actorDisplayRole)) ?? null;
  return {
    schemaVersion: BODY_RIG_APPENDAGE_MOTION_CAGEMATCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    claimScope: "raw_glb_animation_channel_appendage_motion_cagematch_not_visual_realism_or_readiness",
    runId,
    sourceReportPath,
    candidates,
    comparison: {
      annyCandidateId: anny?.candidateId ?? null,
      mpfbCandidateId: mpfb?.candidateId ?? null,
      summary: compareCandidates(anny, mpfb),
      annyMovesSameAppendageBreadthAsMpfb: Boolean(anny && mpfb && movingRegionCount(anny.appendageMovement) >= movingRegionCount(mpfb.appendageMovement)),
    },
    notEvidenceFor: [
      "motion_capture_quality",
      "speech2motion_quality",
      "browser_live_skinning_visibility",
      "b_plus_visual_realism_gate",
      "scene_placement_readiness",
      "quest_readiness",
      "production_asset_readiness",
      "learner_readiness",
      "clinical_validity",
      "scoring_validity",
      ...(sourceReport.notEvidenceFor ?? []),
    ],
  };
}

function analyzeAnimation(animation: Animation): AnimationMotion {
  const channels = animation.listChannels().map((channel) => analyzeChannel(channel));
  const movingChannels = channels.filter((channel) => channel.moves);
  const regionSummaries = regionIds().reduce((summaries, region) => {
    const regionChannels = channels.filter((channel) => channel.region === region);
    const movingRegionChannels = regionChannels.filter((channel) => channel.moves);
    summaries[region] = {
      movingChannelCount: movingRegionChannels.length,
      maxTranslationMeters: max(regionChannels.map((channel) => channel.maxTranslationMeters)),
      maxRotationDegrees: max(regionChannels.map((channel) => channel.maxRotationDegrees)),
      maxScaleDelta: max(regionChannels.map((channel) => channel.maxScaleDelta)),
      present: regionChannels.length > 0,
      moves: movingRegionChannels.length > 0,
    };
    return summaries;
  }, {} as Record<MotionRegion, RegionSummary>);
  return {
    clipName: animation.getName(),
    channelCount: channels.length,
    movingChannelCount: movingChannels.length,
    movingRegions: regionIds().filter((region) => regionSummaries[region].moves),
    regionSummaries,
    strongestChannels: [...movingChannels]
      .sort((left, right) => channelScore(right) - channelScore(left))
      .slice(0, 12),
  };
}

function analyzeChannel(channel: AnimationChannel): ChannelMotion {
  const targetNodeName = channel.getTargetNode()?.getName() || "unnamed_node";
  const targetPath = channel.getTargetPath();
  const output = channel.getSampler()?.getOutput();
  const sampleCount = output?.getCount() ?? 0;
  const maxTranslationMeters = targetPath === "translation" ? maxDistanceFromFirst(output, 3) : 0;
  const maxRotationDegrees = targetPath === "rotation" ? maxQuaternionDegreesFromFirst(output) : 0;
  const maxScaleDelta = targetPath === "scale" ? maxDistanceFromFirst(output, 3) : 0;
  return {
    targetNodeName,
    targetPath,
    region: classifyBodyRigMotionRegion(targetNodeName),
    sampleCount,
    maxTranslationMeters: round(maxTranslationMeters),
    maxRotationDegrees: round(maxRotationDegrees),
    maxScaleDelta: round(maxScaleDelta),
    moves: maxTranslationMeters > 0.002 || maxRotationDegrees > 1 || maxScaleDelta > 0.002,
  };
}

function maxDistanceFromFirst(accessor: Accessor | null | undefined, itemSize: number): number {
  const array = accessor?.getArray();
  if (!array || array.length < itemSize * 2) return 0;
  const first = Array.from(array.slice(0, itemSize));
  let result = 0;
  for (let offset = itemSize; offset <= array.length - itemSize; offset += itemSize) {
    let sum = 0;
    for (let index = 0; index < itemSize; index += 1) sum += (Number(array[offset + index]) - Number(first[index])) ** 2;
    result = Math.max(result, Math.sqrt(sum));
  }
  return result;
}

function maxQuaternionDegreesFromFirst(accessor: Accessor | null | undefined): number {
  const array = accessor?.getArray();
  if (!array || array.length < 8) return 0;
  const first = normalizeQuat(Array.from(array.slice(0, 4)).map(Number));
  let result = 0;
  for (let offset = 4; offset <= array.length - 4; offset += 4) {
    const next = normalizeQuat(Array.from(array.slice(offset, offset + 4)).map(Number));
    const dot = Math.min(1, Math.abs(first[0] * next[0] + first[1] * next[1] + first[2] * next[2] + first[3] * next[3]));
    result = Math.max(result, (2 * Math.acos(dot) * 180) / Math.PI);
  }
  return result;
}

function normalizeQuat(values: number[]): [number, number, number, number] {
  const length = Math.hypot(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1) || 1;
  return [values[0] / length, values[1] / length, values[2] / length, values[3] / length];
}

function summarizeAppendageMovement(animation: AnimationMotion | null): Record<Exclude<MotionRegion, "other">, boolean> {
  return {
    head: Boolean(animation?.regionSummaries.head.moves),
    torso: Boolean(animation?.regionSummaries.torso.moves),
    leftArm: Boolean(animation?.regionSummaries.leftArm.moves),
    rightArm: Boolean(animation?.regionSummaries.rightArm.moves),
    leftLeg: Boolean(animation?.regionSummaries.leftLeg.moves),
    rightLeg: Boolean(animation?.regionSummaries.rightLeg.moves),
  };
}

function blockersForAppendageMovement(movement: Record<Exclude<MotionRegion, "other">, boolean>): string[] {
  const blockers: string[] = [];
  for (const [region, moves] of Object.entries(movement)) {
    if (!moves) blockers.push(`${region}_motion_not_detected_in_selected_clip`);
  }
  return blockers;
}

function compareCandidates(anny: CandidateMotion | null, mpfb: CandidateMotion | null): string {
  if (!anny || !mpfb) return "Anny and MPFB candidates were not both present in the source report.";
  const annyRegions = movingRegions(anny.appendageMovement).join(", ") || "none";
  const mpfbRegions = movingRegions(mpfb.appendageMovement).join(", ") || "none";
  if (movingRegionCount(anny.appendageMovement) < movingRegionCount(mpfb.appendageMovement)) {
    return `MPFB selected clip moves broader appendage regions (${mpfbRegions}) than Anny (${annyRegions}).`;
  }
  if (movingRegionCount(anny.appendageMovement) > movingRegionCount(mpfb.appendageMovement)) {
    return `Anny selected clip moves broader appendage regions (${annyRegions}) than MPFB (${mpfbRegions}), but browser live skinning still needs visual proof.`;
  }
  return `Anny and MPFB selected clips move the same number of tracked regions. Anny: ${annyRegions}. MPFB: ${mpfbRegions}.`;
}

function renderMarkdown(report: BodyRigAppendageMotionCagematchReport): string {
  const lines = [
    "# Body Rig Appendage Motion Cagematch",
    "",
    `Run: \`${report.runId}\``,
    "",
    `Scope: ${report.claimScope}.`,
    "",
    `Comparison: ${report.comparison.summary}`,
    "",
    "| Candidate | Clip | Head | Torso | Left Arm | Right Arm | Left Leg | Right Leg | Blockers |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const candidate of report.candidates) {
    const motion = candidate.appendageMovement;
    lines.push([
      candidate.candidateId,
      candidate.selectedBodyMotionClipName ?? "missing",
      bool(motion.head),
      bool(motion.torso),
      bool(motion.leftArm),
      bool(motion.rightArm),
      bool(motion.leftLeg),
      bool(motion.rightLeg),
      candidate.blockers.length ? candidate.blockers.join(", ") : "none",
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("", "## Strongest Selected-Clip Channels", "");
  for (const candidate of report.candidates) {
    lines.push(`### ${candidate.candidateId}`, "");
    for (const channel of candidate.selectedClipMotion?.strongestChannels ?? []) {
      lines.push(`- ${channel.region} / ${channel.targetNodeName}.${channel.targetPath}: ${channel.maxRotationDegrees}deg, ${channel.maxTranslationMeters}m, scale delta ${channel.maxScaleDelta}`);
    }
    lines.push("");
  }
  lines.push("## Not Evidence For", "", ...report.notEvidenceFor.map((item) => `- ${item}`), "");
  return `${lines.join("\n")}\n`;
}

export function classifyBodyRigMotionRegion(nodeName: string): MotionRegion {
  const name = nodeName.toLowerCase();
  if (/head|neck|skull|face/u.test(name)) return "head";
  if (/spine|chest|torso|pelvis|hips|abdomen|root/u.test(name)) return "torso";
  const isLeft = /(^|[_. -])(left|l)([_. -]|$)|[_. -]l$/u.test(name);
  const isRight = /(^|[_. -])(right|r)([_. -]|$)|[_. -]r$/u.test(name);
  const arm = /shoulder|upper_?arm|lower_?arm|forearm|elbow|wrist|hand|finger/u.test(name);
  const leg = /leg|thigh|knee|shin|ankle|foot|toe|calf/u.test(name);
  if (isLeft && arm) return "leftArm";
  if (isRight && arm) return "rightArm";
  if (isLeft && leg) return "leftLeg";
  if (isRight && leg) return "rightLeg";
  return "other";
}

function resolvePublicGlbPath(sourceGlbPath: string): string {
  if (sourceGlbPath.startsWith("/cagematch/")) return path.join("apps/arena/model-vetting-studio/public", sourceGlbPath);
  return sourceGlbPath;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceReportPath: DEFAULT_REPORT_PATH,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    runId: DEFAULT_RUN_ID,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-report") options.sourceReportPath = requireNext(args, ++index, arg);
    else if (arg === "--output-root") options.outputRoot = requireNext(args, ++index, arg);
    else if (arg === "--run-id") options.runId = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function regionIds(): MotionRegion[] {
  return ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg", "other"];
}

function movingRegions(movement: Record<Exclude<MotionRegion, "other">, boolean>): string[] {
  return Object.entries(movement).filter(([, moves]) => moves).map(([region]) => region);
}

function movingRegionCount(movement: Record<Exclude<MotionRegion, "other">, boolean>): number {
  return movingRegions(movement).length;
}

function max(values: number[]): number {
  return round(Math.max(0, ...values));
}

function channelScore(channel: ChannelMotion): number {
  return channel.maxRotationDegrees + channel.maxTranslationMeters * 100 + channel.maxScaleDelta * 50;
}

function bool(value: boolean): string {
  return value ? "yes" : "no";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
