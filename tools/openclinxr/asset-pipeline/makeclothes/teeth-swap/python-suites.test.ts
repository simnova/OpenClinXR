import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runs the teeth-swap Python suites (swap_teeth.py fixtures and the feature_hashes.py final-GLB rows)
 * so pre-push gates them; before this nothing in the repo invoked them (super-ceo-cap14 2026-11-10).
 * Same mise spawn as the face-regression tests: python comes from the repo's mise config.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
// teeth-swap/ sits one level deeper than makeclothes/, whose known-good root
// (makeclothes/fit-cli.ts:41) climbs four levels; climb five here.
const REPO_ROOT = path.resolve(HERE, "../../../../..");

describe("teeth-swap python suites", () => {
  it("test_swap_teeth and test_feature_hashes pass", () => {
    if (!existsSync(path.join(REPO_ROOT, "mise.toml"))) {
      throw new Error(`teeth-swap suites: derived repo root missing mise.toml: ${REPO_ROOT}`);
    }
    const proc = spawnSync(
      "mise",
      ["exec", "-C", REPO_ROOT, "--", "python3", "-m", "unittest", "discover", "-s", HERE, "-t", HERE, "-p", "test_*.py"],
      { encoding: "utf8", timeout: 60_000 },
    );
    const tail = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.slice(-3000);
    expect(proc.status, tail).toBe(0);
    expect(tail).toMatch(/Ran 10 tests/);
  });
});
