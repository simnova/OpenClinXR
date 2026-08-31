# Review: `blocked-card-unlock-plan-2026-08-31.md`

Reviewer: Grok (session `01a0519a-b8c6-7081-afc0-9d5f00736b24`), 2026-08-31.
Subject: `docs/openclinxr/blocked-card-unlock-plan-2026-08-31.md` as written against board rev 1774 / tree `05120405`.
Tree checked for this review: `74d02b72` (website commits after `05120405`; D9 chain sources not those commits).

Verdict: **execute the administrative closes; do not execute steps 4–5 as written.** The census + luminance re-run (steps 1–2) are a legitimate selection gate. The gown product move is real and is already owned. The Planted speak-fixture card cannot be rewritten.

---

## What holds (verified on this tree)

| plan claim | check |
|---|---|
| Ten D9 stations | `DARK_FACTORY_CHAIN_STATIONS` is ten ids at `multi-case-runner.ts:87-98` |
| Rollup is old and unstamped | `.openclinxr/evidence/issue-288/multi-case-rollup.json` `generatedAt` `2026-08-11T01:25:02.543Z`, no `measuredAgainstCommit` |
| ui-admin has 0 executable `it.fails(` | `rg it\.fails\( apps/ui-admin/src` empty |
| Gown RED has 2 `it.fails` | `the-gown-shell-is-not-sharp-where-no-fold-runs.test.ts:70` and `:88` |
| Camera test has 0 `it.fails` | `the-room-camera-lands-in-the-same-place-twice.test.ts` none |
| Luminance freshness test is an ordinary `it()`, currently a stamp mismatch class | `the-darkness-gate-knows-which-tree-it-measured.test.ts:94` asserts stamp == `runtimeHead()` of `apps/ui-xr/src/main.ts` (`station-luminance-sweep.ts:41-45`) |
| `live:` means zero remaining `it.fails` in that file | `done-when-rules.ts:386-416` |
| `live:` on a missing path fails `missing <path>` | `done-when-rules.ts:403` |
| Planted + absent `live:` file is `planted_red_absent` | `audit-board-graph.ts:99-104` |
| Speak-fixture plant is JSON framing, not pixels | `the-speak-fixture-stills-are-framed-on-the-actor.test.ts:25` and NOT TESTED at `:46` |
| Gown node/mesh names exist | `gown-746-splice.ts:16-21` |
| Cover-shell embed is noted on the rigging station | `multi-case-runner.ts:548-552` |
| Gown GLBs exist and are **tracked** | `git ls-files` lists both `mpfb-gown-*.glb`; not gitignored. `changed:` on them has a land path (unlike #64 cagematch) |
| Integrate lock has no opaque token | `LockResult` is `{acquired, heldBy?, stoleFrom?}` at `integration-lock.ts:81-87`. `integrate.ts` imports acquire/release only (`:4`), acquires `:604`, releases `:725`, never `renewIntegrationLock` |
| `live:` on the luminance plant would force three product REDs | that file has `it.fails` at `:73`, `:85`, `:101` |
| Local slice brief already names the gown RED | `.openclinxr/slices/issue-750/brief.json` `live:` + `run:` of the same test |

The withdrawn-claims table is the strongest part of the document. Keep it.

---

## Block: steps 4–5 (rescope + plant `tsk_27baa1ed86266d7b`)

`tsk_27baa1ed86266d7b` is already **Planted**. BothyBoard freezes `done_when` after Plant. The skill is explicit: workers cannot rewrite the spec; every clause correction happens **before** the plant (`blocked-card-unlock-plan-2026-08-31.md:33` already recorded this about a different card).

Replacing the speak-fixture TREE with the gown TREE on the **same** card is a frozen-contract rewrite. Calling it "rescope then plant" does not make it a first plant.

Required shape:

1. Leave or **close/cancel** `tsk_27baa1ed86266d7b` with the recorded reason: pixels show a shredded gown, the contract asserts JSON ray-hits, and no machine predicate in-repo grades "recognizable human."
2. Do **not** plant a second Bothy card onto `the-gown-shell-is-not-sharp-where-no-fold-runs.test.ts` while issue-750's local brief already lists that `live:`/`run:`.
3. Product work on the gown goes through **issue-750** (or a new Idle→Planted card only after that brief is retired). Dual `live:` owners is the "never plant both" rule the plan already stated (`:128-129`) and then violated in the action table (`:4-5`).

The replacement TREE is otherwise well-formed: two live `it.fails`, generator + both tracked GLBs, capture re-run. Use it on the card that already owns the RED.

---

## Attribution that is still CONSULTED

The pixel grade of `speak-fixture-speaking-1.png` (no head, cyan shard mass, stretcher) is acceptable as MY GRADE if the reviewer actually opened the native 1280² PNG. This review did **not** re-open those pixels.

The jump "cyan mass = `openclinxr_real_garment_from_phenotype_hospital_gown` on `mpfb-gown-adult-patient.glb` because of rigging embed" is labelled CONSULTED in the plan (`:229-230`). Agree: paths exist; causal station was not reproduced here. Do not put `changed:tools/openclinxr/asset-pipeline/anny/automate_blender.py` on a card until a control/treatment on **one** asset shows that file moves the sharpness numbers. The gown on disk is an MPFB-named GLB; Anny `automate_blender.py` may be the wrong rail (D11: MakeClothes/MPFB owns wardrobe).

The gown RED itself measures **interior edge sharpness vs a clean-garment ceiling**, not "looks like a person" and not "camera on the head." Even a perfect green on #750 does not close the original speak-fixture framing question. Say that in the close comment on `tsk_27baa1ed86266d7b`.

#46 still blocks visual garment **appearance** claims. Mesh-sharpness REDs are the allowed lane. Pixel grades of stills stay human.

---

## Other actions

**Steps 6, 7, 8, 9, 11 — do these.** Closing a card whose defect landed under #638, closing a superseded pilot, cancelling a probe whose premise is 0 `it.fails` in ui-admin, then closing the worldview parent, is board hygiene. `tasks.next` already ignores parents. Planting the parent was correctly refused.

**Step 1 (multi-case `--all`) — yes, once, as a selection gate, not as a board-unlock.** Record the fields the plan lists. Do not treat a green rollup as closing any of the six cards. Duration is allowed (D9). If `--all` is multi-hour, start it before any plant discussion.

**Step 2 (luminance sweep) — yes, before touching `tsk_997716b5f42b8930`.** The plan's mechanism correction is right: stamp tracks `main.ts`, not the JSON's own commit. After a fresh sweep, either close the card (if medians moved off black-frame class) or write a **new** Idle card with TREE against the **current** numbers. Do not edit the frozen Planted `done_when`.

**Step 10 — leave blocked until step 2.** Agree.

**`tsk_f500b82767fc7452` — do not plant to unblock the Codex chain.** The three contract defects are real on this tree (string-presence `live:` already green; 50-iter soak vs n=7 regression math; no lock token). Keep them in the plan. When that work is actually selected, plant **after** a RED file exists on disk.

**Step 12 — empty.** "Select first product slice at the step-1 frontier" is not an action until step 1 returns `firstNonDeterministicStation`. Leave it as the output of step 1.

---

## Small factual nits (do not block the admin closes)

- Tree SHA in the headline is `05120405`; current `origin/main` is `74d02b72`. The delta is GitHub Pages copy, not D9 stations. Stamp the review SHA if this file is kept as SSOT.
- `integrate.ts` lock lines are now 604 / 725, not 603 / 724.
- Cover-shell embed is documented on the **rigging** station **and** the clothing station notes (`multi-case-runner.ts:548`). A card that only changes `automate_blender.py` may miss MakeClothes / MPFB wardrobe.
- `.openclinxr/slices/issue-750/brief.json` is under gitignored `.openclinxr/`. Dual ownership is **this machine**, not a clone. A clean checkout has the RED file and no brief. Board-side ownership is still empty unless a Planted Bothy card names that `live:`.

---

## Recommended action list (replaces the plan's 1–12)

| # | action | why |
|---|---|---|
| 1 | Run `multi-case-runner.ts --all` and file the census fields | Selection gate; do not skip |
| 2 | Re-run `station-luminance-sweep.ts` at current HEAD | Existing freshness `it()` is already the instrument |
| 3 | Close `tsk_2c7219bfbba6691e`, `tsk_475bac1eecc4f387`; reap the pilot worktree | Admin |
| 4 | Cancel `tsk_a7d424f578774db9`; then close parent `tsk_7ca4dfcdfb49a622` | Admin; 0 ui-admin `it.fails` |
| 5 | Close `tsk_27baa1ed86266d7b` as wrong-defect-class (JSON framing vs shredded gown). Do not rewrite its TREE | Frozen Planted contract |
| 6 | Gown work: continue issue-750 / the existing gown RED. Do not plant a second `live:` on that file | Dual owner |
| 7 | Leave `tsk_997716b5f42b8930` blocked until step 2; new card only if a current median names a defect | Frozen Planted contract |
| 8 | Commit Codex-hardening WIP to `wt/bothy-tsk_c2822f728a7dde77`; leave blocked; do not plant `tsk_f500b82767fc7452` | Lock token still absent |
| 9 | Next product slice = `firstNonDeterministicStation` from step 1 | Anti-toil: one evidence run, then build |

---

## Claim / not tested (this review)

Claim: protocol freeze on Planted `done_when`; gown RED / camera test / lock types / rollup stamp / ui-admin `it.fails` count / tracked GLBs, as cited above.

Not tested: native re-grade of the three speak-fixture PNGs; `multi-case-runner --all`; luminance sweep at `74d02b72`; issue-750 worktree contents beyond `brief.json`; whether `automate_blender.py` is on the causal path for the shipped MPFB gown GLB.
