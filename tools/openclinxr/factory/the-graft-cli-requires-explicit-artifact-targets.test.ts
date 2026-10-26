import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const CLI = new URL("./graft-bound-clip.ts", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Minimal two-joint rig; source carries CLIP, target does not. */
function rigDocument(jointNames: readonly string[], withClip: string | null): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document
    .createAccessor("POSITION").setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const indices = document
    .createAccessor("indices").setType(Accessor.Type.SCALAR)
    .setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const meshNode = document.createNode("mesh_node").setMesh(document.createMesh("body").addPrimitive(primitive));
  const scene = document.createScene("Scene").addChild(meshNode);
  const joints = jointNames.map((name) => document.createNode(name).setTranslation([0, 1, 0]));
  for (const joint of joints) scene.addChild(joint);
  if (withClip) {
    const times = document.createAccessor("t").setType(Accessor.Type.SCALAR)
      .setArray(new Float32Array([0, 1])).setBuffer(buffer);
    const rotations = document.createAccessor("r").setType(Accessor.Type.VEC4)
      .setArray(new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2])).setBuffer(buffer);
    const animation = document.createAnimation(withClip);
    for (const joint of joints) {
      const sampler = document.createAnimationSampler().setInput(times).setOutput(rotations).setInterpolation("LINEAR");
      animation.addSampler(sampler);
      animation.addChannel(document.createAnimationChannel().setTargetNode(joint).setTargetPath("rotation").setSampler(sampler));
    }
  }
  return document;
}

async function fixture(): Promise<{ dir: string; target: string; source: string; targetHash: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-graft-cli-"));
  tempDirs.push(dir);
  const target = path.join(dir, "target.glb");
  const source = path.join(dir, "source.glb");
  await new NodeIO().write(target, rigDocument(["hip", "knee"], null));
  await new NodeIO().write(source, rigDocument(["hip", "knee"], "probe_walk"));
  return { dir, target, source, targetHash: sha256(await readFile(target)) };
}

async function snapshot(dir: string): Promise<{ entries: string[]; hashes: Map<string, string> }> {
  const entries = (await readdir(dir)).sort();
  const hashes = new Map<string, string>();
  for (const entry of entries) hashes.set(entry, sha256(await readFile(path.join(dir, entry))));
  return { entries, hashes };
}

async function runCli(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  if (!existsSync(TSX_CLI)) throw new Error(`local tsx missing at ${TSX_CLI}`);
  const childDir = await mkdtemp(path.join(cwd, "child-"));
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [TSX_CLI, CLI, ...args],
      { timeout: 120000, cwd: childDir },
    );
    return { code: 0, out: String(stdout), err: String(stderr) };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") };
  } finally {
    await rm(childDir, { recursive: true, force: true });
  }
}

describe("graft CLI requires explicit artifact targets", () => {
  it("rejects graft with output but no report before reading a missing target", async () => {
    const { dir, source } = await fixture();
    const output = path.join(dir, "out.glb");
    const before = await snapshot(dir);
    const missingTarget = path.join(dir, "no-such-target.glb");
    const result = await runCli(
      ["--target", missingTarget, "--source", source, "--clip", "probe_walk", "--output", output],
      dir,
    );
    expect(result.code).not.toBe(0);
    expect(`${result.out}${result.err}`).toMatch(/--report is required/);
    const after = await snapshot(dir);
    expect(after.entries).toEqual(before.entries);
    for (const [name, hash] of before.hashes) expect(after.hashes.get(name)).toBe(hash);
  });

  it("rejects a flag name as the --output value", async () => {
    const { dir, target, source, targetHash } = await fixture();
    const before = await snapshot(dir);
    const result = await runCli(
      ["--target", target, "--source", source, "--clip", "probe_walk", "--output", "--report", "--report", path.join(dir, "r.json")],
      dir,
    );
    expect(result.code).not.toBe(0);
    expect(`${result.out}${result.err}`).toMatch(/requires a value/);
    const after = await snapshot(dir);
    expect(after.entries).toEqual(before.entries);
    expect(sha256(await readFile(target))).toBe(targetHash);
  });

  it("rejects drop and rebind modes missing explicit targets before target read", async () => {
    const { dir, targetHash } = await fixture();
    const before = await snapshot(dir);
    const missingTarget = path.join(dir, "no-such-target.glb");
    const drop = await runCli(
      ["--drop-leading-rest-frame", "--target", missingTarget, "--clip", "probe_walk", "--output", path.join(dir, "o.glb")],
      dir,
    );
    expect(drop.code).not.toBe(0);
    expect(`${drop.out}${drop.err}`).toMatch(/--report is required/);
    const rebind = await runCli(
      ["--rebind-travel-heading", "--target", missingTarget, "--clip", "probe_walk", "--output", path.join(dir, "o2.glb")],
      dir,
    );
    expect(rebind.code).not.toBe(0);
    expect(`${rebind.out}${rebind.err}`).toMatch(/--report is required/);
    const after = await snapshot(dir);
    expect(after.entries).toEqual(before.entries);
    expect(targetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prints all modes on --help without writing", async () => {
    const { dir } = await fixture();
    const before = await snapshot(dir);
    const result = await runCli(["--help"], dir);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/--drop-leading-rest-frame/);
    expect(result.out).toMatch(/--rebind-travel-heading/);
    expect(result.out).toMatch(/--output and --report are required/);
    const after = await snapshot(dir);
    expect(after.entries).toEqual(before.entries);
    for (const [name, hash] of before.hashes) expect(after.hashes.get(name)).toBe(hash);
  });

  it("positive graft writes only owned output/report", async () => {
    const { dir, target, source, targetHash } = await fixture();
    const before = await snapshot(dir);
    void before;
    const output = path.join(dir, "owned-output.glb");
    const reportPath = path.join(dir, "owned-report.json");
    const result = await runCli(
      ["--target", target, "--source", source, "--clip", "probe_walk", "--output", output, "--report", reportPath],
      dir,
    );
    expect(result.code).toBe(0);
    const parsed = JSON.parse(await readFile(reportPath, "utf8")) as {
      graftedChannels: number;
      graftedJoints: number;
      output: { path: string };
      animationsAfter: string[];
    };
    expect(parsed.graftedChannels).toBe(2);
    expect(parsed.graftedJoints).toBe(2);
    expect(parsed.output.path).toBe(output);
    expect(parsed.animationsAfter).toContain("probe_walk");
    expect(sha256(await readFile(target))).toBe(targetHash);
    const doc = await new NodeIO().read(output);
    expect(doc.getRoot().listAnimations().map((a) => a.getName())).toContain("probe_walk");
    expect(doc.getRoot().listAnimations().flatMap((a) => a.listChannels())).toHaveLength(2);
  });
});
