import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type captureIsolatedFootGrounder, gradeReport, resolveFootCapturePaths } from "./capture.js";

type Report = Awaited<ReturnType<typeof captureIsolatedFootGrounder>>;
const snapshot = JSON.parse(readFileSync(new URL("./report.json", import.meta.url), "utf8")) as Report;
// Independent golden (hardcoded literal is intentional here): the canonical
// walk clip verified against the frozen plan + provenance lineage, NOT read
// from the production grader under test.
// - Frozen plan: packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts:101-107
//   revisions.clipRevision = "openclinxr_retarget_walk_source"
//   (via getExpectedFootGrounderIdentity() in
//   tools/openclinxr/evidence/canonical-staging-contracts/expected-foot-identity.ts).
// - Provenance: apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.provenance.json
//   motionClips[0].clipName = "openclinxr_retarget_walk_source",
//   retiredMotionClips[] "openclinxr_retarget_walk_formal_cc0" removed 2026-09-23.
// SYNTHETIC unit-control: admitted() is a synthetic current-contract control, not a real capture; old report.json stays byte-exact.
// Historical report.json is preserved unchanged (still formal_cc0, Sep-16 era);
// only this fixture's admitted() clip pin is corrected.
const CANONICAL_WALK_CLIP = "openclinxr_retarget_walk_source" as const;
const RETIRED_FORMAL_CLIP = "openclinxr_retarget_walk_formal_cc0" as const;
function admitted(): Parameters<typeof gradeReport> {
  const point = { x: 0, y: 1, z: 0 };
  const samples = Array.from({ length: 120 }, (_, frame) => ({ ...snapshot.samples[0], frame, atMs: frame + 1, leftHeel: point, leftToe: point, rightHeel: point, rightToe: point }));
  return [samples, { ...snapshot.cadence, maxOverMedian: 1, medianStrideMeters: 0.001, hz: 240, sampleCount: 120 }, { ...snapshot.clipIdentity, caseFrozenClipRevision: CANONICAL_WALK_CLIP, liveClipStamp: CANONICAL_WALK_CLIP, match: true }, "case_owned_bedside_approach", { frameId: "floor", originX: 0, originY: 0, originZ: 0 }, [], false, false];
}

describe("capture destinations", () => {
  it("defaults to distinct ignored execution directories, never the tracked snapshot", () => {
    const a = resolveFootCapturePaths();
    const b = resolveFootCapturePaths();
    expect(a.outputDir).not.toBe(b.outputDir);
    expect(a.outputDir).toMatch(/^\.openclinxr[/]evidence[/]isolated-foot-grounder[/]runs[/]/);
    expect(a.reportPath).toBe(path.join(a.outputDir, "report.json"));
    expect(a.reportPath).not.toBe("tools/openclinxr/evidence/isolated-foot-grounder/report.json");
  });
  it("writes beside explicit capture output and preserves an explicit report override", () => {
    expect(resolveFootCapturePaths("/tmp/foot-proof")).toEqual({ outputDir: "/tmp/foot-proof", reportPath: "/tmp/foot-proof/report.json" });
    expect(resolveFootCapturePaths("/tmp/foot-proof", "/tmp/separate/report.json")).toEqual({ outputDir: "/tmp/foot-proof", reportPath: "/tmp/separate/report.json" });
  });
});

describe("independent contact evidence gates", () => {
  it("accepts admitted evidence when every gate passes", () => {
    expect(gradeReport(...admitted())).toEqual({ ok: true, problems: [] });
  });
  it("retains an admitted run but refuses insufficient cadence", () => {
    const args = admitted();
    args[1].maxOverMedian = 3.2;
    expect(gradeReport(...args)).toEqual({ ok: false, problems: ["maxOverMedian 3.20 > 2"] });
  });
  it("names admission and floor refusals without demanding those outcomes", () => {
    const args = admitted(); args[3] = null; args[4] = null;
    expect(gradeReport(...args)).toEqual({ ok: false, problems: ["drive source is null, required case_owned_bedside_approach", "no floor frame observed"] });
  });
  it("refuses an environment timeout even if admission and floor are subsequently present", () => {
    const args = admitted(); args[7] = true;
    expect(gradeReport(...args)).toEqual({ ok: false, problems: ["environment prerequisite timed out: InfinigenEnvironmentStatus never reached loaded"] });
  });
  it("refuses non-finite cadence instead of letting NaN comparisons pass", () => {
    const args = admitted(); args[1].maxOverMedian = Number.NaN;
    expect(gradeReport(...args)).toEqual({ ok: false, problems: ["non-finite cadence metrics; contact sampling is not gradeable"] });
  });
  it("refuses the retired formal clip even when every other gate passes", () => {
    const args = admitted();
    args[2] = { ...args[2], caseFrozenClipRevision: RETIRED_FORMAL_CLIP, liveClipStamp: RETIRED_FORMAL_CLIP, match: true };
    expect(gradeReport(...args)).toEqual({ ok: false, problems: [`live clip name ${RETIRED_FORMAL_CLIP} does not match expected ${CANONICAL_WALK_CLIP}`] });
  });
});
