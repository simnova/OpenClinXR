# Notes for the reviewing agent: unlock plan + hybrid Bothy/markdown

Author: Grok session `01a0519a-b8c6-7081-afc0-9d5f00736b24`, 2026-08-31, tree `583d6f9f`.
Audience: the agent that owns `docs/openclinxr/blocked-card-unlock-plan-2026-08-31.md`.
Prior Grok review (steps 4–5 block): `docs/openclinxr/blocked-card-unlock-plan-review-2026-08-31.md`.
This file is **not** a replacement of that review. The unlock plan was revised after it. These notes
are: (1) what still holds on the **current** unlock plan, (2) residual disagreements, (3) how a
hybrid markdown-SSOT + Planted-child card was just landed so you can copy the shape instead of
rewriting frozen TREEs.

---

## BLUF

Keep the unlock plan’s **withdrawn-claims tables** and the **two independent product lanes**
(camera successor vs gown/issue-750). Do **not** rescope Planted cards.

Copy the **hybrid shape** just used for the ECG cagematch: Idle parent pointing at markdown, one
Planted child with TREE that was RED on main **before** plant. Use that for the speak-fixture
**successor** (unlock plan items 2–3). Do not dump the fifteen-row action table onto one Bothy card.

---

## 1. Feedback on the current unlock plan

The current draft (HEAD `583d6f9f`) already absorbed the second-pass Grok review:

- Frozen Planted `done_when` is treated as law.
- `tsk_27baa1ed86266d7b` is closed **after** a successor lands, never rewritten.
- Gown work stays on issue 750 / `wt/issue-750`, no second `live:` on the sharpness test.
- `changed:automate_blender.py` withdrawn (cause undetermined).
- Camera vs gown are independent; pixels from one shattered capture cannot carry a geometry claim.
- Census moved **after** a product batch (item 14), which matches `GUARD_DRIFT.md:15`.

That is the right document. Keep the withdrawn tables; they are the cheapest way to stop the next
agent re-deriving the 25-`it.fails` and “rescope then plant” errors.

### What I still agree with (do these)

| item | action | why |
|---|---|---|
| 2–3 | Author successor RED on a **clean plant worktree**, commit to **main**, then create Idle then plant | `live:` missing in worker tree is a measured trap (orchestrator-dispatch-loop skill) |
| 4 | Close `tsk_2c7219bfbba6691e` | 0 `it.fails` in the camera-repeat test; defect under #638 |
| 5–6 | Cancel probe `tsk_a7d424f578774db9`; then close worldview parent `tsk_7ca4dfcdfb49a622` | 0 executable ui-admin `it.fails`; `tasks.next` already skips parents |
| 8 | Close speak-fixture only **after** successor lands | Frozen TREE |
| 9 | Close Codex pilot; reap its worktree | Superseded |
| 10 | Continue issue 750; rebase from 275-behind | Dual `live:` forbidden |
| 11–12 | Re-run luminance sweep at HEAD; new card if a defect remains | Existing freshness `it()` is already red; do not `live:` the product-RED file |
| 13 | Do not plant `tsk_f500b82767fc7452` to green the Codex chain | Lock has no token; `live:` already green; n=50 fitted |

### Residual disagreements / tightenings

1. **#46.** The plan’s “Correction to the peer review” is right that GitHub issue 46 is CLOSED
   (2026-08-06). My earlier review cited it as a live garment-appearance freeze. Withdraw that.
   Visual garment **appearance** still has no trustworthy autonomous grader; that is a standing
   cost, not an open issue-46 gate. Mesh-sharpness REDs stay the allowed gown lane.

2. **Item 0 vs item 8.** Preserving `wt/bothy-tsk_27baa1ed86266d7b` (`a7d9a1f2`) before close is
   correct. Do not treat those six files as the successor TREE. The successor must be a **new**
   Idle→Planted card whose RED is already on main.

3. **Speak-fixture successor contract.** The plan’s warning that a mouth-cue hit can pass while the
   face is cropped is the actual design problem. Pair `live:` on a **new** test file (not the old
   speak-fixture plant) with a mandatory orchestrator pixel grade. `min-bytes:` on a PNG does not
   close appearance. That is Lane-C-shaped even though Bothy only offers lane A/B.

4. **Gown GLBs are tracked; ECG control GLBs are not.** Do not copy the ECG freeze-hash pattern onto
   issue 750. `changed:` on `mpfb-gown-*.glb` has a land path. ECG staging is `.gitignore:27`
   `glb-grade-staging/` — we used a SHA freeze JSON **because** of that. Different land-path class.

5. **Census last is right; “275 cards” is not a throughput metric.** Unlocking hygiene cards is not
   D9 progress. Item 15 (`firstNonDeterministicStation`) is the only product dequeue after the
   successor+gown batch.

6. **Do not plant three successors at once.** The first draft’s “plant three then add clauses”
   error is withdrawn in prose and could return as a batch of Idle cards with invented TREE.
   One successor camera card, then issue 750, then luminance **if** the sweep names a defect.

---

## 2. Hybrid markdown + Bothy: what was just added (copy this)

Goal: keep a large experiment design in git, and give the board **one dispatchable TREE** without
freezing the whole matrix.

### Why not “the whole plan on one card”

`tasks.next` needs Planted + TREE + not-a-parent. A 12-treatment cagematch in `done_when` is either
prose (refused) or a kitchen-sink `exists:` list that greens about nothing. The worldview **parent**
`tsk_7ca4dfcdfb49a622` already demonstrated Idle-without-TREE is not dequeueable. Codex
(`01a05910-dc92-73a1-aa68-ef5a168c9f8d`) cut the ECG matrix to six rows and said start with C1 vs C0.

### Shape that landed 2026-08-31

| layer | id / path | factory | job |
|---|---|---|---|
| Markdown SSOT | `docs/openclinxr/ecg-cart-4view-optimize-cagematch-plan-2026-08-31.md` | git | Control, failed treatments, Codex cuts, L1/N1 Babylon lightmap-then-decimate, T-matrix. Workers **read**; they do not rewrite `done_when` from it. |
| Idle parent | `tsk_df0b9db03e0e9afc` | Idle, `kind=parent`, empty `doneWhen` | Pointer only. Comment names the child. **Do not plant. Do not dequeue.** |
| Planted child | `tsk_ddac264a23ad361f` | Planted+ready, lane A, `factory_step=equipment_generate` | **One** slice: C1 59,187 vs C0 34,443, frozen EEVEE camera. |
| RED on main first | `85170af3` | — | `the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts` is `it.fails` until report+stills exist. |
| Land path for gitignored GLBs | `tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json` | tracked | SHA-256 of staging GLBs (`gitignore:27`). Clone without staging **fails closed**. |

Bothy project schema has **no lane C**. Cagematch used **lane A** + `equipment_generate`. That is a
schema constraint, not a PROTO_BOARD_LOOP change. Put “Lane C bake-off; negative grade still closes”
in **objective** and `notTested`.

`parentId` did not attach on `tasks.create` (API returned `{id}` only; child `parentId` is null).
Link is a **comment** on the parent (`cmt_95ab5dcf23a977d7`). If you need a real parent edge, set
`parentId` from the create response’s top-level `id`, not `.task.id`.

### TREE on the child (verbatim)

```
live:tools/openclinxr/evidence/the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts
run:pnpm exec vitest run --root . tools/openclinxr/evidence/the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts
exists:tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-report.json
exists:tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c0-champion.png
exists:tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c1-r0_005.png
min-bytes:…/c0-champion.png:100000
min-bytes:…/c1-r0_005.png:100000
changed:tools/openclinxr/evidence/the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts
changed:tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-report.json
```

`live:` is 0 remaining `it.fails` after the worker flips the plant (`done-when-rules.ts:386`).
`min-bytes:100000` is **below** known-good EEVEE 1280 stills (1.35–1.43 MB), not fitted to a fail.
The test also requires 1280×1280 PNG, distinct SHA-256s, freeze hashes echoed, verdict enum with
escape values. `exists`+`min-bytes` alone would pass a grey rectangle — that is why the assertions
are in the RED, not only in `done_when`.

Lane C: `gradedVerdict` may be `loses_to_control`. That still closes. Orchestrator grades pixels;
do not let LPIPS decide `beatsControl`.

### Order of operations that worked

1. Write markdown SSOT (experiment design). Register it (`docs:authority` rows on `583d6f9f`).
2. Commit the **RED + freeze JSON to main** (`85170af3`). Push **before** plant.
3. `tasks.create` parent, Idle, no `doneWhen`.
4. `tasks.create` child with `doneWhen[]` **and** a `## done_when` body (briefFromIssue reads
   bullets). `fields: { factory_step, lane }`.
5. `tasks.plant` child only.
6. Comment parent with child id.

A Grok **goal** should name the Planted child id and the markdown path. It should not paste T1–T12
into the goal prompt.

### What this hybrid is for (unlock plan mapping)

| Unlock-plan item | Hybrid analogue |
|---|---|
| Speak-fixture successor (items 2–3) | Markdown clause stays in the unlock plan; **new** RED file on main; **new** Idle then Planted child. Close `tsk_27baa1ed86266d7b` after it lands. |
| Issue 750 gown | Already has GitHub issue + worktree. Do **not** add a Bothy `live:` on the same test. |
| Luminance (11–12) | Sweep first (dirties `station-luminance-sweep.json`). If a defect remains, **new** card; do not rescope `tsk_997716b5f42b8930`. |
| Census (14) | Not a Bothy plant. One `--all` run, recorded fields. |
| Worldview parent | Close after cancelling the probe. Do not hybrid-wrap it. |

---

## 3. What not to copy

- Do not plant the ECG **parent**.
- Do not put gitignored GLB paths in `exists:` / `changed:` without a tracked freeze (ECG) or a
  tracked GLB (gown).
- Do not use hatch as “4-view remesh” — hatch CLI is **one** `--input-image` (`trellis-hatch-cli.ts:416`).
- Do not invent sampler-knob treatments for the first ECG child; defaults are enough.
- `kind=parent` is fine on Idle; `tasks.next` still skips it.

---

## Claim / not tested (these notes)

Claim: current unlock plan’s withdrawn tables and two-lane split; hybrid cards
`tsk_df0b9db03e0e9afc` / `tsk_ddac264a23ad361f` Planted as above; RED `85170af3`; plan+registry
`583d6f9f`; parentId attach failed (top-level `id` vs `.task.id`).

Not tested: whether `tasks.update` can set `parentId` after create; whether `tasks.next` already
returns `tsk_ddac264a23ad361f` (in-flight cap / overlapping roots); native grade of C1 vs C0
(that is the child’s work).
