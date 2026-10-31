import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve as pathResolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RETIRED (ci-w6-head-realism-adapt, 2026-10-30).
 *
 * The spike eyes-compat bake this file guarded no longer exists in the
 * product: the realism-95 worktree that held its inputs is deleted, and the
 * motivating F-bake bytes (compat-report realism 5906f48cded6, re-baked
 * 2026-10-20 in eye-finish 5fb75138a) lived only as ephemera under
 * /var/folders/.../eyefinish_eye/ (now only sheet/ remains) and were never
 * promoted to the store (the store compat-eyes file is a different bake,
 * 0f006d01a537). Regenerating them needs a Blender metal re-bake, but there
 * is no product reason to do so: the geometric-eye lane (eye-geo, promoted
 * in 65c0fd397, 2026-10-22) rebuilt the eye as a proper anterior segment
 * with its own GREEN-gated evidence (G3 seal, G4 lash re-seat, G5
 * catchlight, G6 full-head + child) and its own blink/gaze tests in this
 * same directory. The old compat-report.json + census.json stay on disk as
 * the historical record; nothing in the product reads them as live
 * evidence anymore.
 *
 * This file therefore asserts only the retirement fact: the superseding G6
 * evidence exists and is green, and the spike bake inputs are gone.
 */

const HERE = join(repoRoot(), "tools/openclinxr/evidence/realism-head/eyes");
const REPO_ROOT = repoRoot();
const G6_MANIFEST = join(HERE, "geometric-eye-g6-manifest.json");
const G6_REPORT = join(HERE, "geometric-eye-g6-report.json");
const GONE_SCRATCH_BAKE =
  "/var/folders/sy/ycs0d4hj4552t2dn87x96x780000gn/T//eyefinish_eye/aisha-realism.lash.glb";
const GONE_SPIKE_INPUT = pathResolve(
  REPO_ROOT,
  "../realism-95/.openclinxr/realism-spike/eyemesh/aisha-hp-cornea.glb",
);

function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

describe("the spike eyes-compat bake is retired in favour of the G6 eye", () => {
  it("the superseding G6 evidence exists and is GREEN 19/19", () => {
    expect(existsSync(G6_MANIFEST), G6_MANIFEST).toBe(true);
    const manifest = JSON.parse(readFileSync(G6_MANIFEST, "utf8")) as {
      gate: string;
      report: { file: string; sha256: string };
    };
    expect(manifest.gate).toMatch(/GREEN 19\/19/);
    expect(existsSync(G6_REPORT), G6_REPORT).toBe(true);
    expect(sha256File(join(HERE, manifest.report.file))).toBe(manifest.report.sha256);
  });

  it("the spike bake inputs are gone (worktree deleted, scratch cleaned)", () => {
    expect(existsSync(GONE_SPIKE_INPUT), "spike eyemesh input must stay absent").toBe(false);
    expect(existsSync(GONE_SCRATCH_BAKE), "ephemeral F-bake must stay absent").toBe(false);
  });
});
