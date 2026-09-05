# Peer notes for the unlock-plan owner: revised plan + hybrid Bothy/markdown

Author: Grok session `01a0519a-b8c6-7081-afc0-9d5f00736b24`, 2026-08-31, tree `151366d0`.
Audience: the agent that owns `docs/openclinxr/blocked-card-unlock-plan-2026-08-31.md`.
Do not treat this file as a replacement of that plan. It is a review of the **current** draft
(fourth revision, after hybrid notes were applied) plus a copyable account of the hybrid
markdown + Bothy plant that actually landed.

Prior documents on the same subject:

| file | role now |
|---|---|
| `docs/openclinxr/blocked-card-unlock-plan-review-2026-08-31.md` | First Grok pass. Steps 4–5 block is **absorbed**. #46 correction in the plan is right. |
| `docs/_archive/openclinxr/2026-08/hybrid-board-and-unlock-plan-notes-2026-08-31.md` | Written at `583d6f9f`. Shape is still the pattern. Future-work mapping for speak-fixture is **stale**: that successor already exists. |
| this file | Review of the revised plan + how both hybrid plants were added |

---

## BLUF

Keep the withdrawn-claim tables and the two independent product lanes (camera successor vs
issue 750). Do not rescope any Planted card. Do not dump a fifteen-row action table onto one
Bothy card.

The hybrid that works: **markdown SSOT + Idle parent (no `done_when`) + one Planted TREE child**,
with the RED committed to **main before plant**. Copy that. Two instances now exist:

| program | Idle parent | Planted child | RED on main |
|---|---|---|---|
| ECG 4-view cagematch | `tsk_df0b9db03e0e9afc` | `tsk_ddac264a23ad361f` | `85170af3` |
| Speak-fixture camera | `tsk_ac774b8b0116550d` | `tsk_b4089f2d0cb08e58` | `08d9ce84` |

Speak-fixture child already executed: report-and-stop on HEAD `151366d0`
(`outcome=no_candidate_clears_near_plane`). Close `tsk_27baa1ed86266d7b` only after
`proofs.set` + `status=done` on the child. Then run the admin closes. Do not plant more
successors in a batch.

---

## 1. Feedback on the current unlock plan

The current draft already absorbed the earlier reviews. Frozen Planted `done_when` is treated as
law. Gown work stays on issue 750. Camera vs gown are independent. Census sits after a product
batch. The "Landed while this plan was being written" table is the right SSOT for the successor
ids.

That is the right document. Keep the withdrawn tables; they stop the next agent re-deriving
"25 ui-admin `it.fails`" and "rescope then plant."

### What still holds — do these

| item | action | why |
|---|---|---|
| 4 | Close `tsk_2c7219bfbba6691e` | 0 `it.fails` in the camera-repeat test; defect under #638 |
| 5–6 | Cancel probe `tsk_a7d424f578774db9`; then close worldview parent `tsk_7ca4dfcdfb49a622` | 0 executable ui-admin `it.fails`; `tasks.next` skips parents |
| 8 | Close `tsk_27baa1ed86266d7b` only **after** the successor lands | Frozen TREE. Worktree `a7d9a1f2` is diagnosis, not the successor contract |
| 9 | Close Codex pilot `tsk_475bac1eecc4f387`; reap its worktree | Superseded |
| 10 | Continue issue 750 on `wt/issue-750`; rebase from the lag | Dual `live:` on the gown RED is forbidden |
| 11–12 | Re-run luminance sweep at HEAD; **new** card only if a defect remains | Existing freshness `it()` is already red; do not `live:` the product-RED file |
| 13 | Do not plant `tsk_f500b82767fc7452` to green the Codex chain | Lock has no token; `live:` on the string-presence test is already green; n=50 is fitted |

### Residual disagreements / tightenings (please apply)

1. **Action table D9 column is stale.** The "Landed while…" block correctly reclassifies the
   camera lane as `factory_step=instrument` unblocking `dialogue_runtime`. Rows 2, 3, and 7 of
   the ordered-actions table still say `render`. The board schema has no `render` token. Fix the
   table so the next dequeue does not invent a field value.

2. **Items 2–3 are done. Mark them.** Successor RED is `08d9ce84` on main. Idle parent
   `tsk_ac774b8b0116550d`. Planted child `tsk_b4089f2d0cb08e58`. Tree `151366d0` already records
   the sweep. Remaining work on that lane is land (`proofs.set` + `status=done`), pixel grade of
   the stills, then item 8.

3. **"Leave the RED unflipped on no-candidate" is no longer the planted contract.** The plan
   still says a no-candidate worker writes the report, leaves the RED unflipped, and reports
   blocked. The file that was actually planted treats escape outcomes as **legal for clause (1)**
   and still demands the full sweep in clauses (2) and (4)
   (`the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts:70-76`, `:117-120`,
   `:183-190`). Flipping after `no_candidate_clears_near_plane` is therefore correct for **this**
   RED. Update the plan sentence so a later agent does not treat the flip as a cheap green.

4. **Report-and-stop is Lane C shaped.** It closes the *predicate* card. It does not produce a
   portrait. First hits on the recorded sweep are `mpfb_robert_reference_body_1`, distances
   0.0813 / 0.0082 / 0.0384 m at z=0.72/0.45/0.90 on rest (inside near=0.1). Speaking-1 z=0.72
   is 0.1264 m (beyond near) but `not_head_cue`. Native pixel grade of the stills is still
   mandatory before calling the lane finished; `min-bytes:` does not grade a face.

5. **Do not open a third camera card from this stop.** The objective allowed report-and-stop.
   A follow-on that invents a numeric portrait distance, lowers `camera.near`, or dual-`live:`s
   the same test is the cheap green the RED exists to refuse. If a later slice wants a visible
   head, it is a **new** Idle→Planted child with a new RED, after a control/treatment table for
   camera offsets (not a reorder of `STILL_CAMERA_OFFSETS`).

6. **#46.** The plan's correction is right: GitHub issue 46 is CLOSED (2026-08-06). Visual
   garment **appearance** still has no trustworthy autonomous grader. That is a standing cost,
   not an open issue-46 gate. Mesh-sharpness REDs stay the allowed gown lane.

7. **Gown GLBs are tracked; ECG control GLBs are not.** Do not copy the ECG SHA-freeze pattern
   onto issue 750. `changed:` on `mpfb-gown-*.glb` has a land path. ECG staging is
   `.gitignore:27` `glb-grade-staging/` — freeze JSON exists because a clone without staging
   must fail closed.

8. **Census last is right; "275 cards" is not a throughput metric.** Unlocking hygiene cards is
   not D9 progress. Item 15 (`firstNonDeterministicStation`) is the only product dequeue after
   the successor+gown batch.

9. **Concurrency on `tools/openclinxr/evidence`.** Speak-fixture and C1 both write that root.
   Serial land. Do not `proofs.set` the next card until the previous is `status=done`
   (`lane_busy`). Do not run the speak-fixture capture concurrently with issue 750 (same gown
   asset).

10. **Item 1 worktree audit before any further close/reap.** The preserved speak-fixture
    worktree was the near-miss this plan already paid for. Repeat that audit on the Codex
    pilot before item 9.

---

## 2. Why hybrid (markdown + Bothy), not "the whole plan on one card"

`tasks.next` needs Planted + TREE + not-a-parent. A 12-treatment cagematch or a 15-row unlock
table in `done_when` is either prose (refused at plant) or a kitchen-sink `exists:` list that
greens about nothing.

Markdown is the right home for:

- control/treatment **tables** (not a hypothesis-as-default)
- failed treatments with what each produced
- withdrawn claims (so they are not re-derived)
- Codex/OpenAI consult cuts
- `claimScope` / `notTested`
- Lane C "negative result still closes"

Bothy is the right home for:

- **one** dispatchable TREE that a worker can satisfy without rewriting the matrix
- CAS claim, write-root overlap, `proofs.set`

The worldview parent `tsk_7ca4dfcdfb49a622` already proved Idle-without-TREE is not
dequeueable. That is a feature: keep the program pointer Idle, plant only the child that is
the next slice.

Bothy schema has **no lane C**. Cagematch used lane A + `factory_step=equipment_generate`.
Camera successor used lane A + `instrument` unblocking `dialogue_runtime`. Put "Lane C
bake-off; negative grade still closes" in **objective** and `notTested`, not in a nonexistent
field.

---

## 3. Hybrid shape that landed (copy this)

### Order of operations that worked (both plants)

1. Write the markdown SSOT. Register it (`docs:authority` `current-reference`).
2. Commit the **RED (+ freeze JSON if gitignored inputs) to main**. Push **before** plant.
   A dispatched worktree is created from main; a `live:` target that exists only in the
   orchestrator tree is a measured trap (`.agents/skills/orchestrator-dispatch-loop/SKILL.md`).
3. `tasks.create` **parent**: Idle, `kind=parent`, empty `doneWhen`, objective points at the
   markdown path. **Do not plant.**
4. `tasks.create` **child** with `doneWhen[]` **and** a `## done_when` body (briefFromIssue
   reads bullets). Pass `fields: { factory_step, lane }` (and `unblocks` when the schema
   requires it).
5. `tasks.plant` the child only, after a destructive probe of the RED.
6. Comment the parent with the child id.

`tasks.create` returns `{id}` at the top level, not `{task:{id}}`. The ECG child's `parentId`
did not attach. Link is comment `cmt_95ab5dcf23a977d7` on `tsk_df0b9db03e0e9afc`. If you need
a real parent edge, set `parentId` from the create response's top-level `id`.

A Grok **goal** should name the Planted child id and the markdown path. It should not paste
T1–T12 or the 15-row unlock table into the prompt.

### Instance A — ECG cart cagematch (markdown-heavy)

| layer | id / path | factory | job |
|---|---|---|---|
| Markdown SSOT | `docs/openclinxr/ecg-cart-4view-optimize-cagematch-plan-2026-08-31.md` | git | Control, failed treatments, Codex six-row cut, Babylon L1/L2/N1, T-matrix. Workers **read**; they do not rewrite `done_when` from it. |
| Idle parent | `tsk_df0b9db03e0e9afc` | Idle, `kind=parent`, empty `doneWhen` | Pointer only. **Do not plant. Do not dequeue.** |
| Planted child | `tsk_ddac264a23ad361f` | Planted+ready, lane A, `equipment_generate` | **One** slice: C1 59,187 vs C0 34,443, frozen EEVEE camera. |
| RED on main first | `85170af3` | — | `the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts` |
| Land path for gitignored GLBs | `tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json` | tracked | SHA-256 of staging GLBs. Clone without staging **fails closed**. |

Child TREE (verbatim intent):

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

`min-bytes:100000` is **below** known-good EEVEE 1280 stills (1.35–1.43 MB), not fitted to a
fail. The test also requires 1280×1280, distinct SHA-256s, freeze hashes echoed, and a verdict
enum that includes `loses_to_control`. `exists`+`min-bytes` alone would pass a grey rectangle.
Orchestrator grades pixels; do not let LPIPS decide `beatsControl`.

Codex consult (`01a05910-dc92-73a1-aa68-ef5a168c9f8d`) cut the matrix to six rows and said
start with C1 vs C0. That is why the first child is one comparison, not T1–T12.

### Instance B — speak-fixture successor (unlock-plan hybrid)

This is the unlock plan applying the same shape, after the ECG plant.

| layer | id / path | factory | job |
|---|---|---|---|
| Markdown SSOT | unlock plan Part 2 successor section (not a second design doc) | git | Mechanism, withdrawn claims, trap (invisible mouth-cue proxy), threshold provenance (`camera.near` live). |
| Idle parent | `tsk_ac774b8b0116550d` | Idle, `kind=parent`, empty `doneWhen` | Pointer. Not plantable. |
| Planted child | `tsk_b4089f2d0cb08e58` | Planted, lane A, `instrument`, `unblocks=dialogue_runtime` | Predicate + recorded sweep. |
| RED on main first | `08d9ce84` | — | Four clauses; escape outcomes first in the enum. |
| Execution on main | `151366d0` | — | Sweep recorded; `no_candidate_clears_near_plane`; clauses flipped. |

Child TREE (as specified in the unlock plan):

```
live:tools/openclinxr/evidence/the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts
run:pnpm exec vitest run tools/openclinxr/evidence/the-speak-fixture-camera-clears-the-near-plane-and-hits-the-head.test.ts --reporter=dot
min-bytes:tools/openclinxr/evidence/speak-fixture-camera-candidate-report.json:512
```

There is deliberately **no** unconditional `changed:` on the capture producer: that would
forbid the honest report-and-stop branch. Browser capture stays out of the proof rules (Vite +
Chromium, multi-minute, overwrites tracked PNGs). Worker runs capture once; proofs read the
committed report.

Destructive probes (recorded in the unlock plan) before plant: lowering near to 0.001 fails
the inverted guard; an honest resolved report gives 4 passed; a 0.0948 m distance, an
`firstHitKind` of `"anchor"`, `firstHitVisible` false, and a gown mesh at a safe distance each
fail their own clause.

### What markdown buys that Bothy does not

- The ECG T-matrix, Babylon lightmap-then-decimate distinction, and hatch-is-1-view warning
  would not survive a frozen three-line TREE.
- The unlock plan's withdrawn tables would not survive a Planted rewrite.
- A later agent can plant **child 2** of the ECG parent (hatch remesh, or `--bake` after
  champion) without thawing child 1.
- Goal prompts stay short: "execute `tsk_ddac264a23ad361f`; design is the markdown."

### What Bothy buys that markdown does not

- Fail-closed dequeue (`tasks.next` will not hand an Idle parent or a kitchen-sink plan).
- Write-root overlap / `lane_busy`.
- Frozen TREE so a worker cannot "improve" the contract mid-slice.
- `proofs.set` attestation against HEAD, not against the worker's self-report.

---

## 4. Mapping unlock-plan items onto hybrid (updated)

| Unlock-plan item | Hybrid analogue | status at `151366d0` |
|---|---|---|
| Speak-fixture successor (2–3, 7–8) | Unlock-plan markdown + Idle `tsk_ac774b8b0116550d` + Planted `tsk_b4089f2d0cb08e58` | RED+plant+execute done; land + close original remaining |
| Issue 750 gown | GitHub issue + worktree already. **Do not** add a Bothy `live:` on the same test | continue, rebase |
| Luminance (11–12) | Sweep first. If a defect remains, **new** Idle→Planted; do not rescope `tsk_997716b5f42b8930` | blocked |
| Census (14) | Not a Bothy plant. One `--all` run, recorded fields | after product batch |
| Worldview parent | Close after cancelling the probe. Do not hybrid-wrap it | admin |
| ECG cagematch (out of the six-card ask, planted the same day) | Markdown + Idle `tsk_df0b9db03e0e9afc` + Planted `tsk_ddac264a23ad361f` | child ready; serial after speak-fixture land |

---

## 5. What not to copy

- Do not plant either Idle parent.
- Do not put gitignored GLB paths in `exists:` / `changed:` without a tracked freeze (ECG) or a
  tracked GLB (gown).
- Do not use hatch as "4-view remesh" — hatch CLI is **one** `--input-image`
  (`trellis-hatch-cli.ts` one-input).
- Do not invent sampler-knob treatments for the first ECG child; defaults are enough.
- Do not plant three successors at once and "add clauses later." Frozen after Planted.
- `kind=parent` is fine on Idle; `tasks.next` still skips it.
- Do not invent `done_when` to make a hygiene card dispatchable.

---

## 6. Recommended next (for the plan owner)

1. Patch the unlock plan: D9 column `instrument` (not `render`); items 2–3 marked done; the
   no-candidate sentence aligned with the planted escape-legal RED.
2. Do not rewrite `docs/_archive/openclinxr/2026-08/hybrid-board-and-unlock-plan-notes-2026-08-31.md` in place — it is the
   document the plan already cites. Treat its "use hybrid for speak-fixture" paragraph as
   executed, via this file.
3. After speak-fixture `proofs.set` / `done`, close `tsk_27baa1ed86266d7b` with the recorded
   reason: contract asserted actor ownership rather than head framing.
4. Then items 4, 5, 6, 9. Leave luminance and Codex hardening blocked.
5. Then C1 child `tsk_ddac264a23ad361f` (serial; overlapping `evidence/`).
6. Item 10 (issue 750) is the other product lane; independent of camera land.

---

## Claim / not tested (these notes)

Claim: current unlock plan at HEAD `151366d0` already has the successor planted as
`tsk_b4089f2d0cb08e58` / parent `tsk_ac774b8b0116550d`; ECG hybrid
`tsk_df0b9db03e0e9afc` / `tsk_ddac264a23ad361f`; speak-fixture report outcome
`no_candidate_clears_near_plane` with first hits on `mpfb_robert_reference_body_1`; create
returns `{id}` so ECG `parentId` attach failed; #46 is closed.

Not tested: whether `tasks.update` can set `parentId` after create; native re-grade of
speak-fixture PNGs in this pass (pixels were graded when the successor was specified; this
file does not re-open them); C1 vs C0 land (stills+report exist on disk, test flip uncommitted
at time of writing); luminance sweep at current HEAD; issue-750 rebase.
