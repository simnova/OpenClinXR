import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#235). TRELLIS multi-case bake from Grok MV packs + MADR 0050 post-opt.
 *
 * #233 proved one ECG image → mesh_exported (991k tris, postOpt null). #232 shipped multi-view
 * packs for ecg-cart, wall-clock, bedside-monitor.
 *
 * This slice: bake ≥2 subjects from those packs (or documented blocked), run simplify/meshopt,
 * report rawTriangleCount AND postOptTriangleCount per subject. Do not reject solely on raw.
 *
 * Header IMMUTABLE — append ## FIXED (#235).
 *
 * ## RETIRED (ci-w7, 2026-10-30)
 *
 * The multi-case spike inputs no longer exist: the #232 Imagine view PNGs were worktree-local
 * and never tracked, and the issue-235 bake outputs were never landed — the report in this
 * checkout is an empty "awaiting Python bake execution" shell. The deliberate successor is the
 * factory equipment chain that baked, treated, froze and published the ECG cart (R5-BEST,
 * 86acc9cae, 2026-10-02, MADR 0059) with wired per-subject bake + postopt records. Per the
 * brief, a retired guard asserts the retirement fact: the superseding records exist and the
 * shipped bytes still match the successor's pin. Never plain-deleted: the file stays as the
 * marker that #235 must not be re-planted against the dead spike inputs.
 */

const WIRING = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/factory-wiring";
const SHIPPED_CART = "apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart.glb";

describe("TRELLIS multi-case bake + post-opt (#235) — RETIRED", () => {
  it("the spike multi-case is superseded by the factory wired records (86acc9cae)", () => {
    for (const f of [`${WIRING}/bake-measure.json`, `${WIRING}/measurement.json`, `${WIRING}/GRADE.md`]) {
      expect(existsSync(f), `successor record missing: ${f}`).toBe(true);
    }
    const bake = JSON.parse(readFileSync(`${WIRING}/bake-measure.json`, "utf8")) as {
      subjectId?: string; verdict?: string; rawTriangleCount?: number; stages?: Record<string, unknown>;
    };
    expect(bake.subjectId, "successor bake names no subject").toBe("ecg-cart");
    expect(
      ["mesh_exported", "runs_but_over_budget"],
      "successor bake reached no measured export verdict",
    ).toContain(bake.verdict);
    expect(bake.rawTriangleCount, "successor bake records no raw column").toBeGreaterThan(0);
  });

  it("the shipped cart still matches the successor's measured pin (COUNTERWEIGHT)", () => {
    // If the successor regresses (records deleted or cart re-baked unpinned), this fails.
    const measurement = JSON.parse(readFileSync(`${WIRING}/measurement.json`, "utf8")) as {
      sha256?: string; bytes?: number;
    };
    const live = readFileSync(SHIPPED_CART);
    expect(createHash("sha256").update(live).digest("hex")).toBe(measurement.sha256);
    expect(live.byteLength).toBe(measurement.bytes);
  });
});
