---
id: DELEGATION_OPTIMIZATION
authority: agent-ops-operating-plan
status: executable
owner: claude-manager (CEO) + pmo (cadence) + openclaw-drift-police (audit)
created: 2026-08-03
---

# Self-Optimizing Multi-Provider Delegation Plan

**Thesis (to be proven, not assumed):** the cheapest provider that clears a task-class quality bar should do that class of work, and the correct assignment is *discovered by measurement*, not by prior belief. Claude manages; Grok 4.5 and DeepSeek 4 execute where they win on value/cost; every routing decision is backed by a scored ledger row.

**Manager = Claude** (planning, decomposition, verification incl. multimodal, integration, drift-control). **Workers = Grok 4.5 (`grok-4.5`, vision-capable, ~$6/1M), DeepSeek 4 (`deepseek-v4-pro` ~$1.80/1M, `deepseek-v4-flash` ~$0.20/1M).** Dispatch is proven: `grok -p "<task>" --model <id> --output-format json` returns text + per-model `usage` (validated live 2026-08-03: DeepSeek-flash round-trip, 38.5k in / 7 out).

**Hard rule — no unproven assumptions.** Forbidden strings in any decision rationale: "Claude is better", "DeepSeek is dumb", "Grok can't see", "obviously X". Every claim cites a `delegation-ledger` row id (measured quality + measured USD). Priors are *seeds only*, overwritten by the first 3 scored samples per (class, model).

---

## 0. Rate card completion (blocker — do first)

`packages/openclinxr/agent-loop/src/model-pricing.ts` has Grok/DeepSeek but **no Claude rows**. Add (blended, re-verify weekly):
`claude-haiku` (~$2/1M), `claude-sonnet` (~$6/1M), `claude-opus` (~$12/1M), `grok-code-fast`/`grok-4.5-fast` if distinct. Then cross-provider USD is comparable in one `resolveModelPrice`. This is the costing basis the plan scores against.

Cost hierarchy after completion (blended $/1M): **deepseek-flash 0.20 ≪ deepseek-pro 1.80 < grok-4.5 6.0 ≈ claude-sonnet 6.0 < grok-build 10 ≈ claude-opus 12.** DeepSeek-flash is ~30× cheaper than the mid tier — the prize is proving how much real work it can carry.

---

## 1. Task taxonomy (routing classes)

| Class | Examples from the shore-up work | Verification signal |
|---|---|---|
| `mechanical-wiring` | pnpm scripts, gate registration, eventType passthrough | tests + typecheck pass |
| `test-scaffold` | vitest cases mirroring a pattern | tests run + assert real behavior |
| `doc-sweep` | registry entries, README, drift fixes | `docs:drift-check` green |
| `bounded-impl` | Q4 durable round-trip, generation manifest emit | targeted test + gate |
| `cross-package-refactor` | orchestrate default-path rework | full package tests |
| `frontend-surface` | in-app Humanoid Studio / iteration view | Playwright render + no page errors |
| `planning-decomposition` | slice specs, sequencing | manager judgment (rubric) |
| `verification` | reviewing a worker diff | correctness of the review vs ground truth |
| `visual-quality-judgment` | "is this skin/garment convincing?" | ground-truth image checks + agreement |
| `adversarial-critique` | second-opinion / red-team a plan | novel valid findings surfaced |

Each shore-up slice is tagged with a class before dispatch.

---

## 2. The scoring engine (measured, in-repo)

New CLI package of thin tsx tools under `tools/openclinxr/delegation/` writing to `.openclinxr/delegation/`:

- **`delegate:dispatch`** — given `{taskClass, model, prompt|promptJsonFile, worktree?}`, bakes the guardrail prompt via `pnpm grok:agent:spawn-spec --role <role>` when a Grok/DeepSeek target, runs `grok -p … --model <id> --output-format json --cwd <wt> --max-turns N` (or performs the work in-session when target = Claude), captures `usage`/`modelUsage`, and records the raw result + git diff hash.
- **`delegate:score`** — computes, for the dispatch:
  - **cost_usd** = `estimateUsdFromTotalTokens(totalTokens, model)` (extend for input/output split via `usage`).
  - **quality ∈ [0,1]** = weighted blend of (a) *deterministic* gates for the class (tests/typecheck/drift/Playwright — pass=1, fail=0, partial=ratio) and (b) *judge* score from a rubric (see §4), with a **hard floor**: any deterministic gate failure caps quality ≤ 0.3 regardless of judge.
  - **value** = `quality / (cost_usd + latency_penalty + ε)`, plus a **floor rule**: if quality < class bar, value = 0 (cheap garbage is worthless). `latency_penalty` monetizes wall-clock (`$/hr_of_manager_wait × seconds`) so a $0.01 worker that takes 3 min can lose to a $0.05 worker that takes 15s when the output is on the critical path. Speed of *valuable* output is a first-class term, not an afterthought.
- **`delegate:router`** — reads the ledger, maintains per-(class, model) EMA of quality, cost, value + sample count + variance; emits `.openclinxr/delegation/router.json`: for each class, the ranked models by value with confidence, and the **current pick** = highest-value model whose lower-confidence-bound quality ≥ class bar.
- **`delegate:scorecard`** — human/website-readable rollup (per class: winner, quality, $/task, n, last-updated) → feeds the in-app studio + honest website update.

Reuse: `model-pricing.ts`, `task-cost-rollup.ts`, `grok-tier-cli.ts`, `openclaw:task-cost`, ccusage; `grok:agent:spawn-spec` for prompt baking; worktree isolation for parallel writers.

---

### 2.5 Coded-over-agentic gate (route computable work to code — it's ~free and instant)

Before any dispatch, the manager asks: **"is this deterministic/computable?"** If yes, it runs *code*, not a model — local compute is ~$0 and milliseconds; every agentic call costs tokens + seconds-to-minutes. Reserve models for reasoning/judgment/generation.

Already applied in this effort (proof it's real, not a slogan):
- **Cost computation** → `estimateUsdFromSplit()` (pure code), never "ask a model what this cost".
- **Token counts** → grok `usage` JSON / ccusage, not an LLM estimate.
- **Price refresh** → a web-service fetch + parse (`delegate:refresh-prices`), not a model guess (done live 2026-08-03).
- **Gate outcomes** → tests / typecheck / `docs:drift-check` / Playwright, not "does this look right?".
- **Router selection** → EMA arithmetic, not an LLM picking a model.
- **Ledger/rollup** → deterministic scripts.

Coded-offload candidates to *keep* hunting during shore-up: image ground-truth checks (pixel/region asserts, `Box3`/vertex math for "is the torso clothed" before spending a vision call), GLB/schema validation (gltf-transform reads), diff/lint/format, artifact registry updates, screenshot bbox diffs. A vision *judgment* stays agentic; a vision *measurement* (color present? region non-empty?) becomes code. **Rule of thumb: measure with code, judge with a model — and only judge what code can't measure.**

## 3. Capability-proof experiments (kill the assumptions — run before trusting the router)

Each is an **A/B on the identical task across ≥2 models**, scored into the ledger. Priors are discarded once n≥3.

| # | Assumption under test | Experiment (identical input, cross-model) | Ground-truth / scoring |
|---|---|---|---|
| P1 | **Grok 4.5 has real vision** | `grok --prompt-json '{blocks:[{type:image, source:base64(<humanoid render>)}, {type:text, "Describe what the patient is wearing and rate clothing realism 0-1 with 3 concrete reasons"}]}' --model grok-4.5 --output-format json` vs same image to Claude | Blind ground-truth: image has a *known* teal-box garment + nude torso. Score = does it correctly identify the box/nudity? (verifiable, not opinion). Also record cost. |
| P2 | **DeepSeek can carry `mechanical-wiring`/`bounded-impl`** | Dispatch the clinical-touch Q4 review-packet eventType wiring to `deepseek-v4-pro` AND `grok-4.5` AND note what Claude-alone would score | Deterministic: does the diff compile + pass the targeted test the manager wrote? quality/cost per model. |
| P3 | **Grok 4.5 gives a *different, valuable* perspective** | Give the *same* design question (e.g., "best approach to the generation manifest") to `grok-4.5` and to Claude; manager diff-judges | Score = count of *valid, novel* points Grok surfaces that Claude did not (and vice-versa). Cross-perspective value is measured, not asserted. |
| P4 | **Claude's premium is justified for `verification`/`visual-quality-judgment`** | Have DeepSeek-pro, Grok-4.5, and Claude each *review* a seeded diff with a *known* injected bug, and each *judge* a render with a *known* defect | Detection rate of the known defect per model per $ → proves whether the premium buys real quality on these classes or not. |
| P5 | **DeepSeek-flash floor** | Same `doc-sweep` task to flash vs pro | Where flash passes gates, it wins on value ~30×; find the class boundary where flash stops clearing the bar. |

Output: 5 seeded scorecards replacing all priors with measured (class, model) → quality/cost/value.

---

## 4. Anti-bias scoring rubric (so quality is measured, not vibed)

- **Deterministic first**: every class has an executable gate (tests, typecheck, `docs:drift-check`, Playwright evidence, the clinical-touch/BVH smokes). Gate is the spine; the judge only modulates within a passing gate.
- **Judge = blind + cross-provider**: quality judging is itself delegated to ≥2 providers on the *same* artifact and averaged; disagreement > 0.3 flags the row for manager review (prevents any single model's bias — including Claude's — from setting the score).
- **Vision judging uses ground truth**: visual scores must reference *verifiable* image facts (object present/absent, count, color) seeded by the manager, not pure aesthetics; aesthetic scores are recorded separately and never gate.
- **Escalation is data**: a worker output that fails its gate → escalate to next tier, and **record the failure** as a quality=low, cost-wasted row. Self-correction is logged, not hidden.
- **Confidence + drift**: router uses lower-confidence-bound (quality − k·stderr) so small-n cheap wins don't over-promote; re-run P1–P5 weekly (prices/models drift) and on any `stopReason` anomaly.

---

## 5. The workload = the shore-up effort (product progress *is* the experiment corpus)

Each slice is dispatched through the router; the routing is scored; product ships.

| Slice | Class | Seed route (pre-proof) | Manager (Claude) role |
|---|---|---|---|
| S1 Gate/CI wiring + doc registration (BVH+clinical-touch gates into `agent:verify`, benchmark-gate, evidence-index) | `doc-sweep`/`mechanical-wiring` | deepseek-flash→pro | write spec, verify gates green |
| S2 Clinical-touch **Q4 durable round-trip** + `clinical.touch.*` review eventType | `bounded-impl` | deepseek-pro | run emission→admin-replay, verify a real touch turn |
| S3 **Generation manifest** + make full-quality `orchestrate_character` the default | `cross-package-refactor` | grok-4.5 / deepseek-pro | verify one-command run + manifest schema |
| S4 **In-app Humanoid Studio / iteration view** (pipeline stages + v1→vN lineage + live GLB) | `frontend-surface` | grok-4.5 exec + Claude verify | Playwright render, no errors, lineage renders |
| S5 **Skin winner promotion** | `visual-quality-judgment` | Claude + grok-4.5 (P1 vision) | multimodal judge panel, promote one, bake default |
| S6 **Garment de-box** | `visual-quality-judgment`+`bounded-impl` | grok-4.5 vision loop + worker geo edits | iterate until ground-truth "clothed torso" passes |

S5/S6 are where the *manager-with-eyes* thesis pays off and where P1/P4 vision proofs get real-workload confirmation. S1–S4 are where DeepSeek's value/cost gets proven on breadth.

---

## 6. The manager loop (executable, runs locally so it can reach Grok+Blender+GPU)

Claude (this agent, or a local `/loop`) runs:

1. **Rehydrate**: `router.json`, `delegation-ledger.jsonl`, backlog, guardrail snapshot.
2. **Select** next shore-up slice; **classify**; router returns candidate model(s).
3. **A/B gate**: if the class has n<3 for the candidate *or* a challenger within 20% value, dispatch the *same* task to both (parallel, isolated worktrees) to keep scoring honest.
4. **Dispatch**: `delegate:dispatch` (Grok/DeepSeek headless, parallel via background) or do-it-in-session (Claude). Capture usage.
5. **Verify**: deterministic gates + blind cross-provider judge (+ multimodal for visual). Produce quality.
6. **Score + update**: `delegate:score` → ledger row; `delegate:router` → EMA update; on gate-fail, escalate + record.
7. **Integrate**: manager reviews winning diff, merges worktree, commits.
8. **Publish honest progress**: `delegate:scorecard` + slice evidence → in-app studio + website update, **gated on verified evidence only** (Claude is the skeptic-with-eyes).
9. **Loop**; weekly **meta-review**: re-run P1–P5, diff router vs last week, record drift.

Autonomy: fully unattended = a persistent **local** Claude loop (asset stages need local Blender/GPU; cloud Routines can't reach them). Non-local slices (S1/S2 wiring) *could* run as a cloud Routine.

---

## 7. Proof artifacts (what "scored, not hand-waved" produces)

- `.openclinxr/delegation/delegation-ledger.jsonl` — every dispatch: `{ts, taskId, class, model, provider, inTok, outTok, usd, gate:{name,pass}, judgeScores:[per-provider], quality, value, verdict, escalatedFrom?, diffHash, ledgerId}`.
- `.openclinxr/delegation/router.json` — per-class ranked models w/ quality, $/task, value, n, confidence, current pick, lastProbe.
- `.openclinxr/delegation/scorecard.md` + a studio panel — the living proof: "class X → model Y wins at quality 0.86, $0.04/task, n=12, since <date>."
- Weekly `probe-report-<date>.json` — P1–P5 re-run deltas (catches "grok-4.5 got cheaper", "deepseek regressed").

Every `PROJECT_STATUS` slice checkpoint gains a `Delegation:` line citing the ledgerId + chosen model + value — the audit trail that replaces belief with evidence.

---

## 8. Day-1 execution order (immediately runnable)

1. **Add Claude rows to `model-pricing.ts`** (§0) + a test. *(mechanical-wiring — dispatch to DeepSeek, Claude verifies; first real ledger row.)*
2. **Scaffold `tools/openclinxr/delegation/` harness** (`dispatch`/`score`/`router`/`scorecard`) + pnpm scripts. *(bounded-impl — A/B DeepSeek-pro vs Grok-4.5, Claude integrates.)*
3. **Run P1–P5** (feed the humanoid render for P1 vision; seed a known-bug diff for P4) → replace priors with measured router. *(This is the "prove the assumptions" gate — nothing routes on belief after this.)*
4. **Start the manager loop on S1**, then S2… while §7 artifacts accumulate; publish the first scorecard once n≥3 on two classes.

**Definition of done for the *optimization* effort (separate from shipping shore-up):** every task class has n≥5 scored samples across ≥2 providers, the router's picks are all evidence-backed (zero prior-only routes), P1–P5 are green with recorded numbers, and the scorecard shows a *measured* value/cost frontier — with at least one prior assumption **overturned by data** and recorded (proof the loop actually learns, not just confirms).

Non-negotiable guardrails carried in: visibility/anti-toil/Q-gates, `notEvidenceFor` on artifacts, no AGPL/NC in git, honest website posture, all production/clinical/scoring gates false.
