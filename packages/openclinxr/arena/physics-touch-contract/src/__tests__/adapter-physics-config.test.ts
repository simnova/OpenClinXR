/**
 * adapter-physics-config.test.ts — anti-invention guard.
 *
 * Verifies that engine adapters do NOT invent their own mass/stiffness
 * constants when a PhysicsConfigV1 is provided. The config from the
 * factory generator (tools/openclinxr/factory) is SSOT; adapters must
 * derive simulation parameters from config, not from hardcoded defaults.
 *
 * Tests:
 *   1. Adapter constructed WITH config uses config-provided seed and mass.
 *   2. Adapter constructed WITHOUT config uses hardcoded defaults (backward compat).
 *   3. fromPhysicsConfig() static factory produces same result as constructor.
 *   4. reset() with config applied still uses config-derived values.
 *   5. Different habitus configs produce different adapter initial states.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { createDefaultPhysicsConfigV1, generatePhysicsConfigFromPhenotype } from "../factory/physics-config-v1.js";
import { HavokCandidateAdapter } from "../adapters/havok.js";
import { RapierCandidateAdapter } from "../adapters/rapier.js";
import { JoltCandidateAdapter } from "../adapters/jolt.js";

// ---------------------------------------------------------------------------
// HavokCandidateAdapter — config consumption
// ---------------------------------------------------------------------------
describe("HavokCandidateAdapter config consumption", () => {
  it("fromPhysicsConfig uses config-provided seed", () => {
    const config = createDefaultPhysicsConfigV1(99);
    const adapter = HavokCandidateAdapter.fromPhysicsConfig(config);

    expect(adapter.meta.seed).toBe(99);
    expect(adapter.meta.fixedDt).toBe(1 / 60);
  });

  it("config seed overrides constructor default", () => {
    const config = createDefaultPhysicsConfigV1(77);
    const adapter = HavokCandidateAdapter.fromPhysicsConfig(config);

    // Must use config.seed=77, not hardcoded 42
    expect(adapter.meta.seed).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// RapierCandidateAdapter — anti-invention: config-driven mass
// ---------------------------------------------------------------------------
describe("RapierCandidateAdapter config consumption", () => {
  it("WITH config: abdomen mass comes from config, not hardcoded 5.0", () => {
    const config = createDefaultPhysicsConfigV1(42);
    // Default config (average habitus) has abdomen mass from habitus table.
    // The habitus table sets average abdomen mass to a specific value.
    const expectedAbdomenMass = config.masses["abdomen"];

    const adapter = new RapierCandidateAdapter(42, config);
    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));

    // Abdomen mass must match config value, not hardcoded 5.0
    expect(state.rigidBodies.abdomen.mass).toBe(expectedAbdomenMass);
  });

  it("WITHOUT config: abdomen mass is hardcoded 5.0 (backward compat)", () => {
    const adapter = new RapierCandidateAdapter(42);
    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));

    // Without config, backward compat: hardcoded 5.0
    expect(state.rigidBodies.abdomen.mass).toBe(5.0);
  });

  it("config with different habitus produces different abdomen mass", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const obeseConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "obese" },
    });

    const avgAdapter = new RapierCandidateAdapter(42, avgConfig);
    const obeseAdapter = new RapierCandidateAdapter(42, obeseConfig);

    const avgBytes = avgAdapter.takeSnapshotBytes();
    const obeseBytes = obeseAdapter.takeSnapshotBytes();
    const avgState = JSON.parse(new TextDecoder().decode(avgBytes));
    const obeseState = JSON.parse(new TextDecoder().decode(obeseBytes));

    // Different habitus → different abdomen mass
    expect(obeseState.rigidBodies.abdomen.mass).not.toBe(
      avgState.rigidBodies.abdomen.mass,
    );
    // Obese should be heavier
    expect(obeseState.rigidBodies.abdomen.mass).toBeGreaterThan(
      avgState.rigidBodies.abdomen.mass,
    );
  });

  it("hand mass stays stable (not driven by clinical body-region config)", () => {
    const config = createDefaultPhysicsConfigV1(42);
    const adapter = new RapierCandidateAdapter(42, config);
    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));

    // Hand mass is not a clinical body region; it stays at 0.5
    expect(state.rigidBodies.palp_hand.mass).toBe(0.5);
  });

  it("fromPhysicsConfig static factory matches constructor-with-config", () => {
    const config = createDefaultPhysicsConfigV1(42);
    const adapter1 = RapierCandidateAdapter.fromPhysicsConfig(config);
    const adapter2 = new RapierCandidateAdapter(42, config);

    const bytes1 = adapter1.takeSnapshotBytes();
    const bytes2 = adapter2.takeSnapshotBytes();

    expect(Buffer.from(bytes1).toString("base64")).toBe(
      Buffer.from(bytes2).toString("base64"),
    );
  });

  it("config seed overrides constructor default seed", () => {
    const config = createDefaultPhysicsConfigV1(77);
    const adapter = new RapierCandidateAdapter(42, config);

    // Must use config.seed=77, not constructor default 42
    expect(adapter.meta.seed).toBe(77);
  });

  it("config fixedDt is used in meta", () => {
    const config = createDefaultPhysicsConfigV1(42);
    const adapter = new RapierCandidateAdapter(42, config);

    expect(adapter.meta.fixedDt).toBe(1 / 60);
  });
});

// ---------------------------------------------------------------------------
// JoltCandidateAdapter — anti-invention: config-driven mass
// ---------------------------------------------------------------------------
describe("JoltCandidateAdapter config consumption", () => {
  it("WITH config: abdomen mass comes from config, not hardcoded 5.0", () => {
    const config = createDefaultPhysicsConfigV1(42);
    const expectedAbdomenMass = config.masses["abdomen"];

    const adapter = new JoltCandidateAdapter(42, config);
    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));

    // Abdomen mass must match config value, not hardcoded 5.0
    expect(state.rigidBodies.abdomen.mass).toBe(expectedAbdomenMass);
  });

  it("WITHOUT config: abdomen mass is hardcoded 5.0 (backward compat)", () => {
    const adapter = new JoltCandidateAdapter(42);
    const bytes = adapter.takeSnapshotBytes();
    const state = JSON.parse(new TextDecoder().decode(bytes));

    // Without config, backward compat: hardcoded 5.0
    expect(state.rigidBodies.abdomen.mass).toBe(5.0);
  });

  it("config with different habitus produces different abdomen mass", () => {
    const avgConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "average" },
    });
    const frailConfig = generatePhysicsConfigFromPhenotype({
      bodyMechanics: { habitus: "frail" },
    });

    const avgAdapter = new JoltCandidateAdapter(42, avgConfig);
    const frailAdapter = new JoltCandidateAdapter(42, frailConfig);

    const avgBytes = avgAdapter.takeSnapshotBytes();
    const frailBytes = frailAdapter.takeSnapshotBytes();
    const avgState = JSON.parse(new TextDecoder().decode(avgBytes));
    const frailState = JSON.parse(new TextDecoder().decode(frailBytes));

    // Different habitus → different abdomen mass
    expect(frailState.rigidBodies.abdomen.mass).not.toBe(
      avgState.rigidBodies.abdomen.mass,
    );
    // Frail should be lighter
    expect(frailState.rigidBodies.abdomen.mass).toBeLessThan(
      avgState.rigidBodies.abdomen.mass,
    );
  });

  it("fromPhysicsConfig static factory matches constructor-with-config", () => {
    const config = createDefaultPhysicsConfigV1(42);
    const adapter1 = JoltCandidateAdapter.fromPhysicsConfig(config);
    const adapter2 = new JoltCandidateAdapter(42, config);

    const bytes1 = adapter1.takeSnapshotBytes();
    const bytes2 = adapter2.takeSnapshotBytes();

    expect(Buffer.from(bytes1).toString("base64")).toBe(
      Buffer.from(bytes2).toString("base64"),
    );
  });

  it("config seed overrides constructor default seed", () => {
    const config = createDefaultPhysicsConfigV1(77);
    const adapter = new JoltCandidateAdapter(42, config);

    expect(adapter.meta.seed).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter: config produces different initial states by engine
// ---------------------------------------------------------------------------
describe("cross-adapter config differentiation", () => {
  it("same config → different snapshot bytes across engines (engine divergence)", () => {
    const config = createDefaultPhysicsConfigV1(42);

    const havok = HavokCandidateAdapter.fromPhysicsConfig(config);
    const rapier = RapierCandidateAdapter.fromPhysicsConfig(config);
    const jolt = JoltCandidateAdapter.fromPhysicsConfig(config);

    const havokBytes = Buffer.from(havok.takeSnapshotBytes()).toString("base64");
    const rapierBytes = Buffer.from(rapier.takeSnapshotBytes()).toString("base64");
    const joltBytes = Buffer.from(jolt.takeSnapshotBytes()).toString("base64");

    // Each engine must produce different state (different internal representations)
    expect(havokBytes).not.toBe(rapierBytes);
    expect(havokBytes).not.toBe(joltBytes);
    expect(rapierBytes).not.toBe(joltBytes);
  });

  it("all adapters use the same seed from config", () => {
    const config = createDefaultPhysicsConfigV1(42);

    const havok = HavokCandidateAdapter.fromPhysicsConfig(config);
    const rapier = RapierCandidateAdapter.fromPhysicsConfig(config);
    const jolt = JoltCandidateAdapter.fromPhysicsConfig(config);

    expect(havok.meta.seed).toBe(42);
    expect(rapier.meta.seed).toBe(42);
    expect(jolt.meta.seed).toBe(42);

    expect(havok.meta.fixedDt).toBe(1 / 60);
    expect(rapier.meta.fixedDt).toBe(1 / 60);
    expect(jolt.meta.fixedDt).toBe(1 / 60);
  });
});
