import { describe, expect, it } from "vitest";
import {
  buildDeterministicInputLog,
  buildPalpationInputLog,
  replayFromSnapshot,
  replayInputLog,
} from "../index.js";
import { HavokCandidateAdapter } from "../adapters/havok.js";
import type { PalpationConfig } from "../scenarios/palpation.js";
import { DEFAULT_PALPATION_SITES } from "../scenarios/palpation.js";

// ---------------------------------------------------------------------------
// HavokCandidateAdapter — basic behaviour
// ---------------------------------------------------------------------------
describe("HavokCandidateAdapter", () => {
  it("has engineId 'havok-candidate' in meta", () => {
    const adapter = new HavokCandidateAdapter();
    expect(adapter.meta.engineId).toBe("havok-candidate");
    expect(adapter.meta.determinismScope).toBe("local");
    expect(adapter.meta.fixedDt).toBe(1 / 60);
  });

  it("meta carries full notEvidenceFor (C7)", () => {
    const adapter = new HavokCandidateAdapter();
    expect(adapter.meta.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("step updates state with hand position from joint pose", () => {
    const adapter = new HavokCandidateAdapter(42);
    adapter.step({
      tick: 10,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 1.5, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null,
    });

    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));
    expect(state.stepCount).toBe(10);
    expect(state.rigidBodies.palp_hand.position.x).toBeCloseTo(1.5, 1);
    expect(state.rigidBodies.palp_hand.position.y).toBeCloseTo(0.5, 1);
  });

  it("step creates contact manifold when contactRegionId is set", () => {
    const adapter = new HavokCandidateAdapter(42);
    adapter.step({
      tick: 0,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.12, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0.5,
      contactRegionId: "abdomen_ruq",
    });

    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));
    const manifoldKeys = Object.keys(state.contactManifolds);
    expect(manifoldKeys.length).toBeGreaterThanOrEqual(1);
    // Manifold should reference hand and abdomen
    const firstKey = manifoldKeys[0]!;
    const mf = state.contactManifolds[firstKey];
    expect(mf.bodyA).toBe("palp_hand");
    expect(mf.bodyB).toBe("abdomen");
  });

  it("reset clears state and sets a new seed", () => {
    const adapter = new HavokCandidateAdapter(42);
    adapter.step({
      tick: 5,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.5, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null,
    });

    const beforeReset = adapter.takeSnapshotBytes();

    adapter.reset(77);
    const afterReset = adapter.takeSnapshotBytes();

    const stateBefore = JSON.parse(new TextDecoder().decode(beforeReset));
    const stateAfter = JSON.parse(new TextDecoder().decode(afterReset));

    // After reset, stepCount should be 0
    expect(stateAfter.stepCount).toBe(0);
    expect(stateAfter.seed).toBe(77);
    // Rigid bodies should be back at initial positions
    expect(stateAfter.rigidBodies.palp_hand.position.x).toBe(0);
  });

  it("applySnapshot restores full state including contact manifolds", () => {
    const adapter = new HavokCandidateAdapter(42);

    // Build some state
    adapter.step({
      tick: 10,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.2, y: 0.5, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0.7,
      contactRegionId: "abdomen_rlq",
    });

    const snapshot = adapter.takeSnapshot();

    // Reset and verify empty
    adapter.reset(99);
    const afterReset = adapter.takeSnapshotBytes();
    const stateAfterReset = JSON.parse(new TextDecoder().decode(afterReset));
    expect(stateAfterReset.stepCount).toBe(0);

    // Restore
    adapter.applySnapshot(snapshot);
    const restored = adapter.takeSnapshotBytes();
    const stateRestored = JSON.parse(new TextDecoder().decode(restored));
    expect(stateRestored.stepCount).toBe(10);
    expect(Object.keys(stateRestored.contactManifolds).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// C6 — Replay equivalence for HavokCandidateAdapter
// ---------------------------------------------------------------------------
describe("havok C6 replay equivalence", () => {
  it("identical input log → identical checksums across two runs", () => {
    const log = buildDeterministicInputLog(150);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log, 30);
    const checksums2 = trace2.result.checksums;

    expect(checksums1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(checksums1.length);

    for (let i = 0; i < checksums1.length; i++) {
      expect(checksums2[i]!.tick).toBe(checksums1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(checksums1[i]!.sha256);
    }
  });

  it("after snapshot restore at tick 60 → same checksums thereafter", () => {
    const log = buildDeterministicInputLog(150);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const snapshot60 = trace1.snapshots.get(60);
    expect(snapshot60).toBeDefined();

    const adapter2 = new HavokCandidateAdapter(42);
    const checksums2 = replayFromSnapshot(
      adapter2,
      snapshot60!,
      log,
      60,
      30,
    ).checksums;

    const postRestore1 = checksums1.filter((c) => c.tick > 60);
    expect(postRestore1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(postRestore1.length);

    for (let i = 0; i < postRestore1.length; i++) {
      expect(checksums2[i]!.tick).toBe(postRestore1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(postRestore1[i]!.sha256);
    }
  });

  it("different seeds → different checksums, but same seed → same checksums", () => {
    const log = buildDeterministicInputLog(60);

    const adapter42 = new HavokCandidateAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new HavokCandidateAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    // Re-run with seed 42 → same
    const adapter42b = new HavokCandidateAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  it("produces different checksums from the stub adapter (different engine)", async () => {
    const { StubPhysicsAdapter } = await import("../adapters/stub.js");
    const log = buildDeterministicInputLog(60);

    const havok = new HavokCandidateAdapter(42);
    const stub = new StubPhysicsAdapter(42);

    const havokTrace = replayInputLog(havok, log, 30);
    const stubTrace = replayInputLog(stub, log, 30);

    // Different engines should produce different checksums
    expect(havokTrace.result.checksums[0]!.sha256).not.toBe(
      stubTrace.result.checksums[0]!.sha256,
    );
  });
});

// ---------------------------------------------------------------------------
// Palpation scenario
// ---------------------------------------------------------------------------
describe("palpation scenario input log", () => {
  const palpationConfig: PalpationConfig = {
    ticks: 600,
    forcePeak: 0.8,
    sites: DEFAULT_PALPATION_SITES,
    dwellTicks: 40,
    transitionTicks: 20,
  };

  it("builds a non-empty input log with the correct number of entries", () => {
    const log = buildPalpationInputLog(palpationConfig);
    expect(log.entries.length).toBeGreaterThan(0);
    // Should not exceed ticks + 1
    expect(log.entries.length).toBeLessThanOrEqual(palpationConfig.ticks + 1);
  });

  it("entries are ordered by tick, starting at 0", () => {
    const log = buildPalpationInputLog(palpationConfig);
    expect(log.entries[0]!.tick).toBe(0);
    for (let i = 1; i < log.entries.length; i++) {
      expect(log.entries[i]!.tick).toBeGreaterThan(log.entries[i - 1]!.tick);
    }
  });

  it("includes palpation contact regions on early ticks", () => {
    const log = buildPalpationInputLog(palpationConfig);

    // First several entries should target abdomen quadrants
    const firstContactTicks = log.entries.filter(
      (e) => e.contactRegionId !== null,
    );
    expect(firstContactTicks.length).toBeGreaterThan(0);

    // All contact regions should be one of the quadrants
    for (const entry of firstContactTicks) {
      expect(entry.contactRegionId).toMatch(
        /^abdomen_(ruq|rlq|luq|llq)$/,
      );
    }
  });

  it("late ticks have null contactRegionId (idle period)", () => {
    const log = buildPalpationInputLog(palpationConfig);

    // Last 10 entries should have no contact region
    const lastEntries = log.entries.slice(-10);
    for (const entry of lastEntries) {
      expect(entry.contactRegionId).toBeNull();
    }
  });

  it("pinch strength varies across the exam (non-zero at contact sites)", () => {
    const log = buildPalpationInputLog(palpationConfig);

    // Find max pinch strength
    const maxPinch = Math.max(
      ...log.entries.map((e) => e.pinchStrength),
    );
    expect(maxPinch).toBeGreaterThan(0);

    // Non-contact entries should have 0 pinch strength
    const nonContact = log.entries.filter((e) => e.contactRegionId === null);
    for (const entry of nonContact) {
      expect(entry.pinchStrength).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// C6 replay with palpation log
// ---------------------------------------------------------------------------
describe("havok C6 replay with palpation log", () => {
  const palpationConfig: PalpationConfig = {
    ticks: 360,
    forcePeak: 0.8,
    sites: DEFAULT_PALPATION_SITES,
    dwellTicks: 30,
    transitionTicks: 15,
  };

  it("identical palpation log → identical checksums", () => {
    const log = buildPalpationInputLog(palpationConfig);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log, 30);

    expect(trace1.result.checksums.length).toBeGreaterThan(0);
    expect(trace2.result.checksums.length).toBe(trace1.result.checksums.length);

    for (let i = 0; i < trace1.result.checksums.length; i++) {
      expect(trace2.result.checksums[i]!.tick).toBe(
        trace1.result.checksums[i]!.tick,
      );
      expect(trace2.result.checksums[i]!.sha256).toBe(
        trace1.result.checksums[i]!.sha256,
      );
    }
  });

  it("snapshot restore mid-palpation → same checksums thereafter", () => {
    const log = buildPalpationInputLog(palpationConfig);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Restore at tick 120 (should be mid-palpation)
    const snapshot120 = trace1.snapshots.get(120);
    expect(snapshot120).toBeDefined();

    const adapter2 = new HavokCandidateAdapter(42);
    const checksums2 = replayFromSnapshot(
      adapter2,
      snapshot120!,
      log,
      120,
      30,
    ).checksums;

    const postRestore1 = checksums1.filter((c) => c.tick > 120);
    expect(postRestore1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(postRestore1.length);

    for (let i = 0; i < postRestore1.length; i++) {
      expect(checksums2[i]!.tick).toBe(postRestore1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(postRestore1[i]!.sha256);
    }
  });

  it("different palpation config (different sites) → different checksums", () => {
    const config1: PalpationConfig = {
      ticks: 120,
      forcePeak: 0.5,
      sites: DEFAULT_PALPATION_SITES.slice(0, 2),
      dwellTicks: 20,
      transitionTicks: 10,
    };

    const config2: PalpationConfig = {
      ticks: 120,
      forcePeak: 0.9,
      sites: DEFAULT_PALPATION_SITES.slice(2, 4),
      dwellTicks: 20,
      transitionTicks: 10,
    };

    const log1 = buildPalpationInputLog(config1);
    const log2 = buildPalpationInputLog(config2);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log1, 30);

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log2, 30);

    // Different palpation configs → different checksums
    expect(trace1.result.checksums[0]!.sha256).not.toBe(
      trace2.result.checksums[0]!.sha256,
    );
  });
});
