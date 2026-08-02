import { describe, expect, it } from "vitest";
import {
  buildDeterministicInputLog,
  buildPalpationInputLog,
  replayFromSnapshot,
  replayInputLog,
} from "../index.js";
import { RapierCandidateAdapter } from "../adapters/rapier.js";
import type { PalpationConfig } from "../scenarios/palpation.js";
import { DEFAULT_PALPATION_SITES } from "../scenarios/palpation.js";

// ---------------------------------------------------------------------------
// RapierCandidateAdapter — basic behaviour
// ---------------------------------------------------------------------------
describe("RapierCandidateAdapter", () => {
  it("has engineId 'rapier-candidate' in meta", () => {
    const adapter = new RapierCandidateAdapter();
    expect(adapter.meta.engineId).toBe("rapier-candidate");
    expect(adapter.meta.determinismScope).toBe("local");
    expect(adapter.meta.fixedDt).toBe(1 / 60);
  });

  it("meta carries full notEvidenceFor (C7)", () => {
    const adapter = new RapierCandidateAdapter();
    expect(adapter.meta.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("step updates state with hand position from joint pose", () => {
    const adapter = new RapierCandidateAdapter(42);
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

  it("step creates contact when contactRegionId is set", () => {
    const adapter = new RapierCandidateAdapter(42);
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
    const contactKeys = Object.keys(state.contacts);
    expect(contactKeys.length).toBeGreaterThanOrEqual(1);
    const firstKey = contactKeys[0]!;
    const contact = state.contacts[firstKey];
    expect(contact.bodyA).toBe("palp_hand");
    expect(contact.bodyB).toBe("abdomen");
    // Rapier stores warmStartImpulse on contacts
    expect(contact.warmStartImpulse).toBeGreaterThan(0);
  });

  it("reset clears state and sets a new seed", () => {
    const adapter = new RapierCandidateAdapter(42);
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

    adapter.reset(77);
    const afterReset = adapter.takeSnapshotBytes();
    const stateAfter = JSON.parse(new TextDecoder().decode(afterReset));
    expect(stateAfter.stepCount).toBe(0);
    expect(stateAfter.seed).toBe(77);
    // Rigid bodies should be back at initial positions
    expect(stateAfter.rigidBodies.palp_hand.position.x).toBe(0);
  });

  it("applySnapshot restores full state including contacts", () => {
    const adapter = new RapierCandidateAdapter(42);

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
    adapter.reset(99);
    adapter.applySnapshot(snapshot);

    const restored = adapter.takeSnapshotBytes();
    const stateRestored = JSON.parse(new TextDecoder().decode(restored));
    expect(stateRestored.stepCount).toBe(10);
    expect(Object.keys(stateRestored.contacts).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// C6 — Replay equivalence for RapierCandidateAdapter
// ---------------------------------------------------------------------------
describe("rapier C6 replay equivalence", () => {
  it("identical input log → identical checksums across two runs", () => {
    const log = buildDeterministicInputLog(150);

    const adapter1 = new RapierCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const adapter2 = new RapierCandidateAdapter(42);
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

    const adapter1 = new RapierCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const snapshot60 = trace1.snapshots.get(60);
    expect(snapshot60).toBeDefined();

    const adapter2 = new RapierCandidateAdapter(42);
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

    const adapter42 = new RapierCandidateAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new RapierCandidateAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    const adapter42b = new RapierCandidateAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  it("produces different checksums from the Havok adapter (engine divergence)", async () => {
    const { HavokCandidateAdapter } = await import("../adapters/havok.js");
    const log = buildDeterministicInputLog(60);

    const rapier = new RapierCandidateAdapter(42);
    const havok = new HavokCandidateAdapter(42);

    const rapierTrace = replayInputLog(rapier, log, 30);
    const havokTrace = replayInputLog(havok, log, 30);

    // Different engines must produce different checksums
    expect(rapierTrace.result.checksums[0]!.sha256).not.toBe(
      havokTrace.result.checksums[0]!.sha256,
    );
  });
});

// ---------------------------------------------------------------------------
// C6 replay with palpation log
// ---------------------------------------------------------------------------
describe("rapier C6 replay with palpation log", () => {
  const palpationConfig: PalpationConfig = {
    ticks: 360,
    forcePeak: 0.8,
    sites: DEFAULT_PALPATION_SITES,
    dwellTicks: 30,
    transitionTicks: 15,
  };

  it("identical palpation log → identical checksums", () => {
    const log = buildPalpationInputLog(palpationConfig);

    const adapter1 = new RapierCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);

    const adapter2 = new RapierCandidateAdapter(42);
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

    const adapter1 = new RapierCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const snapshot120 = trace1.snapshots.get(120);
    expect(snapshot120).toBeDefined();

    const adapter2 = new RapierCandidateAdapter(42);
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
});
