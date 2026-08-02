/**
 * real-engine-loaded.test.ts — AD-1 guard.
 *
 * Asserts:
 *  1. Real Rapier WASM module loads (tests FAIL if WASM absent).
 *  2. engineId is "rapier", NOT matching /-candidate$/.
 *  3. C6 replay equivalence: same input log → identical checksums from
 *     real world.takeSnapshot().
 *  4. Snapshot restore produces identical post-restore checksums.
 *
 * AD-1: "engineId MUST NOT match /-candidate$/. A committed test asserts
 * the real WASM module was loaded and produced the checksum stream
 * (e.g. real world.takeSnapshot() bytes for Rapier). If the module is
 * absent, the test FAILS — it does not fall back to a candidate and pass."
 */

import { describe, expect, it, beforeAll } from "vitest";
import {
  buildDeterministicInputLog,
  buildPalpationInputLog,
  replayFromSnapshot,
  replayInputLog,
} from "../index.js";
import { RapierRealAdapter, initRapier, isRapierInitialized } from "../adapters/rapier-real.js";
import { DEFAULT_PALPATION_SITES } from "../scenarios/palpation.js";

// ---------------------------------------------------------------------------
// Suite: requires Rapier WASM to be loaded
// ---------------------------------------------------------------------------
describe("RapierRealAdapter — real engine", () => {
  beforeAll(async () => {
    await initRapier();
  }, 30000); // WASM download may take a while on first run

  // AD-1: module MUST be loaded
  it("AD-1: real Rapier WASM module is loaded (engineId NOT /-candidate$/)", () => {
    // If initRapier() failed, isRapierInitialized() returns false → test FAILS
    // No candidate fallback.
    expect(isRapierInitialized()).toBe(true);
  });

  it("AD-1: engineId is 'rapier' (explicitly not matching /-candidate$/)", () => {
    const adapter = new RapierRealAdapter(42);
    expect(adapter.meta.engineId).toBe("rapier");
    // Double-check it does NOT match the candidate pattern
    expect(adapter.meta.engineId).not.toMatch(/-candidate$/);
  });

  it("produces a snapshot via real world.takeSnapshot() (non-empty Uint8Array)", () => {
    const adapter = new RapierRealAdapter(42);
    const snapshot = adapter.takeSnapshotBytes();
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot.byteLength).toBeGreaterThan(0);
  });

  it("step runs real world.step() without throwing", () => {
    const adapter = new RapierRealAdapter(42);

    // Step a few ticks with a moving hand
    for (let tick = 0; tick <= 5; tick++) {
      adapter.step({
        tick,
        handedness: "right",
        jointPoses: [
          {
            jointId: "wrist",
            position: { x: 0.1 * tick, y: 0.8, z: 0.4 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        ],
        pinchStrength: 0,
        contactRegionId: null,
      });
    }

    const snapshot = adapter.takeSnapshotBytes();
    expect(snapshot.byteLength).toBeGreaterThan(0);
  });

  it("reset builds a fresh world with new seed", () => {
    const adapter = new RapierRealAdapter(42);
    const snap1 = adapter.takeSnapshotBytes();

    adapter.reset(99);
    const snap2 = adapter.takeSnapshotBytes();

    // Different seeds should produce different initial world state
    expect(
      Buffer.from(snap1).toString("base64"),
    ).not.toBe(
      Buffer.from(snap2).toString("base64"),
    );
  });

  it("applySnapshot restores world state", () => {
    const adapter = new RapierRealAdapter(42);

    // Step a few ticks
    for (let tick = 0; tick <= 10; tick++) {
      adapter.step({
        tick,
        handedness: "right",
        jointPoses: [
          {
            jointId: "wrist",
            position: { x: 0.1 * tick, y: 0.8, z: 0.4 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        ],
        pinchStrength: 0,
        contactRegionId: null,
      });
    }

    const snapshot = adapter.takeSnapshot();
    const checksum1 = Buffer.from(adapter.takeSnapshotBytes()).toString("base64");

    // Reset then restore
    adapter.reset(99);
    adapter.applySnapshot(snapshot);

    const checksum2 = Buffer.from(adapter.takeSnapshotBytes()).toString("base64");
    expect(checksum2).toBe(checksum1);
  });

  it("AD-1: snapshot bytes from real engine differ from candidate adapter", async () => {
    // Import the candidate adapter for comparison
    const { RapierCandidateAdapter } = await import("../adapters/rapier.js");

    const realAdapter = new RapierRealAdapter(42);
    const candidateAdapter = new RapierCandidateAdapter(42);

    // Step both once
    const input = {
      tick: 0,
      handedness: "right" as const,
      jointPoses: [
        {
          jointId: "wrist",
          position: { x: 0.1, y: 0.8, z: 0.4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      pinchStrength: 0,
      contactRegionId: null as string | null,
    };

    realAdapter.step(input);
    candidateAdapter.step(input);

    const realSnap = realAdapter.takeSnapshotBytes();
    const candidateSnap = candidateAdapter.takeSnapshotBytes();

    // Real Rapier snapshot should differ from candidate snapshot
    // (different state representation, different engine internals)
    expect(
      Buffer.from(realSnap).toString("base64"),
    ).not.toBe(
      Buffer.from(candidateSnap).toString("base64"),
    );
  });
});

// ---------------------------------------------------------------------------
// C6: Replay equivalence from real snapshots
// ---------------------------------------------------------------------------
describe("RapierRealAdapter C6 replay equivalence", () => {
  beforeAll(async () => {
    await initRapier();
  }, 30000);

  it("identical input log → identical checksums across two runs (real engine)", () => {
    const log = buildDeterministicInputLog(120);

    const adapter1 = new RapierRealAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const adapter2 = new RapierRealAdapter(42);
    const trace2 = replayInputLog(adapter2, log, 30);
    const checksums2 = trace2.result.checksums;

    expect(checksums1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(checksums1.length);

    for (let i = 0; i < checksums1.length; i++) {
      expect(checksums2[i]!.tick).toBe(checksums1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(checksums1[i]!.sha256);
    }
  });

  it("after snapshot restore at tick 60 → same checksums thereafter (real engine)", () => {
    const log = buildDeterministicInputLog(120);

    const adapter1 = new RapierRealAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    const snapshot60 = trace1.snapshots.get(60);
    expect(snapshot60).toBeDefined();

    const adapter2 = new RapierRealAdapter(42);
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

  it("different seeds → different checksums, same seed → same checksums (real engine)", () => {
    const log = buildDeterministicInputLog(60);

    const adapter42 = new RapierRealAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new RapierRealAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    const adapter42b = new RapierRealAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  it("produces different checksums from the candidate adapter (engine divergence)", async () => {
    const { RapierCandidateAdapter } = await import("../adapters/rapier.js");
    const log = buildDeterministicInputLog(60);

    const real = new RapierRealAdapter(42);
    const candidate = new RapierCandidateAdapter(42);

    const realTrace = replayInputLog(real, log, 30);
    const candidateTrace = replayInputLog(candidate, log, 30);

    // Real Rapier checksums must differ from candidate checksums
    expect(realTrace.result.checksums[0]!.sha256).not.toBe(
      candidateTrace.result.checksums[0]!.sha256,
    );
  });

  it("C6 replay with palpation scenario log (real engine)", () => {
    const palpationConfig = {
      ticks: 180,
      forcePeak: 0.8,
      sites: DEFAULT_PALPATION_SITES.slice(0, 2),
      dwellTicks: 30,
      transitionTicks: 15,
    };

    const log = buildPalpationInputLog(palpationConfig);

    const adapter1 = new RapierRealAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);

    const adapter2 = new RapierRealAdapter(42);
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

  it("snapshot restore mid-palpation → same checksums thereafter (real engine)", () => {
    const palpationConfig = {
      ticks: 180,
      forcePeak: 0.8,
      sites: DEFAULT_PALPATION_SITES.slice(0, 2),
      dwellTicks: 30,
      transitionTicks: 15,
    };

    const log = buildPalpationInputLog(palpationConfig);

    const adapter1 = new RapierRealAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Find a valid mid-point snapshot
    const snapshotTick = 90;
    const snapshot = trace1.snapshots.get(snapshotTick);
    expect(snapshot).toBeDefined();

    const adapter2 = new RapierRealAdapter(42);
    const checksums2 = replayFromSnapshot(
      adapter2,
      snapshot!,
      log,
      snapshotTick,
      30,
    ).checksums;

    const postRestore1 = checksums1.filter((c) => c.tick > snapshotTick);
    expect(postRestore1.length).toBeGreaterThan(0);
    expect(checksums2.length).toBe(postRestore1.length);

    for (let i = 0; i < postRestore1.length; i++) {
      expect(checksums2[i]!.tick).toBe(postRestore1[i]!.tick);
      expect(checksums2[i]!.sha256).toBe(postRestore1[i]!.sha256);
    }
  });
});

// ---------------------------------------------------------------------------
// AD-1 meta contract
// ---------------------------------------------------------------------------
describe("RapierRealAdapter meta contract (AD-1 + C7)", () => {
  beforeAll(async () => {
    await initRapier();
  }, 30000);

  it("meta carries full C7 notEvidenceFor", () => {
    const adapter = new RapierRealAdapter(42);
    expect(adapter.meta.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("meta determinismScope is 'local' (OD-3: accepted closure)", () => {
    const adapter = new RapierRealAdapter(42);
    expect(adapter.meta.determinismScope).toBe("local");
  });

  it("meta fixedDt is 1/60 (C1)", () => {
    const adapter = new RapierRealAdapter(42);
    expect(adapter.meta.fixedDt).toBe(1 / 60);
  });

  it("meta generatorVersion is >= 0.2.0 (real engine)", () => {
    const adapter = new RapierRealAdapter(42);
    const version = parseFloat(adapter.meta.generatorVersion);
    expect(version).toBeGreaterThanOrEqual(0.2);
  });
});
