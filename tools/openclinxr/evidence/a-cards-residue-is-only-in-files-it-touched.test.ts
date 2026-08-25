import { describe, expect, it } from "vitest";
import { residueFilesOwnedByCard } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: duty 3 reports a correctly-verified card as unverified because ANOTHER issue's
 * standing `it.fails` sits in a proof file the card's done_when happens to name.
 *
 * MEASURED on #664, flagged twice (occurrences: 2) by `expectedFailureResidue`:
 *
 *   "contract-verify artifact present — BUT its RED was already unflipped at the verified sha,
 *    so 'verified' was never true"
 *
 * At the verified sha 23cd4824, #664's two named proofs carried:
 *
 *   the-lookup-does-not-invent-a-persons-sex.test.ts   0 it.fails   <- #664 flipped this itself
 *   every-cast-actor-has-a-phenotype.test.ts           5 it.fails   <- #293's, untouched by #664
 *
 * The second file was last modified by `bcef06fe` for #605, and states its intent at line 53:
 * "It is planted `it.fails` precisely so it does not block the land path while it waits. See #293."
 *
 * So the residue is a DELIBERATE standing guard for a different, still-open issue — exactly what
 * the counterweight convention encourages — and counting it makes duty 3 permanently red on a card
 * whose own contract was flipped and verified. Both of #664's proofs pass on HEAD today.
 *
 * The rule: a card owns the residue in files ITS OWN COMMITS TOUCHED. Residue in a shared proof
 * file the card never modified belongs to whoever planted it.
 *
 * WHY THIS IS THE DANGEROUS DIRECTION: a permanent false red is not merely noise. It buries a real
 * unflipped-RED beside it, which is the one thing this check exists to surface.
 *
 * claimScope: which proof files count toward a card's expected-failure residue.
 * notEvidenceFor: whether any card's work is correct; whether the residue in an owned file is a
 *   real defect (it is, and stays reported); the 40-closure bound on duty 3's window.
 */

describe("a card's residue is only in files it touched", () => {
  it("(1) drops residue in a proof file the card never modified", () => {
    const owned = residueFilesOwnedByCard(
      ["evidence/the-lookup-does-not-invent-a-persons-sex.test.ts", "evidence/every-cast-actor-has-a-phenotype.test.ts"],
      new Set(["evidence/the-lookup-does-not-invent-a-persons-sex.test.ts", "packages/openclinxr/scenario-fixtures/src/descriptor-phenotype-lookup.ts"]),
    );
    expect(owned, "#293's standing guard in a file #664 never opened is not #664's residue")
      .toEqual(["evidence/the-lookup-does-not-invent-a-persons-sex.test.ts"]);
  });

  it("(2) COUNTERWEIGHT: keeps residue in a file the card DID modify", () => {
    // The real defect this check exists for: a worker edits its own proof file and leaves the RED
    // unflipped. That must still be caught, or the fix has removed the check rather than narrowed it.
    const owned = residueFilesOwnedByCard(
      ["evidence/its-own-proof.test.ts"],
      new Set(["evidence/its-own-proof.test.ts"]),
    );
    expect(owned).toEqual(["evidence/its-own-proof.test.ts"]);
  });

  it("(3) COUNTERWEIGHT: an unknown touched-set does NOT silently clear everything", () => {
    // If the touched set cannot be determined, narrowing would turn every card green — the
    // reporting-clean-about-a-file-it-never-opened defect this module already warns about. An
    // undefined touched set must fall back to counting every proof file.
    const owned = residueFilesOwnedByCard(["evidence/a.test.ts", "evidence/b.test.ts"], undefined);
    expect(owned, "unknown ownership is not evidence of no residue").toEqual([
      "evidence/a.test.ts",
      "evidence/b.test.ts",
    ]);
  });

  it("(4) VACUITY GUARD: the old rule genuinely differs", () => {
    const proofs = ["evidence/mine.test.ts", "evidence/someone-elses.test.ts"];
    const oldRule = proofs; // counted every named proof file
    const newRule = residueFilesOwnedByCard(proofs, new Set(["evidence/mine.test.ts"]));
    expect(newRule).not.toEqual(oldRule);
    expect(newRule).toEqual(["evidence/mine.test.ts"]);
  });
});
