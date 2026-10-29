import { describe, expect, it } from "vitest";
import { buildVisemeProfileEvidence, type RawTimelineRow } from "./epoch-profile-evidence.js";

const OWNER = "parent_tara_johnson_v1";
const MESH = "mpfb_peds_anxious_parent_body_1";
const COLLECTOR = "tools/openclinxr/evidence/viseme-drive/epoch-profile-evidence.ts";

function row(partial: Partial<RawTimelineRow> & { t: number }): RawTimelineRow {
  return { meshName: MESH, nonZeroVisemes: [], diagSameInstant: null, ...partial };
}

function diag(clockMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meshActorId: OWNER,
    speechActiveActorId: OWNER,
    ownedEpochRootActorId: OWNER,
    ownedClockRootActorId: OWNER,
    ownedEpochClockMs: clockMs,
    ...extra,
  };
}

function ownedRow(t: number, clockMs: number, start = 1000, dur = 3150, visemes: Array<[string, number]> = []): RawTimelineRow {
  return row({
    t,
    nonZeroVisemes: visemes.map(([targetName, influence], i) => ({ targetName, influence, index: i, meshName: MESH })),
    diagSameInstant: diag(clockMs, {
      ownedSpeechEpoch: { actorId: OWNER, speechActorId: OWNER, startedAtMs: start, durationMs: dur },
      dictKeys: ["viseme_aa", "viseme_TH"],
    }),
  });
}

// Legacy-shaped absent row: epoch root null (legitimate per actual 141 raw) but the NEW
// clock-root identity is present from the same cud that stamped the clock.
function absentRow(t: number, clockMs: number): RawTimelineRow {
  return row({
    t,
    nonZeroVisemes: [{ targetName: "viseme_sil", influence: 0.5, index: 0, meshName: MESH }],
    diagSameInstant: diag(clockMs, {
      ownedEpochRootActorId: null,
      ownedSpeechEpoch: null,
      dictKeys: ["viseme_aa", "viseme_TH"],
    }),
  });
}

const META = {
  expectedOwnerActorId: OWNER,
  expectedMeshName: MESH,
  actorId: OWNER,
  meshName: MESH,
  subjectAssetPath: "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
  subjectAssetSha256: "s",
  dictKeysSha256: "d",
  targetCount: 47,
  sourceFile: "packages/openclinxr/xr-dialogue/src/viseme-morph-apply.ts",
  sourceSha256: "h",
  collectorSourceFile: COLLECTOR,
  collectorSourceSha256: "c",
};

describe("buildVisemeProfileEvidence", () => {
  it("counts active/inactive, peaks, and one completed epoch", () => {
    const rows = [ownedRow(1, 1100, 1000, 3150, [["viseme_aa", 0.5], ["viseme_TH", 1]]), ownedRow(2, 1200), absentRow(3, 4200)];
    const out = buildVisemeProfileEvidence({ rows, ...META });
    expect(out.activeEpochSampleCount).toBe(2);
    expect(out.inactiveEpochSampleCount).toBe(1);
    expect(out.completedEpochCount).toBe(1);
    expect(out.prematureEpochClearCount).toBe(0);
    expect(out.activeMorphPeaks["viseme_TH"]).toBe(1);
    expect(out.inactiveMorphPeaks["viseme_sil"]).toBe(0.5);
  });

  it("refuses completion when the frame pass ends while owned", () => {
    const rows = [ownedRow(1, 1100), ownedRow(2, 1200)];
    const out = buildVisemeProfileEvidence({ rows, ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(0);
  });

  it("counts a premature clear when the absent clock precedes declared end", () => {
    const rows = [ownedRow(1, 1100, 1000, 3150), absentRow(2, 1500)];
    const out = buildVisemeProfileEvidence({ rows, ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(1);
  });

  it("counts owner mismatches and rejects pending/wrong-owner/non-finite rows", () => {
    const wrongOwner = ownedRow(1, 1100);
    (wrongOwner.diagSameInstant as Record<string, unknown>)["ownedSpeechEpoch"] = {
      actorId: "someone_else", speechActorId: "someone_else", startedAtMs: 1000, durationMs: 3150,
    };
    const pending = ownedRow(2, 500);
    const noDur = ownedRow(3, 1100);
    (noDur.diagSameInstant as Record<string, unknown>)["ownedSpeechEpoch"] = {
      actorId: OWNER, speechActorId: OWNER, startedAtMs: 1000, durationMs: 0,
    };
    const out = buildVisemeProfileEvidence({ rows: [wrongOwner, pending, noDur], ...META });
    expect(out.activeEpochSampleCount).toBe(0);
    expect(out.ownerMismatchCount).toBeGreaterThanOrEqual(1);
  });

  it("reports no fake positive on empty input", () => {
    const out = buildVisemeProfileEvidence({ rows: [], ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.activeEpochSampleCount).toBe(0);
    expect(out.inactiveEpochSampleCount).toBe(0);
  });

  it("completes only the replaced epoch B, not interrupted epoch A", () => {
    // A owned rows, then B replaces (different epoch), then B completes.
    const a1 = ownedRow(1, 1100, 1000, 3150);
    const b1 = ownedRow(2, 2100, 2000, 1000);
    const bAbsent = absentRow(3, 3100); // >= 3000 end of B
    const out = buildVisemeProfileEvidence({ rows: [a1, b1, bAbsent], ...META });
    expect(out.completedEpochCount).toBe(1);
    expect(out.prematureEpochClearCount).toBe(0);
  });

  it("foreign clock-root absence proves nothing", () => {
    const foreign = absentRow(2, 5000);
    (foreign.diagSameInstant as Record<string, unknown>)["ownedClockRootActorId"] = "patient_maya_johnson_v1";
    const out = buildVisemeProfileEvidence({ rows: [ownedRow(1, 1100, 1000, 3150), foreign], ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(0);
  });

  it("same-owner partial epoch without completion stays at zero", () => {
    const out = buildVisemeProfileEvidence({ rows: [ownedRow(1, 1100, 1000, 3150)], ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(0);
  });

  it("premature clear yields one premature and zero pending", () => {
    const out = buildVisemeProfileEvidence({ rows: [ownedRow(1, 1100, 1000, 3150), absentRow(2, 1500)], ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(1);
  });

  it("positive epochs with wrong clock identity count divergence and are excluded", () => {
    const bad = ownedRow(1, 1100, 1000, 3150);
    (bad.diagSameInstant as Record<string, unknown>)["ownedClockRootActorId"] = "foreign_actor";
    const out = buildVisemeProfileEvidence({ rows: [bad], ...META });
    expect(out.activeEpochSampleCount).toBe(0);
    expect(out.ownerMismatchCount).toBeGreaterThanOrEqual(1);
    expect(out.completedEpochCount).toBe(0);
  });

  it("missing clock-root identity leaves completion unknown, never invented", () => {
    const noClock = absentRow(2, 5000);
    delete (noClock.diagSameInstant as Record<string, unknown>)["ownedClockRootActorId"];
    const out = buildVisemeProfileEvidence({ rows: [ownedRow(1, 1100, 1000, 3150), noClock], ...META });
    expect(out.completedEpochCount).toBe(0);
    expect(out.prematureEpochClearCount).toBe(0);
  });
});
