import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SUBSTRATE — THE SESSION ID IS READ OUT OF THE CHILD'S MOUTH, SO A DEAD CHILD HAS NO NAME.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * `parseResult` (`dispatch-worker.ts:985-1044`) scrapes `sessionId` off the child's `end` event.
 * We never choose it. Three consequences, all in the tree:
 *
 *   :1231  `if (!parsed.sessionId)` throws — a child that dies before `end` leaves NO id at all.
 *   :1299  the contract-report path is KEYED on `parsed.sessionId` — no id, no report.
 *   :953   `recordSession` runs AFTER `spawn` (:1255) — the ledger entry never exists for a
 *          dispatch that dies early, which is why a killed dispatch cannot be looked up.
 *
 * The file's own header records the incident this already cost: on **issue-240** the worker
 * **completed and committed** (`c1ea344e`), then dispatch threw "Dispatch produced no sessionId"
 * before `recordSession` and before the post-exit proof re-run. No contract report was written,
 * `integrate` refused `contract-not-verified`, and manual `contract-verify-cli` recovery followed.
 *
 * I hit the same class four more times in one session: with no ledger entry the only recovery is
 * scavenging `~/.grok/sessions/<url-encoded-worktree>/` newest-first and grepping `updates.jsonl`
 * to confirm identity before daring to resume. A wrong id there does not error — it CONFABULATES,
 * because a fresh session loads project memory and answers confidently about someone else's work.
 *
 * ## THE FIX IS DOCUMENTED, NOT INVENTED
 *
 * `~/.grok/docs/user-guide/14-headless-mode.md`:
 *   `-s, --session-id <ID>` — Create a NEW session with this UUID (errors if invalid UUID or
 *   already in use); **does not resume, use `-r`/`-c`**.
 *
 * So the orchestrator generates the UUID, and the id exists BEFORE the process does. Verified
 * against the page by the superagent, not from my paraphrase.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — id scraped from the child's output              |FAIL | pass| pass| pass| REFUSED
 *   b) pass `--session-id` on resume too                       | pass|FAIL | pass| pass| REFUSED
 *   c) pass a non-UUID (slice id, timestamp)                   | pass| pass|FAIL | pass| REFUSED
 *   d) add `--session-id` but drop `--prompt-file`             | pass| pass| pass|FAIL | REFUSED
 *   e) UUID chosen up front; resume still uses `--resume`      | pass| pass| pass| pass| ALL PASS
 *
 * **(b) is the one to watch.** `-s` and `-r` look interchangeable and are not: `-s` CREATES. Using
 * it on a resume would silently fork a second session and the original transcript would be lost to
 * us — the same class as the confabulating-wrong-id failure this slice exists to end.
 *
 * **(d) is a regression guard.** #437 landed `--prompt-file` an hour ago because embedded flags on
 * `-p` hang dispatch entirely. A rewrite of `buildArgv` that reintroduces `-p` re-arms that hang.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (3) are RED** — corrected from probe output,
 * not prediction. I declared (1) sole; (3) also fails today because with no `--session-id` at all
 * both lookups yield `undefined` and `expect(undefined).not.toBe(undefined)` fails. (2) and (4)
 * pass today and are the nets.
 *
 * NOT TESTED: that grok honours the supplied UUID (the docs say it errors on a duplicate; unverified
 * here). That the ledger write moves before `spawn` — a separate change, deliberately not bundled.
 * Whether an early-death dispatch is then genuinely recoverable end-to-end; that needs a killed
 * dispatch to demonstrate and is the follow-up, not this contract.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const DISPATCHER = join(REPO_ROOT, "tools/openclinxr/openclaw/dispatch-worker.ts");
const SPECIFIER = ["../openclaw/dispatch", "worker.js"].join("-");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BuildArgv = (o: Record<string, unknown>) => string[];
const mod = (await import(SPECIFIER)) as { buildArgv?: BuildArgv };
const buildArgv = mod.buildArgv!;
const base = { prompt: "do the thing", model: "deepseek-v4-flash", maxTurns: 3, cwd: "/tmp/wt", slice: "issue-000" };

describe("dispatch chooses the session id before the child exists", () => {
  it("(1) RED: a fresh dispatch passes --session-id with a UUID", () => {
    const argv = buildArgv(base);
    const i = argv.indexOf("--session-id");
    expect(i, "--session-id must be passed so the id exists before the process").toBeGreaterThanOrEqual(0);
    expect(argv[i + 1], "the id must be a UUID — the docs reject anything else").toMatch(UUID_RE);
  });

  it("(2) COUNTERWEIGHT: a RESUME never passes --session-id", () => {
    // Refuses (b). -s CREATES; -r resumes. Conflating them silently forks a second session and
    // loses the transcript we were resuming for.
    const argv = buildArgv({ ...base, resume: "01a01844-1f39-72b3-8449-dcf9128691a6" });
    expect(argv, "resume must use --resume").toContain("--resume");
    expect(argv, "-s creates a NEW session and must not appear on a resume").not.toContain("--session-id");
  });

  it("(3) COUNTERWEIGHT: two dispatches do not share an id", () => {
    // Refuses (c) and any scheme keyed on the slice: grok errors if the UUID is already in use.
    const a = buildArgv(base);
    const b = buildArgv(base);
    const idA = a[a.indexOf("--session-id") + 1];
    const idB = b[b.indexOf("--session-id") + 1];
    expect(idA, "each dispatch needs its own id").not.toBe(idB);
  });

  it("(4) NET: #437's --prompt-file and the other flags are not regressed", () => {
    // Refuses (d). Reintroducing -p re-arms the embedded-flag hang that cost five dead dispatches.
    const argv = buildArgv(base);
    expect(argv, "the prompt must stay off argv").toContain("--prompt-file");
    expect(argv, "-p must not come back").not.toContain("-p");
    for (const f of ["--model", "--max-turns", "--cwd", "--output-format"]) {
      expect(argv, `${f} must survive`).toContain(f);
    }
    expect(readFileSync(DISPATCHER, "utf8"), "the prompt-file writer must remain").toMatch(/writePromptFile/);
  });
});
