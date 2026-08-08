import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#233). TRELLIS Metal mesh bake — Metal Toolchain is now present.
 *
 * #225 measured `inconclusive_blocked` because Metal Toolchain was missing; mtlmesh/* failed
 * to compile. Operator reports toolchain installed 2026-08-08. Re-run the bake end-to-end.
 *
 * Header IMMUTABLE — append ## FIXED (#233).
 *
 * Verdict vocabulary (exactly one):
 *   mesh_exported | blocked_build | blocked_model | runs_but_over_budget | inconclusive_blocked
 * All close successfully. MADR 0050: report raw + postOpt tris; do not reject solely on raw > 60k.
 */

type Bake = {
  verdict:
    | "mesh_exported"
    | "blocked_build"
    | "blocked_model"
    | "runs_but_over_budget"
    | "inconclusive_blocked";
  verdictReason: string;
  metalToolchainPresent: boolean;
  installPath: string;
  stages: Record<string, "runs" | "blocked" | "throws" | "skipped">;
  rawTriangleCount: number | null;
  postOptTriangleCount: number | null;
  texturedPbr: "yes" | "no" | string;
  exportPath: string | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Bake>;
const load = () =>
  import("./trellis-metal-mesh-bake.js") as Promise<Record<string, unknown>>;

describe("TRELLIS Metal mesh bake with Toolchain present (#233)", () => {
  it("Metal mesh bake reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalMeshBake"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect([
      "mesh_exported",
      "blocked_build",
      "blocked_model",
      "runs_but_over_budget",
      "inconclusive_blocked",
    ]).toContain(r.verdict);
    expect(r.verdictReason.length).toBeGreaterThan(20);
    expect(r.metalToolchainPresent, "must re-probe metal toolchain — operator claims it is installed").toBe(
      true,
    );
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|adopt/i);
  }, 5_400_000);

  it("a claimed mesh export has measured geometry and a file (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectTrellisMetalMeshBake"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "mesh_exported" && r.verdict !== "runs_but_over_budget") return;
    expect(r.exportPath).toBeTruthy();
    expect(existsSync(r.exportPath!)).toBe(true);
    expect(r.rawTriangleCount).toBeGreaterThan(0);
  }, 5_400_000);
});
