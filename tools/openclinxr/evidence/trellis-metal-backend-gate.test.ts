import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#225). Metal TRELLIS backend gate — not another CUDA re-learn.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE #164 LEFT THIS — measured, do not re-derive
 *
 * Stock ComfyUI-TRELLIS2: 24 nodes register; shape gen hard-requires cumesh_vb (CUDA). Verdict
 * reject_measured. Registration is not execution.
 *
 * MADR 0049: pedronaugusto/trellis2-apple + mtlmesh/mtlgemm/mtldiffrast/mtlbvh (MIT) replace CUDA
 * under the same import names. shivampkumar/trellis-mac refused (RMBG CC BY-NC).
 *
 * THIS SLICE must install/run the Metal path (or prove it still blocks after a real attempt).
 * Diagnosis and measured tables above are IMMUTABLE. Append ## FIXED (#225) below when green.
 */

type BackendMeasure = {
  verdict: "backend_open" | "blocked_cuda" | "runs_but_over_budget" | "inconclusive_blocked";
  verdictReason: string;
  stack: "trellis2-apple-metal" | "stock-comfy-cuda" | "other";
  installPath: string;
  stages: Record<string, "runs" | "blocked" | "throws" | "skipped">;
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  texturedPbr: "yes" | "no" | string;
  exportPath: string | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<BackendMeasure>;

const load = () =>
  import("./trellis-metal-backend-gate.js") as Promise<Record<string, unknown>>;

describe("Metal TRELLIS backend gate (#225)", () => {
  it("Metal TRELLIS backend gate reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalBackendGate"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(["backend_open", "blocked_cuda", "runs_but_over_budget", "inconclusive_blocked"]).toContain(
      r.verdict,
    );
    expect(r.verdictReason.length).toBeGreaterThan(15);
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|adopt|clinical/i);
    if (r.verdict === "inconclusive_blocked") return;
    expect(r.installPath.length).toBeGreaterThan(3);
    expect(Object.keys(r.stages).length).toBeGreaterThan(0);
  }, 5_400_000);

  it("a claimed open backend exported a mesh with measured geometry (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalBackendGate"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "backend_open" && r.verdict !== "runs_but_over_budget") return;
    expect(r.exportPath, "open/over_budget requires an export path").toBeTruthy();
    expect(r.rawTriangleCount, "must measure raw tris").toBeGreaterThan(0);
    expect(r.stack).toBe("trellis2-apple-metal");
  }, 5_400_000);
});
