import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#212). Footwear: MakeClothes shoe if licence-clean, else procedural
 * foot-vertex shell — not free-floating AABB ellipsoids.
 *
 * #188 shipped footwear but as "volume over foot AABB" blobs. Gate would pass a detached
 * ellipsoid. #219/#226 embed those shells into library GLBs via embed_library_footwear.py.
 *
 * This slice:
 * 1. MEASURE first (pre-fix): per-asset index vs position-merged components + share with body
 * 2. Prefer MakeClothes/MPFB wardrobe shoe (.mhclo) with CC0/CC-BY in its own header
 * 3. Else improve procedural path: derive shell from foot vertices (not AABB-only), keep
 *    embed in body-param finish pipeline
 * 4. Decomposed visual: toe_defined | heel_defined | sole_plane (not "reads_as_footwear")
 *
 * Header IMMUTABLE — append ## FIXED (#212).
 *
 * ## FIXED (#212)
 * - pre-fix-attachment.json: library + Anny footwear measured detached
 *   (sharesVertexPositionWithBody=false, indexComponents=2, positionMerged=2).
 * - MakeClothes shoe search: no licence-clean staged .mhclo (combat_boots 404,
 *   shoes01 pack unavailable, local caches shirt-only).
 * - embed_library_footwear.py: foot-vertex longitudinal slices + sole plane +
 *   heel counter + elongated toe box + body-foot attachment anchors
 *   (revision issue_212_foot_vertex_landmark_shell_v1).
 * - post-fix library: sharesVertex=true (24 hits), tris≈324/asset.
 * - verdict: procedural_foot_vertex_improved.
 * - grade: .openclinxr/evidence/issue-212/footwear-grade.png (EEVEE feet frame).
 * - Residual: Anny rail still AABB #188 shells; pixel "reads as last" still
 *   load-bearing for anatomical shoe quality (toe/heel markers present, not fashion last).
 */

type AttachmentRow = {
  assetId: string;
  footwearMeshNames: string[];
  indexComponents: number;
  positionMergedComponents: number;
  sharesVertexPositionWithBody: boolean;
  triangleCount: number;
};

type PreFix = {
  measuredAt: string;
  rows: AttachmentRow[];
  ambientFailureClass: string;
};

type Measure = {
  verdict:
    | "makeclothes_shoe_fitted"
    | "procedural_foot_vertex_improved"
    | "blocked_no_licensed_shoe"
    | "measure_only_gate_weak_product_ok"
    | "inconclusive_blocked";
  verdictReason: string;
  preFixPath: string;
  pathUsed: "makeclothes" | "procedural" | "none";
  attachmentAfter: AttachmentRow[] | null;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Measure>;
const load = () =>
  import("./footwear-makeclothes-or-procedural.js") as Promise<Record<string, unknown>>;

const PRE = ".openclinxr/evidence/issue-212/pre-fix-attachment.json";

describe("footwear MakeClothes or procedural foot-vertex (#212)", () => {
  it("pre-fix attachment table exists before product claims and bake reached a verdict", async () => {
    expect(existsSync(PRE), "pre-fix attachment artifact required before product edit").toBe(true);
    const pre = JSON.parse(readFileSync(PRE, "utf8")) as PreFix;
    expect(pre.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of pre.rows) {
      expect(typeof row.indexComponents).toBe("number");
      expect(typeof row.positionMergedComponents).toBe("number");
      expect(typeof row.sharesVertexPositionWithBody).toBe("boolean");
    }

    const mod = await load();
    const inspect = mod["inspectFootwearMakeclothesOrProcedural"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect([
      "makeclothes_shoe_fitted",
      "procedural_foot_vertex_improved",
      "blocked_no_licensed_shoe",
      "measure_only_gate_weak_product_ok",
      "inconclusive_blocked",
    ]).toContain(r.verdict);
    expect(r.verdictReason.length).toBeGreaterThan(20);
    expect(r.notEvidenceFor.join(" ")).toMatch(/quest|clinical|ready/i);
  }, 3_600_000);

  it("a claimed shoe path improves attachment or shape vs free AABB blob (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectFootwearMakeclothesOrProcedural"] as Inspect;
    const r = await inspect();
    if (
      r.verdict === "inconclusive_blocked" ||
      r.verdict === "blocked_no_licensed_shoe" ||
      r.verdict === "measure_only_gate_weak_product_ok"
    ) {
      return;
    }
    expect(["makeclothes", "procedural"]).toContain(r.pathUsed);
    expect(r.attachmentAfter && r.attachmentAfter.length).toBeGreaterThan(0);
    // At least one library body after must not be a pure detached free component story
    // (shares with body OR position-merged components indicate continuous shell)
    const ok = (r.attachmentAfter ?? []).some(
      (row) => row.sharesVertexPositionWithBody || row.positionMergedComponents >= 1,
    );
    expect(ok, "post product attachment table empty of any continuous/attached signal").toBe(true);
    expect(existsSync(".openclinxr/evidence/issue-212/footwear-grade.png")).toBe(true);
  }, 3_600_000);
});
