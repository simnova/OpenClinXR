import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SUBSTRATE — THE PROMPT ON `-p` IS RE-SCANNED FOR FLAGS, AND IT HANGS DISPATCH.
 *
 * ## THE DEFECT, MEASURED — do not re-derive this
 *
 * Composing the role charter into the dispatched prompt hung `dispatch()` five times: no grok child
 * EVER spawned, the process sat alive past 90s, and there was no exception. Three of my hypotheses
 * died against measurement:
 *
 *   NOT length     2,843 chars of padding through dispatch() SPAWNS; 1,421 chars of appendix does not
 *   NOT metachars  appendix with backticks/quotes/$ stripped still HANGS; padding WITH them SPAWNS
 *   NOT newlines   the 400-char prefix (spawns) and 800-char prefix (hangs) both contain exactly 2
 *
 * The trigger is appendix chars 400-800. **The only two flag-looking tokens in the entire appendix —
 * `--output-logs` and `--filter` — are inside that window**, and the 0-400 prefix that spawns
 * contains none. The prompt is passed as the value of `-p`, so those embedded flags reach grok's own
 * argument scan.
 *
 * ## THE DISCRIMINATING TEST, ALREADY RUN
 *
 *   compose ON, prompt via `-p`            -> no grok child, 5 times
 *   compose ON, prompt via `--prompt-file` -> **spawned**, 22.6s, reached the contract gate
 *
 * Same appendix, same dispatch, one flag different. `--prompt-file` is documented as a first-class
 * way to enter headless mode (`~/.grok/docs/user-guide/14-headless-mode.md`), not a workaround.
 *
 * ## WHY A FILE AND NOT ESCAPING
 *
 * Escaping the two known tokens would fix today's appendix and fail on the next brief that mentions
 * a CLI flag — and briefs in this repo routinely do, because they name the commands a worker must
 * run. Taking the prompt off argv removes the whole class. Wire the documented mechanism rather than
 * sanitising text forever (D1).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                                  | (1) | (2) | (3) | (4) | result
 *   -------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — prompt is the value of `-p`                     |FAIL |FAIL | pass| pass| REFUSED
 *   b) keep `-p`, escape/strip the two known flag tokens       |FAIL |FAIL | pass| pass| REFUSED
 *   c) `--prompt-file` but write an empty/truncated file       | pass|FAIL | pass| pass| REFUSED
 *   d) `--prompt-file` and drop --model/--max-turns/--cwd      | pass| pass|FAIL | pass| REFUSED
 *   e) `--prompt-file` with the full prompt, flags intact      | pass| pass| pass| pass| ALL PASS
 *
 * **(b) is the one to watch.** It makes this appendix work and quietly re-arms for any brief that
 * names a flag. Clause (1) requires the prompt to be absent from argv entirely, not sanitised.
 *
 * ## PROBE FIXTURE NOTE — AND A TRAP FOR THE IMPLEMENTER
 *
 * My first pass-leg probe reported "no tests": the file would not even collect, because my patch
 * added a second `import { writeFileSync } from "node:fs"` when **`writeFileSync` is already
 * imported at `dispatch-worker.ts:20`** alongside `appendFileSync`, `existsSync`, `mkdirSync`,
 * `readFileSync`, `readdirSync`. Do not add an import; it is there. With that corrected the pass
 * leg is 4/4. A probe whose pass leg does not pass has demonstrated nothing.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (SS227): **(1) and (2) are RED** — argv is `["-p", prompt]`
 * today. **(3) and (4) pass today** and are the nets that stop the fix dropping flags or writing a
 * stub file.
 *
 * NOT TESTED: that grok's scan is the mechanism. The correlation is exact and the switch fixes it,
 * but I did not read grok's argument parser — "flags embedded in the -p value" remains the best
 * supported explanation, not a proven one. Also untested: whether a real dispatch now reaches
 * `sessionId` end-to-end with compose re-enabled; that is this slice's other half and belongs in
 * the worker's own verification, not in this contract.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
/** Computed so a not-yet-changed signature cannot break compilation (SS383/SS352). */
const SPECIFIER = ["../openclaw/dispatch", "worker.js"].join("-");
/** The exact tokens that reach grok's scan today. Measured, not chosen. */
const EMBEDDED_FLAGS = ["--output-logs", "--filter"] as const;

type BuildArgv = (o: Record<string, unknown>) => string[];
const mod = (await import(SPECIFIER)) as { buildArgv?: BuildArgv };
const buildArgv = mod.buildArgv!;

const PROMPT = `do the thing\nrun pnpm --filter pkg test --output-logs=errors-only\n${"x".repeat(4000)}`;
const opts = { prompt: PROMPT, model: "deepseek-v4-flash", maxTurns: 7, cwd: "/tmp/wt", slice: "issue-000" };

describe("dispatch passes the prompt off argv", () => {
  it("(1) RED: the prompt is not an argv element, and --prompt-file is used", () => {
    const argv = buildArgv(opts);
    expect(argv, "the prompt must not be passed via -p").not.toContain("-p");
    expect(argv, "the documented off-argv mechanism").toContain("--prompt-file");
    for (const el of argv) {
      expect(el.length, `no argv element may carry the prompt body (found ${el.length} chars)`).toBeLessThan(1000);
    }
  });

  it("(2) RED: no argv element carries the embedded flag tokens, and the file holds the full prompt", () => {
    // Refuses (b) and (c). Sanitising the two known tokens re-arms on the next brief that names a
    // flag; a stub file passes clause (1) while sending the worker nothing.
    const argv = buildArgv(opts);
    for (const flag of EMBEDDED_FLAGS) {
      expect(argv.some((a) => a.includes(flag)), `${flag} must not reach grok's argument scan`).toBe(false);
    }
    const i = argv.indexOf("--prompt-file");
    const path = argv[i + 1];
    expect(typeof path === "string" && path.length > 0, "--prompt-file needs a path").toBe(true);
    expect(existsSync(path!), `${path} must exist when the argv is built`).toBe(true);
    expect(readFileSync(path!, "utf8"), "the file must hold the FULL prompt, not a stub").toBe(PROMPT);
  });

  it("(3) NET: the other flags survive the change", () => {
    // Refuses (d). A rewrite that drops --model or --max-turns silently changes worker behaviour.
    const argv = buildArgv(opts);
    for (const pair of [["--model", "deepseek-v4-flash"], ["--max-turns", "7"], ["--cwd", "/tmp/wt"]]) {
      const i = argv.indexOf(pair[0]!);
      expect(i, `${pair[0]} must still be passed`).toBeGreaterThanOrEqual(0);
      expect(argv[i + 1], `${pair[0]} value`).toBe(pair[1]);
    }
    expect(argv, "output format must still be set").toContain("--output-format");
  });

  it("(4) NET: the measured evidence for this change is recorded in the tree", () => {
    // Keeps the reason discoverable: the next person to see --prompt-file should find why.
    const src = readFileSync(join(REPO_ROOT, "tools/openclinxr/evidence/dispatch-passes-the-prompt-off-argv.test.ts"), "utf8");
    expect(src, "the flag-token measurement must stay in the header").toContain("--output-logs");
    expect(src, "the discriminating test must stay in the header").toContain("--prompt-file");
  });
});
