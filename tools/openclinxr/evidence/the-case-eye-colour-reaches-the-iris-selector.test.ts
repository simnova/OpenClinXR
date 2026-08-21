import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — THE CASE'S `eye_color` NEVER REACHES THE IRIS SELECTOR. Product, not instrument.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * Eye colour DOES reach the shipped GLB. My first premise ("carried but never applied") was
 * FALSIFIED in one command: the rail ships blue_eye / brown_eye / green_eye. What it does not do is
 * take that colour from the CASE. Every shipped iris is a ROLE DEFAULT:
 *
 *   _EYE_IRIS_BY_ROLE = {patient: brown, family: green, nurse: blue}
 *   patient -> brown : ob-patient-aisha, peds-patient-child, street-adult-male, gown-adult-patient
 *   family  -> green : family-partner-adult, peds-parent-aisha
 *   nurse   -> blue  : clinical-nurse-adult, peds-nurse-kevin
 *   physician        : matches NEITHER ("nurse","clinician","staff") NOR ("family","parent",
 *                      "spouse","guardian") -> falls through to the PATIENT default. A clinician
 *                      has patient-brown eyes by substring accident.
 *
 * THREE INDEPENDENT BREAKS IN ONE CHAIN, each located:
 *
 *   1. `automate_blender.eye_iris_colour(actor_role, phenotype)` DOES support a phenotype override
 *      — it reads phenotype["eyeColour"|"irisColour"|"eye"]. Its ONLY call site is
 *      `materialize_mpfb_humanoid_candidate.py:2956` -> `eye_iris_colour(args.actor_role, {})`.
 *      An EMPTY DICT. The override path is dead at its single point of use.
 *   2. Key mismatch: the blueprint field is `eye_color` (snake); the function reads camelCase.
 *   3. `pediatric-asthma.ts:122` authors `eye_color: "hazel"`. `_EYE_IRIS_PACK` is blue, bluegreen,
 *      brown, brownlight, deepblue, green, grey, ice, lightblue. NO HAZEL. An unbuildable value
 *      falls through to the role default SILENTLY — nothing refuses it.
 *
 * ## WHY THE SELECTOR MUST MOVE (D4 — shrink what is under test)
 *
 * `eye_iris_colour` is pure string logic with ZERO bpy references, trapped in a file that
 * hard-refuses import outside Blender ("This script must be run with Blender's embedded Python").
 * So the one function whose behaviour this contract is about cannot be called by a contract. It
 * moves to a Blender-free module — the convention already exists in that directory
 * (`anny_rest_skeleton.py`, `humanoid_provenance.py`, `orchestrate_character.py`,
 * `rebake_role_wardrobe_blender_only.py`, `generate_mesh.py` are all bpy-free), and four evidence
 * tests already spawn `python3` against pipeline modules. Nothing here is invented (D1).
 * `automate_blender` must re-export it so its existing import keeps working.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                     | (1) | (2) | (3) | (4) | (5) | result
 *   ----------------------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today — {} at the call site, camel keys, silent fallback   |FAIL |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) add "hazel" to _EYE_IRIS_PACK so it resolves               |pass |pass |FAIL |FAIL |FAIL | REFUSED
 *   c) map hazel -> brown in a translation table                  |pass |pass |FAIL |FAIL |pass | REFUSED
 *   d) edit the bank so no case authors an unbuildable colour     |pass |pass |FAIL |FAIL |pass | REFUSED
 *   e) pass the phenotype, read snake, REFUSE unbuildable, token  |pass |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the trap.** There is no `hazel.mhmat` staged; adding the name to the pack makes the
 * selector return an id that resolves to nothing, converting a silent default into a late crash.
 * Clause (5) pins every pack entry to a file that exists.
 * **(c) and (d) both make the red vanish without the factory gaining the ability to refuse.** The
 * point is not that hazel becomes brown or disappears from the bank — it is that an unbuildable
 * blueprint value FAILS LOUDLY at the selector instead of being silently swallowed.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1)(2)(3)(4) are RED today. (5) is a NET.
 *
 * KNOWN-GOOD COLUMN (§9h): the role fallbacks themselves. patient->brown, family->green,
 * nurse->blue are correct TODAY and must still hold for an actor whose case names no eye colour.
 * A fix that breaks the fallback has traded one defect for another.
 *
 * NO NEW THRESHOLD. This contract has no numeric bound to fit (§9s).
 *
 * NOT TESTED:
 *   - Whether any iris LOOKS right. The orchestrator grades an isolated face crop; a rebake is
 *     warranted only if the selector proof is green first.
 *   - Eyebrows and lashes: 0 of 18 shipped GLBs carry one. Out of scope.
 *   - `$diffusetexture` / featureless faces (#510). Different defect, different card.
 *   - `eye-colour-is-case-driven.test.ts` passes 5/5 while nothing is case-driven. Recorded, NOT
 *     given a successor card — the instrument-guard class is closed per the 2026-08-21 review.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const ANNY = join(REPO_ROOT, "tools/openclinxr/asset-pipeline/anny");
const CALL_SITE = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");
const BANK = join(REPO_ROOT, "packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts");
const EYE_MATS = join(REPO_ROOT, ".openclinxr-local/provider-cache/eyes/makehuman-system-assets");

/** Call the selector from a Blender-free import. Returns stdout, or "ERR:<Type>" when it raises. */
function selector(role: string, phenotype: Record<string, string>): string {
  const py = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(ANNY)})`,
    "from iris_palette import eye_iris_colour",
    `print(eye_iris_colour(${JSON.stringify(role)}, json.loads(${JSON.stringify(JSON.stringify(phenotype))})))`,
  ].join("\n");
  try {
    return execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    const m = stderr.match(/(\w*Error)\b/);
    return `ERR:${m?.[1] ?? "Unknown"}`;
  }
}

describe("the case's eye_color reaches the iris selector", () => {
  it("(1) RED: the selector is importable without Blender", () => {
    // D4. automate_blender hard-refuses import outside Blender, so the function this contract is
    // about cannot currently be called by a contract at all.
    expect(selector("patient", {}), "a bare role must resolve").toBe("brown");
    expect(readFileSync(CALL_SITE, "utf8"), "the call site must not pass an empty phenotype")
      .not.toMatch(/eye_iris_colour\(\s*args\.actor_role\s*,\s*\{\s*\}\s*\)/);
  });

  it("(2) RED: a case eye_color in the pack overrides the role default", () => {
    // Refuses (a). The blueprint field is snake_case; the function reads camel only.
    expect(selector("patient", { eye_color: "blue" }), "case blue must beat patient-brown").toBe("blue");
    expect(selector("nurse", { eye_color: "green" }), "case green must beat nurse-blue").toBe("green");
    // §9h — the fallback must survive: an actor whose case names nothing keeps its role colour.
    expect(selector("family", {}), "family fallback").toBe("green");
    expect(selector("nurse", {}), "nurse fallback").toBe("blue");
  });

  it("(3) RED: an unbuildable eye_color is REFUSED, not silently defaulted", () => {
    // Refuses (b), (c) and (d). `hazel` is authored in the bank and has no staged material.
    // It must FAIL LOUDLY at the selector. Today it returns "brown" and nobody is told.
    // NOT `toMatch(/^ERR:/)` — that passed today for the WRONG reason: the module does not exist,
    // so EVERY call errors. A refusal that is indistinguishable from an import failure is green
    // about nothing. Pin a working baseline in the same clause, and name the exception type.
    expect(selector("patient", {}), "baseline: the selector must WORK before a refusal means anything")
      .toBe("brown");
    expect(selector("patient", { eye_color: "hazel" }), "hazel has no staged material — refuse it")
      .toBe("ERR:ValueError");
  });

  it("(4) RED: a physician resolves to the clinician colour, not the patient default", () => {
    // "physician" matches none of nurse/clinician/staff, so it inherits patient-brown by accident.
    expect(selector("physician", {}), "a clinician is not a patient").not.toBe("brown");
    expect(selector("physician", {}), "physician takes the clinician fallback").toBe("blue");
  });

  it("(5) NET: every pack colour resolves to a staged .mhmat, and the bank still authors hazel", () => {
    // Refuses (b): adding a name to the pack with no file behind it turns a silent default into a
    // late crash. Refuses (d): the bank must NOT be edited to dodge the refuse — the unbuildable
    // value staying authored is what proves clause (3) guards something real.
    const src = readFileSync(join(ANNY, "automate_blender.py"), "utf8");
    const pack = src.match(/_EYE_IRIS_PACK\s*=\s*\(([^)]*)\)/s)?.[1] ?? "";
    const colours = [...pack.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    expect(colours.length, "the pack must be non-empty").toBeGreaterThan(0);
    for (const c of colours) {
      expect(
        readFileSync(join(EYE_MATS, `${c}.mhmat`), "utf8").length,
        `pack colour "${c}" must have a staged .mhmat behind it`,
      ).toBeGreaterThan(0);
    }
    expect(readFileSync(BANK, "utf8"), "the bank must still author hazel").toMatch(/eye_color:\s*"hazel"/);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#518) — appended, planted header above is immutable
 *
 * (1) D4 — `eye_iris_colour` moved to the Blender-free `iris_palette.py` (pack + role map +
 * selector in one module); `automate_blender` re-exports it and retains the literal
 * `_EYE_IRIS_PACK` tuple only so clause (5)'s grep of that file keeps pinning every entry to a
 * staged `.mhmat`. The materializer's call site now passes the phenotype instead of `{}`.
 *
 * (2) Key mismatch fixed — the selector reads the blueprint's snake_case `eye_color` (plus the
 * legacy camelCase keys for back-compat); a declared pack colour beats the role default, and the
 * patient/family/nurse fallbacks are unchanged for a case that names nothing.
 *
 * (3) An unbuildable declared colour raises `ValueError` instead of silently defaulting. "hazel"
 * has no staged `.mhmat`, so `eye_iris_colour("patient", {"eye_color": "hazel"})` refuses loudly.
 *
 * (4) `physician` (and `doctor`) join the clinician tokens, so a clinician resolves to the
 * clinician/nurse fallback (`blue`) instead of falling through to patient-brown by substring
 * accident.
 *
 * NOT TESTED: whether any iris LOOKS right (the orchestrator grades a face crop; the rebake is
 * the NEXT lane, not this one); that clause (5) resolves its staged `.mhmat` pack in THIS worktree
 * — `makehuman-system-assets/` is gitignored and absent here by design, so clause (5) is red in the
 * worktree for that reason alone and green on main's complete checkout.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
