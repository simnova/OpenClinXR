import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#77) — five candidate tools were researched and none was ever run.
 *
 * ALL THREE `it.fails` FLIP. This header is THE RECORD, not scratch — flip them, append a
 * `## FIXED (#77)` block below, and leave the measured facts intact.
 *
 * WHY THIS EXISTS. The operator surfaced five repos over two days. They were checked for licence and
 * hardware viability and filed on #70/#71/#46. **Not one was installed or executed.** Meanwhile five
 * consecutive slices hand-tuned a procedural garment generator, and #76 records that two machine
 * gates for shoulder coverage have now both passed on visibly bare shoulders.
 *
 * THE TWO IN SCOPE NEED NO DECISION FROM ANYONE:
 *
 *   Mesh2Motion    asset-registry/src/index.ts:927 — MIT, authoring_output_allowed,
 *                  preferredForInitialBuild: TRUE, approvalBlockers: [] — the only registered tool in
 *                  that state, named in MADR 0016's accepted decision, and
 *                  `grep -rn mesh2motion tools/openclinxr/asset-pipeline/` returns NOTHING.
 *   Infinigen      BSD-3-Clause (gh api repos/princeton-vl/infinigen .license.spdx_id). Apple Silicon
 *   Indoors        supported with documented arm64 steps; CUDA optional and terrain-only; built on
 *                  Blender, already the approved tool for the environment_equipment lane — which has
 *                  no generator registered at all.
 *
 * THE DELIVERABLE IS A DECISION WITH EVIDENCE, NOT AN ADOPTION. "Mesh2Motion's rig is worse than the
 * hand-built armature for our topology, here is the measurement" CLOSES THIS SUCCESSFULLY. So does
 * "Infinigen's rooms blow the Quest triangle budget by 40x, here is the count." Do not adopt either;
 * do not wire either into the shipping pipeline.
 *
 * THE THIRD CONTRACT IS THE ONE THAT KEEPS THIS HONEST. "It would not install" is a legitimate
 * result and must be recorded WITH THE ACTUAL ERROR. A report that describes a bake-off nobody ran is
 * the #17 failure — a fabricated score.json where the grader was also the producer — and this project
 * has paid for that once already.
 *
 * ARTIFACTS MUST CARRY CONTENT, NOT JUST EXIST. `min-bytes:` proves a renderer ran; #56 shipped 113 KB
 * of collapsed torsos past exactly that check. A skeleton report needs a bone count and named joints;
 * a room report needs triangles and a wall-clock. Numbers nobody could have written without running
 * the tool.
 *
 * WHAT I HAVE NOT DETERMINED, one line each and possibly all wrong: whether Mesh2Motion takes a mesh
 * or an image as input; whether Infinigen Indoors can be parameterised toward a named room type or
 * only sampled; whether either needs a model download and how large; whether a Python 3.10 venv is
 * required alongside the 3.13 on this machine. Find out by running them, and record what you find
 * even if it contradicts the issue.
 *
 * ANIGEN-MAC IS EXPLICITLY OUT. Every hardware prerequisite is verified here — macOS 26.5.2, Xcode
 * 26.6, arm64, Metal/MPS, no CUDA — but `extensions/CUBVH/` derives from NVIDIA instant-ngp under
 * non-commercial / research use only. That is a decision for Patrick, not an agent. Do not install it.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `runExternalToolCagematch()` returning per-tool
 * entries. Change the call sites and say why if a different shape is better. What must not change: a
 * skeleton report carries a bone count, a room report carries triangles and time, and a tool that
 * failed to install is recorded as blocked with its error rather than skipped.
 *
 * SCOPE: did these tools run on this machine, and what did they produce. Says NOTHING about whether
 * either is better than the incumbent — I open the outputs beside what we ship and record that
 * verdict on #77. Whether a generated clinical room is clinically plausible needs a clinician.
 */

const load = async () =>
  import("./external-tool-cagematch.js") as Promise<Record<string, unknown>>;

type ToolEntry = {
  toolId: string;
  status: "ran" | "blocked";
  blockedReason?: string;
  skeleton?: { boneCount: number; jointNames: string[] };
  room?: { triangleCount: number; generationSeconds: number; gltfPath: string };
};
type Run = () => Promise<{ tools: ToolEntry[] }>;

describe("the candidate tools were actually run (#77)", () => {
  it.fails("the mesh2motion probe reports a real skeleton with a bone count and named joints", async () => {
    const mod = await load();
    const run = mod["runExternalToolCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    const entry = report.tools.find((t) => t.toolId === "mesh2motion");
    expect(entry, "no mesh2motion entry in the report").toBeDefined();
    if (entry!.status === "blocked") {
      // A blocked tool is a legitimate outcome — but it is the THIRD contract's business, and this
      // one is about what a successful run must carry. Fail loudly so the blocked path cannot be
      // used to satisfy this contract by omission.
      expect(entry!.status, `mesh2motion blocked: ${entry!.blockedReason}`).toBe("ran");
    }
    expect(entry!.skeleton?.boneCount, "a rig with no bones is not a rig").toBeGreaterThan(0);
    expect(entry!.skeleton?.jointNames.length, "bones without names are not comparable").toBeGreaterThan(0);
  }, 1_800_000);

  it.fails("the infinigen probe reports a triangle count and a generation wall-clock for a real room", async () => {
    const mod = await load();
    const run = mod["runExternalToolCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    const entry = report.tools.find((t) => t.toolId === "infinigen_indoors");
    expect(entry, "no infinigen entry in the report").toBeDefined();
    if (entry!.status === "blocked") {
      expect(entry!.status, `infinigen blocked: ${entry!.blockedReason}`).toBe("ran");
    }
    // The two numbers that decide whether this is usable at all: what it costs to draw, and what it
    // costs to make. Neither can be written without running it.
    expect(entry!.room?.triangleCount).toBeGreaterThan(0);
    expect(entry!.room?.generationSeconds).toBeGreaterThan(0);
    expect(String(entry!.room?.gltfPath ?? ""), "a room with no exported file is not a room").not.toHaveLength(0);
  }, 1_800_000);

  it.fails("a tool that could not be installed is recorded as blocked with the error, not silently skipped", async () => {
    // The anti-fabrication contract. Every tool named in the report must be accounted for: either it
    // ran and carries measurements, or it is blocked and carries the reason it failed. A report that
    // simply omits a tool it could not install is how a bake-off that never happened gets filed as
    // one.
    const mod = await load();
    const run = mod["runExternalToolCagematch"] as Run | undefined;
    expect(run).toBeTypeOf("function");

    const report = await run!();
    expect(report.tools.length, "the report names no tools at all").toBeGreaterThanOrEqual(2);
    for (const entry of report.tools) {
      expect(["ran", "blocked"]).toContain(entry.status);
      if (entry.status === "blocked") {
        expect(
          String(entry.blockedReason ?? ""),
          `${entry.toolId} is blocked with no reason — that is a skip wearing a label`,
        ).not.toHaveLength(0);
      }
    }
  }, 1_800_000);
});
