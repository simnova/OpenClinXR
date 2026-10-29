import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Repair mode for the landed chest-anchor stage (`separate_chest_anchor_joints.mjs`).
 *
 * CONTEXT (chest-asset-audit/report.json + OWN proof/samples-6-before.json,
 * read-only probes of shipped bytes): six contracted bodies carry a valid
 * separated rest (span 17.0 cm) and a separated ClinicalIdleConversation clip,
 * but their grafted `openclinxr_retarget_walk_source` breast translation
 * keyframes sit at x ~= 0 on every key. glTF translation channels REPLACE the
 * node translation, so while that locomotion clip plays both anchors are
 * pinned to the sternum. The landed stage refuses these files
 * (already-separated rest), so the walk samplers cannot be fixed with it.
 *
 * The candidate extends the SAME tool with an explicit opt-in
 * `--repair-collapsed-animations` flag. Default behaviour (flag absent) is
 * unchanged and still refuses already-separated rests. The repair mode never
 * touches rest TRS and restores ONLY genuinely midline-pinned breast
 * translation X values to the target joint's own rest X (no new hardcoded
 * span; the existing 1e-6 epsilon decides pinned vs valid).
 *
 * SHIPPED TEST SCOPE: all 10 tests below synthesize controlled rigs in
 * os.tmpdir (no shipped GLB bytes read, no bad-state assertion on current
 * assets) so they stay green before AND after the real assets are repaired.
 * The real 6-file before-state is proven separately as OWN proof
 * (proof/samples-6-before.json + proof/repair-verification.json on temp
 * copies only), not as a shipped assertion.
 *
 * claimScope: the repair flag restores collapsed walk samplers on
 *   already-separated rigs while preserving rest TRS, non-breast channels
 *   and already-valid curves, and refuses ambiguous/malformed/shared-sampler
 *   cases instead of guessing.
 * notEvidenceFor: what any still SHOWS; the two rest-collapsed bodies (fixed
 *   by the unchanged landed stage, owned elsewhere); any new half-span choice.
 */

const ROOT = join(import.meta.dirname, "../../../..");
const TOOL = join(ROOT, "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs");

const EPS = 1e-6;

function runTool(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [TOOL, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
    return {
      ok: false,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : (e.message ?? String(err)),
    };
  }
}

async function breastTranslationX(glb: string): Promise<Map<string, number[]>> {
  const doc = await new NodeIO().read(glb);
  const out = new Map<string, number[]>();
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (!target) continue;
      if (target.getName() !== "breast.L" && target.getName() !== "breast.R") continue;
      if (channel.getTargetPath() !== "translation") continue;
      const array = channel.getSampler().getOutput().getArray();
      const xs: number[] = [];
      for (let i = 0; i < array.length; i += 3) xs.push(array[i]);
      out.set(`${animation.getName()}|${target.getName()}`, xs);
    }
  }
  return out;
}

// --- synthetic rig builder (no MAIN bytes; controlled bad/good graphs) ---

type SynthClip = {
  animation: string;
  joint: string;
  xs: number[];
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
  outType?: "VEC3" | "SCALAR";
};

async function writeSyntheticRig(path: string, opts: {
  restL?: number;
  restR?: number;
  clips?: SynthClip[];
  /** when true, L and R breast channels of the first clip share one sampler */
  shareFirstSampler?: boolean;
}): Promise<void> {
  const restL = opts.restL ?? 0.085;
  const restR = opts.restR ?? -0.085;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mkNode = (name: string, x: number) => {
    const node = doc.createNode(name).setTranslation([x, 0.16, 0]);
    doc.createScene("s").addChild(node);
    return node;
  };
  const nodes = new Map<string, ReturnType<typeof mkNode>>();
  nodes.set("breast.L", mkNode("breast.L", restL));
  nodes.set("breast.R", mkNode("breast.R", restR));
  nodes.set("clavicle.L", mkNode("clavicle.L", 0.024));
  nodes.set("clavicle.R", mkNode("clavicle.R", -0.024));
  nodes.set("head", mkNode("head", 0));

  for (const clip of opts.clips ?? []) {
    const joint = nodes.get(clip.joint);
    if (!joint) throw new Error(`unknown synthetic joint ${clip.joint}`);
    const anim = doc.createAnimation(clip.animation);
    const interp = clip.interpolation ?? "STEP";

    const input = doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Float32Array(clip.xs.map((_, i) => i)))
      .setBuffer(buffer);
    let output;
    if (clip.outType === "SCALAR") {
      output = doc.createAccessor().setType("SCALAR").setArray(new Float32Array(clip.xs)).setBuffer(buffer);
    } else if (interp === "CUBICSPLINE") {
      // glTF CUBICSPLINE: in-tangent, value, out-tangent per key.
      const flat: number[] = [];
      for (const x of clip.xs) flat.push(0, 0.16, 0, x, 0.16, 0, 0, 0.16, 0);
      output = doc.createAccessor().setType("VEC3").setArray(new Float32Array(flat)).setBuffer(buffer);
      // input count n matches; output count is 3n by spec — the tool must refuse before trusting it.
    } else {
      const flat: number[] = [];
      for (const x of clip.xs) flat.push(x, 0.16, 0);
      output = doc.createAccessor().setType("VEC3").setArray(new Float32Array(flat)).setBuffer(buffer);
    }
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation(interp);
    anim.addSampler(sampler);
    anim.addChannel(
      doc.createAnimationChannel().setTargetNode(joint).setTargetPath("translation").setSampler(sampler),
    );
  }

  if (opts.shareFirstSampler) {
    // Rebuild: two channels (L + R) on ONE sampler pinned at 0. Drop the per-clip
    // samplers above for the first animation by writing a dedicated shared file.
    const doc2 = new Document();
    const buf2 = doc2.createBuffer();
    const mk2 = (name: string, x: number) => {
      const node = doc2.createNode(name).setTranslation([x, 0.16, 0]);
      doc2.createScene("s").addChild(node);
      return node;
    };
    const l = mk2("breast.L", restL);
    const r = mk2("breast.R", restR);
    mk2("clavicle.L", 0.024);
    mk2("clavicle.R", -0.024);
    const anim = doc2.createAnimation("walk");
    const input = doc2.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buf2);
    const output = doc2
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0.16, 0, 0, 0.16, 0]))
      .setBuffer(buf2);
    const sampler = doc2.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("STEP");
    anim.addSampler(sampler);
    anim.addChannel(doc2.createAnimationChannel().setTargetNode(l).setTargetPath("translation").setSampler(sampler));
    anim.addChannel(doc2.createAnimationChannel().setTargetNode(r).setTargetPath("translation").setSampler(sampler));
    await new NodeIO().write(path, doc2);
    return;
  }

  await new NodeIO().write(path, doc);
}

function synthTemp(opts: Parameters<typeof writeSyntheticRig>[1], fn: (glb: string, dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "chest-repair-synth-"));
  const glb = join(dir, "synth.glb");
  return (async () => {
    await writeSyntheticRig(glb, opts);
    await fn(glb, dir);
  })().finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("chest walk-sampler repair", () => {
  it("default mode still refuses an already-separated rest (old tool notable, unchanged)", async () => {
    await synthTemp(
      { restL: 0.085, restR: -0.085, clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0] }] },
      (glb, dir) => {
        const res = runTool(["--input", glb, "--output", glb, "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/already-separated anchor/);
      },
    );
  });

  it("repair mode restores pinned walk X to each joint's own rest X and preserves everything else", async () => {
    await synthTemp(
      {
        restL: 0.085,
        restR: -0.085,
        clips: [
          { animation: "walk", joint: "breast.L", xs: [0, 0] },
          { animation: "walk", joint: "breast.R", xs: [0, 0] },
          { animation: "idle", joint: "breast.L", xs: [0.085, 0.085] },
          { animation: "idle", joint: "breast.R", xs: [-0.085, -0.085] },
        ],
      },
      async (glb, dir) => {
        const before = await new NodeIO().read(glb);
        const snapRest = new Map<string, { t: number[]; r: number[]; s: number[] }>();
        for (const n of before.getRoot().listNodes()) {
          snapRest.set(n.getName(), { t: [...n.getTranslation()], r: [...n.getRotation()], s: [...n.getScale()] });
        }
        const beforeMeshDigest = JSON.stringify(
          before.getRoot().listMeshes().map((m) => m.listPrimitives().map((p) => p.listAttributes().map((a) => [...(a.getArray() ?? [])].length))),
        );
        const beforeCounts = {
          accessors: before.getRoot().listAccessors().length,
          animations: before.getRoot().listAnimations().length,
        };

        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", glb, "--report", join(dir, "r.json")]);
        expect(res.stderr).toBe("");
        expect(res.ok).toBe(true);
        const report = JSON.parse(readFileSync(join(dir, "r.json"), "utf8"));
        expect(report.repairCollapsedAnimations).toBe(true);
        expect(report.animationChannelsRepaired).toHaveLength(2);

        const after = await new NodeIO().read(glb);
        // Rest TRS exactly preserved on every node.
        for (const n of after.getRoot().listNodes()) {
          const s = snapRest.get(n.getName())!;
          expect([...n.getTranslation()]).toEqual(s.t);
          expect([...n.getRotation()]).toEqual(s.r);
          expect([...n.getScale()]).toEqual(s.s);
        }
        // Walk curves now restate each joint's own rest X; y/z per key untouched.
        const curves = await breastTranslationX(glb);
        for (const [key, xs] of curves) {
          if (key === "walk|breast.L") for (const x of xs) expect(Math.abs(x - 0.085)).toBeLessThanOrEqual(EPS);
          if (key === "walk|breast.R") for (const x of xs) expect(Math.abs(x - -0.085)).toBeLessThanOrEqual(EPS);
          if (key === "idle|breast.L") for (const x of xs) expect(Math.abs(x - 0.085)).toBeLessThanOrEqual(EPS);
          if (key === "idle|breast.R") for (const x of xs) expect(Math.abs(x - -0.085)).toBeLessThanOrEqual(EPS);
        }
        // Meshes untouched.
        const afterMeshDigest = JSON.stringify(
          after.getRoot().listMeshes().map((m) => m.listPrimitives().map((p) => p.listAttributes().map((a) => [...(a.getArray() ?? [])].length))),
        );
        expect(afterMeshDigest).toBe(beforeMeshDigest);
        expect(after.getRoot().listAccessors().length).toBe(beforeCounts.accessors);
        expect(after.getRoot().listAnimations().length).toBe(beforeCounts.animations);
      },
    );
  });

  it("repair mode refuses when there is nothing collapsed (already-correct unchanged)", async () => {
    await synthTemp(
      {
        restL: 0.085,
        restR: -0.085,
        clips: [
          { animation: "walk", joint: "breast.L", xs: [0.085, 0.085] },
          { animation: "walk", joint: "breast.R", xs: [-0.085, -0.085] },
        ],
      },
      (glb, dir) => {
        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", glb, "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/nothing to repair/);
      },
    );
  });

  it("repair mode refuses a collapsed rest (that is the default tool's job, not this mode's)", async () => {
    await synthTemp({ restL: 0, restR: 0, clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0] }] }, (glb, dir) => {
      const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/already-separated mirrored rest/);
    });
  });

  it("unrelated joints are never touched", async () => {
    await synthTemp(
      {
        clips: [
          { animation: "walk", joint: "breast.L", xs: [0, 0] },
          { animation: "walk", joint: "breast.R", xs: [0, 0] },
          { animation: "walk", joint: "head", xs: [0, 0] },
        ],
      },
      async (glb, dir) => {
        const before = await new NodeIO().read(glb);
        const headBefore = JSON.stringify(
          (() => {
            for (const a of before.getRoot().listAnimations()) {
              for (const c of a.listChannels()) {
                if (c.getTargetNode()?.getName() === "head") return [...(c.getSampler().getOutput().getArray() ?? [])];
              }
            }
            return [];
          })(),
        );
        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(true);
        const after = await new NodeIO().read(join(dir, "out.glb"));
        for (const a of after.getRoot().listAnimations()) {
          for (const c of a.listChannels()) {
            if (c.getTargetNode()?.getName() === "head") {
              expect(JSON.stringify([...(c.getSampler().getOutput().getArray() ?? [])])).toBe(headBefore);
            }
          }
        }
      },
    );
  });

  it("meaningful dynamic breast curves are preserved, never flattened", async () => {
    await synthTemp(
      {
        clips: [
          { animation: "walk", joint: "breast.L", xs: [0, 0] },
          { animation: "walk", joint: "breast.R", xs: [0, 0] },
        ],
      },
      async (glb, dir) => {
        // Dynamic sway around rest on a second clip must survive the repair.
        const doc = await new NodeIO().read(glb);
        const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
        const l = doc.getRoot().listNodes().find((n) => n.getName() === "breast.L")!;
        const anim = doc.createAnimation("sway");
        const input = doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
        const output = doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array([0.08, 0.16, 0, 0.09, 0.16, 0]))
          .setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR");
        anim.addSampler(sampler);
        anim.addChannel(doc.createAnimationChannel().setTargetNode(l).setTargetPath("translation").setSampler(sampler));
        await new NodeIO().write(glb, doc);

        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(true);
        const report = JSON.parse(readFileSync(join(dir, "r.json"), "utf8"));
        expect(report.animationChannelsUnchanged.map((c: { reason: string }) => c.reason)).toContain("meaningful_dynamic_preserved");
        const after = await new NodeIO().read(join(dir, "out.glb"));
        for (const a of after.getRoot().listAnimations()) {
          if (a.getName() !== "sway") continue;
          for (const c of a.listChannels()) {
            const got = [...(c.getSampler().getOutput().getArray() ?? [])];
            expect(got.length).toBe(6);
            for (const [i, want] of [0.08, 0.16, 0, 0.09, 0.16, 0].entries()) {
              expect(Math.abs(got[i] - want)).toBeLessThanOrEqual(1e-6);
            }
          }
        }
      },
    );
  });

  it("mixed midline/rest samplers fail closed instead of guessing", async () => {
    await synthTemp({ clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0.085] }] }, (glb, dir) => {
      const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/mixed\/ambiguous/);
    });
  });

  it("malformed samplers fail closed", async () => {
    await synthTemp(
      { clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0], outType: "SCALAR" }] },
      (glb, dir) => {
        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/malformed/);
      },
    );
  });

  it("CUBICSPLINE interpolation is rejected unless tangents are handled", async () => {
    await synthTemp(
      { clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0], interpolation: "CUBICSPLINE" }] },
      (glb, dir) => {
        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/CUBICSPLINE/);
      },
    );
  });

  it("a sampler shared with the other side refuses rather than corrupting it", async () => {
    await synthTemp({ shareFirstSampler: true }, (glb, dir) => {
      const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/shared with/);
    });
  });

  it("two distinct samplers sharing one output accessor refuse rather than corrupting the innocent joint", async () => {
    await synthTemp(
      { clips: [{ animation: "walk", joint: "breast.L", xs: [0, 0] }] },
      async (glb, dir) => {
        // Rewire: keep L pinned at 0 but point a second sampler (R, distinct
        // sampler object) at the SAME output accessor. A sampler-keyed guard
        // would see two single-user samplers and mutate; the output-keyed guard
        // must refuse because L (+0.085) and R (-0.085) need different values.
        const doc = await new NodeIO().read(glb);
        const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
        const r = doc.getRoot().listNodes().find((n) => n.getName() === "breast.R")!;
        const walk = doc.getRoot().listAnimations().find((a) => a.getName() === "walk")!;
        const firstSampler = walk.listSamplers()[0];
        const sharedOutput = firstSampler.getOutput();
        const input2 = doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
        const sampler2 = doc.createAnimationSampler().setInput(input2).setOutput(sharedOutput).setInterpolation("STEP");
        walk.addSampler(sampler2);
        walk.addChannel(doc.createAnimationChannel().setTargetNode(r).setTargetPath("translation").setSampler(sampler2));
        await new NodeIO().write(glb, doc);

        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/shared with/);
      },
    );
  });

  it("non-finite VEC3 components fail closed as malformed instead of being preserved", async () => {
    await synthTemp(
      {
        restL: 0.085,
        restR: -0.085,
        clips: [
          { animation: "walk", joint: "breast.L", xs: [0, 0] },
          { animation: "walk", joint: "breast.R", xs: [0, 0] },
        ],
      },
      async (glb, dir) => {
        // Poison Y of the L walk curve with NaN: X is still midline-pinned, so
        // the old code would restore X and publish the NaN as if valid.
        const doc = await new NodeIO().read(glb);
        const walk = doc.getRoot().listAnimations().find((a) => a.getName() === "walk")!;
        for (const c of walk.listChannels()) {
          if (c.getTargetNode()?.getName() !== "breast.L") continue;
          const arr = c.getSampler().getOutput().getArray()!;
          arr[1] = Number.NaN;
        }
        await new NodeIO().write(glb, doc);

        const res = runTool(["--repair-collapsed-animations", "--input", glb, "--output", join(dir, "out.glb"), "--report", join(dir, "r.json")]);
        expect(res.ok).toBe(false);
        expect(res.stderr).toMatch(/non-finite/);
      },
    );
  });
});
