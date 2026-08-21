import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — #356's ANTI-MONOPOLY CLAUSE IS A STALE PROXY AND IS NOW RED ON MAIN.
 *
 * ## THE DEFECT, MEASURED
 *
 * `#519` made the peds cast honour its authored `eye_color`. Graded on the shipped bytes at a
 * native 737x614 crop: parent GREEN -> BROWN, nurse BLUE -> BROWN. Correct, and the case is why:
 *
 *   actor                     case authors   shipped iris
 *   mpfb-peds-parent-aisha    brown          brown  4659691c7295
 *   mpfb-peds-nurse-kevin     brown          brown  4659691c7295
 *   mpfb-peds-patient-child   hazel          brown  4659691c7295   <- hazel unbuildable, role default
 *
 * `eye-colour-is-case-driven.test.ts:163` clause (1) then fails: "co-present actors do not all
 * share one iris". One distinct texture across three actors.
 *
 * ## THE GUARD'S OWN HEADER SAYS IT IS A PROXY — line 72, verbatim
 *
 *     "that the cast is not uniform. It cannot say that a given brown belongs to a given case."
 *
 * It was written for `#180` (`044c3c21`), whose shape was ONE HARDCODED COLOUR FOR EVERY ACTOR.
 * Uniformity was a usable stand-in for "hardcoded" while nothing read the case. **The factory now
 * reads the case**, so uniformity has stopped being evidence of a hardcode: three browns is a TRUE
 * statement about a bank that authors brown, brown, and an unbuildable hazel.
 *
 * A proxy that outlives the condition it stood for reports the product as broken when the product
 * became correct. That is what is red on main right now.
 *
 * ## WHAT REPLACES IT — check the CASE, not the variety
 *
 *   (a) every actor whose authored `eye_color` is IN the pack has that exact colour shipped;
 *   (b) two actors authoring DIFFERENT pack colours ship DIFFERENT irises.
 *
 * (b) preserves everything #180 and #356 were defending: a hardcode cannot satisfy it, because a
 * hardcode gives one texture to two different authored colours. Uniformity is permitted only when
 * the CASE is uniform, which is exactly the distinction the old clause could not draw.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                   | (1) | (2) | (3) | result
 *   --------------------------------------------------------------|-----|-----|-----|--------
 *   a) delete clause (1)                                        |FAIL |pass |pass | REFUSED
 *   b) weaken it to `distinct >= 1`                             |FAIL |pass |pass | REFUSED
 *   c) edit the bank so the adults differ                       |pass |pass |FAIL | REFUSED
 *   d) invent Maya's colour so the cast varies                  |pass |pass |FAIL | REFUSED
 *   e) re-key the clause to the case per (a)+(b)                |pass |pass |pass | ALL PASS
 *
 * **(a) and (b) are the same surrender** — merge-kill kills `deleted-test`, and `distinct >= 1` is
 * true of any tree including a hardcoded one. **(c) and (d) are identity decisions** about a
 * specific paediatric patient and two clinicians; they belong to the operator under D13, not to a
 * worker and not to me. Clause (3) pins the bank unchanged.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are RED today. (3) is a NET.
 *
 * KNOWN-GOOD COLUMN (§9h): parent and nurse both author `brown` and both ship `4659691c7295` —
 * the case IS satisfied today, which is why the replacement clause must pass while the old one
 * fails. That divergence is the whole finding.
 *
 * NOT TESTED:
 *   - Whether a uniform-eyed cast is GOOD. It is faithful; whether it is desirable is an authoring
 *     question, and it is the second live blocker for the options+provenance artifact after `hazel`.
 *   - Maya's colour. Unbuildable, refused loudly, operator's to pick (D13).
 *   - Clauses (2), (3), (3b), (3c) of that file. Untouched and must stay so.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "eye-colour-is-case-driven.test.ts");
const BANK = join(HERE, "../../../packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts");

describe("the iris guard checks the case, not uniformity", () => {
  it("(1) RED: the guard no longer fails merely because the cast is uniform", () => {
    const src = readFileSync(GUARD, "utf8");
    // The old proxy: `distinct >= 2` over the whole cast, regardless of what the case says.
    expect(/distinct\s*>=\s*2/.test(src), "the bare uniformity proxy must be gone").toBe(false);
    // And the clause must still exist — merge-kill kills a deleted test, and so does this.
    expect(/it\(\s*["'`]\(1\)/.test(src), "clause (1) must be rewritten, never removed").toBe(true);
  });

  it("(2) RED: the guard checks an authored colour against the shipped iris", () => {
    // CODE ONLY. Matching the whole file matched the HEADER PROSE and passed today for the wrong
    // reason — §7k, a marker check in my own plant. Comments are stripped before matching.
    const code = readFileSync(GUARD, "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    expect(
      /eye_color|authoredColour|authored_colour/i.test(code),
      "the replacement must READ what the case authors, not just count textures",
    ).toBe(true);
    expect(
      /not\.toBe|!==|toEqual/.test(code),
      "and must still require two actors authoring DIFFERENT pack colours to ship different irises",
    ).toBe(true);
  });

  it("(3) NET: the bank is unedited and Maya's colour is not invented", () => {
    // Refuses (c) and (d). Making the cast vary by changing authored identity is an operator
    // decision under D13, not a way to buy a green.
    const bank = readFileSync(BANK, "utf8");
    expect(bank, "Maya still authors hazel").toMatch(/eye_color:\s*"hazel"/);
    expect((bank.match(/eye_color:\s*"brown"/g) ?? []).length, "both adults still author brown").toBe(2);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#520) — appended; the planted header above is immutable
 *
 * Clause (1)/(2) flipped: `eye-colour-is-case-driven.test.ts` clause (1) no longer carries the
 * cast-wide distinctness proxy; it reads bank `eye_color` / `authoredColour` and requires (a)
 * pack-authored colours to match shipped iris sha and (b) different pack colours to differ
 * (`not.toBe` fixture). Bank still authors hazel + two browns. Clauses (2)/(3)/(3b)/(3c) of the
 * guard file untouched.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
