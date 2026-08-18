import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * E6 slice 2 (#423) — CITE THE CALL, DO NOT WIRE IT.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `.openclinxr-local/provider-cache/mpfb/extracted/services/faceservice.py:154`:
 *
 *     def load_targets(basemesh, load_microsoft_visemes=True, load_meta_visemes=False,
 *                      load_arkit_faceunits=False):
 *         """Bulk load targets, if installed. Will raise exception if target asset pack is not installed."""
 *
 * The defaults are inverted for this machine:
 *
 * | flag | list (file:line) | size | staged here |
 * |---|---|---|---|
 * | `load_microsoft_visemes` (default **True**) | `MICROSOFT_VISEMES` :15 | 22 | **NO** |
 * | `load_meta_visemes` (default **False**) | `META_VISEMES` :40 | 15 | **YES — visemes02** |
 * | `load_arkit_faceunits` (default False) | `ARKIT_FACEUNITS` :58 | 52 | **NO** |
 *
 * `META_VISEMES` matches the staged pack **exactly, name for name** — 15 of 15, nothing missing in
 * either direction (measured against #426's landed preflight). `provider-cache/visemes/` contains
 * only `makehuman-visemes02`.
 *
 * So `load_targets(basemesh)` with defaults requests 22 targets that are not installed, and the
 * docstring says that raises. The call this factory must make is:
 *
 *     FaceService.load_targets(basemesh, load_microsoft_visemes=False,
 *                              load_meta_visemes=True, load_arkit_faceunits=False)
 *
 * A bare default call looks correct in review and fails at runtime. That is what this contract pins.
 *
 * ## WHAT THIS SLICE IS NOT
 *
 * **No apply, no bake, no `.target` parser, no materializer edit.** This is a citation contract: it
 * records where the call lives, which flags this machine requires, and why — so the wiring slice
 * (blocked behind #327) starts from a resolved fact instead of rediscovering it. D1: find the proven
 * tool and record its interface before hand-rolling anything near it.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no citation artifact                            |FAIL |FAIL |FAIL |FAIL | REFUSED
 *   b) cite the symbol with no file:line                       |FAIL | pass|FAIL | pass| REFUSED
 *   c) cite file:line but copy the DEFAULT flags               | pass|FAIL | pass| pass| REFUSED
 *   d) cite a line number that does not contain the symbol     | pass| pass|FAIL | pass| REFUSED
 *   e) file:line that resolves + the required flags + counts   | pass| pass| pass| pass| ALL PASS
 *
 * **(c) is the one to watch.** Transcribing the signature verbatim — `load_microsoft_visemes=True`
 * — is the natural thing to do when citing a function, and it is the exact call that raises here.
 * Clause (2) requires the REQUIRED values, not the declared defaults.
 *
 * **(d) is why clause (3) exists.** A citation nobody resolves is a claim, not evidence (SS7k: a name
 * match tells you what something is called). Clause (3) opens the cited file and requires the cited
 * line to contain the cited symbol.
 *
 * Rows (b) col (4) and (d) col (1) were corrected from probe output, not prediction: the list
 * sizes survive a missing file:line, and a wrong line number is still a number, so clause (3) is
 * the only thing that catches (d). That is precisely the job clause (3) was written for.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **all four are RED today** — no artifact exists and every
 * clause reads it. Clause (4) becomes a vacuity guard once it does.
 *
 * NOT TESTED: that the call succeeds; that any target binds to hm08; the helper-strip apply order
 * beyond what #426 measured; `configure_lip_sync`'s own behaviour; anything about visemes01 or
 * faceunits01, neither of which is staged. E6.3 remains blocked on #327.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/lip-sync-call-citation.json");

/** Measured from source 2026-08-18. Sizes, not targets — they identify the right lists. */
const EXPECTED_LIST_SIZES = { MICROSOFT_VISEMES: 22, META_VISEMES: 15, ARKIT_FACEUNITS: 52 };
/** The call this machine requires. Defaults are inverted; see the header. */
const REQUIRED_FLAGS = { load_microsoft_visemes: false, load_meta_visemes: true, load_arkit_faceunits: false };

type Citation = { symbol: string; file: string; line: number };
type Doc = {
  loadTargets?: Citation & { requiredFlags?: Record<string, boolean>; declaredDefaults?: Record<string, boolean> };
  configureLipSync?: Citation;
  listSizes?: Record<string, number>;
  stagedPack?: string;
};

function doc(): Doc {
  expect(existsSync(ARTIFACT), `${ARTIFACT} — E6.2 writes this`).toBe(true);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Doc;
}
function resolvesTo(c: Citation | undefined): boolean {
  if (!c || !existsSync(join(REPO_ROOT, c.file))) return false;
  const lines = readFileSync(join(REPO_ROOT, c.file), "utf8").split("\n");
  return (lines[c.line - 1] ?? "").includes(c.symbol);
}

describe("the lip-sync call is cited with the flags this machine requires", () => {
  it("(1) RED: load_targets is cited with a file and a line", () => {
    const d = doc();
    expect(d.loadTargets?.symbol, "symbol").toBe("load_targets");
    expect(d.loadTargets?.file, "file path").toMatch(/faceservice\.py$/);
    expect(typeof d.loadTargets?.line, "line number").toBe("number");
    expect(d.configureLipSync?.symbol, "the lip-sync entry point must also be cited").toBe("configure_lip_sync");
  });

  it("(2) COUNTERWEIGHT: the REQUIRED flags are recorded, not the declared defaults", () => {
    // Refuses (c). Transcribing the signature gives load_microsoft_visemes=True, which requests 22
    // targets that are not staged — the docstring says that raises.
    const d = doc();
    expect(d.loadTargets?.requiredFlags, "requiredFlags for THIS machine").toEqual(REQUIRED_FLAGS);
    expect(
      d.loadTargets?.requiredFlags?.load_microsoft_visemes,
      "microsoft pack is NOT staged here; requesting it raises",
    ).toBe(false);
    expect(d.loadTargets?.requiredFlags?.load_meta_visemes, "visemes02 IS staged and is the meta list").toBe(true);
  });

  it("(3) COUNTERWEIGHT: both citations resolve — the cited line contains the cited symbol", () => {
    // Refuses (d). An unresolved citation is a claim, not evidence.
    const d = doc();
    expect(resolvesTo(d.loadTargets), `${d.loadTargets?.file}:${d.loadTargets?.line} must contain "load_targets"`).toBe(true);
    expect(
      resolvesTo(d.configureLipSync),
      `${d.configureLipSync?.file}:${d.configureLipSync?.line} must contain "configure_lip_sync"`,
    ).toBe(true);
  });

  it("(4) VACUITY GUARD: the three target lists are identified by size", () => {
    const d = doc();
    expect(d.listSizes, "list sizes identify which list each flag selects").toEqual(EXPECTED_LIST_SIZES);
    expect(d.stagedPack, "only one pack is staged on this machine").toMatch(/visemes02/);
  });
});
