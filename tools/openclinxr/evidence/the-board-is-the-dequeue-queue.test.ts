import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as ts from "typescript";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main cd51020a — do not re-derive these rows
 *
 * `agents/rules/EXEC_REHYDRATE.md:37-39` already specifies the standard, verbatim:
 *
 *   > HOT (operational / collaboration) -> GitHub via `gh` CLI: task delegation + decomposition
 *   > (issues + role sub-tasks), agent-to-agent communication (comments), review + feedback,
 *   > status roll-up and **dequeue queue (project board)**. Concurrency-safe — each agent writes
 *   > its OWN issue/comment/review.
 *
 * Half of that is real. Issues ARE the substrate: `briefFromIssue` parses the body,
 * `## factory_step:` and `## done_when` come from it, the close carries CLAIM + NOT TESTED.
 * The other half — the board as dequeue queue, and workers with a voice — is not wired.
 *
 * ## MEASURED, four separate holes
 *
 * **1. `role` is optional, so the worker never gets its charter or its status directive.**
 *   `dispatch-worker.ts:129,208` declare `role?: string`, and `:1272` composes the charter
 *   appendix ONLY `if (options.role)`. The ledger for this campaign:
 *
 *     issue-440  role=openclaw-drift-police   <- composed
 *     issue-441 .. issue-447  role=None       <- SEVEN dispatches, appendix empty
 *
 *   `WORKER_STATUS_REPORTING_DIRECTIVE` (`worker-directives.ts:56`) is reached only through
 *   `buildRepoAgentSpawnPrompt` (`grok-repo-agent-spawn.ts:27,86,240`), which the appendix calls.
 *   The constant is NOT unwired — I claimed that and withdrew it. **The call site omitted `role`.**
 *
 * **2. Nothing writes the Factory field.** Board 7 carries 460 items and the field exists with
 *   exactly [Idle, Planted, Dispatched, Landed, Graded]. Occupancy measured:
 *
 *     unset  449      Landed  11      Planted 0   Dispatched 0   Graded 0
 *
 *   Zero occurrences of `item-edit` or `--single-select-option-id` anywhere in
 *   `tools/openclinxr/openclaw/**`. The dequeue queue the rules name has no writer.
 *
 * **3. `integrate()` never checks that the worker said anything.** Zero matches for
 *   `issue/comments`, `issue comment` or `workerComment` in `integrate.ts`. A slice can land
 *   with the worker mute — and all seven did. Comment authors on #441-#446 are `gidich` (me)
 *   on every one; #447 has zero.
 *
 * **4. `board-cli.ts` has no `item-add`.** It can create issues, comment, close, review and
 *   merge. It cannot put a card on the board. Membership currently depends on GitHub's
 *   Auto-add workflow, which is enabled but is not something this repo asserts.
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h)
 *
 * `issue-440` is the one dispatch in the ledger that passed a role
 * (`openclaw-drift-police`). It is the only evidence in this tree that the composed path
 * works end to end, and clause (5) pins it so a later edit cannot quietly drop role support
 * and leave every clause vacuous. There is exactly one such row — stated, not papered over.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) | (2) | (3) | (4) | (5) | result
 *   ---------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today                                           |FAIL |FAIL |FAIL |pass |pass | REFUSED
 *   b) default `role` to a placeholder when omitted    |pass |FAIL |FAIL |pass |pass | REFUSED
 *   c) re-author the directive inside dispatch-worker  |pass |FAIL |FAIL |**FAIL**|pass| REFUSED
 *   d) let a worker set Factory itself                 |pass |pass |pass |**FAIL**|pass| REFUSED
 *   e) require role; dispatcher/integrator own Factory |pass |pass |pass |pass |pass | ALL PASS
 *
 * **(b) is the tempting one.** A default silences the failure and reinstates exactly the state
 * that produced seven mute workers — a role that is present but meaningless composes a charter
 * for the wrong agent. Clause (1) requires a REFUSAL, not a fallback.
 *
 * **(c) is already forbidden elsewhere** and is repeated here because it is the obvious way to
 * make workers speak: copy the directive text into the dispatcher. `the-worker-is-told-to-
 * report-on-its-own-card.test.ts` refuses it as a D1 violation — the baker owns that text.
 * Clause (4) pins the single-source-of-truth.
 *
 * **(d) is the dangerous one.** Letting the worker write the project field would make clause (3)
 * green while handing an unsupervised agent the dequeue queue. EXEC_REHYDRATE scopes a worker to
 * its OWN card: comments only, never close, labels or fields.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — both substitutions MATCHED the table
 *
 * Mutated the sources, ran, restored from backups.
 *
 *   cheat (c) copy the directive text into dispatch-worker.ts AND add a real role assert
 *             -> clause (1) GREENS on the assert, clause (4) FIRES on the copied text
 *   cheat (d) grant the worker `--single-select-option-id` in the directive
 *             -> clause (4) FIRES
 *
 * (c) is the instructive one: the honest half of that cheat (the assert) genuinely satisfies
 * clause (1), and only clause (4) separates "made workers speak correctly" from "made workers
 * speak by copying the baker's text". Without (4) this contract would accept the D1 violation
 * that `the-worker-is-told-to-report-on-its-own-card` already forbids.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3) are REDS — role is optional, no Factory writer exists, integrate has no comment check.
 *   (4) PASSES TODAY — the directive still has exactly one definition and one composing caller.
 *       Pure net against (c) and (d).
 *   (5) PASSES TODAY — it reads the issue-440 ledger row. Pure vacuity guard.
 *
 * NOT TESTED:
 *   - **That a worker will actually comment.** This asserts the mechanism reaches the prompt and
 *     that a mute landing is refused. Whether a given model chooses to write is not gateable.
 *   - **Board membership by Auto-add.** Clause (2) asserts a writer exists, not that GitHub's
 *     workflow stays enabled. If Auto-add is turned off, membership silently depends on the
 *     `item-add` this slice asks for.
 *   - **The 11 `Landed` cards.** Set before this session by something I have not identified.
 *   - **Whether the board is the right substrate at all.** That is the operator's call and it is
 *     already made; this slice implements it, it does not evaluate it.
 */
/**
 * ## QUALIFICATION (2026-10-27, portable contract proposal)
 *
 * The header above is the immutable 2026-08-19 historical record: a real-campaign report
 * measured against the live ledger (issue-440 with role openclaw-drift-police plus rows
 * without roles). That live ledger is gitignored private state and is NOT read here.
 * Clause (5) in THIS file is synthetic: it writes an explicit synthetic ledger to a unique
 * mkdtemp root per test with cleanup, in the exact worker-sessions.jsonl shape, carrying
 * one row with a real role alongside rows without roles. No historical IDs are reused.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");

const DISPATCH = join(REPO_ROOT, "tools/openclinxr/openclaw/dispatch-worker.ts");
const INTEGRATE = join(REPO_ROOT, "tools/openclinxr/openclaw/integrate.ts");
const BOARD_CLI = join(REPO_ROOT, "tools/openclinxr/openclaw/board-cli.ts");
const DIRECTIVES = join(REPO_ROOT, "packages/openclinxr/agent-loop/src/worker-directives.ts");

const BLOCK = /\/\*[\s\S]*?\*\//gu;
const LINE = /^[ \t]*\/\/.*$/gmu;
/** Comment-stripped source — a symbol in a docstring is not a call site (the #397 trap). */
const code = (p: string): string => readFileSync(p, "utf8").replace(BLOCK, "").replace(LINE, "");

const dispatchSrc = code(DISPATCH);
const integrateSrc = code(INTEGRATE);
const boardSrc = code(BOARD_CLI);

const tmpRoots: string[] = [];

/** Minimal pure string-expression evaluator: string/template literals plus `+` only. */
function evalStringExpr(node: ts.Expression): string {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return evalStringExpr(node.left) + evalStringExpr(node.right);
  }
  if (ts.isParenthesizedExpression(node)) return evalStringExpr(node.expression);
  throw new Error(`unsupported directive initializer: ${ts.SyntaxKind[node.kind]}`);
}

/** Exact top-level `export const NAME = <pure string expr>` value via the TypeScript AST. */
function readDirectiveValue(sourcePath: string, name: string): string {
  const program = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true);
  for (const stmt of program.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (decl.name.getText(program) === name) {
        if (!decl.initializer || !ts.isExpression(decl.initializer)) throw new Error(`no initializer for ${name}`);
        return evalStringExpr(decl.initializer);
      }
    }
  }
  throw new Error(`top-level const ${name} not found in ${sourcePath}`);
}
afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

function writeSyntheticLedger(): string {
  const root = mkdtempSync(join(tmpdir(), "board-ledger-"));
  tmpRoots.push(root);
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  const rows = [
    { slice: "issue-603001", sessionId: "sess-no-role-1", phase: "completed", proofsOk: true, proofs: [] },
    { slice: "issue-603002", sessionId: "sess-no-role-2", phase: "completed", proofsOk: true, proofs: [] },
    { slice: "issue-603003", sessionId: "sess-no-role-3", phase: "completed", proofsOk: true, proofs: [] },
    { slice: "issue-603004", sessionId: "sess-no-role-4", phase: "completed", proofsOk: true, proofs: [] },
    { slice: "issue-603005", sessionId: "sess-no-role-5", phase: "completed", proofsOk: true, proofs: [] },
    { slice: "issue-603006", sessionId: "sess-no-role-6", phase: "completed", proofsOk: false, proofs: [] },
    { slice: "issue-603007", sessionId: "sess-synth-role", phase: "completed", proofsOk: true, proofs: [], role: "openclaw-drift-police" },
  ];
  writeFileSync(
    join(root, ".openclinxr/openclaw/worker-sessions.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  return join(root, ".openclinxr/openclaw/worker-sessions.jsonl");
}

describe("the board is the dequeue queue, and workers have a voice", () => {
  it("(1) RED: dispatch refuses a slice with no role", () => {
    // Refuses (b): a DEFAULT reinstates seven mute workers with a charter for the wrong agent.
    // The refusal must be a hard fail before spawn, like assertLoopNotPaused and
    // assertIntegrateHeadUsable already are.
    expect(
      /assertDispatchRole|requireDispatchRole|role is required|assertKnownRole/u.test(dispatchSrc),
      `dispatch-worker.ts declares role?: string (lines 129, 208) and composes the charter only `
        + `if (options.role) at :1272 — seven dispatches this campaign passed role=None and their `
        + `workers got no charter and no status directive. A missing or unknown role must FAIL CLOSED, not default`,
    ).toBe(true);
  });

  it("(2) RED: something writes the Factory field", () => {
    // Board 7: 460 items, Factory [Idle|Planted|Dispatched|Landed|Graded], occupancy
    // unset 449 / Landed 11 / everything else 0. The dequeue queue has no writer.
    const anyWriter = [dispatchSrc, integrateSrc, boardSrc].some((s) =>
      /single-select-option-id|item-edit|setFactoryField|writeFactory/u.test(s),
    );
    expect(
      anyWriter,
      `no Factory writer in dispatch-worker.ts, integrate.ts or board-cli.ts — dispatch must set `
        + `Dispatched and integrate must set Landed, or the board can never be the dequeue queue the rules name`,
    ).toBe(true);
  });

  it("(3) RED: integrate refuses a landing whose worker never spoke", () => {
    // All seven campaign slices landed with the worker mute. Comment authors on #441-#446 are
    // the orchestrator on every one; #447 has none.
    expect(
      /issue\/comments|issueComments|workerComment|assertWorkerReported/u.test(integrateSrc),
      `integrate.ts has zero references to issue comments — a slice can land with its worker silent, `
        + `which is how #443's self-referencing clause and #447's proof-order defect reached me only `
        + `because I read the diff`,
    ).toBe(true);
  });

  it("(4) COUNTERWEIGHT: the status directive still has ONE definition and ONE composer", () => {
    // Refuses (c) copying the text into the dispatcher, and (d) inventing a second write path.
    // The baker owns this string (D1); dispatch composes it through the charter appendix.
    const defn = code(DIRECTIVES);
    expect(defn.includes("WORKER_STATUS_REPORTING_DIRECTIVE"), "the directive must keep its single definition").toBe(true);
    expect(
      /comment on your OWN issue/u.test(dispatchSrc),
      `the directive text was copied into dispatch-worker.ts — the baker owns it (D1); compose it via the role appendix`,
    ).toBe(false);
    expect(
      /gh issue close|--single-select-option-id/u.test(defn),
      `the worker directive must not grant close or project-field writes — EXEC_REHYDRATE scopes a worker to comments on its own card`,
    ).toBe(false);
  });

  it("(5) VACUITY GUARD: the seeded role composes through the real role support", async () => {
    // Synthetic ledger in the exact worker-sessions.jsonl shape: rows without roles plus one
    // row carrying the real canonical role openclaw-drift-police. The guard binds to the
    // actual exported role support: assertDispatchRole(role, REPO_ROOT) accepts it,
    // and the directive VALUE is read from the DIRECTIVES source via the TypeScript AST;
    // buildRoleCharterAppendix(role, REPO_ROOT) is non-empty and carries the shared
    // worker status directive, and missing/unknown roles reject. No dispatch, spawn,
    // network, or main-ledger read; temp root holds only the synthetic ledger.
    const LEDGER = writeSyntheticLedger();
    const rows = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim().length > 0);
    expect(rows.length, "the synthetic ledger must hold rows with and without roles").toBeGreaterThan(5);
    const withRole = rows.filter((l) => l.includes('"role":"openclaw-drift-police"'));
    expect(withRole.length, "synthetic ledger must seed the canonical role").toBeGreaterThan(0);
    const mod = (await import("../openclaw/dispatch-worker.js")) as {
      assertDispatchRole: (role: string | undefined, repoRoot: string) => void;
      buildRoleCharterAppendix: (role: string, repoRoot?: string) => string;
    };
    expect(() => mod.assertDispatchRole("openclaw-drift-police", REPO_ROOT)).not.toThrow();
    const appendix = mod.buildRoleCharterAppendix("openclaw-drift-police", REPO_ROOT);
    expect(appendix.length, "baked charter must be non-empty for the canonical role").toBeGreaterThan(0);
    const directiveValue = readDirectiveValue(DIRECTIVES, "WORKER_STATUS_REPORTING_DIRECTIVE");
    expect(directiveValue.length, "shared worker directive must be non-empty").toBeGreaterThan(0);
    expect(appendix, "baked charter must carry the actual shared status directive").toContain(directiveValue);
    expect(() => mod.assertDispatchRole(undefined, REPO_ROOT)).toThrow(/role is required/);
    expect(() => mod.assertDispatchRole("not-a-real-role", REPO_ROOT)).toThrow(/not a dispatchable repo role/);
  });
});
