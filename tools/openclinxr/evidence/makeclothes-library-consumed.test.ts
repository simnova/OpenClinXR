import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#215). Two REDs. Both flip.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * OPERATOR DIRECTIVE D1 — this slice exists because of it, verbatim:
 *
 *   "We're building a factory and need automation in it, NOT A HANDFUL OF LLMS TOILING IN
 *    NON-DETERMINISTIC WAYS BUILDING THINGS IN THE FACTORY."
 *
 * Workers have hand-authored, in bespoke Python: a foot-AABB shoe shell, a hem peak-turn clamp, a
 * wardrobe-stack shoulder metric, body-surface-derived garment shells. That is the clothing strategy
 * today and it must stop being it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURED ON MAIN BEFORE THIS WAS WRITTEN — trust these, do not re-derive
 *
 * `pnpm exec tsx tools/openclinxr/evidence/makeclothes-anny-reference-probe.ts` COMPLETES in ~100 s:
 *
 *     verdict adopt_mh_body | mpfbLoads true | fitted true
 *     garmentTriangles 9384 | meanVertexDeviation 0.0229 m | maxVertexDeviation 0.1826 m
 *
 * A real CC-BY scrub shirt (WojackOWL) is fitted onto the hm08 basemesh via
 * `ClothesService.fit_clothes_to_human`. MPFB is installed as a Blender USER EXTENSION under
 * `Library/Application Support/Blender/<ver>/extensions/user_default/mpfb`; Blender is at
 * `/opt/homebrew/bin/blender`. The probe enforces `MAX_TRIANGLES_PER_ASSET = 60_000` and reads the
 * licence FROM THE `.mhclo` HEADER, not the download page.
 *
 * SO THE QUESTION IS NOT "DOES MAKECLOTHES WORK HERE". IT WORKS. Nothing consumes it.
 *
 * The probe writes to `.openclinxr/evidence/makeclothes-anny-reference/latest/` and stops. Its own
 * `notEvidenceFor` excludes shipping into orchestrate/humanoids. Meanwhile the factory keeps deriving
 * garments from the body surface in `automate_blender.py`.
 *
 * "Proven and unconsumed" is a PATTERN here, not an incident: #70 says "Mesh2Motion is approved,
 * preferred and unused"; MADR 0044 adopted hm08 and all seven shipped humanoids are still
 * `.anny_base`. This is the build-it-never-wire-it class at factory scale.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONSUMPTION SLOT ALREADY EXISTS AND IS WIRED — measured, do not rebuild it
 *
 *   apps/ui-xr/src/main.ts:7314
 *     humanoidSourceComparator === "reom_local_fitted_garment_patient"
 *       -> '/xr-assets/humanoids/candidates/makeclothes-hm08-scrub-shirt-library.glb'
 *         (was reom-local-fitted-scrub-top-candidate.glb; #215 factory stage owns the path)
 *
 * A comparator resolving a fitted-garment humanoid is a supported shape. #215 wires a FACTORY STAGE
 * that produces the library GLB from MakeClothes with provenance.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE — a peer round argued me down from "convert an existing role"
 *
 * MADR 0044: fitted `.mhclo` transfer onto Anny topology SHATTERS. So consuming a fitted garment
 * means shipping an hm08 BODY for that asset. Converting `ed_chest_pain_nurse_adult` would force a
 * full body swap for a shipped role — bigger than one garment and not this slice.
 *
 *   DO:     produce ONE NEW candidate asset — hm08 body + fitted CC-BY garment — from a factory
 *           stage, with provenance, resolvable through the comparator path above.
 *   DO NOT: convert a shipped Anny role, migrate the runtime body, or change ui-xr DEFAULTS.
 *   DO NOT: put the fit inside `automate_blender.py`. That file is the Anny rebake/paint/surface-shell
 *           path and it is exactly where the LLM-authored Python accumulated. New stage, new file.
 *   DO NOT: vendor MPFB. It is GPL. It stays a Blender user extension.
 *   LIBRARY, NOT PER-CHARACTER: fit once into a reusable library; do not run MPFB on every bake.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PROBE PASSING MUST NOT SATISFY THESE. That is the whole point — the probe already passes.
 *
 * THE MECHANISM IS KNOWN AND MEASURED; this is wiring, not diagnosis. Do not spend turns hunting a
 * bug. If the fit stage cannot be driven from a factory script on this machine, say so and stop —
 * `reject_measured` closes this issue successfully.
 */

type LibraryEntry = {
  garmentId: string;
  bodyClass: string;
  glbPath: string;
  garmentMeshNames: string[];
  garmentTriangleCount: number;
  licenseToken: string;
  licenseSource: string;
  producedByStage: string;
};

type Inspect = () => Promise<{
  entries: LibraryEntry[];
  comparatorResolvedPaths: { comparatorId: string; resolvedPath: string }[];
}>;

const load = () =>
  import("./makeclothes-library-consumed.js") as Promise<Record<string, unknown>>;

describe("the factory consumes a fitted MakeClothes garment (#215)", () => {
  it("a factory stage produced a library GLB whose garment is FITTED, not body-surface-derived", async () => {
    const mod = await load();
    const inspect = mod["inspectMakeclothesLibraryConsumed"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(
      report.entries.length,
      "no MakeClothes library entries — the fit stage produced nothing a factory script can consume",
    ).toBeGreaterThan(0);

    const bad: string[] = [];
    for (const e of report.entries) {
      // The defining difference. Body-surface-derived garments carry the generated shell naming from
      // automate_blender.py. A FITTED garment does not — it came from a .mhclo through ClothesService.
      const surfaceDerived = e.garmentMeshNames.filter((n) => /openclinxr_real_garment_/i.test(n));
      if (surfaceDerived.length > 0) {
        bad.push(`${e.glbPath}: garment ${surfaceDerived.join(",")} is body-surface-derived, not fitted`);
      }
      if (e.garmentMeshNames.length === 0) bad.push(`${e.glbPath}: no garment mesh at all`);
      if (e.garmentTriangleCount < 500) {
        bad.push(`${e.glbPath}: ${e.garmentTriangleCount} garment triangles — the probe's fitted shirt is 9384`);
      }
      if (e.garmentTriangleCount > 60_000) {
        bad.push(`${e.glbPath}: ${e.garmentTriangleCount} triangles exceeds MAX_TRIANGLES_PER_ASSET`);
      }
      // Provenance is what separates a factory artifact from a probe artifact.
      if (!/CC-?BY/i.test(e.licenseToken)) bad.push(`${e.glbPath}: licence "${e.licenseToken}" is not CC-BY`);
      if (!/mhclo/i.test(e.licenseSource)) {
        bad.push(
          `${e.glbPath}: licence source "${e.licenseSource}" — it must be read from the .mhclo header, not a page claim`,
        );
      }
      if (!e.producedByStage || /probe/i.test(e.producedByStage)) {
        bad.push(`${e.glbPath}: producedByStage "${e.producedByStage}" — a probe is not a factory stage`);
      }
    }
    expect(bad, `library entries that are not factory-produced fitted garments:\n${bad.join("\n")}`).toEqual([]);
  }, 1_800_000);

  it("the runtime can resolve it, and no shipped Anny role was converted (COUNTERWEIGHT)", async () => {
    // Consumption means the runtime can reach it — main.ts:7314 already proves a comparator slot for a
    // fitted-garment humanoid is a supported shape. But the seven shipped humanoids must stay Anny:
    // MADR 0044 says .mhclo transfer onto Anny topology shatters, so a converted role would be a
    // silent body swap. This slice adds a candidate; it does not migrate the cast.
    const mod = await load();
    const inspect = mod["inspectMakeclothesLibraryConsumed"] as Inspect;
    const report = await inspect();

    const broken: string[] = [];
    const resolvesLibrary = report.comparatorResolvedPaths.some((c) =>
      report.entries.some((e) => c.resolvedPath.includes(e.glbPath.split("/").pop() ?? " ")),
    );
    if (!resolvesLibrary) {
      broken.push("no comparator resolves a library GLB — the artifact exists but the runtime cannot reach it");
    }
    for (const e of report.entries) {
      if (/generated-humanoids\//.test(e.glbPath)) {
        broken.push(
          `${e.glbPath}: a shipped Anny humanoid was overwritten — this slice adds a candidate, it does not convert the cast`,
        );
      }
    }
    expect(broken, `the counterweight broke:\n${broken.join("\n")}`).toEqual([]);
  }, 1_800_000);
});
