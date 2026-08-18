import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E6 slice 1 (#423) — INDEX PREFLIGHT ON THE STAGED CC0 VISEME PACK.
 *
 * ## THE FIND
 *
 * `.openclinxr-local/provider-cache/visemes/makehuman-visemes02/` — 15 `.target` files, ARKit/Meta
 * names (`viseme_aa CH DD E FF I kk nn O PP RR sil SS TH U`), manifest `packs/visemes02.json` giving
 * author `Mika Suominen` and `"license": "CC0"` on all 15. **Zero consumers.** Grepping the pack path,
 * `targets/visemes`, and `viseme_*.target` across `tools/ apps/ packages/` returns nothing that loads
 * it; the only hits are two COMMENTS citing visemes02 as a licence precedent for the mhair02 override.
 *
 * Meanwhile all 7 shipped MPFB actors carry **32 FACS expression-unit targets and `viseme_*` = 0**, and
 * the runtime drives speech by aliasing ARKit names onto 13 generic `mouth-*` shapes (#353). A proven,
 * licensed, purpose-built asset sits on disk while the factory approximates it — the "proven and
 * unconsumed" defect this repo names as its characteristic failure.
 *
 * MPFB release notes (operator-supplied, fetched 2026-08-18): 2.0.15 added the Lip Sync add-on
 * integration plus visemes01 (22, Microsoft) and visemes02 (15, Meta/ARKit); 2.0.16 added 52 ARKit
 * faceunits. Only visemes02 is staged here.
 *
 * ## WHY AN INDEX PREFLIGHT COMES FIRST — THE CRUDEGOWN RULE
 *
 * This pipeline helper-strips the hm08 basemesh at vertex **13,380** (MADR 0052). A `.target` whose
 * vertex indices reach past that boundary is displacing geometry that no longer exists on the stripped
 * body. S0 (`bf64ff70`) established this check for garments and it cost one file read; skipping the
 * equivalent check is how a floor-length evening dress reached a bake through three green contracts.
 *
 * **The superagent's own parse says this pack fails that boundary**, which is the finding, not a
 * blocker: `FF I RR U sil` are helper-clean, and `aa E O PP TH DD kk CH SS nn` reach **maxIdx up to
 * 15,119** with hundreds of rows ≥ 13,380. So they must be applied BEFORE the strip, exactly as
 * clothes are. This contract exists to put that measurement on disk rather than in a chat message.
 *
 * ## `sil` IS ZERO VERTICES AND THAT IS CORRECT
 *
 * `viseme_sil` is the rest pose — a target with no displacements. A contract that treats 0 vertices as
 * a missing or broken file would refuse the one target that is definitionally empty. Clause (3) pins
 * that distinction so nobody "fixes" it later.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                | (1) | (2) | (3) | (4) | result
 *   -----------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no preflight artifact                          |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) report only the max across the pack, not per file      |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   c) treat `sil` (0 verts) as missing and drop it to 14     |FAIL | pass|FAIL |FAIL | REFUSED
 *   d) rows complete, but a pack-level "unusable" verdict     |pass |**FAIL**| pass| pass| REFUSED
 *      and no named clean subset
 *   e) per-file rows + `helperCleanTargets` naming the five   |pass | pass| pass| pass| ALL PASS
 *
 * **(d) is the one to watch, and clause (2) had to be rewritten to bite it.** My first draft computed
 * the clean subset FROM the rows, so a complete artifact carrying a wholesale "unusable" verdict
 * satisfied it — the counterweight was decorative. Clause (2) now requires the artifact to CARRY
 * `helperCleanTargets` as a named list and to agree with the rows. Ten of fifteen exceeding the
 * boundary reads like a refusal and is not: the apply order is the answer (before the strip), not
 * abandonment, and "unusable" cannot be asserted over a pack that is a third clean and fully usable
 * pre-strip.
 *
 * Row (c) column (2) was measured, not predicted: dropping `sil` from BOTH the rows and the named
 * list keeps the two consistent, so clause (2) passes and clauses (1)/(3)/(4) are what refuse it.
 * The first draft of this table claimed all four failed. Probe output, all four treatments, is the
 * record.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **ALL FOUR are RED today** — no artifact exists and every
 * clause reads it. Clause (4) is a vacuity guard that becomes load-bearing once it does.
 *
 * NOT TESTED:
 *   - That the targets FIT, deform correctly, or look like speech. Index range is necessary, never
 *     sufficient — the entire crudegown lesson.
 *   - The apply path. Citing `FaceService.load_targets(basemesh, load_microsoft_visemes=,
 *     load_meta_visemes=, load_arkit_faceunits=)` at `mpfb/services/faceservice.py:154` is E6.2.
 *   - Any bake. E6.3 is blocked on the #327 licence reconciliation regardless of this result.
 *   - visemes01 (22 Microsoft) and faceunits01 (52 ARKit) — neither is staged on this machine.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PACK = join(REPO_ROOT, ".openclinxr-local/provider-cache/visemes/makehuman-visemes02/targets/visemes");
const PREFLIGHT = join(REPO_ROOT, "tools/openclinxr/evidence/visemes02-preflight.json");

/** MADR 0052 helper-strip boundary. Not tuned — it is the basemesh split point, same as S0 used. */
const HELPER_STRIP_VERTEX = 13380;
/** The rest pose. Zero displacements is correct, not a missing file. */
const REST_TARGET = "viseme_sil";

type Row = { name: string; vertCount: number; maxIdx: number; helperRows: number; helperClean: boolean };
type Preflight = {
  helperStripVertex?: number;
  rows: Row[];
  enumeratedFrom?: string;
  /** Named, not derived — see clause (2). A wholesale "unusable" verdict cannot supply this. */
  helperCleanTargets?: string[];
};

function preflight(): Preflight {
  expect(existsSync(PREFLIGHT), `${PREFLIGHT} — E6.1 writes this; the pack has never been measured`).toBe(true);
  return JSON.parse(readFileSync(PREFLIGHT, "utf8")) as Preflight;
}
/** Ground truth for the population, read off disk so the artifact cannot under-report. */
const onDisk = (): string[] =>
  existsSync(PACK) ? readdirSync(PACK).filter((f) => f.endsWith(".target")).map((f) => f.replace(/\.target$/, "")) : [];

describe("the staged visemes02 pack is index-preflighted before anything applies it", () => {
  it("(1) RED: every target in the pack has a per-file vertCount, maxIdx and helperRows", () => {
    // Refuses (b) and (c). A pack-wide maximum hides which files are clean; dropping `sil` to 14
    // silently loses the rest pose the Lip Sync mapping needs.
    const p = preflight();
    const disk = onDisk();
    expect(disk.length, "targets on disk").toBeGreaterThan(0);
    expect(p.helperStripVertex, "the boundary the verdict is against").toBe(HELPER_STRIP_VERTEX);
    const measured = new Set(p.rows.map((r) => r.name));
    const missing = disk.filter((d) => !measured.has(d));
    expect(missing, `targets on disk but not measured: ${missing.join(", ")}`).toEqual([]);
    for (const r of p.rows) {
      expect(typeof r.maxIdx, `${r.name}: maxIdx`).toBe("number");
      expect(typeof r.helperRows, `${r.name}: rows at or past the boundary`).toBe("number");
      expect(r.helperClean, `${r.name}: helperClean must equal maxIdx < ${HELPER_STRIP_VERTEX}`).toBe(
        r.maxIdx < HELPER_STRIP_VERTEX,
      );
    }
  });

  it("(2) RED: the helper-clean subset is named, so the pack is not written off wholesale", () => {
    // Refuses (d). Some files exceeding the boundary is an APPLY-ORDER fact, not a verdict on the
    // pack. The clean subset must be visible by name or "unusable" becomes assertable over an asset
    // that is fully usable before the strip.
    const p = preflight();
    const derived = p.rows.filter((r) => r.helperClean).map((r) => r.name).sort();
    expect(derived.length, "targets under the boundary — the pack is not wholly dirty").toBeGreaterThan(0);
    expect(
      [...(p.helperCleanTargets ?? [])].sort(),
      `helperCleanTargets must NAME the clean subset (derived: ${derived.join(", ")}); a pack-level verdict cannot supply it`,
    ).toEqual(derived);
    const dirty = p.rows.filter((r) => !r.helperClean);
    for (const r of dirty) {
      expect(r.helperRows, `${r.name} exceeds the boundary so it must report how many rows do`).toBeGreaterThan(0);
    }
  });

  it("(3) RED: the rest pose is recorded as empty, not as missing", () => {
    // viseme_sil is definitionally zero displacements. A contract that cannot tell "empty" from
    // "absent" would have someone delete the one target the Lip Sync slot mapping needs for silence.
    const p = preflight();
    const sil = p.rows.find((r) => r.name === REST_TARGET);
    expect(sil, `${REST_TARGET} must be measured, not skipped`).toBeTruthy();
    expect(sil?.vertCount, `${REST_TARGET} is the rest pose — zero displacements is correct`).toBe(0);
    expect(sil?.helperClean, `${REST_TARGET} touches no vertex, so it cannot exceed the boundary`).toBe(true);
  });

  it("(4) VACUITY GUARD: the population was enumerated from the pack, not hardcoded", () => {
    const p = preflight();
    expect(
      typeof p.enumeratedFrom === "string" && /visemes/.test(p.enumeratedFrom),
      "the artifact must record the pack directory it walked",
    ).toBe(true);
    expect(p.rows.length, "rows measured").toBe(onDisk().length);
  });
});
