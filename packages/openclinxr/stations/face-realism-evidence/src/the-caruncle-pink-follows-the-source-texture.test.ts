// Card tsk_028edd8266dda1f1 CARUNCLE-PINK.
// NONE close: pick.json d9dfb67e (cap56 2026-11-22); the medial-canthus gap vs Blender is shading, not albedo; the file name predates the verdict.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function testRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("workspace root (pnpm-workspace.yaml) not found");
}

type ChainStep = {
  name?: unknown;
  script?: unknown;
  parameters?: { inner_rgb?: unknown; outer_rgb?: unknown; feather_px?: unknown };
};

function readSteps(): ChainStep[] {
  const root = testRepoRoot();
  const chain = JSON.parse(
    readFileSync(join(root, "tools/openclinxr/asset-pipeline/skin/face-replay/chain-manifest.json"), "utf8"),
  ) as { stages?: ChainStep[] };
  expect(Array.isArray(chain.stages), "chain-manifest stages array present").toBe(true);
  return chain.stages ?? [];
}

function findEyeCorners(steps: ChainStep[]): ChainStep | undefined {
  return steps.find((step) => step.name === "eye_corners");
}

const INNER_MESSAGE =
  "CARUNCLE-PINK closed NONE (caruncle/pick.json d9dfb67e): Blender shares this texture, so inner_rgb cannot close the gap, and a pinker/lighter paint raises L* where runtime is already 8-14 L* too bright. Change it only with a new graded Blender-vs-runtime sweep.";

describe("the caruncle pink follows the source texture", () => {
  it("CW-PARAM: eye_corners inner_rgb is the closed NONE value", () => {
    const step = findEyeCorners(readSteps());
    expect(step, "eye_corners step present in chain-manifest").toBeDefined();
    expect(step?.parameters?.inner_rgb, INNER_MESSAGE).toEqual([200, 140, 125]);
  });

  it("CW-LATERAL: eye_corners outer_rgb and feather match the closed values", () => {
    const step = findEyeCorners(readSteps());
    expect(step, "eye_corners step present in chain-manifest").toBeDefined();
    expect(step?.parameters?.outer_rgb, "outer_rgb closed value").toEqual([215, 185, 170]);
    expect(step?.parameters?.feather_px, "feather_px closed value").toBe(8);
  });

  it("STEP-PRESENT: exactly one eye_corners step runs fix_corner.py", () => {
    const steps = readSteps();
    const matches = steps.filter((step) => step.name === "eye_corners");
    expect(matches, "exactly one step named eye_corners").toHaveLength(1);
    expect(matches[0]?.script, "eye_corners runs fix_corner.py").toBe("fix_corner.py");
  });
});
