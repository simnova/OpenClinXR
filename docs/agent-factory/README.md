# OpenClinXR Agent Factory

This directory is the operating manual for the OpenClinXR Agent Factory: a repo-native multi-agent planning system that improves the OpenClinXR system design without building the product itself.

The factory has four layers:

1. **Coordinator and Archivist Layer**: manages loops, memory, sources, scorecards, and synthesis.
2. **Core Design Team**: creates the constructive solution plan.
3. **Adversarial Challenge Team**: attacks the plan and produces a stronger counterplan.
4. **Senior Leadership Team**: approves, blocks, or sends the plan back for revision.

Specialty physicians, legal counsel, compliance counsel, and IP/open-source counsel are first-class participants. They receive persistent memory and can block approval when their risk domain is unresolved.

## Operating Rule

The factory is for planning and design maturity. It must not generate OpenClinXR product implementation code unless a separate implementation plan is reviewed and approved.

## Implementation-Time Steering Rule

During autonomous code work, use the Agent Factory as focus memory (via `agents/**/charter.md`, `agents/**/memory.md`, `.agent-factory/memory-index.json`), not as a reason to restart broad planning.

Per current AGENTS.md and state files (PROJECT_COORDINATION_INDEX.md, AUTONOMOUS_WORK_PLAN.md, worker-backlog-and-validation-matrix.md):

- Primary daily driver for product advancement: OpenClaw-style continuous small deterministic slices using per-slice records in the canonical state md files, lease for unattended, `pnpm docs:drift-check` + `agent:alignment` guards.
- Full iteration loop (this factory's 00-brief through 08-memory-update-log, or `pnpm agent:loop`): use only for plateau recovery, major planning, broad drift review, or leadership synthesis. Do not run for routine implementation.
- Rehydration for any session/compact/heartbeat: read only the "Current State Snapshot" blocks (first ~60-80 lines) in the 3 state files + AGENTS top. Use `tail | grep` or `grep` tool for history. Use `read_file` with offset+limit on long files.
- Hyper token-efficient & long-run practices (see AGENTS.md): focused cmds/tests (`-t "name"`), `pnpm openclaw:lease` before edits, snapshots + Efficiency Quick Refs, scheduler/monitor for persistent heartbeats, no chat summaries (status only in canonical files).
- Consult agent roles when: task selection scattered, repeated evidence toil, need critique, unclear ownership. Map to repo roles. Coordinator/orchestration first.

`PROJECT_COORDINATION_INDEX.md` is the short coordinator-facing control index (with active queue and Efficiency Quick Ref) that decides slices and when to consult factory memory.

Do not run full factory loop just to continue routine implementation. Pick product-shaping worker slice from `AUTONOMOUS_WORK_PLAN.md` and `docs/openclinxr/worker-backlog-and-validation-matrix.md` (current: UI-XR runtime evidence consumer + materialization continuation for peds factory).

Evidence, scorecards, maturity reports, and .agent-factory/ are steering signals. They are not a substitute for advancing the blueprint-to-runtime factory, conversation tooling, reusable assets, review/persistence/replay, or focused verification of touched behavior.

After any coordination or agentic doc edits, always run `pnpm agent:alignment && pnpm docs:drift-check`.

## Standard Workflow (Full Iteration Loop - Use Only When AGENTS Calls For It)

The full loop below is for plateau recovery, major planning, broad drift review, or leadership synthesis (per AGENTS.md "Full iteration loop ... only for ..."). For routine product slices, use OpenClaw continuous slices with snapshots in state files for rehydration, per-slice records, lease, etc.

1. Create an iteration brief in `iterations/iteration-XXXX/00-brief.md`.
2. Retrieve relevant memory from `agents/**/index.json` and `.agent-factory/memory-index.json`.
3. Produce `01-core-plan.md`.
4. Score the core plan in `02-core-scorecard.json`.
5. Produce `03-adversarial-counterplan.md`.
6. Score the counterplan in `04-adversarial-scorecard.json`.
7. Produce `05-core-revision.md`.
8. Run leadership review in `06-leadership-review.md`.
9. Produce `07-final-synthesis.md`.
10. Record memory changes in `08-memory-update-log.md`.

For daily driver, see OpenClaw runbook + AGENTS hyper practices + current snapshots in PROJECT/AUTONOMOUS/worker-backlog.

## Key Commands

```bash
pnpm agent:generate
pnpm agent:validate
pnpm agent:index
pnpm agent:evidence
pnpm agent:risks
pnpm agent:maturity
pnpm agent:score -- iterations/iteration-0009
pnpm agent:leadership -- iterations/iteration-0009
pnpm agent:verify
```

`pnpm agent:evidence` prints open evidence debt and writes `.agent-factory/evidence-debt-report.json` so future iterations can compare open debt by iteration and owner.
`pnpm agent:risks` prints open critical risks and writes `.agent-factory/risk-report.json` with open-risk rollups by severity, iteration, and owner.
`pnpm agent:maturity` writes `.agent-factory/maturity-report.json` with selected scorecards, weighted deltas, blockers, and leadership quality-bar readiness.

## Background Agent Models

Use `docs/agent-factory/model-assignment-policy.md` and the `packages/openclinxr/agent-loop` recommendation helpers when assigning background agents. `gpt-5.4-mini` is for bounded scouting, `gpt-5.4` is for ordinary execution and specialist review, and `gpt-5.5` with extra-high reasoning is reserved for adversarial or leadership synthesis.

## Workflow Skills

Use `docs/agent-factory/workflow-skill-policy.md` and `recommendWorkflowSkillsForWorkOrder` in `packages/openclinxr/agent-loop` when assigning local workflow skills. These recommendations are advisory tooling support for agents; they do not create runtime dependencies unless a later verified implementation slice installs and tests one deliberately.

## Quality Bar

The plan is not mature until it has:

- A weighted score of at least 4.5 out of 5.
- No critical unresolved risks.
- Legal and regulatory resilience at least 4.3.
- Clinical validity at least 4.5.
- Psychometric defensibility at least 4.5.
- Specialty clinical generalizability at least 4.2.
- Senior Leadership majority approval with no block from General Counsel, Chief Medical Education Officer, Chief Psychometrician, or Chief Security and Privacy Officer.
