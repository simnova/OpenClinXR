/**
 * #501 — the injected worker directive names a comment shape the land gate REFUSES.
 *
 * MEASURED 2026-08-21 (orchestrator, from the live board). IMMUTABLE — flip the assertions and
 * append a `## FIXED (#501)` block below; do not rewrite these tables.
 *
 * WHAT EVERY DISPATCHED WORKER IS TOLD — worker-directives.ts:56-59, the ONLY instruction it
 * receives about commenting:
 *
 *   "comment on your OWN issue (`gh issue comment <n>`) with UNABLE:, any proof that cannot pass
 *    as written, and a `Factory: Dispatched|Landed` line."
 *
 * It never mentions the four report headers.
 *
 * WHAT THE GATE ACCEPTS — integrate.ts:384 + :441-443, either of:
 *   WORKER_REPORT_MARKERS = /(UNABLE:|cannot pass|Factory: Dispatched)/i     <- "Landed" ABSENT
 *   isWorkerReport(body)  = the IN-SCOPE/OUT-OF-SCOPE/CLAIM/NOT TESTED skeleton
 *
 * So a worker that follows the directive VERBATIM on a clean slice — no UNABLE, no unpassable
 * proof, so it writes only `Factory: Landed` — matches neither path and the land is refused.
 *
 * MEASURED ON THE LIVE BOARD, four real comment shapes, all from real slices:
 *
 *   #480  "Factory: Landed"                     15 B, no prose   AUTOMATION field write  MUST REFUSE
 *   #491  IN-SCOPE + CLAIM + NOT TESTED        2932 B, no OUT-OF-SCOPE                   MUST REFUSE
 *   #498  "Factory: Landed" + prose             278 B, no headers                        MUST REFUSE
 *   #483  all four headers                     1923 B                                    MUST ACCEPT
 *
 * #491's refusal was CORRECT — the missing OUT-OF-SCOPE slot is the one that produced the
 * 115,194-vertex footwear finding. #480 is why `Factory:` was narrowed to `Factory: Dispatched`
 * in the first place. So THE GATE IS NOT THE DEFECT and must not be loosened: three of these four
 * refusals are right. The defect is that the DIRECTIVE tells workers to write the one shape that
 * is refused.
 *
 * Cost: every occurrence spends a resume on work that was already complete and already verified
 * (#498 landed unchanged after the resume). This is `§6d` — a prose instruction that disagrees
 * with a contract loses, and the worker is right to follow its proofs.
 *
 * claimScope: whether the injected directive's stated comment shape is one the land gate accepts.
 * notEvidenceFor: whether any worker actually reports well, or that the gate's own logic is right.
 *
 * ## FIXED (#501)
 *
 * The directive (worker-directives.ts:56-59) now names all four report headers, so a clean slice
 * following it verbatim writes IN-SCOPE:/OUT-OF-SCOPE:/CLAIM:/NOT TESTED: and the gate accepts
 * the comment. The gate itself is UNTOUCHED — `Factory: Landed` alone (the board field write) and
 * a three-header report still refuse, asserted by clause (3). Clauses (1) and (2) flipped green
 * with the directive change; the 4500-char spawn-prompt budget test still passes for all roles
 * (architect 4464→4482, the tightest). #498's shape — `Factory: Landed` + prose, no headers — is
 * still refused because the directive no longer offers that as the report shape.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertWorkerReported } from "../openclaw/integrate.js";

const DIRECTIVE_SRC = "packages/openclinxr/agent-loop/src/worker-directives.ts";
const REQUIRED = ["IN-SCOPE:", "OUT-OF-SCOPE:", "CLAIM:", "NOT TESTED:"] as const;

/** Real comment bodies, copied from the shapes measured on the live board. */
const AUTOMATION_FIELD_WRITE = "Factory: Landed";
const DIRECTIVE_VERBATIM = "Factory: Landed\n\nreadMhcloLayering added to fit-cli.ts. Contract 4/4.";
const THREE_HEADERS = "IN-SCOPE:\n- did the thing\n\nCLAIM:\nit works\n\nNOT TESTED:\nthe rest";
const FOUR_HEADERS = "IN-SCOPE:\n- did the thing\n\nOUT-OF-SCOPE:\n- saw a separate defect\n\nCLAIM:\nit works\n\nNOT TESTED:\nthe rest";

/** Drive the real gate with a stubbed `gh`, so this measures integrate.ts and not a copy of it. */
function gateAccepts(body: string): boolean {
  const runner = (argv: string[]): string => {
    if (argv[1] === "api") return "gidich";
    return JSON.stringify([{ author: { login: "gidich" }, body }]);
  };
  return assertWorkerReported(process.cwd(), "issue-483", runner) === null;
}

describe("#501 the worker directive names a shape the land gate accepts", () => {
  it("the fixtures are not vacuous — the gate discriminates between them", () => {
    expect(gateAccepts(FOUR_HEADERS)).toBe(true);
    expect(gateAccepts(AUTOMATION_FIELD_WRITE)).toBe(false);
  });

  it(
    "(1) the injected directive names all four report headers a clean slice must write",
    () => {
      const src = readFileSync(DIRECTIVE_SRC, "utf8");
      const directive = src.slice(src.indexOf("WORKER_STATUS_REPORTING_DIRECTIVE"));
      for (const header of REQUIRED) {
        expect(directive, `directive never names ${header}`).toContain(header);
      }
    },
  );

  it(
    "(2) a clean slice following the directive VERBATIM satisfies the gate — comment built from what the directive itself names",
    () => {
      // Derived from the directive text, NOT hardcoded: whatever headers the directive tells a
      // worker to write, a comment containing exactly those must be accepted. Today it names
      // none, so a clean slice is left with the Factory line alone and the gate refuses it.
      const src = readFileSync(DIRECTIVE_SRC, "utf8");
      const directive = src.slice(src.indexOf("WORKER_STATUS_REPORTING_DIRECTIVE"), src.indexOf("WORKER_STATUS_REPORTING_DIRECTIVE") + 900);
      const named = REQUIRED.filter((h) => directive.includes(h));
      const body = `Factory: Landed\n\n${named.map((h) => `${h}\n- content`).join("\n\n")}`;
      expect(gateAccepts(body)).toBe(true);
    },
  );

  it(
    "(3) COUNTERWEIGHT: the gate is NOT loosened — the automation field write and a report missing OUT-OF-SCOPE both stay refused",
    () => {
      expect(gateAccepts(AUTOMATION_FIELD_WRITE), "#480 bare automation write must stay refused").toBe(false);
      expect(gateAccepts(THREE_HEADERS), "#491 missing OUT-OF-SCOPE must stay refused").toBe(false);
    },
  );
});
