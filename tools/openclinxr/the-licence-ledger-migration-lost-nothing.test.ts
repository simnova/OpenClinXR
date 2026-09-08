import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The licence ledger moved from 402 hand-appended Markdown lines to per-asset records plus a
 * generator, because the hand-written file was the #8 serialization point in this repo — 17
 * excess-writer events over 20 days and 2 of the 17 conflict-resolving merges in 1,500
 * commits. Every worker acquiring or refusing an asset appended to the same file.
 *
 * A migration like that fails silently: the generator produces a well-formed ledger whether or
 * not it carries every entry, and nobody notices a missing row until someone re-acquires an
 * asset that was refused. THAT is the asymmetry this test exists for. Losing an APPROVAL costs
 * a re-check; losing a REFUSAL means the refusal gets re-litigated and the asset is acquired,
 * which is the outcome the ledger exists to prevent. So refusals are asserted by source name,
 * not by count.
 *
 * The reference is the pre-migration file read from git by BLOB SHA, not a checked-in copy.
 * A copy is one more thing that can drift, and it would need its own doc-registry entry; the
 * committed blob cannot drift by definition. It is a frozen reference on purpose: deriving the
 * expectation from the same records the generator reads would pass by construction.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
/** The ledger exactly as it stood before the migration, at commit 15214830. */
const PRE_MIGRATION_BLOB = "1181caa4896a1b875142d7f65a3a12de920dc1f3";
const GENERATED = join(HERE, "..", "..", "docs", "openclinxr", "third-party-asset-licence-ledger.md");

/** A ledger row's first cell is the source it names; that is the identity worth comparing. */
function sourceCells(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1]?.trim() ?? "";
    if (first === "" || /^-+$/.test(first) || first.toLowerCase() === "source") continue;
    out.add(first);
  }
  return out;
}

describe("the licence ledger migration lost nothing", () => {
  const before = execFileSync("git", ["cat-file", "-p", PRE_MIGRATION_BLOB], {
    cwd: join(HERE, "..", ".."),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const after = readFileSync(GENERATED, "utf8");

  it("(1) every source named before the migration is still named after it", () => {
    const missing = [...sourceCells(before)].filter((source) => !sourceCells(after).has(source));
    expect(missing, `sources dropped by the migration:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(2) every REFUSED source survives, by name", () => {
    // A refusal that vanishes is re-litigated and the asset gets acquired anyway.
    const refusedBefore = before
      .split("\n")
      .filter((line) => /refus/i.test(line) && line.startsWith("|"))
      .map((line) => line.split("|")[1]?.trim() ?? "")
      .filter((source) => source !== "" && !/^-+$/.test(source));
    expect(refusedBefore.length, "the fixture must actually contain refusals").toBeGreaterThan(0);
    const lost = refusedBefore.filter((source) => !after.includes(source));
    expect(lost, `REFUSALS dropped by the migration:\n${lost.join("\n")}`).toEqual([]);
  });

  it("(3) every line of prose survives", () => {
    // Found by destructive probe, twice. Deleting prose-1-open-questions.json regenerates the
    // ledger silently: clauses (1) and (2) stay green because a prose record has no source cell,
    // and a HEADING comparison stays green too, because the generator emits section headings from
    // its fixed rules header rather than from records — so the heading outlives its body. Prose
    // carries the standing rules and the open questions, the content nobody re-derives once gone,
    // so the invariant has to be the body text itself.
    const prose = (markdown: string): string[] =>
      markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("|") && !line.startsWith("#"));
    const lost = prose(before).filter((line) => !after.includes(line));
    expect(lost, `prose dropped by the migration:\n${lost.join("\n")}`).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: the comparison can fail — a source absent from the generated file is reported", () => {
    const invented = "https://example.invalid/asset-that-was-never-in-the-ledger";
    expect(sourceCells(before).has(invented)).toBe(false);
    expect(after.includes(invented)).toBe(false);
    const missing = [invented].filter((source) => !after.includes(source));
    expect(missing).toEqual([invented]);
  });
});
