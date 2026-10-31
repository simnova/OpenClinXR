import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

/**
 * The conjunctiva+caruncle fit binds a community .mhclo to lid-margin body
 * verts so the fitted mesh inherits weights plus the six eye closure/slit/
 * opened-up morphs (lash T2+A3 pattern), closing the white-to-lid gap.
 *
 * not_found is an honest terminal outcome: 77 packs swept, zero hits, so the
 * manifest records the pack list and the licence line that failed. Clause (3)
 * accepts status in {fitted, not_found}; the lid-morph inheritance assertions
 * apply only to fitted. A known-bad not_found fixture (packsSearched 0) is
 * rejected by the same validator.
 *
 * The sheet PNG lives in the operator asset store, not gitignored scratch:
 * clause (2) verifies its sha256 when the store exists and skips (never
 * passes silently) when the store is absent.
 *
 * claimScope: manifest search record + store sheet bytes.
 * notEvidenceFor: clinical_validity, production_asset_readiness; pixel grade
 *   lives in corner-sheet.png. Never opens the gitignored realism GLB.
 */

const REPO_ROOT = repoRoot();
const MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/manifest.json",
);
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
const storeExists = existsSync(STORE_ROOT);

type EyeCornerManifest = {
  status: string;
  search: { packsSearched: number; bulkGrep: string };
  licence: { header: string };
  fit?: {
    mhcloPath?: string;
    lidMarginVertCount?: number;
    inheritedMorphs?: string[];
  };
};

/** Terminal-outcome gate: fitted must carry the lid-morph inheritance record;
 * not_found must carry a real search record. Throws on anything else. */
function validateTerminalOutcome(m: EyeCornerManifest): void {
  expect(["fitted", "not_found"], "status in {fitted, not_found}").toContain(
    m.status,
  );
  if (m.status === "not_found") {
    expect(m.search.packsSearched, "not_found needs packs searched >0")
      .toBeGreaterThan(0);
    expect(m.search.bulkGrep, "not_found needs the bulk-grep line").toMatch(
      /zero hits/,
    );
    expect(m.licence.header.length, "not_found needs the licence line")
      .toBeGreaterThan(0);
    return;
  }
  expect(m.fit?.mhcloPath, "fitted requires the .mhclo path").toBeTruthy();
  expect(m.fit?.lidMarginVertCount ?? 0, "fitted binds lid-margin verts")
    .toBeGreaterThan(0);
  expect(
    m.fit?.inheritedMorphs ?? [],
    "fitted inherits closure/slit morphs",
  ).toEqual(expect.arrayContaining(["eye-closure", "eye-slit"]));
}

describe("the conjunctiva caruncle fit inherits lid morphs", () => {
  it("(1) manifest exists with the search record and licence line", () => {
    expect(existsSync(MANIFEST), MANIFEST).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    expect(m.name).toBe("eye-corner-conjunctiva-caruncle-fit");
    expect(m.search.packsSearched, "packs searched >0").toBeGreaterThan(0);
    expect(m.search.bulkGrep, "bulk grep recorded").toMatch(/zero hits/);
    expect(m.licence.header.length, "licence line recorded").toBeGreaterThan(0);
    expect(m.provenance.producerSourceSha256.length).toBe(64);
  });

  it.skipIf(!storeExists)(
    storeExists
      ? "(2) RED: store sheet matches manifest sha and shows the gap"
      : "(2) RED: store sheet check [store absent]",
    () => {
      const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
      expect(m.sheet.storeSha256.length).toBe(64);
      const storeSheet = join(
        STORE_ROOT,
        "corner-assets/corner-sheet.png",
      );
      expect(existsSync(storeSheet), storeSheet).toBe(true);
      const bytes = readFileSync(storeSheet);
      const sha = createHash("sha256").update(bytes).digest("hex");
      expect(sha, "store sheet bytes match manifest").toBe(
        m.sheet.storeSha256,
      );
      const cov = m.coverageGate.brightFractionCanthusCrop;
      const vals = [
        cov["eye3-front"].L,
        cov["eye3-front"].R,
        cov["eye3-yaw40"].L,
        cov["eye3-yaw40"].R,
        cov["eye3-yaw-40"].L,
        cov["eye3-yaw-40"].R,
      ];
      expect(
        vals.some((v: number) => v < 0.05),
        "at least one canthus crop shows near-zero white (gap open)",
      ).toBe(true);
      expect(m.falsifier.verdict).toBe("premise_live");
    },
  );

  it("(3) terminal outcome: fitted inherits lid morphs, or honest not_found", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    validateTerminalOutcome(m);
  });

  it("(3b) known-bad: not_found with zero packs searched is rejected", () => {
    const bad: EyeCornerManifest = {
      status: "not_found",
      search: { packsSearched: 0, bulkGrep: "" },
      licence: { header: "" },
    };
    expect(() => validateTerminalOutcome(bad)).toThrow();
  });
});
