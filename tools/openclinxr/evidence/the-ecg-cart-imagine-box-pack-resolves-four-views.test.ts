import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: G1 PACK_A #232 rebuilt a photoreal cluttered cart. Next TREE
 * needs a hard-surface Imagine-box 4-view pack off issue-232.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED.
 *
 * ## FIXED (Imagine-box 4-view pack)
 * Tracked pack tools/openclinxr/asset-pipeline/trellis/packs/ecg-cart-imagine-box
 * resolves viewCount 4 via factory:trellis:bake --dry-run.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACK = join(REPO, "tools/openclinxr/asset-pipeline/trellis/packs/ecg-cart-imagine-box");
const VIEWS = ["front.png", "side.png", "three_quarter_left.png", "three_quarter_right.png"] as const;

describe("the ECG cart Imagine-box pack resolves four views", () => {
  it("(1) tracked pack is not issue-232 and factory:trellis:bake dry-run reports viewCount 4", () => {
    expect(PACK.includes("issue-232")).toBe(false);
    for (const name of VIEWS) {
      const file = join(PACK, name);
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file).byteLength).toBeGreaterThan(10_000);
    }
    const stdout = execFileSync(
      "pnpm",
      ["factory:trellis:bake", "--subject", "ecg-cart-imagine-box", "--dry-run"],
      { cwd: REPO, encoding: "utf8" },
    );
    const jsonStart = stdout.indexOf("{");
    const plan = JSON.parse(stdout.slice(jsonStart)) as {
      subjectId?: string;
      viewCount?: number;
      inputImagePaths?: string[];
    };
    expect(plan.subjectId).toBe("ecg-cart-imagine-box");
    expect(plan.viewCount).toBe(4);
    expect(plan.inputImagePaths?.every((p) => !p.includes("issue-232"))).toBe(true);
    expect(plan.inputImagePaths?.every((p) => p.includes("ecg-cart-imagine-box"))).toBe(true);
  });
});

// NOT TESTED: live GPU bake; hatch remesh.
