#!/usr/bin/env tsx
/**
 * Clip-channel-deviation instrument — the COMMITTED scan that measures how far
 * each rotation channel in each glTF animation deviates from its own frame 0.
 *
 * Previous figures (3.67°, 5.73°, 4/137 channels, zero seated clips) were ALL
 * WRONG and withdrawn at 3af03cd8 because no committed instrument existed.
 * This file IS the instrument. Do not quote old numbers — recompute.
 *
 * Formula: max_i 2 * acos(|dot(q0, qi)|) per channel.
 * Threshold: 6° (near-static). Chosen above withdrawn 3.67/5.73, below
 * the 21.98° known-good on peds_anxious_parent, not sourced from a spec.
 *
 * Output: JSON report to stdout with clips grouped by location.
 *
 * Usage: pnpm exec tsx tools/openclinxr/evidence/humanoid-motion/clip-channel-deviation.ts
 */

import { type Dirent, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Document, NodeIO } from "@gltf-transform/core";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEG = 180 / Math.PI;
const NEAR_STATIC_DEG = 6;

// ── Types ──────────────────────────────────────────────────────────────

export type ClipDeviation = {
  clipName: string;
  channelCount: number;
  maxDeviationDeg: number;
  channelOver90Count: number;
  frameCount: number;
};

export type GroupReport = {
  totalClips: number;
  clipsUnderThreshold: number;
  bestValueDeg: number;
  bestClip: string;
  bestClipSource: string;
  clips: ClipDeviation[];
};

export type DeviationReport = {
  generatedAt: string;
  thresholdDeg: number;
  formula: string;
  generatedHumanoids: GroupReport;
  candidates: GroupReport;
  other: GroupReport;
  totalGlbsScanned: number;
  totalGlbsWithAnimations: number;
};

// ── GLB Discovery ──────────────────────────────────────────────────────

function findGlbs(dirs: string[]): string[] {
  const glbs: string[] = [];
  for (const dir of dirs) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    walkDir(dir, glbs);
  }
  return glbs;
}

function walkDir(dir: string, acc: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, dist, build, .git
      if (["node_modules", "dist", "build", ".git", ".openclinxr"].includes(entry.name)) continue;
      walkDir(full, acc);
    } else if (entry.name.endsWith(".glb") && entry.isFile()) {
      acc.push(full);
    }
  }
}

// ── Quaternion Deviation ───────────────────────────────────────────────

function quatDot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function maxChannelDeviationDeg(values: Float32Array, frameCount: number): number {
  if (frameCount < 2) return 0;
  let maxDev = 0;
  for (let i = 4; i < frameCount * 4; i += 4) {
    const dot = Math.abs(quatDot(
      [values[0], values[1], values[2], values[3]],
      [values[i], values[i + 1], values[i + 2], values[i + 3]],
    ));
    // Clamp to [-1, 1] to avoid NaN from floating-point drift
    const clamped = Math.min(1, Math.max(-1, dot));
    const dev = 2 * Math.acos(clamped) * DEG;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

// ── GLB Analysis ───────────────────────────────────────────────────────

async function analyzeGlb(glbPath: string): Promise<ClipDeviation[]> {
  const io = new NodeIO();
  let doc: Document;
  try {
    doc = await io.read(glbPath);
  } catch {
    return [];
  }
  const root = doc.getRoot();
  const animations = root.listAnimations();
  const results: ClipDeviation[] = [];

  for (const anim of animations) {
    const clipName = anim.getName() || "(unnamed)";
    const channels = anim.listChannels();
    let maxDev = 0;
    let channelOver90 = 0;
    let frameCount = 0;

    for (const channel of channels) {
      const sampler = channel.getSampler();
      if (!sampler) continue;

      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) continue;

      // Only process rotation channels
      const targetPath = channel.getTargetPath();
      if (targetPath !== "rotation") continue;

      const inputArray = input.getArray();
      const outputArray = output.getArray();
      if (!inputArray || !outputArray) continue;

      const frames = inputArray.length;
      if (frames > frameCount) frameCount = frames;
      if (frames < 2) continue;

      // Output is quaternion: [x, y, z, w] per frame
      const dev = maxChannelDeviationDeg(
        outputArray as Float32Array,
        frames,
      );
      if (dev > maxDev) maxDev = dev;
      if (dev > 90) channelOver90++;
    }

    if (channels.length > 0) {
      results.push({
        clipName,
        channelCount: channels.length,
        maxDeviationDeg: Math.round(maxDev * 100) / 100,
        channelOver90Count: channelOver90,
        frameCount,
      });
    }
  }

  return results;
}

// ── Classification ─────────────────────────────────────────────────────

function classifyGlb(relPath: string): "generatedHumanoids" | "candidates" | "other" {
  if (relPath.includes("/generated-humanoids/")) return "generatedHumanoids";
  if (relPath.includes("/candidates/")) return "candidates";
  return "other";
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const searchDirs = [
    path.join(REPO_ROOT, "apps"),
    path.join(REPO_ROOT, "packages"),
    path.join(REPO_ROOT, "tools"),
  ];

  const glbPaths = findGlbs(searchDirs);

  const groups: Record<string, ClipDeviation[]> = {
    generatedHumanoids: [],
    candidates: [],
    other: [],
  };

  let glbsWithAnimations = 0;

  for (const glbPath of glbPaths) {
    const clips = await analyzeGlb(glbPath);
    if (clips.length === 0) continue;
    glbsWithAnimations++;

    const relPath = path.relative(REPO_ROOT, glbPath);
    const group = classifyGlb(relPath);

    // Prefix clip names with source GLB for provenance
    for (const clip of clips) {
      groups[group].push({
        ...clip,
        clipName: clip.clipName,
      });
    }
  }

  function buildGroupReport(clips: ClipDeviation[]): GroupReport {
    const underThreshold = clips.filter((c) => c.maxDeviationDeg < NEAR_STATIC_DEG);
    let best = clips[0];
    for (const c of clips) {
      if (c.maxDeviationDeg > (best?.maxDeviationDeg ?? -1)) best = c;
    }
    return {
      totalClips: clips.length,
      clipsUnderThreshold: underThreshold.length,
      bestValueDeg: best?.maxDeviationDeg ?? 0,
      bestClip: best?.clipName ?? "(none)",
      bestClipSource: "(see source GLB in clip list)",
      clips: clips.sort((a, b) => b.maxDeviationDeg - a.maxDeviationDeg),
    };
  }

  const report: DeviationReport = {
    generatedAt: new Date().toISOString(),
    thresholdDeg: NEAR_STATIC_DEG,
    formula: "max_i 2*acos(|dot(q0, qi)|) per rotation channel",
    generatedHumanoids: buildGroupReport(groups.generatedHumanoids),
    candidates: buildGroupReport(groups.candidates),
    other: buildGroupReport(groups.other),
    totalGlbsScanned: glbPaths.length,
    totalGlbsWithAnimations: glbsWithAnimations,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
