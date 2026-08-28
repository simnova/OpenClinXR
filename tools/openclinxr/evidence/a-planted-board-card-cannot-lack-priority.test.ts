import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as boardCli from "../openclaw/board-cli.ts";

/**
 * OBSERVABLE: Factory: Planted can be written while the board's Priority field stays empty, and
 * both the supervisor gauge and the dequeue then skip the card. Nothing in the repo writes Priority.
 *
 * MEASURED 2026-08-28 against tools/openclinxr/openclaw/board-cli.ts:
 *   - one field writer: planFactoryStageWrite / setFactoryField (Factory only, :461/:520)
 *   - pnpm openclaw:board has slice-open|status|close|factory; no priority subcommand
 *   - board-next-selector.ts:99 filters `typeof i.priority === "string" && i.priority.length > 0`
 *
 * Diagnosis and measured tables in this header are IMMUTABLE. Flip it.fails to it and append a
 * ## FIXED (#690) block. Do not rewrite the original paths or numbers.
 *
 * No implicit default. A card planted without a stated priority must be REFUSED, not silently
 * made P2. If a Priority writer already exists, report where and stop — that is a successful
 * outcome; the changed:board-cli.ts rule is waived in that case (say so in the report).
 *
 * claimScope: Factory=Planted cannot land without a Priority write or a refusal.
 * notEvidenceFor: that the live board's Priority option ids are frozen; resolve by NAME the way
 * Factory already does.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = readFileSync(join(HERE, "../openclaw/board-cli.ts"), "utf8");
const SELECTOR_SRC = readFileSync(join(HERE, "../openclaw/board-next-selector.ts"), "utf8");

type PriorityWriter = (
  repoRoot: string,
  sliceId: string,
  priority: string | undefined,
) => unknown;

describe("a planted board card cannot lack priority", () => {
  it.fails("(1) board-cli exports setPriorityField", () => {
    expect(typeof (boardCli as { setPriorityField?: unknown }).setPriorityField).toBe("function");
  });

  it.fails("(2) setPriorityField refuses when priority is omitted or empty — never defaults P2", () => {
    const write = (boardCli as { setPriorityField?: PriorityWriter }).setPriorityField;
    expect(write, "export missing; clause (1) covers that").toBeTypeOf("function");
    expect(() => write!("/tmp", "issue-690", undefined)).toThrow(/priority/i);
    expect(() => write!("/tmp", "issue-690", "")).toThrow(/priority/i);
  });

  it("(3) COUNTERWEIGHT: setFactoryField does not write P2 as a silent default", () => {
    const from = CLI_SRC.indexOf("export function setFactoryField");
    expect(from).toBeGreaterThanOrEqual(0);
    const fn = CLI_SRC.slice(from, from + 4000);
    expect(fn.includes('"P2"') || fn.includes("'P2'"), "a P2 literal in setFactoryField is the implicit default this card forbids").toBe(false);
  });

  it("(4) COUNTERWEIGHT: dequeue still skips an empty Priority — do not delete the selector filter", () => {
    expect(SELECTOR_SRC).toMatch(/typeof i\.priority === "string"/);
    expect(SELECTOR_SRC).toMatch(/i\.priority\.length > 0/);
  });
});

// NOT TESTED: GitHub project field-list option ids; live gh writes; BothyBoard priority ints.
