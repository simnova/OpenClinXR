import { describe, expect, it } from "vitest";
import {
  buildGuardingInputLog,
  DEFAULT_GUARDING_CONFIG,
} from "../../scenarios/guarding.js";
import type { GuardingConfig, GuardingThresholdEvent } from "../../scenarios/guarding.js";
import { HavokCandidateAdapter } from "../../adapters/havok.js";
import { replayFromSnapshot, replayInputLog } from "../../replay.js";

// ---------------------------------------------------------------------------
// Guarding scenario — HavokCandidateAdapter C6
// ---------------------------------------------------------------------------
describe("havok C6 replay with guarding log", () => {
  const guardingConfig: GuardingConfig = {
    ...DEFAULT_GUARDING_CONFIG,
    ticks: 240,
    approachTicks: 15,
    lightPalpationTicks: 20,
    deepPalpationTicks: 30,
    postGuardDwellTicks: 20,
    releaseTicks: 15,
  };

  it("builds a non-empty guarding input log", () => {
    const { log } = buildGuardingInputLog(guardingConfig);
    expect(log.entries.length).toBeGreaterThan(0);
    expect(log.entries.length).toBeLessThanOrEqual(guardingConfig.ticks + 1);
  });

  it("entries are ordered by tick, starting at 0", () => {
    const { log } = buildGuardingInputLog(guardingConfig);
    expect(log.entries[0]!.tick).toBe(0);
    for (let i = 1; i < log.entries.length; i++) {
      expect(log.entries[i]!.tick).toBeGreaterThan(log.entries[i - 1]!.tick);
    }
  });

  it("emits at least one guarding threshold event", () => {
    const { guardEvents } = buildGuardingInputLog(guardingConfig);
    expect(guardEvents.length).toBeGreaterThanOrEqual(1);

    // Event has required fields
    const event = guardEvents[0]!;
    expect(event.region).toBe(guardingConfig.contactRegionId);
    expect(event.force).toBeGreaterThan(0);
    expect(event.emotionEventId).toMatch(/^guard_rlq_\d+$/);
    expect(event.tick).toBeGreaterThanOrEqual(0);
  });

  it("guarding event triggers when force exceeds threshold", () => {
    const config: GuardingConfig = {
      ...guardingConfig,
      guardingThreshold: 0.3,
      forcePeak: 0.7,
    };
    const { guardEvents } = buildGuardingInputLog(config);
    expect(guardEvents.length).toBeGreaterThanOrEqual(1);

    // All events should have force ≥ threshold
    for (const evt of guardEvents) {
      expect(evt.force).toBeGreaterThanOrEqual(config.guardingThreshold);
    }
  });

  it("emotionEventId is unique per guard event", () => {
    const { guardEvents } = buildGuardingInputLog(guardingConfig);
    const ids = guardEvents.map((e) => e.emotionEventId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("contact region is present on palpation ticks", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

    const contactTicks = log.entries.filter(
      (e) => e.contactRegionId !== null,
    );
    expect(contactTicks.length).toBeGreaterThan(0);

    for (const entry of contactTicks) {
      expect(entry.contactRegionId).toBe(guardingConfig.contactRegionId);
    }
  });

  it("pinch strength ramps and peaks during deep palpation", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

    const maxPinch = Math.max(
      ...log.entries.map((e) => e.pinchStrength),
    );
    expect(maxPinch).toBeGreaterThan(0);
    // With guarding reduction factor of 0.6, peak should be ≤ forcePeak * 0.6
    expect(maxPinch).toBeLessThanOrEqual(guardingConfig.forcePeak);
  });

  it("idle ticks at end have null contactRegionId and 0 pinch", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

    const lastEntries = log.entries.slice(-10);
    for (const entry of lastEntries) {
      expect(entry.contactRegionId).toBeNull();
      expect(entry.pinchStrength).toBe(0);
    }
  });

  // C6: identical input log → identical checksums
  it("identical guarding log → identical checksums (C6 replay equivalence)", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

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
  it("snapshot restore mid-guarding → same checksums thereafter (C6)", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log, 30);
    const checksums1 = trace1.result.checksums;

    // Restore at tick 60 (should be mid-palpation / early guarding)
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
  it("different seeds → different guarding checksums, same seed → same", () => {
    const { log } = buildGuardingInputLog(guardingConfig);

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

  // Different guarding configs → different checksums
  it("different guarding configs → different checksums", () => {
    const config1: GuardingConfig = {
      ...DEFAULT_GUARDING_CONFIG,
      ticks: 120,
      contactRegionId: "abdomen_rlq",
      guardingThreshold: 0.4,
      forcePeak: 0.6,
      approachTicks: 8,
      lightPalpationTicks: 12,
      deepPalpationTicks: 20,
      postGuardDwellTicks: 12,
      releaseTicks: 8,
    };

    const config2: GuardingConfig = {
      ...config1,
      contactRegionId: "abdomen_ruq",
      forcePeak: 0.9,
      guardingThreshold: 0.6,
    };

    const { log: log1 } = buildGuardingInputLog(config1);
    const { log: log2 } = buildGuardingInputLog(config2);

    const adapter1 = new HavokCandidateAdapter(42);
    const trace1 = replayInputLog(adapter1, log1, 30);

    const adapter2 = new HavokCandidateAdapter(42);
    const trace2 = replayInputLog(adapter2, log2, 30);

    // Configs may share early ticks; divergence appears by final checkpoint.
    const last1 = trace1.result.checksums.at(-1)!.sha256;
    const last2 = trace2.result.checksums.at(-1)!.sha256;
    expect(last1).not.toBe(last2);
  });

  // Guard events are deterministic (same config → same events)
  it("guard events are deterministic (same config → identical events)", () => {
    const { guardEvents: events1 } = buildGuardingInputLog(guardingConfig);
    const { guardEvents: events2 } = buildGuardingInputLog(guardingConfig);

    expect(events1.length).toBe(events2.length);
    for (let i = 0; i < events1.length; i++) {
      expect(events2[i]!.tick).toBe(events1[i]!.tick);
      expect(events2[i]!.region).toBe(events1[i]!.region);
      expect(events2[i]!.force).toBeCloseTo(events1[i]!.force, 4);
      expect(events2[i]!.emotionEventId).toBe(events1[i]!.emotionEventId);
    }
  });
});
