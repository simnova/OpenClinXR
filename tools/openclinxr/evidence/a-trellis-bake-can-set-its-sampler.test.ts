import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a TRELLIS bake can be run at sampler parameters other than the shipped defaults, and
 * records which ones it used.
 *
 * MEASURED 2026-08-25, do not re-derive. The pipeline exposes three samplers, each
 * `FlowEulerGuidanceIntervalSampler`, with five knobs apiece — read from
 * `~/ComfyUI/models/trellis2/pipeline.json`:
 *
 *   sampler                   steps  guidance_strength  guidance_rescale  interval     rescale_t
 *   sparse_structure_sampler     12                7.5               0.7  [0.6, 1.0]         5.0
 *   shape_slat_sampler           12                7.5               0.5  [0.6, 1.0]         3.0
 *   tex_slat_sampler             12                1.0               0.0  [0.6, 0.9]         3.0
 *
 * **None of the fifteen is settable from this repo.** `run_bake_isolated.py` declares only
 * `--subject-id`, `--display-name`, `--input-image`, `--output-dir`, `--seed`, `--weights-path`,
 * `--dinov3-path`, `--trellis-root`, `--hf-demo`, `--remesh`, `--no-remesh`, `--decimation-target`
 * and `--texture-size`.
 *
 * **`--hf-demo` is a no-op by construction.** At `run_bake_isolated.py:243-252` it reads the
 * pipeline's own defaults with `getattr(pipeline, "sparse_structure_sampler_params", {})` and passes
 * them straight back. It changes the shape of the call and never a value, so every bake this repo has
 * ever produced ran at the table above.
 *
 * WHY THIS BLOCKS REAL WORK. #661's TRELLIS shoe carries 76 disconnected components with the largest
 * at 93.8%, and the raw bake already shows 76 at 96.7% — **so the debris originates in generation,
 * not in decimation or meshopt.** `sparse_structure` builds the coarse occupancy grid, which is where
 * stray voxels become floating fragments. **That hypothesis cannot be tested at all until the knob is
 * reachable.**
 *
 * KNOWN-GOOD COLUMN - clause (2): `--seed` and `--decimation-target` are already threaded end to end,
 * from the TypeScript CLI's argv builder through to a Python `add_argument`. They are the shape a
 * correctly wired knob has in this codebase, and they must keep working.
 *
 * COUNTERWEIGHT - clause (3): the defaults must not move. A bake invoked with no sampler flags has to
 * behave exactly as it does today, or every prior measurement on this bank silently changes meaning.
 * The Python must keep its `--hf-demo`, `--remesh`, `--no-remesh` and `--decimation-target` arguments.
 *
 * FAILED TREATMENT, do not repeat: making `--hf-demo` write different values. It exists to reproduce
 * the HF Space call shape and is referenced by prior bake records; changing what it means retroactively
 * rewrites what those runs were.
 *
 * claimScope: which arguments the bake CLI and the Python script accept, read from their source.
 * notEvidenceFor: what any sampler value does to output quality — nothing has been varied yet; whether
 *   the pipeline honours a passed value; the multi-view path, which takes a different branch.
 *
 * ## FIXED (#662)
 *
 * All fifteen knobs are reachable end to end. Flag naming: `--<prefix>-<knob>` with prefix
 * ss|shape|tex and knob steps|guidance-strength|guidance-rescale|guidance-interval (two floats
 * LO HI)|rescale-t — e.g. `--ss-steps 8 --shape-guidance-interval 0.4 1.0`. Only explicitly
 * passed values are forwarded; run_bake_isolated.py merges them over the pipeline defaults
 * (user wins) in both single-view and multi-view branches, and records the effective merged
 * table under `effectiveSamplerParams` plus explicit overrides under `samplerOverrides`
 * (`--hf-demo`'s `samplerParams` key is untouched). The second gap is closed in the same pass:
 * `--decimation-target` and `--texture-size` were declared in Python but never forwarded by
 * trellis-bake-cli.ts; they now parse, appear in dry-run plans, and reach argv.
 */

const PY = "tools/openclinxr/evidence/blender/run_bake_isolated.py";
const TS = "tools/openclinxr/asset-pipeline/trellis/trellis-bake-cli.ts";
/** One flag per sampler is enough to prove the surface is reachable; steps is the cheapest to vary. */
const REQUIRED_FLAGS = ["--ss-steps", "--shape-steps", "--tex-steps"] as const;

const py = (): string => readFileSync(PY, "utf8");
const ts = (): string => readFileSync(TS, "utf8");

describe("a trellis bake can set its sampler", () => {
  it("(1) the bake exposes sampler knobs and forwards them", () => {
    const p = py(); const t = ts();
    const missingPython = REQUIRED_FLAGS.filter((f) => !p.includes(`"${f}"`));
    expect(
      missingPython,
      "run_bake_isolated.py declares no sampler arguments, so every bake this repo has produced ran "
      + "at the shipped defaults and the #661 debris hypothesis cannot be tested",
    ).toHaveLength(0);
    const missingForward = REQUIRED_FLAGS.filter((f) => !t.includes(f));
    expect(
      missingForward,
      "the TypeScript CLI does not forward the sampler flags into argv, so the Python surface would "
      + "be unreachable from the factory station",
    ).toHaveLength(0);
  });

  it("(2) KNOWN-GOOD COLUMN: the knobs that ARE wired stay wired end to end", () => {
    // --seed and --decimation-target are the shape a correctly threaded knob has here: declared in
    // Python, pushed into argv in TypeScript. A fix that rewires the CLI must not break them.
    const p = py(); const t = ts();
    for (const flag of ["--seed", "--decimation-target"]) {
      expect(p.includes(`"${flag}"`), `${flag} must stay declared in ${PY}`).toBe(true);
    }
    expect(t.includes('argv.push("--seed"'), "the CLI must still forward --seed").toBe(true);
  });

  it("(3) COUNTERWEIGHT: the existing arguments and defaults survive", () => {
    // Every prior measurement on this bank was taken at the shipped defaults. If a no-flag bake stops
    // behaving as it does today, those records silently change meaning.
    const p = py();
    for (const flag of ["--hf-demo", "--remesh", "--no-remesh", "--texture-size"]) {
      expect(p.includes(`"${flag}"`), `${flag} must survive the rewiring`).toBe(true);
    }
    expect(p.includes("default=300_000"), "the decimation default must not move").toBe(true);
  });

  it("(4) VACUITY GUARD: the reader is parsing the real sources", () => {
    // Without this, clause (1) passes on an empty read and clause (3) on a file that no longer exists.
    expect(py().length, `${PY} must be a real file`).toBeGreaterThan(2000);
    expect(ts().length, `${TS} must be a real file`).toBeGreaterThan(2000);
    expect(py().includes("add_argument"), "the Python must be an argparse CLI").toBe(true);
  });
});
