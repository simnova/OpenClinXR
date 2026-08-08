import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";

/**
 * PLANTED CONTRACTS (#231). Comfy-only humanoid texture bake — StableGen headless is closed.
 *
 * MADR 0045: StableGen modal operator hangs headless. Prefer Comfy depth→RealVisXL→project/bake.
 * Header IMMUTABLE — append ## FIXED (#231).
 */

type BakeMeasure = {
  verdict: "texture_baked" | "inconclusive_blocked" | "reject_measured";
  verdictReason: string;
  textureBytes: number | null;
  textureResolution: string | null;
  generationWallClockSeconds: number | null;
  subjectPath: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

type Inspect = () => Promise<BakeMeasure>;

const load = () =>
  import("./comfy-humanoid-texture-bake.js") as Promise<Record<string, unknown>>;

describe("Comfy-only humanoid texture bake (#231)", () => {
  it("texture bake reached a named verdict", async () => {
    const mod = await load();
    const inspect = mod["inspectComfyHumanoidTextureBake"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");
    const r = await inspect!();
    expect(["texture_baked", "inconclusive_blocked", "reject_measured"]).toContain(r.verdict);
    expect(r.verdictReason.length).toBeGreaterThan(15);
    expect(r.notEvidenceFor.join(" ")).toMatch(/clinical|quest|ready/i);
  }, 3_600_000);

  it("a claimed bake produced texture bytes and before/after stills (COUNTERWEIGHT)", async () => {
    const mod = await load();
    const inspect = mod["inspectComfyHumanoidTextureBake"] as Inspect;
    const r = await inspect();
    if (r.verdict !== "texture_baked") return;
    expect(r.textureBytes).toBeGreaterThan(1000);
    expect(existsSync(".openclinxr/evidence/issue-231/before.png")).toBe(true);
    expect(existsSync(".openclinxr/evidence/issue-231/after.png")).toBe(true);
    expect(statSync(".openclinxr/evidence/issue-231/after.png").size).toBeGreaterThan(2000);
  }, 3_600_000);
});
