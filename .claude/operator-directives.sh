#!/usr/bin/env bash
# Injected into EVERY prompt by the UserPromptSubmit hook in .claude/hooks.json.
#
# WHY THIS EXISTS. The operator observed: "each time I've coached you it seems like you understand
# but then immediately you do a 180 and go back to what feels comfortable." The diagnosed mechanism
# is that the autonomous cron prompt fires ~2,000 words EVERY cycle while a directive fires ONCE and
# is never re-presented at slice-selection time. Repetition wins. Writing the directives into a rules
# file did not fix it — a peer round's verdict was "you reordered the altar, you did not replace the
# religion."
#
# This hook makes the directives fire at the SAME frequency, in the SAME channel, immediately
# adjacent to the cron text they were losing to. It is the only mechanism available that matches the
# competing signal's cadence.
#
# Worker/subagent sessions skip it — they get their brief, not the orchestrator's standing law.

if [ "${OPENCLINXR_WORKER:-0}" = "1" ] || [ "${OPENCLINXR_WORKER:-}" = "true" ] || [ -n "${GROK_SUBAGENT:-}" ]; then
  exit 0
fi

cat <<'DIRECTIVES'

=== OPERATOR DIRECTIVES — standing, from the human, re-presented every prompt ===

D1  AUTOMATION, NOT LLM TOIL. "We're building a factory and need automation in it, not a handful of
    LLMs toiling in non-deterministic ways building things in the factory." Wire deterministic tools;
    do NOT have workers hand-author bespoke geometry code.
D2  PROCEDURAL + HARNESS ONLY. Humans, clothing, rooms, equipment. All other work is on hold.
D3  ISOLATE THE SUBJECT. Full-room capture proves assembly; it does NOT diagnose a subject.
D4  SHRINK WHAT IS UNDER TEST to the minimum that proves the claim.
D5  RESEARCH BEFORE INVENTING. The SECOND failed attempt at a predicate is the trigger, not the fourth.
D6  ASK FOR ALTERNATIVES, not only an attack, grounded in this codebase and its direction.
D7  PERIODIC HONEST REVIEW every 5-8 landed slices. Hand over your own errors, not your successes.
D8  MINIMAL GENERATOR CONFIG; the pipeline refines afterwards.
D9  DARK FACTORY. Each tool is a deterministic station in a PIPELINE. Optimize the WHOLE pipeline.
    Execution DURATION IS NOT A CONSTRAINT. The measure is: take MULTIPLE CASES through it and get a
    full experience capable of running an examination WITH NO FURTHER LLM INVOLVEMENT. LLMs in the
    product only for narrow purposes (e.g. dynamic dialogue) where absolutely necessary.
D10 CONSULT GROK AS A PEER, IN CONVERSATION — multi-turn via --resume, pushing back. A one-shot
    prompt is not a consult.

BEFORE WRITING ANY CAPTURE LINE IN A done_when, answer this (D3/D4):
  Is the claim about a THING or a COMPOSITION?
    THING       (is this prop/figure/garment shaped right?) -> ISOLATED HARNESS, subject alone.
                tools/openclinxr/evidence/isolated-subject-harness.ts. Name it in the done_when.
    COMPOSITION (does the assembled room/scene still hold together?) -> full capture, and NAME THE
                STATION. Never let the default station stand in for one that exhibits the defect.
  Measured today: 46 evidence modules boot the full app; 5 use the isolated harness (#170). Two
  consecutive retros put verify+capture as the LARGEST turn bucket (#185 12-15/51, #226 12-16/36).
  That is the cost of testing something larger than the claim.

BEFORE ANY DISPATCH, answer these three IN WRITING (not in your head):
  1. Which directive does this slice serve?
  2. Which does it violate? "None" must be defended, not assumed.
  3. Whose lane is this, and what does the registry say that role runs on? Role from the PORTFOLIO
     table, model from role-harness-policy. Unenforced: nothing checks role-against-lane, so
     picking asset-pipeline-lead over xr-systems-architect for a wardrobe slice is still only your
     judgement. dispatch() will catch a wrong MODEL; it cannot catch a wrong ROLE.
  4. Am I choosing this because it is RIGHT, or because I already know the file and the fix?
     The measured failure mode is CYCLE-CERTAINTY MAXIMISATION — picking whatever most likely yields
     a green report this cycle. Wiring a PROVEN-BUT-UNCONSUMED component beats proving a new one.

SKILLS — LOAD THESE, DO NOT RE-DERIVE THEM. Each exists because the approach was forgotten and
re-paid for at least once. `.agents/skills/<name>/SKILL.md`.
  gh-body-file                  BEFORE any gh issue/PR/comment write. Backticks in --body are
                                command substitution: the shell eats them, gh exits 0, the body
                                publishes mangled. Always --body-file from a <<'EOF' heredoc.
                                Paid twice in one hour, the second time AFTER writing the lesson down.
  orchestrator-dispatch-loop    BEFORE dispatching or harvesting. dispatch(repoRoot, options) is TWO
                                args; integrate needs contractForSlice or merge-kill refuses;
                                factory_step HAS a colon and done_when does NOT; a runner outside the
                                repo needs an async IIFE. Also the clause hygiene a probe will
                                otherwise teach you: a vacuity guard cannot live inside the it.fails
                                it guards, a guard must not forbid the fix, substring checks are
                                prefix-matchable.
  agent-session-continuity      BEFORE resuming anything. A wrong session id CONFABULATES, it does not
                                error. Killed dispatches write NO ledger entry. Resumes need all three
                                env vars or the docs-hygiene hook dirties the tree. NEVER
                                dispatch({worktree:true, resume}) — it resets the worktree first.
  delegated-worker-contract     the WORKER's side; dispatch() already injects it per role.
  worker-scoped-session         why OPENCLINXR_WORKER=1 is not optional.
  per-job-temp / turborepo      temp-file and output-budget discipline for anything you spawn.

  If you are about to write a shell one-liner that reproduces something one of these describes, you
  have already lost the tick. Read the skill.

MECHANICALLY ENFORCED: board-brief.ts refuses any issue lacking `## factory_step: <enum>`, refuses
`instrument` without `unblocks: <step>`, and refuses a clothing slice naming no tool path.
  dispatch() resolves --model from the ROLE's harness policy and THROWS on a tier downgrade unless
  you pass modelDowngradeReason (#461). It is a RANK: fast_bounded/expert_review roles keep flash
  with no ceremony; a standard_execution role on flash is refused. Roleless stays flash-first.
  Why this became a throw: five consecutive write slices ran xr-systems-architect on flash because
  the default ignored the role. Nothing warned. Intention was the only guard and it lost 5/5.

THE TEST THE OPERATOR IS APPLYING: of the next five landed slices, do >=3 move a pipeline station
from LLM-authored to deterministic? If >=3 are instead another asset-class fix, the stated diagnosis
was self-serving.
DIRECTIVES
