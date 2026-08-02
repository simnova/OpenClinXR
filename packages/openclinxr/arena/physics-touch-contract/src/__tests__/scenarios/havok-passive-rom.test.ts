import { describe, expect, it } from "vitest";
import {
  buildPassiveRomInputLog,
  DEFAULT_PASSIVE_ROM_CONFIG,
} from "../../scenarios/passive-rom.js";
import type { PassiveRomConfig } from "../../scenarios/passive-rom.js";
import { HavokCandidateAdapter } from "../../adapters/havok.js";
import { replayFromSnapshot, replayInputLog } from "../../replay.js";

// ---------------------------------------------------------------------------
// Passive ROM scenario — HavokCandidateAdapter C6
// ---------------------------------------------------------------------------
describe("havok C6 replay with passive-rom log", () => {
  const romConfig: PassiveRomConfig = {
    ...DEFAULT_PASSIVE_ROM_CONFIG,
    ticks: 300,
    approachTicks: 20,
    preArcDwellTicks: 10,
    arcTicks: 60,
    postArcDwellTicks: 15,
    releaseTicks: 15,
  };

  it("builds a non-empty passive-rom input log with correct entry count", () => {
    const log = buildPassiveRomInputLog(romConfig);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.entries.length).toBeLessThanOrEqual(romConfig.ticks + 1);
  });

  it("entries are ordered by tick, starting at 0", () => {
    const log = buildPassiveRomInputLog(romConfig);
    expect(log.entries[0]!.tick).toBe(0);
    for (let i = 1; i < log.entries.length; i++) {
      expect(log.entries[i]!.tick).toBeGreaterThan(log.entries[i - 1]!.tick);
    }
  });

  it("contact region appears on arc-phase ticks", () => {
    const log = buildPassiveRomInputLog(romConfig);

    const contactTicks = log.entries.filter(
      (e) => e.contactRegionId !== null,
    );
    expect(contactTicks.length).toBeGreaterThan(0);

    // Contact region should be forearm_distal_R (right side default)
    for (const entry of contactTicks) {
      expect(entry.contactRegionId).toMatch(/^forearm_distal_[RL]$/);
    }
  });

  it("pinch strength is non-zero during grasp phases", () => {
    const log = buildPassiveRomInputLog(romConfig);

    const maxPinch = Math.max(
      ...log.entries.map((e) => e.pinchStrength),
    );
    expect(maxPinch).toBeGreaterThan(0);
    // ROM uses gentle grasp (0.25–0.30 range)
    expect(maxPinch).toBeLessThan(0.5);
  });

  it("idle ticks at end have null contactRegionId and 0 pinch", () => {
    const log = buildPassiveRomInputLog(romConfig);

    const lastEntries = log.entries.slice(-10);
    for (const entry of lastEntries) {
      expect(entry.contactRegionId).toBeNull();
      expect(entry.pinchStrength).toBe(0);
    }
  });

  // C6: identical input log → identical checksums
  it("identical passive-rom log → identical checksums (C6 replay equivalence)", () => {
    const log = buildPassiveRomInputLog(romConfig);

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
  it("snapshot restore mid-ROM → same checksums thereafter (C6)", () => {
    const log = buildPassiveRomInputLog(romConfig);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Restore at tick 60 (should be early arc phase)
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
  it("different seeds → different passive-rom checksums, same seed → same", () => {
    const log = buildPassiveRomInputLog(romConfig);

    const adapter42 = new HavokCandidateAdapter(42);
    const trace42 = replayInputLog(adapter42, log, 30);

    const adapter99 = new HavokCandidateAdapter(99);
    const trace99 = replayInputLog(adapter99, log, 30);

    expect(trace42.result.checksums[0]!.sha256).not.toBe(
      trace99.result.checksums[0]!.sha256,
    );

    // Same seed re-run → same
    const adapter42b = new HavokCandidateAdapter(42);
    const trace42b = replayInputLog(adapter42b, log, 30);
    expect(trace42b.result.checksums[0]!.sha256).toBe(
      trace42.result.checksums[0]!.sha256,
    );
  });

  // Different ROM configs → different checksums
  it("different ROM configs → different checksums", () => {
    const config1: PassiveRomConfig = {
      ...DEFAULT_PASSIVE_ROM_CONFIG,
      ticks: 120,
      side: "right",
      joint: "shoulder",
      direction: "abduction",
      arcStartRad: 0,
      arcEndRad: 0.6,
      approachTicks: 10,
      preArcDwellTicks: 5,
      arcTicks: 30,
      postArcDwellTicks: 10,
      releaseTicks: 10,
    };

    const config2: PassiveRomConfig = {
      ...config1,
      side: "left",
      direction: "flexion",
      arcEndRad: 1.0,
    };

    const log1 = buildPassiveRomInputLog(config1);
    const log2 = buildPassiveRomInputLog(config2);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log1, 30);

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log2, 30);

    // Configs may share early ticks; divergence appears by final checkpoint.
    const last1 = trace1.result.checksums.at(-1)!.sha256;
    const last2 = trace2.result.checksums.at(-1)!.sha256;
    expect(last1).not.toBe(last2);
  });
});
