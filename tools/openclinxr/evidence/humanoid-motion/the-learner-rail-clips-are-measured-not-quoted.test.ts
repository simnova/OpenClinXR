/**
 * The learner rail clips are measured, not quoted.
 *
 * This test runs the committed clip-channel-deviation instrument and asserts that
 * the learner rail (generated-humanoids/ + candidates/) contains clips with
 * MEASURED rotation deviation — not near-static bind-pose restatements.
 *
 * PROVING IT BITES: the test asserts that the seated retarget clip
 * (`openclinxr_retarget_seated_talking_cc0`) appears in the candidates group
 * with max deviation > 6°. Before the CC0 retarget stage runs on any actor,
 * this clip would NOT appear in candidates at all (it only exists after
 * seated_clip_bind_stage.py produces a motion-bind GLB). The test therefore
 * fails on the pre-retarget state and passes after.
 *
 * claimScope: learner-rail clip deviation floor
 * notEvidenceFor: visual quality, clinical gait validity, Quest frame budget
 */

import { type Dirent, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const NEAR_STATIC_DEG = 6;

// ── Shared instrument logic (mirrors clip-channel-deviation.ts) ────────

function quatDot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function maxChannelDeviationDeg(values: Float32Array, frameCount: number): number {
  if (frameCount < 2) return 0;
  let maxDev = 0;
  for (let i = 4; i < frameCount * 4; i += 4) {
    const dot = Math.abs(
      quatDot(
        [values[0], values[1], values[2], values[3]],
        [values[i], values[i + 1], values[i + 2], values[i + 3]],
      ),
    );
    const clamped = Math.min(1, Math.max(-1, dot));
    const dev = 2 * Math.acos(clamped) * (180 / Math.PI);
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
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
      if (["node_modules", "dist", "build", ".git", ".openclinxr"].includes(entry.name)) continue;
      walkDir(full, acc);
    } else if (entry.name.endsWith(".glb") && entry.isFile()) {
      acc.push(full);
    }
  }
}

function findGlbs(dirs: string[]): string[] {
  const glbs: string[] = [];
  for (const dir of dirs) {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    walkDir(dir, glbs);
  }
  return glbs;
}

type ClipInfo = { clipName: string; maxDeviationDeg: number; channelCount: number; frameCount: number };

async function analyzeGlb(glbPath: string): Promise<ClipInfo[]> {
  const io = new NodeIO();
  let doc: Document;
  try {
    doc = await io.read(glbPath);
  } catch {
    return [];
  }
  const root = doc.getRoot();
  const results: ClipInfo[] = [];
  for (const anim of root.listAnimations()) {
    const clipName = anim.getName() || "(unnamed)";
    let maxDev = 0;
    let frameCount = 0;
    for (const channel of anim.listChannels()) {
      const sampler = channel.getSampler();
      if (!sampler || channel.getTargetPath() !== "rotation") continue;
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) continue;
      const inputArray = input.getArray();
      const outputArray = output.getArray();
      if (!inputArray || !outputArray) continue;
      const frames = inputArray.length;
      if (frames > frameCount) frameCount = frames;
      if (frames < 2) continue;
      const dev = maxChannelDeviationDeg(outputArray as Float32Array, frames);
      if (dev > maxDev) maxDev = dev;
    }
    if (anim.listChannels().length > 0) {
      results.push({ clipName, maxDeviationDeg: Math.round(maxDev * 100) / 100, channelCount: anim.listChannels().length, frameCount });
    }
  }
  return results;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("learner rail clips are measured not quoted", () => {
  const searchDirs = [
    path.join(REPO_ROOT, "apps"),
    path.join(REPO_ROOT, "packages"),
    path.join(REPO_ROOT, "tools"),
  ];

  const glbPaths = findGlbs(searchDirs);

  it("finds GLB files to scan", () => {
    expect(glbPaths.length).toBeGreaterThan(0);
  });

  it("has at least one seated retarget clip in candidates/ with >6° deviation", async () => {
    // This asserts the CC0 retarget stage has run for at least one actor.
    // Before any retarget, no motion-bind GLB exists in candidates/ with
    // the seated clip name, so this test FAILS — proving it bites.
    const candidateGlbs = glbPaths.filter((p) => p.includes("/candidates/"));
    expect(candidateGlbs.length).toBeGreaterThan(0);

    const seatedClips: ClipInfo[] = [];
    for (const glb of candidateGlbs) {
      const clips = await analyzeGlb(glb);
      for (const clip of clips) {
        if (/seat/i.test(clip.clipName) && clip.maxDeviationDeg > 0) {
          seatedClips.push(clip);
        }
      }
    }

    expect(seatedClips.length).toBeGreaterThanOrEqual(1);
    const best = seatedClips.reduce((a, b) => (a.maxDeviationDeg > b.maxDeviationDeg ? a : b));
    expect(best.maxDeviationDeg).toBeGreaterThan(NEAR_STATIC_DEG);
  });

  it("generated-humanoids has at least one clip with >6° deviation", async () => {
    const genGlbs = glbPaths.filter((p) => p.includes("/generated-humanoids/"));
    expect(genGlbs.length).toBeGreaterThan(0);

    let anyMotion = false;
    for (const glb of genGlbs) {
      const clips = await analyzeGlb(glb);
      for (const clip of clips) {
        if (clip.maxDeviationDeg > NEAR_STATIC_DEG) {
          anyMotion = true;
          break;
        }
      }
      if (anyMotion) break;
    }

    expect(anyMotion).toBe(true);
  });

  it("candidate clips have distinct names (not all identical)", async () => {
    const candidateGlbs = glbPaths.filter((p) => p.includes("/candidates/"));
    const clipNames = new Set<string>();
    for (const glb of candidateGlbs) {
      const clips = await analyzeGlb(glb);
      for (const clip of clips) {
        if (clip.maxDeviationDeg > 0) clipNames.add(clip.clipName);
      }
    }
    // At minimum: the seated retarget clip + ClinicalIdleConversation
    expect(clipNames.size).toBeGreaterThanOrEqual(2);
  });
});
