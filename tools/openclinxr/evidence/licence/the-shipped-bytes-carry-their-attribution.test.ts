import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUBCOMPONENT_CLEARANCE, type SubcomponentClearance } from "./selected-scene-asset-lineage.js";
import {
  attributableComponents,
  bodyIdFromAssetPath,
  deriveCopyrightNotice,
  NOTICES_BASE_URL,
} from "./shipped-licence-notice.js";

/**
 * The shipped bytes carry the attribution their sources oblige. Do they?
 *
 * MEASURED 2026-09-10: no. Every one of the thirteen shipped humanoids has an `asset` block of
 * exactly `{generator, version}` — no `copyright`, no `extras` — while WojackOWL's CC-BY scrub kit
 * is welded into five of them and served at a public URL. The attribution survived only in a ledger
 * and a website page, neither of which reaches someone who fetches the `.glb`.
 *
 * THE VACUOUS VERSION OF THIS TEST, written down so nobody rebuilds it: "asset.copyright is
 * non-empty and contains the notices URL". A single hardcoded string pasted into all thirteen files
 * satisfies that completely while carrying no relationship to what was actually welded in. The
 * clauses below are built so that both cheap frauds fail — a global constant fails on the eight
 * bodies that owe nothing, and a WojackOWL-shaped `if` fails on a synthetic second CC-BY author.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HUMANOIDS = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

function meshNamesOf(glbPath: string): string[] {
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    meshes?: { name?: string }[];
    asset?: Record<string, unknown>;
  };
  return (json.meshes ?? []).map((mesh) => mesh.name ?? "");
}

function assetBlockOf(glbPath: string): Record<string, unknown> {
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    asset?: Record<string, unknown>;
  };
  return json.asset ?? {};
}

/** A synthetic component whose author is nobody's special case. */
const SECOND_CC_BY: SubcomponentClearance = {
  meshMatch: "synthetic_second_cc_by_component",
  component: "Synthetic Second Kit",
  licenceRecordPath: "docs/openclinxr/asset-licence-records/synthetic-fixture.json",
  requiredRecordPhrases: ["CC-BY"],
  rights: "cc-by",
  attribution: "A Second Author, Second Kit, CC-BY",
  redistributable: true,
  publicRenderCleared: true,
};

describe("the shipped bytes carry their attribution", () => {
  it("(1) every CC-BY component in the table carries the credit it obliges", () => {
    const naked = SUBCOMPONENT_CLEARANCE.filter(
      (entry) => entry.rights === "cc-by" && (entry.attribution ?? "").trim().length === 0,
    ).map((entry) => entry.component);
    expect(
      naked,
      "a CC-BY component with no attribution string is an obligation nobody can discharge — put the credit from its own header or its ledger row on the entry",
    ).toEqual([]);
    // And the population is real, so clause (1) is not green about an empty set.
    expect(SUBCOMPONENT_CLEARANCE.filter((entry) => entry.rights === "cc-by").length).toBeGreaterThan(0);
  });

  it("(2) the notice is DERIVED from the components, not from the body's name", () => {
    const withKit = deriveCopyrightNotice({
      meshNames: ["mpfb_x_body", "makeclothes_library_scrub_shirt_x_mesh"],
      bodyId: "fixture-body",
    });
    expect(withKit).toContain("WojackOWL");
    expect(withKit).toContain(`${NOTICES_BASE_URL}#fixture-body`);
    expect(withKit).toContain("Contains");

    // COUNTERWEIGHT: the same body id with no CC-BY component owes nothing. A writer that returns a
    // constant, or that keys off the body rather than its parts, fails here.
    const withoutKit = deriveCopyrightNotice({
      meshNames: ["mpfb_x_body", "openclinxr_fitted_eyebrow_mindfront_x_mesh"],
      bodyId: "fixture-body",
    });
    expect(withoutKit).toBeUndefined();
  });

  it("(3) a SECOND CC-BY author appears without anyone editing the writer", () => {
    // This is the clause that refuses `if (scrub kit) { WojackOWL }`. The live hole was that nobody
    // had enumerated what the bake consumes; a writer hardcoded to the one kit we happened to notice
    // would mint the same hole for the next one.
    const notice = deriveCopyrightNotice({
      meshNames: ["mpfb_x_body", "synthetic_second_cc_by_component_x_mesh"],
      bodyId: "fixture-body",
      table: [...SUBCOMPONENT_CLEARANCE, SECOND_CC_BY],
    });
    expect(notice).toContain("A Second Author, Second Kit, CC-BY");
    expect(notice).not.toContain("WojackOWL");
  });

  it("(4) one kit split across two meshes owes ONE credit, not two", () => {
    const notice = deriveCopyrightNotice({
      meshNames: ["makeclothes_library_scrub_shirt_x_mesh", "makeclothes_library_scrub_pants_x_mesh"],
      bodyId: "fixture-body",
    });
    const occurrences = notice?.split("WojackOWL").length ?? 0;
    expect(occurrences - 1, `one kit, one credit: ${notice}`).toBe(1);
  });

  it("(5) every shipped body's asset.copyright equals what the writer derives for it", () => {
    // THE CONTROL SET IS THE POINT. The bodies that owe nothing must carry nothing: a single
    // hardcoded string pasted into all thirteen dies here rather than in clause (2).
    const bodies = readdirSync(HUMANOIDS)
      .filter((file) => file.endsWith(".glb"))
      .sort();
    expect(bodies.length, "no shipped humanoids found").toBeGreaterThan(0);

    const owing: string[] = [];
    const naked: string[] = [];
    for (const file of bodies) {
      const full = path.join(HUMANOIDS, file);
      const expected = deriveCopyrightNotice({
        meshNames: meshNamesOf(full),
        bodyId: bodyIdFromAssetPath(file),
      });
      const actual = assetBlockOf(full)["copyright"];
      if (expected === undefined) {
        if (actual !== undefined) naked.push(`${file}: owes nothing but carries "${String(actual)}"`);
      } else if (actual !== expected) {
        owing.push(`${file}:\n    expected ${expected}\n    actual   ${String(actual)}`);
      }
    }
    expect(naked, "a body with no CC-BY component must carry no notice — a constant pasted everywhere fails here").toEqual([]);
    expect(owing, "these shipped bodies carry a CC-BY component and do not carry its credit").toEqual([]);
  });

  it("(6) the components this table can attribute are actually present in shipped bodies", () => {
    // Guards the whole file against going green on a table that matches nothing real.
    const across = readdirSync(HUMANOIDS)
      .filter((file) => file.endsWith(".glb"))
      .flatMap((file) => attributableComponents(meshNamesOf(path.join(HUMANOIDS, file))));
    expect(across.length, "no shipped body matches any CC-BY entry — the table has drifted from the bytes").toBeGreaterThan(0);
  });
});
