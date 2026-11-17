import { runInThisContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { waitForSceneAssetsSettled } from "../declared-actors-rendered.js";
import { assertLiveCastMatchesDeclared } from "../idle-arm-hang.js";
import type { Page } from "../lib/slotted-playwright.js";

/**
 * ARM-PARTIAL-CAST (H1): `waitForSceneAssetsSettled` returns the settle outcome
 * instead of void. No browser: a stub Page drives the predicate the helper passes
 * to `waitForFunction` against a fake `__openClinXrSceneAssetEvidence`, simulates
 * the timeout by throwing, and evals the pending-ids IIFE against the same fake.
 *
 * The 60 s cap and 30 s fallback sleep are unchanged — tiny `timeoutMs` values
 * keep this test in milliseconds.
 */

type FakeAsset = { assetId: string; status: "pending" | "loaded" | "failed" };
type FakeEvidence = { pendingCount: number; assets: FakeAsset[] };

function stubPage(evidence: FakeEvidence): Page {
  return {
    async waitForFunction(predicate: () => boolean) {
      (globalThis as Record<string, unknown>).browserPageWindow = {
        __openClinXrSceneAssetEvidence: evidence,
      };
      if (predicate()) return undefined;
      throw new Error("stub waitForFunction: condition false (simulated timeout)");
    },
    async waitForTimeout(ms: number) {
      expect(ms, "fallback sleep stays bounded").toBeLessThanOrEqual(30_000);
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
      return undefined;
    },
    async evaluate(expression: string) {
      (globalThis as Record<string, unknown>).browserPageWindow = {
        __openClinXrSceneAssetEvidence: evidence,
      };
      // The helper passes a string IIFE (tsx/esbuild `__name` rule); execute that
      // exact string in this context so the field names it reads are under test.
      return runInThisContext(expression) as unknown;
    },
  } as unknown as Page;
}

describe("waitForSceneAssetsSettled result (ARM-PARTIAL-CAST H1)", () => {
  it("pendingCount stuck >0 -> settled:false with the pending ids", async () => {
    const page = stubPage({
      pendingCount: 1,
      assets: [
        { assetId: "ward_nurse_asset", status: "pending" },
        { assetId: "ward_patient_asset", status: "loaded" },
      ],
    });
    const result = await waitForSceneAssetsSettled(page, 40);
    expect(result.settled).toBe(false);
    expect(result.pendingIds).toEqual(["ward_nurse_asset"]);
  });

  it("pendingCount 0 -> settled:true, pendingIds []", async () => {
    const page = stubPage({
      pendingCount: 0,
      assets: [
        { assetId: "ward_nurse_asset", status: "loaded" },
        { assetId: "ward_patient_asset", status: "failed" },
      ],
    });
    const result = await waitForSceneAssetsSettled(page, 40);
    expect(result.settled).toBe(true);
    expect(result.pendingIds).toEqual([]);
  });

  it("a failed asset counts as settled, so a broken load is reported, not masked", async () => {
    const page = stubPage({
      pendingCount: 0,
      assets: [{ assetId: "ward_nurse_asset", status: "failed" }],
    });
    const result = await waitForSceneAssetsSettled(page, 40);
    expect(result.settled).toBe(true);
    expect(result.pendingIds).toEqual([]);
  });
});

describe("assertLiveCastMatchesDeclared (F1 cardinality, stubbed, no browser)", () => {
  const CAST = ["a_v1", "b_v1", "c_v1", "d_v1"];
  const SID = "ward_delirium_med_rec_v1";

  function messageFor(input: {
    liveIds: string[];
    pendingIds?: string[];
    settled?: boolean;
  }): string | null {
    try {
      assertLiveCastMatchesDeclared({
        scenarioId: SID,
        castIds: CAST,
        liveIds: input.liveIds,
        pendingIds: input.pendingIds ?? [],
        settled: input.settled ?? true,
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  it("equal sets + settled -> no throw", () => {
    expect(messageFor({ liveIds: [...CAST] })).toBeNull();
  });

  it("one missing -> throws naming it", () => {
    const message = messageFor({ liveIds: ["a_v1", "c_v1", "d_v1"] });
    expect(message, "the absent actor id is named").toMatch(/b_v1/);
    expect(message, "the station is named").toMatch(/ward_delirium_med_rec_v1/);
  });

  it("same size with one substituted id -> throws naming both", () => {
    const message = messageFor({ liveIds: ["a_v1", "x_v1", "c_v1", "d_v1"] });
    expect(message, "the missing cast id is named").toMatch(/b_v1/);
    expect(message, "the unexpected live id is named").toMatch(/x_v1/);
  });

  it("an actor_<i> fallback id -> throws", () => {
    const message = messageFor({ liveIds: ["a_v1", "b_v1", "c_v1", "actor_0"] });
    expect(message, "the fallback id must not count as cast").toMatch(/actor_0/);
    expect(message, "the displaced cast id is named").toMatch(/d_v1/);
  });

  it("an empty cast -> throws even with an empty live set", () => {
    expect(() => assertLiveCastMatchesDeclared({ scenarioId: SID, castIds: [], liveIds: [], pendingIds: [], settled: true })).toThrow(/cast resolved empty/);
  });

  it("equal sets but unsettled -> throws (settled is required, not just counts)", () => {
    const message = messageFor({ liveIds: [...CAST], settled: false });
    expect(message, "an unsettled full-count read still throws").toMatch(/unsettled/);
  });
});
