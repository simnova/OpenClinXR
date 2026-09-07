import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchFactoryRunTable } from "@openclinxr/ui-shared/factory-run-table-client";

/**
 * PLANT-PHASE NOTE: while this was a planted RED the module did not exist and knip
 * fails closed on an unresolved import, so the plant reached it through a non-static
 * specifier. The module exists now, and a non-static specifier also loses vitest's
 * dependency pre-bundling, which made the suite fail only when run in parallel with
 * the rest of the file set. Static import.
 */
async function client(): Promise<{ fetchFactoryRunTable: typeof fetchFactoryRunTable }> {
  return { fetchFactoryRunTable };
}


/**
 * OBSERVABLE: GET /internal/factory-run-table serves the run record and
 * FactoryRunProgressPanel renders it, and nothing in the admin shell connects
 * the two. Faculty still cannot see whether the factory ran.
 *
 * MEASURED 2026-09-06 on main 8c3b26ff:
 *   grep -rn 'factory-run-table' apps/ui-admin/src -> 0 matches
 *   grep -rn 'FactoryRunProgressPanel' apps/ui-admin/src -> 1 match, the panel's
 *   own unit test, which constructs the props by hand.
 *
 * The client lives in packages/openclinxr/ui-shared beside the panel it feeds, not in
 * apps/ui-admin/src: the thin-app ratchet caps that directory at 40 non-test sources
 * (workspace-architecture.test.ts) and it is at 40 today, so a 41st file fails the gate.
 *
 * KNOWN-GOOD COLUMN: compile-encounter-world.ts is the same shape done right —
 * a small module owning one endpoint, a `fetch` injection point for tests, the
 * VITE_OPENCLINXR_API_BASE_URL fallback, and bearer-token resolution shared with
 * the rest of the admin client.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails -> it and append ## FIXED.
 *
 * claimScope: the admin shell fetches the run record and hands it to the panel.
 * notEvidenceFor: that the served numbers are current; that a `deterministic`
 * classification means the artifact is usable; live Blender; Quest.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the admin shell shows the factory run record", () => {
  it("(1) fetchFactoryRunTable GETs /internal/factory-run-table", async () => {
    const { fetchFactoryRunTable } = await client();
    const seen: { url: string; method: string }[] = [];
    await fetchFactoryRunTable({
      baseUrl: "https://api.test",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), method: init?.method ?? "GET" });
        return jsonResponse({ cases: [] });
      }) as typeof fetch,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.test/internal/factory-run-table");
    expect(seen[0].method).toBe("GET");
  });

  it("(2) it returns the served cases unchanged", async () => {
    const { fetchFactoryRunTable } = await client();
    const served = {
      cases: [
        {
          caseId: "ed_chest_pain_priority_v2",
          stations: [{ stationId: "render", classification: "error" }],
        },
      ],
    };
    const result = await fetchFactoryRunTable({
      baseUrl: "https://api.test",
      fetch: (async () => jsonResponse(served)) as typeof fetch,
    });
    expect(result.cases).toEqual(served.cases);
  });

  it("(3) COUNTERWEIGHT: a failing request yields an empty record, never a throw", async () => {
    const { fetchFactoryRunTable } = await client();
    const result = await fetchFactoryRunTable({
      baseUrl: "https://api.test",
      fetch: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    expect(result.cases).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: a non-JSON or malformed body yields an empty record", async () => {
    const { fetchFactoryRunTable } = await client();
    const result = await fetchFactoryRunTable({
      baseUrl: "https://api.test",
      fetch: (async () => new Response("not json", { status: 200 })) as typeof fetch,
    });
    expect(result.cases).toEqual([]);
  });

  it("(5) the admin shell mounts FactoryRunProgressPanel with fetched cases", () => {
    const app = readFileSync(join(SRC, "app.tsx"), "utf8");
    const seedBlueprint = readFileSync(join(SRC, "../../../packages/openclinxr/ui-route-admin/src/seed-blueprint-workbench.tsx"), "utf8");
    expect(`${app}${seedBlueprint}`).toContain("FactoryRunProgressPanel");
    expect(`${app}${seedBlueprint}`).toContain("fetchFactoryRunTable");
    // the panel's cases come from state fed by the fetch, never a literal
    expect(`${app}${seedBlueprint}`).not.toMatch(/<FactoryRunProgressPanel\s+cases=\{\[/);
  });
});

// NOT TESTED: rendered appearance; that the panel is reachable from a particular tab;
// that the run record describes the current tree.
