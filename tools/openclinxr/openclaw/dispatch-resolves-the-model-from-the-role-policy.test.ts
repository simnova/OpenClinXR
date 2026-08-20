import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildArgv } from "./dispatch-worker.js";

/**
 * #462 — dispatch silently downgrades every write role to flash.
 *
 * ## MEASURED
 *
 * `dispatch-worker.ts` defaults the model to flash at **five** sites — `:660`, `:1020`, `:1339`,
 * `:1342`, `:1353` — with no reference to the role:
 *
 *     argv.push("--model", options.model ?? "deepseek-v4-flash");
 *
 * `role-harness-policy.ts` already maps tier -> `grok: { model }` (`:157` fast_bounded,
 * `:164` standard_execution, `:171` expert_review, `:178` frontier_thinking), and
 * **`dispatch-worker.ts:26` already imports `getRepoRoleHarnessPolicy`.** The map is in scope and
 * unused for this decision.
 *
 * `assertDispatchRole` (`:575`) throws on a missing role and on a role with no charter — earned
 * after #441-#447 shipped roleless. **It says nothing about the model.** Probed: three roles of
 * three different tiers all accepted, nothing checks the model.
 *
 * Consequence, measured on this session's ledger: **five consecutive write slices** dispatched
 * `xr-systems-architect` (standard_execution -> pro) and every one ran **flash**. No warning, no
 * log line, no gate. The orchestrator's intention was the only thing standing between the registry
 * and the wire, and it lost five times out of five.
 *
 * ## DOWNGRADE IS A RANK, NOT "FLASH IS WRONG"
 *
 * `fast_bounded` and `expert_review` roles map to flash BY POLICY — `openclaw-drift-police` and
 * `productivity-skeptic` on flash are correct and must stay allowed with no ceremony. The refusal
 * is a role whose policy names a HIGHER tier being run on a lower one. Rank:
 * `deepseek-v4-flash < deepseek-v4-pro < grok-build`.
 *
 * ## THE ROLELESS PATH STAYS FLASH-FIRST, AND ITS TEST STAYS GREEN
 *
 * `dispatch-worker.test.ts:132` — *"defaults to flash-first model — frontier / pro are opt-in per
 * task"* — calls `buildArgv({ prompt: "x" })` with **no role**. That is the low-level roleless
 * path and flash-first is right for it. **Do not flip that test.** I checked before assuming; the
 * superagent's brief said to flip it and the call site says otherwise.
 *
 * ## THE FOURTH SURFACE — this fix DEADLOCKS THE CRON WITHOUT IT
 *
 * `.openclinxr/openclaw/superagent-loop-prompt.md:16` says, every cycle:
 *
 *     dispatch({ worktree: true, role, model: deepseek-v4-flash })
 *
 * That is an EXPLICIT model, so clause (2)'s throw would refuse every autonomous dispatch until it
 * changes. It is in this slice deliberately — a gate that bricks the loop it guards is not a gate.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 *   (1) RED — a standard_execution role with NO model must resolve to its policy model.
 *   (2) RED — that role with an explicit lower tier and no stated reason must THROW.
 *   (3) RED — the cron prompt must stop hardcoding the model.
 *   (4) NET — an explicit downgrade WITH a reason is allowed. **I predicted this would fail today
 *             and it PASSES**: `buildArgv` ignores the unknown `modelDowngradeReason` field and
 *             honours the explicit flash. It must keep passing once the field is actually consumed.
 *             Corrected here rather than left as a wrong prediction in a planted header.
 *   (5) NET — a fast_bounded role on flash is IN POLICY and needs no reason. Passes today.
 *   (6) NET — the roleless path still yields flash. Passes today and must keep passing.
 *   (7) GUARD — the tier ranks are distinct, so "downgrade" means something.
 *
 * ## THE CHEAPEST FIXES THIS REFUSES
 *
 *   a) hardcode pro instead of flash            -> (5)/(6) fail; fast_bounded and roleless want flash
 *   b) patch only `:660` and leave four sites   -> (1) checks argv, but the ledger at `:1020` and
 *      the vision appendix at `:1339/:1342/:1353` would still read flash — resolve ONCE, call it
 *      from all five
 *   c) warn instead of throw                    -> (2) fails; a warning is what five slices ignored
 *   d) delete the flash-first test              -> merge-kill refuses `deleted-test`; it is correct
 *      for the roleless path and stays
 *   e) drop the cron line entirely              -> (3) wants the MODEL gone, not the dispatch
 *
 * NOT TESTED:
 *   - Role-against-lane. The portfolio table is not machine-readable and a parser for it is the
 *     instrument-building this project already has too much of. A log line naming role+tier+model
 *     is the whole ask.
 *   - Whether pro actually produces better work than flash. This asserts the registry is obeyed,
 *     never that the registry is right.
 *   - Codex/Cursor harness routing; `.codex/agents/*.toml` is untouched.
 *   - The Claude per-prompt directive (a separate, prose surface).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const LOOP_PROMPT = join(REPO_ROOT, ".openclinxr/openclaw/superagent-loop-prompt.md");
const DISPATCH_SRC = join(HERE, "dispatch-worker.ts");

/** standard_execution -> deepseek-v4-pro per role-harness-policy.ts:164. */
const WRITE_ROLE = "xr-systems-architect";
/** fast_bounded -> deepseek-v4-flash per role-harness-policy.ts:157. Flash here is IN POLICY. */
const SCOUT_ROLE = "openclaw-drift-police";
const FLASH = "deepseek-v4-flash";
const PRO = "deepseek-v4-pro";

const modelOf = (argv: string[]): string | undefined => argv[argv.indexOf("--model") + 1];

describe("dispatch resolves the model from the role policy", () => {
  it("(1) RED: a standard_execution role with no model resolves to its policy tier", () => {
    const argv = buildArgv({ prompt: "x", role: WRITE_ROLE } as never);
    expect(
      modelOf(argv),
      `${WRITE_ROLE} is standard_execution -> ${PRO}; five write slices this session silently ran `
        + `${FLASH} because the default ignores the role`,
    ).toBe(PRO);
  });

  it("(2) RED: an explicit tier downgrade with no stated reason throws", () => {
    // Refuses (c). A warning is exactly what five consecutive slices did not notice.
    expect(
      () => buildArgv({ prompt: "x", role: WRITE_ROLE, model: FLASH } as never),
      `running a standard_execution role on ${FLASH} must fail closed and name the reason`,
    ).toThrow(/downgrade|reason/iu);
  });

  it("(3) RED: the cron loop prompt no longer hardcodes the model", () => {
    // Refuses (e). The dispatch call stays; the MODEL argument goes, so policy fills it.
    const src = readFileSync(LOOP_PROMPT, "utf8");
    expect(
      /model:\s*deepseek-v4-flash/u.test(src),
      `superagent-loop-prompt.md pins an explicit ${FLASH}; with clause (2) live that would refuse `
        + `every autonomous dispatch — a gate that bricks the loop it guards is not a gate`,
    ).toBe(false);
    expect(src, "the dispatch call itself stays").toMatch(/dispatch\(\{/u);
  });

  it("(4) COUNTERWEIGHT: a declared downgrade is allowed and is recorded", () => {
    const argv = buildArgv({
      prompt: "x",
      role: WRITE_ROLE,
      model: FLASH,
      modelDowngradeReason: "bounded mechanical edit, measured on #NNN",
    } as never);
    expect(modelOf(argv), "a named downgrade is honoured, not silently upgraded").toBe(FLASH);
  });

  it("(5) COUNTERWEIGHT: a fast_bounded role on flash is in policy and needs no reason", () => {
    // Refuses (a). Hardcoding pro would break every scout.
    const argv = buildArgv({ prompt: "x", role: SCOUT_ROLE } as never);
    expect(modelOf(argv), `${SCOUT_ROLE} is fast_bounded -> ${FLASH}, no ceremony`).toBe(FLASH);
    expect(() => buildArgv({ prompt: "x", role: SCOUT_ROLE, model: FLASH } as never)).not.toThrow();
  });

  it("(6) COUNTERWEIGHT: the roleless path still defaults to flash-first", () => {
    // Refuses (d). dispatch-worker.test.ts:132 pins this and is CORRECT for the low-level path.
    expect(modelOf(buildArgv({ prompt: "x" } as never)), "roleless stays flash-first").toBe(FLASH);
  });

  it("(7) VACUITY GUARD: the tiers are distinct, so 'downgrade' has meaning", () => {
    expect(PRO).not.toBe(FLASH);
    const src = readFileSync(DISPATCH_SRC, "utf8");
    expect(
      src.includes("getRepoRoleHarnessPolicy"),
      "the policy map is already imported at :26 — this slice uses it, it does not add it",
    ).toBe(true);
  });
});
