/**
 * Synthetic regression for the ED rebake RLQ defect (Group A, tsk_29fdbf5ffb49879f).
 *
 * Builds a toy rig GLB (no Blender, no real assets), runs the real producer
 * materialize-guard-withdraw-clip.ts against it, and proves:
 *  1. genuine output = 9 rotation-only channels, rest-relative keys, settle to rest,
 *     no leg/root/lower-body targets;
 *  2. an idle-clone corruption (same-name clip replaced by full-body TRS duplicate)
 *     FAILS those invariants (counterexample, not blessed);
 *  3. re-running the producer over the corrupted file repairs it (same-name replace),
 *     restores 9 rotation-only channels, and leaves unrelated animations byte-identical.
 *
 * notEvidenceFor: clinical_validity / production_animation_quality / quest_readiness.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Accessor, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const RLQ = "openclinxr_role_patient_guard_withdraw_rlq";
const MATERIALIZER = fileURLToPath(new URL("../materialize-guard-withdraw-clip.ts", import.meta.url));

const TOY_NODES = [
  "root",
  "spine03",
  "spine01",
  "head",
  "upperarm01.R",
  "lowerarm01.R",
  "upperarm01.L",
  "lowerarm01.L",
  "upperleg01.L",
  "wrist.L",
  "wrist.R",
] as const;

async function buildToyGlb(outPath: string): Promise<void> {
  const doc = (await import("@gltf-transform/core")).createDocument?.() as never;
  void doc;
  const { Document } = await import("@gltf-transform/core");
  const document = new Document();
  const buffer = document.createBuffer("toy");
  const nodes = TOY_NODES.map((name) => document.createNode(name).setTranslation([0, 0, 0]));
  const scene = document.createScene("toy");
  nodes[0]!.addChild(nodes[1]!);
  nodes[1]!.addChild(nodes[2]!);
  nodes[2]!.addChild(nodes[3]!);
  for (const n of nodes) scene.addChild(n);
  // Unrelated pre-existing animation that must survive byte-identical.
  const times = document
    .createAccessor("idle_times")
    .setArray(new Float32Array([0, 1]))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const out = document
    .createAccessor("idle_out")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
    .setType(Accessor.Type.VEC4)
    .setBuffer(buffer);
  const anim = document.createAnimation("ClinicalIdleConversation");
  const sampler = document
    .createAnimationSampler("idle_sampler")
    .setInput(times)
    .setOutput(out)
    .setInterpolation("LINEAR");
  anim.addSampler(sampler);
  anim.addChannel(
    document
      .createAnimationChannel("idle_channel")
      .setSampler(sampler)
      .setTargetNode(nodes[1]!)
      .setTargetPath("rotation"),
  );
  await new NodeIO().write(outPath, document);
}

function runMaterializer(input: string, output: string, dir: string): void {
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      MATERIALIZER,
      "--glb",
      input,
      "--out",
      output,
      "--backup",
      join(dir, "backup.glb"),
      "--report",
      join(dir, "report.json"),
    ],
    { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 120000, stdio: "pipe" },
  );
}

type ClipSummary = {
  channels: { node: string; path: string; count: number; type: string }[];
  names: string[];
};

async function summarize(glbPath: string): Promise<{ rlq: ClipSummary; idleChannels: number }> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const anims = root.listAnimations();
  const rlq = anims.find((a) => a.getName() === RLQ);
  if (!rlq) return { rlq: { channels: [], names: [] }, idleChannels: -1 };
  const channels = rlq.listChannels().map((c) => {
    const out = c.getSampler().getOutput()!;
    return {
      node: c.getTargetNode()!.getVertexName?.() ?? c.getTargetNode()!.getName(),
      path: c.getTargetPath(),
      count: out.getCount(),
      type: out.getType(),
    };
  });
  const idle = anims.find((a) => a.getName() === "ClinicalIdleConversation");
  return { rlq: { channels, names: channels.map((c) => c.node) }, idleChannels: idle?.listChannels().length ?? -1 };
}

/** Corrupt the RLQ clip in place: replace with a full-body TRS idle duplicate (the rebake defect). */
async function corruptToIdleClone(input: string, output: string): Promise<void> {
  const io = new NodeIO();
  const document = await io.read(input);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0]!;
  for (const clip of root.listAnimations().filter((a) => a.getName() === RLQ)) clip.dispose();
  const times = document
    .createAccessor("idleclone_times")
    .setArray(new Float32Array([0, 0.5, 1.0]))
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const anim = document.createAnimation(RLQ);
  for (const node of root.listNodes()) {
    for (const path of ["translation", "rotation", "scale"] as const) {
      const width = path === "rotation" ? 4 : 3;
      const out = document
        .createAccessor(`idleclone_${node.getName()}_${path}`)
        .setArray(new Float32Array(width * 3).fill(path === "rotation" ? 0 : 1))
        .setType(width === 4 ? Accessor.Type.VEC4 : Accessor.Type.VEC3)
        .setBuffer(buffer);
      const sampler = document
        .createAnimationSampler(`idleclone_${node.getName()}_${path}_s`)
        .setInput(times)
        .setOutput(out)
        .setInterpolation("LINEAR");
      anim.addSampler(sampler);
      anim.addChannel(
        document
          .createAnimationChannel(`idleclone_${node.getName()}_${path}_c`)
          .setSampler(sampler)
          .setTargetNode(node)
          .setTargetPath(path),
      );
    }
  }
  await io.write(output, document);
}

function expectGenuineRlq(summary: ClipSummary): void {
  expect(summary.channels).toHaveLength(9);
  for (const c of summary.channels) {
    expect(c.path).toBe("rotation");
    expect(c.type).toBe("VEC4");
    expect(c.count).toBe(3);
    expect(c.node).not.toMatch(/root|pelvis|leg|foot|toe/i);
  }
  expect(summary.names).toEqual(
    expect.arrayContaining(["spine03", "spine01", "head", "upperarm01.R", "lowerarm01.R"]),
  );
  expect(new Set(summary.names).size).toBe(9);
}

describe("RLQ producer regression (synthetic toy rig)", () => {
  it("materializes 9 rotation-only rest-relative channels and repairs an idle-clone corruption", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rlq-toy-"));
    try {
      const toy = join(dir, "toy.glb");
      const genuine = join(dir, "genuine.glb");
      await buildToyGlb(toy);
      runMaterializer(toy, genuine, dir);
      const good = await summarize(genuine);
      expectGenuineRlq(good.rlq);
      expect(good.idleChannels).toBe(1);

      // Rest-relative: first and last keys equal rest (identity on toy rig).
      const document = await new NodeIO().read(genuine);
      const clip = document.getRoot().listAnimations().find((a) => a.getName() === RLQ)!;
      for (const channel of clip.listChannels()) {
        const values = Array.from(
          channel.getSampler().getOutput()!.getArray() as Float32Array,
        );
        const first = values.slice(0, 4);
        const last = values.slice(8, 12);
        expect(first).toEqual([0, 0, 0, 1]);
        expect(last).toEqual([0, 0, 0, 1]);
        const peak = values.slice(4, 8);
        expect(peak).not.toEqual([0, 0, 0, 1]);
      }

      // Corruption counterexample: idle-clone replacement must FAIL genuine invariants.
      const corrupted = join(dir, "corrupted.glb");
      await corruptToIdleClone(genuine, corrupted);
      const bad = await summarize(corrupted);
      expect(bad.rlq.channels.length).toBeGreaterThan(9);
      expect(bad.rlq.channels.some((c) => c.path !== "rotation")).toBe(true);
      expect(() => expectGenuineRlq(bad.rlq)).toThrow();

      // Repair: re-running the producer replaces the same-name clip, restores 9ch.
      const repaired = join(dir, "repaired.glb");
      runMaterializer(corrupted, repaired, dir);
      const fixed = await summarize(repaired);
      expectGenuineRlq(fixed.rlq);
      expect(fixed.idleChannels).toBe(1);
      // No dual clips left behind.
      const doc2 = await new NodeIO().read(repaired);
      expect(
        doc2.getRoot().listAnimations().filter((a) => a.getName() === RLQ),
      ).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);

  it("the bake post-export hook repairs an idle clone, skips RLQ-less actors, and fails closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rlq-hook-"));
    try {
      const toy = join(dir, "toy.glb");
      await buildToyGlb(toy);
      const genuine = join(dir, "genuine.glb");
      runMaterializer(toy, genuine, dir);
      const corrupted = join(dir, "corrupted.glb");
      await corruptToIdleClone(genuine, corrupted);
      copyFileSync(corrupted, join(dir, "hook-input.glb"));
      const hookInput = join(dir, "hook-input.glb");

      // Idle payload fingerprint before the hook (must survive byte-identical).
      const idleBefore = await summarize(hookInput);
      const bakePy = fileURLToPath(new URL("../blender/bake_mpfb_gown_inspect.py", import.meta.url));
      const driver = fileURLToPath(new URL("./drive-hook-rematerialize.py", import.meta.url));
      const hookOut = execFileSync(
        "python3",
        [driver, bakePy, hookInput, join(dir, "explicit-report.json")],
        { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 180000, encoding: "utf8" },
      );
      const hookResult = JSON.parse(hookOut.split("\n").filter((l) => l.startsWith("{")).at(-1)!) as {
        skipped: boolean;
        report: { animationName: string; appliedNodeCount: number } | null;
      };
      expect(hookResult.skipped).toBe(false);
      expect(hookResult.report?.animationName).toBe(RLQ);
      expect(hookResult.report?.appliedNodeCount).toBe(9);
      const fixed = await summarize(hookInput);
      expectGenuineRlq(fixed.rlq);
      expect(fixed.idleChannels).toBe(idleBefore.idleChannels);

      // RLQ-less actor stays byte-identical (skip path).
      const noRlq = join(dir, "norlq.glb");
      await buildToyGlb(noRlq);
      const beforeBytes = readFileSync(noRlq);
      const skipOut = execFileSync("python3", [driver, bakePy, noRlq, "-"], {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 180000, encoding: "utf8",
      });
      const skipResult = JSON.parse(skipOut.split("\n").filter((l) => l.startsWith("{")).at(-1)!) as {
        skipped: boolean;
      };
      expect(skipResult.skipped).toBe(true);
      expect(readFileSync(noRlq).equals(beforeBytes)).toBe(true);

      // Two hook runs use distinct default report paths (no shared report).
      const corrupted2 = join(dir, "corrupted2.glb");
      await corruptToIdleClone(genuine, corrupted2);
      const run1 = execFileSync("python3", [driver, bakePy, corrupted2, "-"], {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 180000, encoding: "utf8",
      });
      const lastJson = (s: string): { report: { appliedNodeCount: number } | null } =>
        JSON.parse(s.split("\n").filter((l) => l.startsWith("{")).at(-1)!);
      const r1doc = lastJson(run1);
      const corrupted3 = join(dir, "corrupted3.glb");
      await corruptToIdleClone(genuine, corrupted3);
      const run2 = execFileSync("python3", [driver, bakePy, corrupted3, "-"], {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 180000, encoding: "utf8",
      });
      const lastLine = (s: string, prefix: string): string =>
        s.split("\n").filter((l) => l.startsWith(prefix)).at(-1)!;
      const p1 = lastLine(run1, "RLQ_REPORT ").replace("RLQ_REPORT ", "").trim();
      const r2doc = lastJson(run2);
      const p2 = lastLine(run2, "RLQ_REPORT ").replace("RLQ_REPORT ", "").trim();
      expect(p1.length).toBeGreaterThan(0);
      expect(p2.length).toBeGreaterThan(0);
      expect(p1).not.toBe(p2);
      expect(r1doc.report && r2doc.report).toBeTruthy();

      // Failure propagates: hook on a non-GLB input raises (fail closed).
      const notGlb = join(dir, "not-a-glb.txt");
      (await import("node:fs")).writeFileSync(notGlb, "nope");
      let threw = false;
      try {
        execFileSync("python3", [driver, bakePy, notGlb, "-"], {
          cwd: fileURLToPath(new URL("../../../../", import.meta.url)), timeout: 180000, encoding: "utf8",
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});
