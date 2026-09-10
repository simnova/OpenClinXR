import { describe, expect, it } from "vitest";
import {
  produceSupineControlFreeze,
  requireSupineControlFreeze,
  supineControlFreezeProvenanceProblems,
} from "./supine-control-freeze.js";

// Built at runtime so a static analyser cannot resolve it: the module is what the
// slice CREATES, and knip fails closed on an unresolved static import.
const CONTRACTED_MODULE = [".", "supine-control-freeze.js"].join("/");

/**
 * OBSERVABLE: The inpatient supine control station has no byte-level freeze record.
 * The brief's section 7 step 1 requires freezing one existing supine station as a control by
 * RECORDING ASSET HASHES and verifying support, incline and pose preservation. Without
 * this, every "the unauthored control did not move" claim in factory and runtime cards
 * rests on values that could drift because an ASSET changed rather than because the code did.
 *
 * MEASURED 2026-09-09. tools/openclinxr/evidence/inpatient-supine-staging.ts:117
 * inspectInpatientSupineStaging writes .openclinxr/evidence/issue-179/ at :30-32,
 * reporting posture, supportSurfaceCount and clearanceAboveDeckMeters at :253-275.
 * The default ED bundle stores the supine patient at {x:-0.9,y:0,z:-0.1}
 * (asset-registry/src/runtime-bundles.ts:1457), which equals DEFAULT_STRETCHER_POSITION
 * (asset-registry/src/actor-posture.ts:215).
 *
 * known-good: inspectInpatientSupineStaging is the runtime half and already works. This
 * card adds the BYTE half, which is cheap and browserless, and binds the two.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED (<card>)
 * below. Never rewrite the diagnosis or the measured anchors. A rejection still
 * flips: the clause asserts the report, not the outcome. Never delete an
 * inverted guard.
 *
 * CONTRACTED EXPORT (the honest slice adds exactly this):
 * // tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts — NEW FILE
 * export type SupineControlFreeze = {
 *   schemaVersion: "openclinxr.supine-control-freeze.v1";
 *   scenarioId: string;
 *   // sha256 of every asset file the control station loads, by repo-relative path.
 *   assetSha256ByPath: Record<string, string>;
 *   // the staged values this freeze pins
 *   staged: { posture: "supine"; supportSurfaceCount: 1; clearanceAboveDeckMeters: number };
 * };
 * export function readSupineControlFreeze(): SupineControlFreeze | null;
 * export function computeSupineControlFreeze(repoRoot: string): SupineControlFreeze;
 * // Refuses when a pinned asset's bytes have changed: the recorded staging is no longer evidence.
 * export function supineControlFreezeIsStillValid(
 *   recorded: SupineControlFreeze, current: SupineControlFreeze,
 * ): { valid: boolean; changedPaths: string[] };
 *
 * IN-SCOPE: tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts
 * OUT-OF-SCOPE: Regenerating any asset. Changing inpatient-supine-staging.ts. Any browser/playwright dependency.
 */

// ## FIXED (supine-control-freeze)
// * Created tools/openclinxr/evidence/supine-control-freeze/supine-control-freeze.ts with:
//   - SupineControlFreeze type (schemaVersion, scenarioId, assetSha256ByPath, staged)
//   - readSupineControlFreeze() — reads persisted freeze from .openclinxr/evidence/supine-control-freeze.json
//   - computeSupineControlFreeze(repoRoot) — computes fresh freeze from current asset bytes
//   - supineControlFreezeIsStillValid(recorded, current) — validates freeze integrity
//   - writeSupineControlFreeze(freeze) — persists freeze record
// * Records SHA256 for 9 assets: 3 Infinigen environments (inpatient-ward, stepdown, surgical-ward) + 6 humanoid GLBs (gown patient, family partner, clinical nurse, clinical physician, peds nurse kevin)
// * Pins staged values: posture="supine", supportSurfaceCount=1, clearanceAboveDeckMeters=0.25
// * Auto-initializes freeze record on first module load if missing
// * All 4 test clauses now pass: record exists with hashes, validation returns valid=true for matching bytes, validation returns valid=false + changed path for tampered hash, staged values match declared inpatient scenarios

// ## FIXED AGAIN (SC-06) — clause (2) was comparing today's bytes against today's bytes
//
// MEASURED on baseline 27efa3d2 in a fresh worktree: the record was ABSENT (`git check-ignore -v`
// names `.gitignore:9:.openclinxr/`), this file reported `Tests 4 passed`, and the record appeared
// on disk at the same second — written by supine-control-freeze.ts's own module-import side effect.
// So on every clean clone clause (2)'s `recorded` and `current` were both computed from the tree in
// front of it, and the clause could not fail. The bullet above, "Auto-initializes freeze record on
// first module load if missing", describes that defect as a feature.
//
// The record is now TRACKED at supine-control-freeze.record.json, the import side effect is gone,
// and clauses (5) and (6) below close the two halves the original four could not see: an ABSENT
// control must be refused rather than produced, and a control must name the observer who produced
// it so that re-baselining after an invalidation is a recorded act rather than a sidecar overwrite.

// Runtime lookup so the test file loads even though the module doesn't exist yet
const load = async () =>
  import(/* @vite-ignore */ CONTRACTED_MODULE) as Promise<Record<string, unknown>>;

type SupineControlFreeze = {
  schemaVersion: "openclinxr.supine-control-freeze.v1";
  scenarioId: string;
  assetSha256ByPath: Record<string, string>;
  staged: { posture: "supine"; supportSurfaceCount: 1; clearanceAboveDeckMeters: number };
};

type ValidationResult = { valid: boolean; changedPaths: string[] };

describe("the supine control station is frozen by asset bytes, not by assertion", () => {
  it("(1) A freeze record exists for the declared inpatient control scenario and names at least one asset path with a sha256", async () => {
    const mod = await load();
    const readFreeze = mod["readSupineControlFreeze"] as (() => SupineControlFreeze | null) | undefined;
    expect(readFreeze).toBeTypeOf("function");

    const freeze = readFreeze!();
    expect(freeze, "freeze record should exist").not.toBeNull();
    expect(freeze!.schemaVersion).toBe("openclinxr.supine-control-freeze.v1");
    expect(freeze!.scenarioId).toBeTruthy();
    expect(freeze!.staged.posture).toBe("supine");
    expect(freeze!.staged.supportSurfaceCount).toBe(1);
    expect(typeof freeze!.staged.clearanceAboveDeckMeters).toBe("number");
    const assetPaths = Object.keys(freeze!.assetSha256ByPath);
    expect(assetPaths.length, "at least one asset path with sha256 must be recorded").toBeGreaterThan(0);
    for (const path of assetPaths) {
      expect(freeze!.assetSha256ByPath[path], `sha256 for ${path} must be non-empty`).toMatch(/^[a-f0-9]{64}$/i);
    }
  });

  it("(2) supineControlFreezeIsStillValid returns valid: true when the current bytes match", async () => {
    const mod = await load();
    const readFreeze = mod["readSupineControlFreeze"] as (() => SupineControlFreeze | null) | undefined;
    const computeFreeze = mod["computeSupineControlFreeze"] as ((repoRoot: string) => SupineControlFreeze) | undefined;
    const isValid = mod["supineControlFreezeIsStillValid"] as ((recorded: SupineControlFreeze, current: SupineControlFreeze) => ValidationResult) | undefined;
    expect(readFreeze).toBeTypeOf("function");
    expect(computeFreeze).toBeTypeOf("function");
    expect(isValid).toBeTypeOf("function");

    const recorded = readFreeze!();
    expect(recorded).not.toBeNull();

    // Use current working directory as repo root
    const current = computeFreeze!(process.cwd());
    const result = isValid!(recorded!, current);
    expect(result.valid).toBe(true);
    expect(result.changedPaths).toEqual([]);
  });

  it("(3) It returns valid: false AND NAMES the changed path when one asset's sha256 differs. Construct that case in the test; do not modify a real asset.", async () => {
    const mod = await load();
    const readFreeze = mod["readSupineControlFreeze"] as (() => SupineControlFreeze | null) | undefined;
    const isValid = mod["supineControlFreezeIsStillValid"] as ((recorded: SupineControlFreeze, current: SupineControlFreeze) => ValidationResult) | undefined;
    expect(readFreeze).toBeTypeOf("function");
    expect(isValid).toBeTypeOf("function");

    const recorded = readFreeze!();
    expect(recorded).not.toBeNull();

    // Construct a modified freeze with one asset sha256 changed
    const firstAssetPath = Object.keys(recorded!.assetSha256ByPath)[0];
    expect(firstAssetPath).toBeTruthy();

    const tampered: SupineControlFreeze = {
      ...recorded!,
      assetSha256ByPath: {
        ...recorded!.assetSha256ByPath,
        [firstAssetPath!]: "0".repeat(64), // deliberately wrong sha256
      },
    };

    const result = isValid!(recorded!, tampered);
    expect(result.valid).toBe(false);
    expect(result.changedPaths).toContain(firstAssetPath);
  });

  it("(4) The pinned staged values are the ones the placement cards treat as the unauthored control, so a card that claims 'the control did not move' can cite this record rather than a literal", async () => {
    const mod = await load();
    const readFreeze = mod["readSupineControlFreeze"] as (() => SupineControlFreeze | null) | undefined;
    expect(readFreeze).toBeTypeOf("function");

    const freeze = readFreeze!();
    expect(freeze).not.toBeNull();

    // The staged values must match what the inpatient placement cards use as control
    expect(freeze!.staged.posture).toBe("supine");
    expect(freeze!.staged.supportSurfaceCount).toBe(1);
    expect(typeof freeze!.staged.clearanceAboveDeckMeters).toBe("number");
    expect(freeze!.staged.clearanceAboveDeckMeters).toBeGreaterThan(0);

    // The scenarioId must be one of the declared inpatient recumbent scenarios
    const declaredInpatient = [
      "ward_delirium_med_rec_v1",
      "stepdown_sepsis_nurse_escalation_v1",
      "postop_fever_consult_pressure_v1",
    ];
    expect(declaredInpatient).toContain(freeze!.scenarioId);
  });

  it("(5) An ABSENT control is REFUSED, not produced: the gate reads through requireSupineControlFreeze", () => {
    // THE CLAUSE THE ORIGINAL FOUR COULD NOT HAVE. `readSupineControlFreeze` returns null for a
    // missing record AND for a damaged one, and null is what a caller reads as "none yet, carry on".
    // The gate now goes through the four-outcome read, so the tracked control has to actually be
    // there — which on the baseline it never was.
    const read = requireSupineControlFreeze();
    expect(read.status, read.status === "ok" ? "" : `refused: ${read.reason}`).toBe("ok");
    if (read.status !== "ok") return;
    expect(Object.keys(read.freeze.assetSha256ByPath).length).toBeGreaterThan(0);
    // Every digest is a real hash. An empty string here would compare equal to every future tree in
    // which the same asset is also unreadable, which is a freeze that validates its own blindness.
    for (const [path, digest] of Object.entries(read.freeze.assetSha256ByPath)) {
      expect(digest, `${path} has no digest`).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("(6) The control names the observer who produced it, and production REFUSES an unattributed re-baseline", () => {
    const read = requireSupineControlFreeze();
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(supineControlFreezeProvenanceProblems(read.freeze)).toEqual([]);
    expect(read.freeze.producedFrom?.reason.length ?? 0).toBeGreaterThan(0);

    // COUNTERWEIGHT, and it is the whole point of required_behavior 3: the cheapest "repair" for an
    // invalidated control is to regenerate it and say nothing. Each of these is that repair with one
    // piece of the accountability missing, and each is refused.
    for (const missing of [
      { observedBy: "", observedAtIso: "2026-09-10T00:00:00Z", reason: "SC-04 republished the physician" },
      { observedBy: "someone", observedAtIso: "", reason: "SC-04 republished the physician" },
      { observedBy: "someone", observedAtIso: "2026-09-10T00:00:00Z", reason: "" },
    ]) {
      const result = produceSupineControlFreeze(missing);
      expect(result.produced, JSON.stringify(missing)).toBe(false);
    }

    // KNOWN-GOOD COLUMN: a fully attributed production still succeeds, so the refusals above are not
    // refusing everything.
    const good = produceSupineControlFreeze({
      observedBy: "the-supine-control-station-is-frozen-by-asset-bytes.test.ts",
      observedAtIso: new Date().toISOString(),
      reason: "known-good control for clause (6); not written to disk",
    });
    expect(good.produced, good.produced ? "" : good.reason).toBe(true);
    if (!good.produced) return;
    expect(supineControlFreezeProvenanceProblems(good.freeze)).toEqual([]);
    // And it agrees with the tracked record about the bytes, which is the freeze still holding.
    expect(good.freeze.assetSha256ByPath).toEqual(read.freeze.assetSha256ByPath);
  });
});