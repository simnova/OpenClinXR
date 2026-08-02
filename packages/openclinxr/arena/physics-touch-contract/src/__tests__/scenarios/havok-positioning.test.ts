import { describe, expect, it } from "vitest";
import {
  buildPositioningInputLog,
  DEFAULT_POSITIONING_CONFIG,
} from "../../scenarios/positioning.js";
import type { PositioningConfig } from "../../scenarios/positioning.js";
import { HavokCandidateAdapter } from "../../adapters/havok.js";
import { replayFromSnapshot, replayInputLog } from "../../replay.js";

// ---------------------------------------------------------------------------
// Positioning scenario — HavokCandidateAdapter C6
// ---------------------------------------------------------------------------
describe("havok C6 replay with positioning log", () => {
  const positioningConfig: PositioningConfig = {
    ...DEFAULT_POSITIONING_CONFIG,
    ticks: 200,
    approachTicks: 15,
    contactTicks: 10,
    guideTicks: 40,
    dwellTicks: 20,
    releaseTicks: 12,
  };

  it("builds a non-empty positioning input log", () => {
    const log = buildPositioningInputLog(positioningConfig);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.entries.length).toBeLessThanOrEqual(positioningConfig.ticks + 1);
  });

  it("entries are ordered by tick, starting at 0", () => {
    const log = buildPositioningInputLog(positioningConfig);
    expect(log.entries[0]!.tick).toBe(0);
    for (let i = 1; i < log.entries.length; i++) {
      expect(log.entries[i]!.tick).toBeGreaterThan(log.entries[i - 1]!.tick);
    }
  });

  it("contact region is present on guide-phase ticks", () => {
    const log = buildPositioningInputLog(positioningConfig);

    const contactTicks = log.entries.filter(
      (e) => e.contactRegionId !== null,
    );
    expect(contactTicks.length).toBeGreaterThan(0);

    for (const entry of contactTicks) {
      expect(entry.contactRegionId).toBe(positioningConfig.contactRegionId);
    }
  });

  it("pinch strength stays low for positioning (gentle assist)", () => {
    const log = buildPositioningInputLog(positioningConfig);

    const maxPinch = Math.max(
      ...log.entries.map((e) => e.pinchStrength),
    );
    expect(maxPinch).toBeGreaterThan(0);
    // Positioning uses light touch only (≤0.12)
    expect(maxPinch).toBeLessThan(0.2);
  });

  it("hand position changes from start to end during guide phase", () => {
    const log = buildPositioningInputLog(positioningConfig);

    // Find positions during guide phase vs after approach
    const posEarly = log.entries[positioningConfig.approachTicks]?.jointPoses[0]?.position;
    const guideEndIdx = positioningConfig.approachTicks + positioningConfig.contactTicks + positioningConfig.guideTicks - 1;
    const posLate = log.entries[guideEndIdx]?.jointPoses[0]?.position;

    expect(posEarly).toBeDefined();
    expect(posLate).toBeDefined();

    // Position should have changed (not identical)
    const dx = (posLate!.x - posEarly!.x) + (posLate!.y - posEarly!.y) + (posLate!.z - posEarly!.z);
    expect(Math.abs(dx)).toBeGreaterThan(0.001);
  });

  it("idle ticks at end have null contactRegionId and 0 pinch", () => {
    const log = buildPositioningInputLog(positioningConfig);

    const lastEntries = log.entries.slice(-10);
    for (const entry of lastEntries) {
      expect(entry.contactRegionId).toBeNull();
      expect(entry.pinchStrength).toBe(0);
    }
  });

  // C6: identical input log → identical checksums
  it("identical positioning log → identical checksums (C6 replay equivalence)", () => {
    const log = buildPositioningInputLog(positioningConfig);

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

  // C6: snapshot restore → same checksums thereafter
  it("snapshot restore mid-positioning → same checksums thereafter (C6)", () => {
    const log = buildPositioningInputLog(positioningConfig);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Restore at tick 60 (should be in guide phase)
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

  // Different seeds → different checksums
  it("different seeds → different positioning checksums, same seed → same", () => {
    const log = buildPositioningInputLog(positioningConfig);

    const adapter42 = new HavokCandidateAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new HavokCandidateAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    const adapter42b = new HavokCandidateAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  // Different positioning configs → different checksums
  it("different positioning configs → different checksums", () => {
    const config1: PositioningConfig = {
      ...DEFAULT_POSITIONING_CONFIG,
      ticks: 100,
      contactRegionId: "shoulder_L",
      startPosition: { x: -0.15, y: 0.62, z: 0.28 },
      endPosition: { x: -0.12, y: 0.58, z: 0.35 },
      approachTicks: 8,
      contactTicks: 6,
      guideTicks: 20,
      dwellTicks: 10,
      releaseTicks: 8,
    };

    const config2: PositioningConfig = {
      ...config1,
      contactRegionId: "elbow_R",
      startPosition: { x: 0.18, y: 0.48, z: 0.28 },
      endPosition: { x: 0.16, y: 0.45, z: 0.38 },
    };

    const log1 = buildPositioningInputLog(config1);
    const log2 = buildPositioningInputLog(config2);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log1, 30);

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log2, 30);

    expect(trace1.result.checksums[0]!.sha256).not.toBe(
      trace2.result.checksums[0]!.sha256,
    );
  });
});
