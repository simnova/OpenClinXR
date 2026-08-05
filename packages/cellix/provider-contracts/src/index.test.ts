import { describe, expect, it } from "vitest";
import {
  validateProviderAuditRecord,
  validateProviderHealth,
  validateTraceEvent,
} from "./index.js";

/**
 * These validators are structural (ajv) PLUS semantic. The semantic rules are the ones worth
 * pinning — they encode generic provider invariants that a swappable adapter must not violate.
 */
describe("@cellix/provider-contracts", () => {
  const health = { providerId: "local-model", status: "ready" as const };

  describe("provider health", () => {
    it("accepts a ready provider with no blockers", () => {
      expect(validateProviderHealth(health)).toEqual({ ok: true });
    });

    it("rejects a ready provider that still reports blockers (contradiction)", () => {
      const result = validateProviderHealth({ ...health, blockers: ["missing credential"] });
      expect(result).toEqual({ ok: false, errors: ["ready provider health must not include blockers"] });
    });

    it("rejects a blank providerId", () => {
      const result = validateProviderHealth({ ...health, providerId: "   " });
      expect(result).toEqual({ ok: false, errors: ["provider health requires a nonblank providerId"] });
    });

    it("rejects an unknown status structurally", () => {
      expect(validateProviderHealth({ ...health, status: "probably-fine" }).ok).toBe(false);
    });
  });

  describe("trace events", () => {
    const event = {
      stationRunId: "run_001",
      sequence: 3,
      eventType: "station.started",
      occurredAt: "2026-05-03T15:38:58.000Z",
      atSecond: 0,
      source: "runtime",
      payload: {},
    };

    it("accepts a well-formed event", () => {
      expect(validateTraceEvent(event)).toEqual({ ok: true });
    });

    it("accepts a payload whose durableEventRef matches stationRunId + sequence", () => {
      const payload = { durableEventRef: "durable://station-runs/run_001/events/3" };
      expect(validateTraceEvent({ ...event, payload })).toEqual({ ok: true });
    });

    it("rejects a durableEventRef that disagrees with the event identity", () => {
      const payload = { durableEventRef: "durable://station-runs/run_001/events/999" };
      expect(validateTraceEvent({ ...event, payload }).ok).toBe(false);
    });

    it("rejects a non-string durableEventRef", () => {
      const result = validateTraceEvent({ ...event, payload: { durableEventRef: 3 } });
      expect(result).toEqual({ ok: false, errors: ["trace event payload durableEventRef must be string"] });
    });

    it("rejects a blank tag when present", () => {
      expect(validateTraceEvent({ ...event, tag: " " }).ok).toBe(false);
    });
  });

  describe("provider audit records", () => {
    const audit = {
      requestId: "req_1",
      providerId: "local-model",
      modelId: "mock",
      modelVersion: "1",
      modelRuntimeName: "offline",
      requestPolicyId: "policy-v1",
      safetyPolicyVersion: "safety-v1",
      latencyMs: 12,
      costEstimateUsd: 0,
      safetyStatus: "not_exercised" as const,
    };

    it("accepts a complete audit record", () => {
      expect(validateProviderAuditRecord(audit)).toEqual({ ok: true });
    });

    it("names every whitespace-only identity/policy field", () => {
      // Whitespace passes ajv's minLength, so this exercises the SEMANTIC rule specifically.
      const result = validateProviderAuditRecord({ ...audit, modelId: "  ", requestPolicyId: " " });
      expect(result).toEqual({
        ok: false,
        errors: ["provider audit fields must be nonblank: modelId, requestPolicyId"],
      });
    });

    it("rejects an empty-string field structurally (minLength), before the semantic pass", () => {
      expect(validateProviderAuditRecord({ ...audit, modelId: "" }).ok).toBe(false);
    });

    it("rejects negative cost", () => {
      expect(validateProviderAuditRecord({ ...audit, costEstimateUsd: -1 }).ok).toBe(false);
    });
  });
});
