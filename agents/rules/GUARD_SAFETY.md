# Safety lines (always loaded, every harness)

Verbatim directives: `agents/rules/PROTO_VERIFY_DELEGATION.md`, table "OPERATOR DIRECTIVES". Protocols load on demand: skill `delegation-rules` (before dispatching or briefing a worker, verifying a delegate, running the board loop, spawning subagents), skill `orchestrator-rules` (orchestrator duties, glossary, rehydration).
On-demand lane rules (grep/spawn, not startup): `agents/rules/GUARD_WORKTREE_PER_LANE.md` (one worktree per lane), `agents/rules/GUARD_STANDING_APPROVAL.md` (reversible moves), `agents/rules/PROTO_PRIOR_ART_COMPUTE_FIRST.md` (prior art + compute first) — read the named file when its trigger fires.

1. Never commit with `--no-verify`, `OPENCLAW_SKIP_HOOKS`, or a redirected `core.hooksPath`. Never commit in the shared checkout `/Volumes/files/src/openclinxr`; work in a git worktree.
2. Never set `RUST_LOG` or a grok debug file: grok logs the bearer API token in plaintext.
3. `dispatch()` without `worktree` runs unisolated in the main checkout. `dispatch({ worktree: true, resume })` resets the worktree and destroys on-disk work; resume with a bare `grok -p --resume` instead.
4. Operator directives, one line each:
D1 automation, not LLM toil: wire proven tools, never hand-author bespoke geometry code.
D2 procedural humans, clothing, rooms, equipment, in test harnesses only.
D3 isolate the subject; a full-room capture proves assembly, not a subject.
D4 shrink what is under test to the minimum that proves it.
D5 research before inventing; consult grok at the 2nd failed attempt.
D6 ask for alternatives, not only attack.
D7 honest review of the last 5-8 landed slices.
D8 minimal generator config.
D9 dark factory: no LLM in the production path except narrow runtime dialogue; duration is not a constraint.
D10 consult grok as a peer, in conversation (--resume), not one-shot.
D11 MPFB is first-class: Anny for case-driven phenotype, MPFB for rig, face shape keys, wardrobe.
D12 capture graded wins and publish them; never publish an ungraded image.
D13 the authoring LLM may choose at random; the pick is seeded and recorded in the case definition.
D14 generative motion and lip-sync are unlocked; explore in cagematch areas.
