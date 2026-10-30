import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#239). Deeper post-opt ladder toward station band (MADR 0050).
 *
 * First-pass postopt (#235/#237) at ratio 0.10:
 *   wall-clock ~93k, bedside-monitor ~141k, ecg-cart ~184k
 * Station soft target ≤60k per prop; hard ceiling 180k. Clock is closest; ECG/monitor still fat.
 *
 * Job: multi-rung simplify ladder on existing raw or stage-1 postopt GLBs (no re-bake TRELLIS).
 * Record raw → stage1 → stage2(+), feature survival (non-zero extent, not collapsed).
 *
 * Header IMMUTABLE — append ## FIXED (#239).
 *
 * ## RETIRED (ci-w7, 2026-10-30)
 *
 * The spike-era subjects this ladder guarded no longer exist: the issue-235/issue-237 raw TRELLIS
 * GLBs (wall-clock, bedside-monitor, ecg-cart raws) were worktree-local, never tracked, and the
 * ladder report in this checkout is an empty "awaiting ≥2 source GLBs" shell. The deliberate
 * successor is the factory R5-BEST chain (86acc9cae, 2026-10-02, MADR 0059): स्टेशन bake with
 * recorded raw → postopt treatment columns (raw 11,990,792 faces, island filter 35 → 7 kept,
 * final 37,828 tris — inside the old 60k soft target), frozen and published to the runtime.
 * Per the brief, a retired guard asserts the retirement fact: the superseding records exist and
 * the shipped bytes still match the successor's pin. Never plain-deleted: the file stays as the
 * marker that #239's ladder must not be re-planted against the dead spike inputs.
 */

const WIRING = "docs/openclinxr/asset-cagematch/image-to-3dlab-ecg-cart-2026-10-01/factory-wiring";
const FREEZE = "tools/openclinxr/asset-pipeline/trellis/equipment-freezes/ecg-cart.freeze.json";
const SHIPPED_CART = "apps/ui-xr/public/xr-assets/medical-equipment/ecg-cart.glb";

describe("TRELLIS deeper post-opt ladder to station band (#239) — RETIRED", () => {
  it("the spike ladder is superseded by the factory R5-BEST wired records (86acc9cae)", () => {
    for (const f of [`${WIRING}/bake-measure.json`, `${WIRING}/components.json`, `${WIRING}/measurement.json`, FREEZE]) {
      expect(existsSync(f), `successor record missing: ${f}`).toBe(true);
    }
    const bake = JSON.parse(readFileSync(`${WIRING}/bake-measure.json`, "utf8")) as {
      subjectId?: string; verdict?: string; rawTriangleCount?: number;
    };
    expect(bake.subjectId, "successor bake names no subject").toBe("ecg-cart");
    expect(bake.verdict, "successor bake reached no measured verdict").toBe("mesh_exported");
    const components = JSON.parse(readFileSync(`${WIRING}/components.json`, "utf8")) as unknown;
    expect(components, "successor postopt treatment record is empty").not.toBeNull();
  });

  it("the shipped cart still matches the successor's measured pin (COUNTERWEIGHT)", () => {
    // If the successor regresses (records deleted or cart re-baked unpinned), this fails.
    const measurement = JSON.parse(readFileSync(`${WIRING}/measurement.json`, "utf8")) as {
      sha256?: string; bytes?: number; triangles?: number;
    };
    const live = readFileSync(SHIPPED_CART);
    expect(createHash("sha256").update(live).digest("hex")).toBe(measurement.sha256);
    expect(live.byteLength).toBe(measurement.bytes);
    expect(measurement.triangles, "successor final must sit inside the old 60k soft target")
      .toBeLessThanOrEqual(60_000);
  });
});
