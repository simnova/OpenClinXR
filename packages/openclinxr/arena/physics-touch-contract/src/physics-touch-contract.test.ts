import { describe, expect, it } from "vitest";
import {
  accumulateFrameTime,
  appendTickInput,
  buildDeterministicInputLog,
  computeSnapshotHash,
  consumeTick,
  createFixedStepAccumulator,
  createInputLog,
  createStubPhysicsArtifactMeta,
  currentTick,
  defaultNotEvidenceFor,
  FIXED_DT,
  getTickInput,
  hashState,
  inputLogLength,
  listTickInputs,
  replayFromSnapshot,
  replayInputLog,
  serializeState,
  StubPhysicsAdapter,
} from "./index.js";

// ---------------------------------------------------------------------------
// C1 — Fixed step
// ---------------------------------------------------------------------------
describe("fixed-step (C1)", () => {
  it("has dt = 1/60 as f64 literal", () => {
    expect(FIXED_DT).toBe(1 / 60);
    // Verify it's close to 16.666... ms
    expect(FIXED_DT * 1000).toBeCloseTo(16.666, 2);
  });

  it("accumulates frame time and returns correct step count", () => {
    const acc = createFixedStepAccumulator();

    // 1/30 s of render time → should produce 2 physics ticks (since 1/30 = 2 * 1/60)
    const steps = accumulateFrameTime(acc, 1 / 30);
    expect(steps).toBe(2);
    // Accumulator should be drained
    expect(acc.accumulator).toBe(0);

    // Consume both ticks
    expect(consumeTick(acc)).toBe(0);
    expect(consumeTick(acc)).toBe(1);
    expect(currentTick(acc)).toBe(2);
  });

  it("handles fractional accumulation", () => {
    const acc = createFixedStepAccumulator();

    // 2.5 * dt worth of render time
    const dt = FIXED_DT;
    const steps = accumulateFrameTime(acc, dt * 2.5);
    expect(steps).toBe(2);
    // 0.5 * dt remains in accumulator
    expect(acc.accumulator).toBeCloseTo(dt * 0.5, 10);
  });

  it("accumulates across multiple frames", () => {
    const acc = createFixedStepAccumulator();

    // Frame 1: 0.75 * dt → 0 steps, 0.75 remainder
    expect(accumulateFrameTime(acc, FIXED_DT * 0.75)).toBe(0);
    expect(acc.accumulator).toBeCloseTo(FIXED_DT * 0.75, 10);

    // Frame 2: 0.75 * dt → 1 step, 0.5 remainder
    expect(accumulateFrameTime(acc, FIXED_DT * 0.75)).toBe(1);
    expect(acc.accumulator).toBeCloseTo(FIXED_DT * 0.5, 10);

    consumeTick(acc);
    expect(currentTick(acc)).toBe(1);
  });

  it("creates accumulator starting at tick 0", () => {
    const acc = createFixedStepAccumulator();
    expect(acc.accumulator).toBe(0);
    expect(currentTick(acc)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C2 — Input log
// ---------------------------------------------------------------------------
describe("input-log (C2)", () => {
  it("creates empty input log", () => {
    const log = createInputLog();
    expect(log.entries).toEqual([]);
    expect(inputLogLength(log)).toBe(0);
  });

  it("appends tick inputs preserving order", () => {
    let log = createInputLog();

    log = appendTickInput(log, {
      tick: 0,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0.5,
      contactRegionId: "abdomen",
    });

    log = appendTickInput(log, {
      tick: 1,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.1, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0.3,
      contactRegionId: null,
    });

    expect(inputLogLength(log)).toBe(2);
    expect(log.entries[0]!.tick).toBe(0);
    expect(log.entries[1]!.tick).toBe(1);
    expect(log.entries[0]!.pinchStrength).toBe(0.5);
    expect(log.entries[0]!.contactRegionId).toBe("abdomen");
  });

  it("looks up tick input by tick index", () => {
    let log = createInputLog();
    log = appendTickInput(log, {
      tick: 42,
      handedness: "left",
      jointPoses: [],
      pinchStrength: 0,
      contactRegionId: null,
    });

    const found = getTickInput(log, 42);
    expect(found).toBeDefined();
    expect(found!.tick).toBe(42);
    expect(found!.handedness).toBe("left");

    const missing = getTickInput(log, 99);
    expect(missing).toBeUndefined();
  });

  it("lists all tick inputs", () => {
    let log = createInputLog();
    log = appendTickInput(log, {
      tick: 0,
      handedness: "right",
      jointPoses: [],
      pinchStrength: 0,
      contactRegionId: null,
    });
    log = appendTickInput(log, {
      tick: 1,
      handedness: "left",
      jointPoses: [],
      pinchStrength: 0,
      contactRegionId: null,
    });

    const entries = listTickInputs(log);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.handedness).toBe("right");
    expect(entries[1]!.handedness).toBe("left");
  });

  it("deep-clones entries on append (immutability)", () => {
    let log = createInputLog();
    const jointPoses = [
      {
        jointId: "wrist",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ];
    log = appendTickInput(log, {
      tick: 0,
      handedness: "right",
      jointPoses,
      pinchStrength: 0,
      contactRegionId: null,
    });

    // Mutate original array — should not affect log
    jointPoses[0]!.position.x = 999;
    expect(log.entries[0]!.jointPoses[0]!.position.x).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C3 — Snapshot hash
// ---------------------------------------------------------------------------
describe("snapshot-hash (C3)", () => {
  it("serializes state deterministically (sorted keys)", () => {
    const state = { b: 2, a: 1, c: [3, 2, 1] };
    const bytes = serializeState(state);
    const json = Buffer.from(bytes).toString("utf-8");
    expect(json).toBe('{"a":1,"b":2,"c":[3,2,1]}');
  });

  it("produces consistent SHA-256 hex", () => {
    const h1 = hashState({ a: 1, b: 2 });
    const h2 = hashState({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/u.test(h1)).toBe(true);
  });

  it("different state → different hash", () => {
    const h1 = hashState({ a: 1 });
    const h2 = hashState({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it("computeSnapshotHash works with raw bytes", () => {
    const bytes = new TextEncoder().encode("hello");
    const h = computeSnapshotHash(Buffer.from(bytes));
    expect(h).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// C6 — Replay equivalence (gate for the whole spec)
// ---------------------------------------------------------------------------
describe("replay equivalence (C6)", () => {
  it("identical input log replayed twice → identical checksums at every checkpoint", () => {
    const log = buildDeterministicInputLog(150);

    const adapter1 = new StubPhysicsAdapter();
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const adapter2 = new StubPhysicsAdapter();
    const trace2 = replayInputLog(adapter2, log, 30);
    const checksums2 = trace2.result.checksums;

    expect(checksums1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(checksums1.length);

    for (let i = 0; i < checksums1.length; i++) {
      expect(checksums2[i]!.tick).toBe(checksums1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(checksums1[i]!.sha256);
    }
  });

  it("after snapshot restore at tick k → same checksums thereafter", () => {
    const log = buildDeterministicInputLog(150);

    // Run 1: full replay
    const adapter1 = new StubPhysicsAdapter();
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Grab the snapshot at tick 60
    const snapshot60 = trace1.snapshots.get(60);
    expect(snapshot60).toBeDefined();

    // Run 2: restore at tick 60 and continue
    const adapter2 = new StubPhysicsAdapter();
    const checksums2 = replayFromSnapshot(
      adapter2,
      snapshot60!,
      log,
      60,
      30,
    ).checksums;

    // Compare checksums from tick 90 onward (next checkpoint after restore)
    // Run 1 checksums: [{tick:0}, {tick:30}, {tick:60}, {tick:90}, {tick:120}, {tick:150}]
    // Run 2 checksums: [{tick:90}, {tick:120}, {tick:150}]
    const postRestore1 = checksums1.filter((c) => c.tick > 60);
    expect(postRestore1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(postRestore1.length);

    for (let i = 0; i < postRestore1.length; i++) {
      expect(checksums2[i]!.tick).toBe(postRestore1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(postRestore1[i]!.sha256);
    }
  });

  it("checkpoints at the configured interval", () => {
    const log = buildDeterministicInputLog(100);
    const adapter = new StubPhysicsAdapter();
    const trace = replayInputLog(adapter, log, 25);

    const ticks = trace.result.checksums.map((c) => c.tick);
    expect(ticks).toEqual([0, 25, 50, 75, 100]);
  });

  it("different seeds → different checksums (reproducibility per seed)", () => {
    const log = buildDeterministicInputLog(60);

    const adapter42 = new StubPhysicsAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new StubPhysicsAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    // Same input log, different seeds → different checksums
    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    // But re-running with seed 42 again → same
    const adapter42b = new StubPhysicsAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  it("buildDeterministicInputLog produces predictable entries", () => {
    const log = buildDeterministicInputLog(5);
    expect(log.entries).toHaveLength(6); // 0..5 inclusive

    expect(log.entries[0]!.tick).toBe(0);
    expect(log.entries[5]!.tick).toBe(5);

    // Position x should increase by 0.1 per tick
    expect(log.entries[1]!.jointPoses[0]!.position.x).toBeCloseTo(0.1);
    expect(log.entries[5]!.jointPoses[0]!.position.x).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// C7 — notEvidenceFor
// ---------------------------------------------------------------------------
describe("notEvidenceFor (C7)", () => {
  it("defaultNotEvidenceFor includes all four required fields", () => {
    const nef = defaultNotEvidenceFor();
    expect(nef).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("createStubPhysicsArtifactMeta carries notEvidenceFor", () => {
    const meta = createStubPhysicsArtifactMeta();
    expect(meta.notEvidenceFor).toEqual(defaultNotEvidenceFor());
    expect(meta.determinismScope).toBe("local");
    expect(meta.engineId).toBe("stub");
    expect(meta.fixedDt).toBe(1 / 60);
    expect(meta.seed).toBe(42);
  });

  it("adapter meta carries notEvidenceFor (C7)", () => {
    const adapter = new StubPhysicsAdapter();
    expect(adapter.meta.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Stub adapter
// ---------------------------------------------------------------------------
describe("stub adapter", () => {
  it("step accumulates joint positions into state", () => {
    const adapter = new StubPhysicsAdapter();
    adapter.step({
      tick: 10,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 1.5, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null,
    });

    const snapshot = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(snapshot));
    expect(state.pose_wrist).toBe(1.5);
    expect(state.tick).toBe(10);
  });

  it("reset clears state and sets seed", () => {
    const adapter = new StubPhysicsAdapter();
    adapter.step({
      tick: 5,
      handedness: "right",
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 3, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null,
    });

    adapter.reset(77);
    const snapshot = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(snapshot));
    // State should be empty after reset (only seed if snapshot was taken after reset but before any step)
    // Actually, after reset we have empty state; snapshot serializes {} → "{}"
    expect(state.seed).toBeUndefined(); // seed is only written on step
  });

  it("applySnapshot restores state", () => {
    const adapter = new StubPhysicsAdapter();
    const snap = new TextEncoder().encode(
      '{"pose_wrist":5,"seed":42,"tick":10}',
    );
    adapter.applySnapshot(snap);

    const restored = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(restored));
    expect(state.pose_wrist).toBe(5);
    expect(state.tick).toBe(10);
  });
});
