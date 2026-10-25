import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("../../../../packages/openclinxr/asset-registry/src/actor-casting.js", () => ({
  listShippedCastScenarioIds: () => ["foreignScenario"],
  resolveScenarioActorCast: () => fixtures.rows,
}));

import { inspectCastIdentityAcrossStations } from "../cast-identity-all-stations.js";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { force: true, recursive: true });
  dir = "";
  fixtures.rows = [];
});

function synthFixture(assetBase: string, declaredAgeBand: string) {
  dir = mkdtempSync(join(tmpdir(), "cast-age-"));
  const assetPath = join(dir, assetBase);
  const provenanceManifestPath = join(dir, `${assetBase}.provenance.json`);
  writeFileSync(assetPath, `synthetic unit fixture bytes ${assetBase}`);
  writeFileSync(provenanceManifestPath, JSON.stringify({ scenarioId: "sourceScenario" }));
  fixtures.rows = [
    {
      actorId: "synthetic_unit_fixture",
      role: "patient",
      assetPath,
      runtimeAssetPath: `/generated-humanoids/${assetBase}`,
      provenanceManifestPath,
      declaredAgeBand,
    },
  ];
}

// Synthetic unit fixtures only: byte content + provenance JSON are fabricated in a
// unique mkdtemp dir (cleaned per case). Only fs/hash reads occur; no valid GLB needed.
describe("cast identity age classification negative controls", () => {
  it("canonical child body on child role reuses the pool (null)", async () => {
    synthFixture("mpfb-peds-patient-child.glb", "child");
    const report = await inspectCastIdentityAcrossStations();
    expect(report.roles).toHaveLength(1);
    expect(report.roles[0]!.assetProvenanceScenarioId).toBeNull();
  });

  it("canonical child body on adult role surfaces the foreign scenario", async () => {
    synthFixture("mpfb-peds-patient-child.glb", "adult");
    const report = await inspectCastIdentityAcrossStations();
    expect(report.roles).toHaveLength(1);
    expect(report.roles[0]!.assetProvenanceScenarioId).toBe("sourceScenario");
  });

  it("adult fixture body on child role surfaces the foreign scenario", async () => {
    synthFixture("adult-fixture.glb", "child");
    const report = await inspectCastIdentityAcrossStations();
    expect(report.roles).toHaveLength(1);
    expect(report.roles[0]!.assetProvenanceScenarioId).toBe("sourceScenario");
  });

  it("adult fixture body on adult role reuses the pool (null)", async () => {
    synthFixture("adult-fixture.glb", "adult");
    const report = await inspectCastIdentityAcrossStations();
    expect(report.roles).toHaveLength(1);
    expect(report.roles[0]!.assetProvenanceScenarioId).toBeNull();
  });
});
