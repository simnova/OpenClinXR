import { describe, expect, it } from "vitest";
import { assertContractsLive } from "./assert-contract-live.js";

/**
 * The planted-contract pattern keeps main green while a contract is unmet, which also makes the
 * obvious done_when proof vacuous: `run:vitest -t "<title>"` passes while `it.fails` is still there,
 * so a worker that does nothing satisfies it. This checker is what makes that proof mean something.
 *
 * Probed destructively rather than asserted against a clean tree: an empty-problems assertion would
 * pass identically if the function returned nothing at all.
 */

const TITLE = "a self-asserted approval with no recorded reviewer decision does not enter exam assembly pool";

describe("assertContractsLive", () => {
  it("FAILS while the contract is still planted as it.fails", () => {
    const result = assertContractsLive(`it.fails("${TITLE}", async () => {});`, [TITLE]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/still planted/i);
  });

  it("passes once it has been flipped to a live it()", () => {
    const result = assertContractsLive(`it("${TITLE}", async () => {});`, [TITLE]);
    expect(result.ok).toBe(true);
  });

  it("FAILS when the contract was renamed or deleted rather than met", () => {
    // The other way to make a red test stop being red.
    const result = assertContractsLive(`it("something else entirely", async () => {});`, [TITLE]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/no live it\(\)/i);
  });

  it("tolerates reformatting — quote style and spacing are not the contract", () => {
    expect(assertContractsLive(`it (  '${TITLE}' , async () => {});`, [TITLE]).ok).toBe(true);
  });

  it("still catches a planted marker written with odd spacing", () => {
    expect(assertContractsLive(`it . fails ( "${TITLE}" , async () => {});`, [TITLE]).ok).toBe(false);
  });

  it("does not mistake a live it() elsewhere for the planted one being flipped", () => {
    // The failure that would make this checker useless: matching `it(` anywhere in the file.
    const source = `it("unrelated passing test", () => {});\nit.fails("${TITLE}", async () => {});`;
    expect(assertContractsLive(source, [TITLE]).ok).toBe(false);
  });

  it("reports every unmet contract, not just the first", () => {
    const source = `it.fails("${TITLE}", async () => {});`;
    const result = assertContractsLive(source, [TITLE, "a second contract that does not exist"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(2);
  });

  it("treats titles containing regex metacharacters literally", () => {
    // Real titles carry parentheses — "(#39)" — and an unescaped title would match the wrong thing.
    const withMeta = "exam assembly (#39) [pool] a.b";
    expect(assertContractsLive(`it.fails("${withMeta}", () => {});`, [withMeta]).ok).toBe(false);
    expect(assertContractsLive(`it("${withMeta}", () => {});`, [withMeta]).ok).toBe(true);
  });
});
