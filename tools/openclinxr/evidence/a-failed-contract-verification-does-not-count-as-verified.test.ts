import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyDoneClaim } from "../openclaw/supervisor-audit.js";

/**
 * OBSERVABLE: the supervisor audit's duty 3 reports `contractVerified: true` for a merge
 * verification that FAILED, because it tests only that the artifact FILE EXISTS.
 *
 * MEASURED on HEAD 987b7580:
 *
 *   supervisor-audit.ts:437   const verified = existsSync(artifact);
 *   supervisor-audit.ts:451   const ok = onMain && shas.length > 0 && verified;
 *
 * and the writer puts the file on disk BEFORE it decides the verification failed:
 *
 *   contract-verify-cli.ts:128   writeFileSync(reportPath, ...)       <- unconditional
 *   contract-verify-cli.ts:184   if (!proofsOk) process.exit(2);      <- after the write
 *
 * So `proofsOk: false` and `proofsOk: true` are indistinguishable to duty 3. This is the same
 * existence-for-content substitution the repo has now paid for several times: a byte floor proving
 * a renderer ran, a name match proving a garment exists, a registry that shrank while every gate
 * stayed green.
 *
 * NOT HYPOTHETICAL, and not yet live. 395 contract-verify artifacts sit in
 * `.openclinxr/openclaw/`; FOUR already carry `proofsOk: false` — issues 241, 349, 355 and 635.
 * None of the four is in the current audit window, so today's 32 done-claims all pass on inspection
 * of their contents. The defect is latent: the first Landed/Graded card whose merge verification
 * failed will be reported as verified.
 *
 * CLAUSES (1), (4) and (5) are all the SAME defect seen from three angles, so all three are
 * planted RED. Clauses (2) and (3) are the counterweights and pass on HEAD: they hold the
 * currently-green behaviour so the fix cannot be "return false".
 *
 * ## FIXED (supervisor duty 3)
 *
 * `contractVerifiedFromArtifact` replaces the bare `existsSync` at supervisor-audit.ts:437. It
 * reads the artifact, requires `proofsOk === true`, requires a non-empty `checks` array, and
 * requires every check to have `passed === true`. Unreadable, unparseable, empty-checks and
 * missing-checks all report NOT verified. The five clauses above are green at this commit.
 *
 * KNOWN-GOOD COLUMN: all 32 done-claims in the 987b7580 audit carry `proofsOk: true`, zero failed
 * checks, and an artifact headSha that is an ancestor of main. Clause (2) holds that column green,
 * so the cheapest fix — always returning false — is refused.
 *
 * claimScope: what `verifyDoneClaim` reports in `contractVerified` for a given artifact state.
 * notEvidenceFor: whether any landing is CORRECT, which is a grade; nor whether `ok` should also
 *   require the artifact's headSha to be on main, which is a separate and real residual named in
 *   the NOT TESTED line below.
 */

/** A temp root with a git repo, an artifact directory, and one commit citing the issue. */
function fixtureRoot(issue: number, artifact: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "done-claim-"));
  const run = (...argv: string[]) => execFileSync(argv[0]!, argv.slice(1), { cwd: root, stdio: "ignore" });
  run("git", "init", "-q", "-b", "main");
  run("git", "config", "user.email", "t@t");
  run("git", "config", "user.name", "t");
  writeFileSync(join(root, "f.txt"), "x\n");
  run("git", "add", "-A");
  run("git", "commit", "-q", "-m", `fix(#${issue}): land the thing`);
  mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
  if (artifact !== null) {
    writeFileSync(join(root, `.openclinxr/openclaw/contract-verify-issue-${issue}-merge.json`), artifact);
  }
  return root;
}

/**
 * Values are ILLUSTRATIVE, not a specification: the only field under test is `proofsOk`. The
 * headSha is a literal 40-hex string that is deliberately NOT a commit in the fixture, so nothing
 * here can be read as a spec for an ancestry check that this clause does not make.
 */
const FAILED = JSON.stringify({
  schemaVersion: 1, phase: "merge", sliceId: "issue-9991", headSha: "0".repeat(40),
  proofsOk: false,
  checks: [{ rule: "run:some-proof", passed: false, detail: "2 of 3 assertions failed" }],
});
const PASSED = JSON.stringify({
  schemaVersion: 1, phase: "merge", sliceId: "issue-9992", headSha: "0".repeat(40),
  proofsOk: true,
  checks: [{ rule: "run:some-proof", passed: true, detail: "" }],
});

describe("a failed contract verification does not count as verified", () => {
  it("(1) an artifact whose proofsOk is FALSE must not report contractVerified", () => {
    const root = fixtureRoot(9991, FAILED);
    const claim = verifyDoneClaim(root, 9991, "Landed");
    expect(
      claim.contractVerified,
      "the artifact records a FAILED merge verification; treating its existence as proof is the "
        + "existence-for-content substitution this audit exists to catch",
    ).toBe(false);
  });

  it("(2) COUNTERWEIGHT: an artifact whose proofsOk is TRUE still verifies", () => {
    const root = fixtureRoot(9992, PASSED);
    const claim = verifyDoneClaim(root, 9992, "Landed");
    expect(
      claim.contractVerified,
      "always returning false is the cheapest way to pass clause (1) and would blank all 32 "
        + "currently-passing done-claims",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: a MISSING artifact still reports not-verified", () => {
    const root = fixtureRoot(9993, null);
    const claim = verifyDoneClaim(root, 9993, "Landed");
    expect(claim.contractVerified, "the existing absent-artifact behaviour must survive the fix").toBe(false);
    expect(claim.why, "and it must keep saying WHY, not silently drop to false").toMatch(/NO contract-verify artifact/);
  });

  it("(4) RED: an unparseable artifact must not verify", () => {
    const root = fixtureRoot(9994, "{ this is not json");
    const claim = verifyDoneClaim(root, 9994, "Landed");
    expect(
      claim.contractVerified,
      "parse-and-default-to-true would satisfy clauses (1) and (2) while making a corrupt artifact "
        + "count as a passing verification",
    ).toBe(false);
  });

  it("(5) RED: an artifact with a FAILED check but proofsOk true must not verify", () => {
    const root = fixtureRoot(9995, JSON.stringify({
      schemaVersion: 1, phase: "merge", sliceId: "issue-9995", headSha: "0".repeat(40),
      proofsOk: true,
      checks: [{ rule: "run:a", passed: true }, { rule: "run:b", passed: false, detail: "red" }],
    }));
    const claim = verifyDoneClaim(root, 9995, "Landed");
    expect(
      claim.contractVerified,
      "reading only the proofsOk boolean trusts a summary field over the checks it summarises; a "
        + "writer bug or a hand-edited artifact would pass",
    ).toBe(false);
  });
});

// NOT TESTED: whether `ok` should also require the artifact's headSha to be an ancestor of main.
// Today a verification run against an ABANDONED branch head writes an artifact that these clauses
// would accept. That is a real residual and belongs to a separate card, not to this one.
