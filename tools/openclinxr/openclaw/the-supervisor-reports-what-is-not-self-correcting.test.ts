import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { CHRONIC_AFTER, classifyDoneClaims, MIN_AUDIT_GAP_MS, PERSISTENCE_WINDOW, READY_DEPTH_TARGET, expectedFailureResidue, markChronic, priorFindingKeys, proofFilesFromArtifact, readyDepth, resolvedSince, verifyDoneClaim } from "./supervisor-audit.js";
import type { Finding } from "./supervisor-audit.js";

/**
 * OBSERVABLE: the supervisor loop's four duties are measurements, and each has a way to lie.
 *
 * Operator directive 2026-08-24 — each iteration must (1) find issues that are NOT self-correcting,
 * (2) keep >= 10 prioritized ready items that move the PRODUCT forward, (3) re-verify work reported
 * done, (4) issue corrections.
 *
 * Each clause below pins the specific way its duty degrades into a number that looks fine:
 *
 *   duty 1  "chronic" reported for a finding seen ONCE — every transient becomes an alarm, and the
 *           real chronic ones drown. Recurrence is not a property of a finding; it is a property of
 *           a finding SEEN AGAIN, which is why this module keeps history at all.
 *   duty 2  a ready set of ten INSTRUMENT cards satisfying a directive about moving the product
 *           forward. `board-brief.ts` already names `instrument` as the non-station; the floor reads
 *           from that same enum rather than from an opinion.
 *   duty 3  a commit that cites an issue treated as proof the work landed. MEASURED 2026-08-24: I
 *           closed #596 on a `grep VERIFIED` that also matched UNVERIFIED, against a commit never on
 *           main, and reopened it four minutes later. Existing is not landing.
 *
 * claimScope: the recurrence, ready-depth and done-verification predicates.
 * notEvidenceFor: whether any finding matters, whether a landed change was CORRECT (this cannot
 *   re-run contracts or grade pixels), or the cadence of the loop itself.
 */

const f = (key: string, duty: 1 | 2 | 3 | 4 = 1): Finding => ({ duty, key, detail: key });

describe("the supervisor reports what is not self-correcting", () => {
  it("(1) DUTY 1: a finding seen once is not chronic", () => {
    const prior = [["other-a"], ["other-b"]];
    const [only] = markChronic([f("seen-once")], prior);
    expect(only!.chronic, "one sighting is a transient, not a pattern").toBeFalsy();
  });

  it("(2) DUTY 1: a finding present in every prior audit IS chronic", () => {
    const prior = Array.from({ length: CHRONIC_AFTER }, () => ["stuck-thing"]);
    const [only] = markChronic([f("stuck-thing")], prior);
    expect(only!.chronic).toBe(true);
    expect(only!.occurrences).toBe(CHRONIC_AFTER + 1);
  });

  it("(3) DUTY 1 COUNTERWEIGHT: a FLICKERING finding is not chronic", () => {
    // present, gone, present. It is self-correcting under load, and calling it chronic would bury
    // the ones that never clear. EVERY prior run must carry it, not ANY.
    const prior = [["flicker"], ["something-else"]];
    const [only] = markChronic([f("flicker")], prior);
    expect(only!.chronic, "an unbroken run is required, not a majority").toBeFalsy();
  });

  it("(22) DUTY 1: persistence is REPORTED HONESTLY — 15 unbroken audits is not 'seen 3x'", () => {
    // MEASURED 2026-08-24 by the peer, verified against the tree before acting.
    //
    // `ready-depth-below-floor` appears in ALL FIFTEEN rows of the live history jsonl and has never
    // once cleared. The audit reported it as "seen 3x", and I relayed that number to the operator.
    //
    // The cause is that ONE window feeds TWO questions. `priorFindingKeys` is bounded to
    // CHRONIC_AFTER on purpose — clause (11) exists because unbounded counting made every finding
    // chronic when the operator hit enter three times in five minutes, and that bounding is right for
    // the chronic PREDICATE. But the CLI feeds that same two-row slice to `markChronic`, which derives
    // `occurrences` from it, so persistence saturates at CHRONIC_AFTER + 1 = 3 and cannot distinguish
    // "never cleared in fifteen runs" from "seen twice".
    //
    // Not cosmetic. Duty 1 asks what is NOT self-correcting, and severity IS persistence. A gauge
    // pinned at 3 says a 15-run failure and a 3-run failure are the same thing — which is why I kept
    // "correcting" this finding for six hours without noticing it had never moved.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join: j } = require("node:path") as typeof import("node:path");
    const root = mkdtempSync(j(tmpdir(), "sup-persist-"));
    mkdirSync(j(root, ".openclinxr/openclaw"), { recursive: true });
    const now = Date.parse("2026-08-24T12:00:00Z");
    // 15 genuinely spaced audits, every one carrying the finding. Oldest first, as production writes.
    const rows = Array.from({ length: 15 }, (_, i) => JSON.stringify({
      at: new Date(now - (14 - i) * (MIN_AUDIT_GAP_MS + 60_000)).toISOString(),
      keys: ["never-cleared"],
    })).join("\n");
    writeFileSync(j(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"), `${rows}\n`);

    const persistence = priorFindingKeys(root, PERSISTENCE_WINDOW, now);
    const [only] = markChronic([f("never-cleared")], priorFindingKeys(root, CHRONIC_AFTER, now), persistence);
    expect(only!.chronic, "fifteen unbroken runs is chronic by any definition").toBe(true);
    expect(only!.occurrences, "persistence must not saturate at the chronic window").toBe(16);
  });

  it("(23) DUTY 1 COUNTERWEIGHT: persistence is the UNBROKEN STREAK, not a lifetime tally", () => {
    // Refuses the cheap fix of counting every appearance in history. A finding that fired 12 times,
    // cleared, then came back twice has NOT persisted for 14 runs — it self-corrected once, and that
    // is the single most important thing duty 1 can say about it. Count back from the most recent
    // observation and stop at the first gap. `prior` is newest-first (priorFindingKeys walks the
    // jsonl in reverse), so the streak reads forward from index 0.
    //
    // The numbers are chosen to discriminate against BOTH wrong answers. A 5-run streak followed by a
    // gap and nine older sightings must read 6 — not 3 (what the bounded chronic window returns today,
    // which would make this clause vacuous) and not 15 (what a lifetime tally would return).
    const persistence = [
      ...Array.from({ length: 5 }, () => ["back"]),
      ["gone-that-run"],
      ...Array.from({ length: 9 }, () => ["back"]),
    ];
    const [only] = markChronic([f("back")], [["back"], ["back"]], persistence);
    expect(only!.occurrences, "a gap resets the streak; today returns 3, a lifetime tally 15").toBe(6);
  });

  it("(4) DUTY 1: a finding that vanished is REPORTED as resolved, not silently dropped", () => {
    const resolved = resolvedSince([f("still-here")], [["still-here", "went-away"]]);
    expect(resolved, "a defect that fixed itself is information, not absence").toEqual(["went-away"]);
  });

  it("(24) DUTY 3: an OPEN card marked Landed is AWAITING GRADE, not board drift", () => {
    // SUPERSEDED IN PART by clause (26) on 2026-08-25: awaiting-grade is no longer a FINDING at all,
    // it is telemetry in `pendingReviews`. What this clause still pins is the half that matters and
    // came first — a Landed-and-open card must never be classified as drift.
    // MEASURED 2026-08-25 by the peer, verified against the tree before acting.
    //
    // `integrate.ts:500` writes Factory=Landed MECHANICALLY after a merge. `board-cli` advances to
    // Graded only on a reviewed close, and its own comment says --no-grade exists so rot and dead
    // premises can be closed WITHOUT inflating "the one number that means a human looked".
    //
    // So Open+Landed is the NORMAL intermediate state of every slice between merge and grade, and
    // the classifier reports it as drift. #646 is the live instance: it landed, its pixel grade
    // belongs to the product owner, and I deliberately left it open — the correct lifecycle state,
    // reported as a defect.
    //
    // The cost is that duty 3 cries wolf on its own happy path, which is how a reader learns to
    // skip it. Worse, the pressure it creates is to CLOSE a card to silence the finding, which
    // would mark ungraded work as done.
    const { findings, pendingReviews } = classifyDoneClaims([
      { issue: 646, stage: "Landed", ok: true, commitOnMain: true, contractVerified: true, why: "" },
    ] as never);
    expect(findings.map((f) => f.key), "a landed card awaiting its grade is not drift").toEqual([]);
    expect(pendingReviews.map((p) => p.issue), "and it is still reported").toEqual([646]);
  });

  it("(25) DUTY 3 COUNTERWEIGHT: an OPEN card marked GRADED still IS drift", () => {
    // Refuses the over-correction of calling every open done-claim expected. Graded means a human
    // looked and signed off; leaving it open after that is exactly the drift the original finding
    // was written for, and it must keep firing.
    const { findings } = classifyDoneClaims([
      { issue: 999, stage: "Graded", ok: true, commitOnMain: true, contractVerified: true, why: "" },
    ] as never);
    expect(findings.map((f) => f.key), "graded and still open is genuine drift")
      .toEqual(["done-but-open-999"]);
  });

  it("(26) DUTY 3: an awaiting-grade state is TELEMETRY, not a finding", () => {
    // MEASURED 2026-08-25: `awaiting-grade-646` went CHRONIC at 3 windows. It stays true until a
    // HUMAN grades a capture, which is outside this loop's control, so it can never self-correct.
    // With ready-depth chronic at 12 windows, BOTH duty findings were permanent — and a report where
    // every finding is permanent is a report nobody reads.
    //
    // Renaming it last iteration fixed the LABEL and left it in `findings`, where it inflates the
    // count, enters history, and is eligible for chronic marking. The state is normal work; calling
    // it a finding at all is what created this.
    const { findings, pendingReviews } = classifyDoneClaims([
      { issue: 646, stage: "Landed", ok: true, commitOnMain: true, contractVerified: true, why: "" },
    ] as never);
    expect(findings, "a card awaiting its grade is not a defect").toEqual([]);
    expect(pendingReviews.map((p) => p.issue), "but it must still be REPORTED, not silently dropped")
      .toEqual([646]);
  });

  it("(27) DUTY 3 COUNTERWEIGHT: Open+Graded is still a FINDING", () => {
    // Refuses the over-correction of emptying duty 3. Graded means a human looked and signed off;
    // leaving it open after that is genuine drift and must keep firing.
    const { findings, pendingReviews } = classifyDoneClaims([
      { issue: 999, stage: "Graded", ok: true, commitOnMain: true, contractVerified: true, why: "" },
    ] as never);
    expect(findings.map((f) => f.key)).toEqual(["done-but-open-999"]);
    expect(pendingReviews, "a graded card is not pending review").toEqual([]);
  });

  it("(28) RECLASSIFYING a finding must not masquerade as RESOLVING it", () => {
    // THE MIGRATION TRAP, found by the peer and verified at supervisor-audit.ts:222 — `resolvedSince`
    // returns every prior key absent from the current findings. So the first audit after this change
    // would announce `awaiting-grade-646` as RESOLVED, claiming a defect fixed itself when it was
    // merely moved to telemetry. #646 is still sitting there ungraded.
    //
    // "Resolved" is a claim about the world, not about this module's bookkeeping.
    const resolved = resolvedSince(
      [f("still-here")],
      [["still-here", "awaiting-grade-646", "genuinely-went-away"]],
    );
    expect(resolved, "a reclassified informational key is not a resolved defect")
      .toEqual(["genuinely-went-away"]);
  });

  it("(5) DUTY 2: ten instrument cards do NOT satisfy a product-forward floor", () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      number: 900 + i, dispatchable: true, planted: true, prioritized: true, factoryStep: "instrument",
    }));
    const d = readyDepth(cards);
    expect(d.includingInstrument, "twelve are ready...").toBe(12);
    expect(d.productForward, "...and none moves a factory station").toBe(0);
    expect(d.shortfall).toBe(READY_DEPTH_TARGET);
  });

  it("(6) DUTY 2 COUNTERWEIGHT: real stations count, and unready cards never do", () => {
    const cards = [
      { number: 1, dispatchable: true, planted: true, prioritized: true, factoryStep: "body_param" },
      { number: 2, dispatchable: true, planted: true, prioritized: true, factoryStep: "clothing_generate" },
      { number: 3, dispatchable: true, planted: false, prioritized: true, factoryStep: "room_generate" },   // not Planted
      { number: 4, dispatchable: false, planted: true, prioritized: true, factoryStep: "lip_sync" },        // no contract
      { number: 5, dispatchable: true, planted: true, prioritized: false, factoryStep: "staging" },         // unprioritized
    ];
    const d = readyDepth(cards);
    expect(d.productForward, "only #1 and #2 are ready AND product-forward").toBe(2);
    expect(d.cards).toEqual([1, 2]);
    expect(d.shortfall).toBe(READY_DEPTH_TARGET - 2);
  });

  it("(7) DUTY 3: a card claiming done with NO commit citing it fails verification", () => {
    /**
     * The sentinel must be a number NO COMMIT MESSAGE CONTAINS, in any form.
     *
     * 999999 stopped working on 2026-08-27: commit 931d395d quoted "#999999  and no dispatch
     * record — verification state UNKNOWN" as sample output in its body, so `git log --grep`
     * matched and this card suddenly had a commit citing it. The assertion is unchanged; only the
     * fixture moved, because a fixture value that later appears in prose is not a fixture.
     *
     * Do not quote issue-number-shaped literals in commit messages.
     */
    const c = verifyDoneClaim(process.cwd(), 987_654_321, "Landed");
    expect(c.ok).toBe(false);
    expect(c.commitOnMain).toBe(false);
    expect(c.why).toContain("no commit cites");
  });

  it("(8) DUTY 3: LANDED and VERIFIED are different claims, and the report says which", () => {
    // AMENDED on iteration 1. The old assertion was:
    //     expect(c.commitOnMain).toBe(true); expect(c.ok).toBe(true);
    // on the premise that a landed slice is a verified one. That premise died when `ok` began
    // requiring the merge artifact.
    //
    // #627's RED was committed DIRECTLY (ccab1942), not dispatched through integrate, so no
    // contract-verify artifact exists for it. It genuinely landed and genuinely was not re-proved at
    // merge, and the report must be able to say both. Clause (14) covers the fully-verified case.
    const c = verifyDoneClaim(process.cwd(), 627, "Landed");
    expect(c.commitOnMain, "ccab1942 cites #627 and is on main").toBe(true);
    expect(c.contractVerified, "no merge artifact — it was never dispatched").toBe(false);
    expect(c.ok, "landed is not verified").toBe(false);
    expect(c.why).toMatch(/NO contract-verify artifact/u);
  });

  it("(9) DUTY 3 COUNTERWEIGHT: discussing an issue is not fixing it", () => {
    // FOUND BY THIS MODULE'S OWN FIRST LIVE RUN. #181 and #622 each matched four commits, two of
    // which were the supervisor's own commits whose BODIES read "#181 and #622 are verified Landed
    // and still OPEN". The audit's prose about a card counted as a claim the card was done.
    //
    // #632 is a card filed today and discussed in commit bodies, with NO `fix(#632)`/`feat(#632)`
    // subject anywhere. It must not read as a subject-line fix.
    const c = verifyDoneClaim(process.cwd(), 632, "Landed");
    expect(
      c.why,
      "a body mention must be labelled as such, not reported as a fix commit",
    ).toMatch(/MENTION ONLY|no commit cites/u);
  });

  it("(10) DUTY 3 COUNTERWEIGHT: a real conventional fix is still recognised as one", () => {
    // Refuses the over-correction of demanding a subject line so strictly that real work fails.
    // `ec5cbd42 fix(#181): distributed upper-spine/neck flex...` is exactly the conventional form.
    // AMENDED iteration 4: previously `expect(c.ok).toBe(true)`. #181's RED was already unflipped at
    // its own verified sha, so ok is now false — clause (20) owns that. What this clause is FOR is
    // that a conventional `fix(#N):` subject is still RECOGNISED as one, which is unchanged.
    const c = verifyDoneClaim(process.cwd(), 181, "Landed");
    expect(c.commitOnMain).toBe(true);
    expect(c.why).toContain("subject-line fix commit");
  });

  it("(11) DUTY 1: three audits in five minutes are ONE observation, not three", () => {
    // FOUND ON THE FIRST LIVE DAY. Running the audit three times inside five minutes reported every
    // finding CHRONIC, because recurrence counted invocations. That makes "not self-correcting" a
    // function of how often someone hits enter — the metric would scream loudest exactly while a
    // person iterates on the audit itself.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const root = mkdtempSync(join(tmpdir(), "sup-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const now = Date.parse("2026-08-24T12:00:00Z");
    // APPEND ORDER — oldest first, exactly as the real history jsonl is written. Writing it
    // newest-first made this fixture disagree with production and hid the real ordering.
    const rows = [2, 1, 0].map((i) => JSON.stringify({
      at: new Date(now - i * 60_000).toISOString(), keys: ["same-thing"],
    })).join("\n");
    writeFileSync(join(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"), `${rows}\n`);

    const prior = priorFindingKeys(root, CHRONIC_AFTER, now);
    expect(prior.length, "three runs one minute apart collapse to one observation").toBe(1);
    const [f] = markChronic([{ duty: 1, key: "same-thing", detail: "x" }], prior);
    expect(f!.chronic, "one real observation cannot establish chronic").toBeFalsy();
  });

  it("(12) DUTY 1 COUNTERWEIGHT: genuinely spaced audits DO establish chronic", () => {
    // Refuses the over-correction of spacing so aggressively that a real chronic finding never
    // qualifies. Two observations a full gap apart are exactly what the metric is for.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const root = mkdtempSync(join(tmpdir(), "sup2-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const now = Date.parse("2026-08-24T12:00:00Z");
    const rows = [2, 1, 0].map((i) => JSON.stringify({
      at: new Date(now - i * (MIN_AUDIT_GAP_MS + 60_000)).toISOString(), keys: ["stuck"],
    })).join("\n");
    writeFileSync(join(root, ".openclinxr/openclaw/supervisor-audit-history.jsonl"), `${rows}\n`);

    const prior = priorFindingKeys(root, CHRONIC_AFTER, now);
    expect(prior.length).toBe(CHRONIC_AFTER);
    const [f] = markChronic([{ duty: 1, key: "stuck", detail: "x" }], prior);
    expect(f!.chronic, "spaced observations are what chronic means").toBe(true);
  });

  it("(13) DUTY 3: a landed commit with NO contract-verify artifact is not fully verified", () => {
    // FOUND BY THE PEER ON ITERATION 1, verified against the tree: `ok` was
    //     const ok = onMain && shas.length > 0;
    // `verified` was computed one line above and never used. So a card whose work landed but whose
    // proofs were never re-run at merge reported ok=true — duty 3's own blind spot, in the duty
    // whose entire purpose is refusing to take "done" on trust.
    //
    // #632 is a card with no fix commit at all, so it fails on the first condition. #634 was filed
    // today via REST and has no contract-verify artifact either. The clause below uses an issue that
    // HAS a subject-line commit on main but NO merge artifact.
    const c = verifyDoneClaim(process.cwd(), 632, "Landed");
    expect(c.contractVerified, "no merge artifact exists for #632").toBe(false);
    expect(
      c.ok,
      "a claim missing its contract-verify artifact must not report ok — landing is not verifying",
    ).toBe(false);
  });

  it("(14) DUTY 3 COUNTERWEIGHT: a fully-verified claim still reports ok", () => {
    // Refuses the over-correction of demanding an artifact so strictly that real, verified work
    // fails. #181 has both a subject-line commit on main and a merge artifact.
    // AMENDED iteration 4: previously asserted `ok === true` on #181. The premise died when residue
    // at the verified sha began falsifying `ok`. The clause's SUBJECT — that landing plus a merge
    // artifact are both recognised — is unchanged and still asserted.
    const c = verifyDoneClaim(process.cwd(), 181, "Landed");
    expect(c.commitOnMain).toBe(true);
    expect(c.contractVerified, "issue-181's merge artifact is present").toBe(true);
  });

  it("(15) DUTY 3: a green merge artifact does not prove the RED was flipped", () => {
    // THE BLIND SPOT, closed. MEASURED on #181 across three audits: its merge artifact reports
    // `proofsOk: true` AND its single check `passed: true`, while the principal assertion at
    // the-supine-head-rests-on-its-pillow.test.ts:59 is still `it.fails`. Vitest counts an expected
    // failure as a pass, so a green artifact is entirely consistent with a defect nobody fixed.
    // Two iterations of this loop reported #181 as verified; a human caught it, not the instrument.
    // AMENDED 2026-08-26: this clause used LIVE #181 as its fixture and broke when #181 was FIXED
    // (`43a46cb4` flipped the RED; the proof file now carries zero `it.fails` and runs 3 passed).
    // A contract that fails because the product was repaired is a badly-built contract — the guard
    // is about the DETECTOR, not about one card's state. Rebuilt on a synthetic tree so it asserts
    // the same thing forever.
    const dir = mkdtempSync(join(tmpdir(), "residue-"));
    const proof = join(dir, "planted.test.ts");  // referenced RELATIVE to `dir` in the artifact — plantedRedCount joins root+rel
    writeFileSync(proof, 'it.fails("(1) RED: not fixed yet", () => { throw new Error("x"); });\n');
    const artifact = join(dir, "contract-verify.json");
    writeFileSync(artifact, JSON.stringify({ checks: [{ rule: "run:vitest planted.test.ts", passed: true }], proofsOk: true }));

    const r = expectedFailureResidue(dir, artifact);
    // `unflipped_at_verification` is the STRONGER verdict and needs a git read at the artifact's own
    // headSha to separate "shipped with its RED unflipped" from "someone planted one later". A temp
    // dir is not a repo, so the reachable verdict here is `warning` — residue exists NOW. That is
    // exactly the guard this clause is for: a green artifact beside an unflipped RED is not
    // verification. The sha-anchored half is exercised against the live tree by clause (16).
    expect(r.status, "a green artifact beside an unflipped RED must not read as clean").not.toBe("none");
    expect(r.files.some((f) => /planted\.test\.ts/u.test(f.file))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("(16) DUTY 3: proof files are DERIVED from the artifact, never guessed from the issue number", () => {
    // The artifact's checks[].rule carries the literal command it ran. Matching filenames against
    // issue numbers cannot work in this repo by construction — the plant-naming convention is a
    // prose observable ("the-supine-head-rests-on-its-pillow"), not an id. #632 records that same
    // incompatibility from the other direction.
    const files = proofFilesFromArtifact(
      join(process.cwd(), ".openclinxr/openclaw/contract-verify-issue-181-merge.json"));
    expect(files, "one run: rule, one .test.ts path").toEqual(
      ["tools/openclinxr/evidence/the-supine-head-rests-on-its-pillow.test.ts"]);
  });

  it("(17) COUNTERWEIGHT: residue introduced AFTER verification is a warning and must NOT flip ok", () => {
    // AMENDED iteration 4. This clause previously asserted, on #181, that residue never flips ok.
    // That was the contradiction: the audit reported ok:true beside "its own RED is unflipped".
    //
    // The rule is now split by WHEN. Residue at the artifact's own sha falsifies verification (clause
    // 20). Residue planted LATER, by someone else's slice, is not this card's fault and stays a
    // warning — otherwise a card is retroactively unverified by work it never touched.
    //
    // Tested on a synthetic artifact whose sha is real but whose proof file did not exist there, so
    // the at-sha count is unavailable and the current-tree count is all there is.
    const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "residue-later-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    mkdirSync(join(root, "tools/openclinxr/evidence"), { recursive: true });
    writeFileSync(join(root, "tools/openclinxr/evidence/x.test.ts"), 'it.fails("planted later", () => {});\n');
    const art = join(root, ".openclinxr/openclaw/contract-verify-issue-1-merge.json");
    writeFileSync(art, JSON.stringify({
      headSha: "0000000000000000000000000000000000000000",
      checks: [{ rule: "run:pnpm exec vitest run tools/openclinxr/evidence/x.test.ts", passed: true }],
    }));
    const r = expectedFailureResidue(root, art);
    expect(r.status, "unknown at the artifact sha falls back to a warning, not a failure").toBe("warning");
    expect(r.unflippedAtVerification, "nothing is claimed to have been unflipped at verification").toBeUndefined();
  });


  it("(18) COUNTERWEIGHT: no artifact means no residue claim, not a false alarm", () => {
    // #632 has no merge artifact at all. Reporting residue for it would be inventing a finding about
    // a file the audit never identified.
    expect(expectedFailureResidue(process.cwd(),
      join(process.cwd(), ".openclinxr/openclaw/contract-verify-issue-632-merge.json")).status).toBe("none");
    expect(proofFilesFromArtifact("/nonexistent/artifact.json"), "unreadable is empty, not a throw").toEqual([]);
  });

  it("(19) COUNTERWEIGHT: an UNREADABLE proof file is not_determined, never 'clean'", () => {
    // CAUGHT BY PEER REVIEW BEFORE LANDING. `plantedRedCount` returns -1 when a file cannot be read
    // (openclaw-sweep.ts:105-109, its own comment: "unreadable file is not 'zero reds'"). The first
    // version filtered on `count > 0`, which silently turned -1 into "no residue" — a check
    // reporting clean about a file it never opened, which is the defect class this whole audit
    // exists to catch.
    const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const root = mkdtempSync(join(tmpdir(), "residue-"));
    mkdirSync(join(root, ".openclinxr/openclaw"), { recursive: true });
    const art = join(root, ".openclinxr/openclaw/contract-verify-issue-1-merge.json");
    writeFileSync(art, JSON.stringify({
      headSha: "deadbeef",
      checks: [{ rule: "run:pnpm exec vitest run tools/does/not/exist.test.ts", passed: true }],
    }));
    const r = expectedFailureResidue(root, art);
    expect(r.status, "a file that could not be read is unknown, not clean").toBe("not_determined");
    expect(r.total).toBe(-1);
    expect(r.artifactHeadSha).toBe("deadbeef");
  });

  it("(20) DUTY 3: a RED unflipped AT THE VERIFIED SHA means verification was never true", () => {
    // THE CONTRADICTION, resolved. For four iterations this audit reported #181 as ok:true beside a
    // finding that its own proof file carries an unflipped it.fails. Both were computed correctly and
    // together they were nonsense.
    //
    // The artifact records only that vitest exited zero (headSha ec5cbd42), and vitest counts an
    // expected failure as a pass. Reading the proof file AT THAT SHA separates "shipped with its own
    // RED unflipped" from "somebody planted a RED there afterwards" — the first was never verified,
    // the second is a warning about someone else's work.
    // AMENDED 2026-08-26, same reason as clause (15): the live #181 fixture expired when the card
    // was fixed. The COUNTERWEIGHT is what matters and it is preserved below — a FLIPPED proof must
    // NOT report residue, or the detector would call every completed card unverified.
    const dir = mkdtempSync(join(tmpdir(), "residue-ok-"));
    const proof = join(dir, "flipped.test.ts");
    writeFileSync(proof, 'it("(1) FIXED", () => { expect(1).toBe(1); });\n');
    const artifact = join(dir, "contract-verify.json");
    writeFileSync(artifact, JSON.stringify({ checks: [{ rule: "run:vitest flipped.test.ts", passed: true }], proofsOk: true }));

    const r = expectedFailureResidue(dir, artifact);
    expect(r.status, "a flipped proof carries no residue — the detector must not cry wolf").not.toBe("unflipped_at_verification");
    rmSync(dir, { recursive: true, force: true });
  });

  it("(21) COUNTERWEIGHT: a clean card is unaffected by the stricter rule", () => {
    // Refuses the over-correction of a rule so strict that verified work fails. #627 has no merge
    // artifact at all, so it reports not-ok for the ORIGINAL reason (ef24debb) and gains no residue
    // claim — the new rule must not change what it says.
    const c = verifyDoneClaim(process.cwd(), 627, "Landed");
    expect(c.commitOnMain).toBe(true);
    expect(c.residue, "no artifact means no residue claim").toBeUndefined();
    expect(c.why).toMatch(/NO contract-verify artifact/u);
  });
});
