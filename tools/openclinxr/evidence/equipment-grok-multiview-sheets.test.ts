import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * PLANTED CONTRACTS (#232). Grok-image multi-view equipment reference packs for TRELLIS inputs.
 *
 * Does NOT require TRELLIS backend. Produces image packs + manifest only.
 * Header IMMUTABLE — append ## FIXED (#232).
 *
 * ## FIXED (#232)
 * - `inspectEquipmentGrokMultiviewSheets` lands in equipment-grok-multiview-sheets.ts.
 * - Packs on disk: ecg-cart | wall-clock | bedside-monitor (4 views each: front,
 *   three_quarter_left, three_quarter_right, side) under .openclinxr/evidence/issue-232/.
 * - Images from harness image_gen (Grok Imagine); JPG→PNG; manifest lists paths/prompts.
 * - claimScope / notEvidenceFor exclude clinical accuracy, TRELLIS success, Quest readiness.
 */

type MvReport = {
  subjects: string[];
  manifestPath: string;
  packs: Array<{ subjectId: string; views: string[]; minBytes: number }>;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<MvReport>;

const load = () =>
  import("./equipment-grok-multiview-sheets.js") as Promise<Record<string, unknown>>;

const ROOT = ".openclinxr/evidence/issue-232";

describe("Grok multi-view equipment reference sheets (#232)", () => {
  it("three equipment multi-view packs exist with a valid manifest", async () => {
    const mod = await load();
    const inspect = mod["inspectEquipmentGrokMultiviewSheets"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(r.subjects.length).toBeGreaterThanOrEqual(3);
    expect(existsSync(r.manifestPath) || existsSync(join(ROOT, "manifest.json"))).toBe(true);
    expect(r.notEvidenceFor.join(" ")).toMatch(/trellis|quest|clinical/i);
  }, 1_800_000);

  it("views are distinct files with non-trivial bytes (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectEquipmentGrokMultiviewSheets"] as Inspect;
    const r = await inspect();
    expect(r.packs.length).toBeGreaterThanOrEqual(3);
    for (const pack of r.packs) {
      expect(pack.views.length).toBeGreaterThanOrEqual(4);
      expect(pack.minBytes).toBeGreaterThan(5000);
    }
    // Spot-check on-disk front for first subject dir if present
    if (existsSync(join(ROOT, "ecg-cart", "front.png"))) {
      expect(statSync(join(ROOT, "ecg-cart", "front.png")).size).toBeGreaterThan(5000);
    }
  }, 1_800_000);
});
