---
title: AgentEx / Grok Harness Gaps for Full OpenClaw-Style Unattended Autonomy with Repo-Defined Agents
authority: agent-methodology
scope: project-wide
last-updated: 2026-06-04
relates-to: AGENTS.md (subagent-protocol, long-running-autonomy, agent-consult, OpenClaw orchestration rule), .grok/config.toml, agents/rules/* (all), docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, .agent-factory/memory-index.json, agents/** (9 core roles)
---

# AgentEx Gaps for Full Autonomy (OpenClaw Style + Repo Agents)

**Context (post 1-5+6)**: Strong foundation exists:
- .grok/config.toml: subagents (explore/plan enabled + role mapping comments), memory (injection + watcher on index/role memories), long bash timeouts, notifications (turn_complete), [plugins], compat full, skills via .agents, MCP github.
- Hooks: PostToolUse auto `pnpm agent:alignment && pnpm docs:drift-check` (on Edit etc.), PreCompact rehydrate (snapshots only), SessionStart (resume + chief-coordinator memory + index parse + lease status).
- .grok/plugins/openclinxr-post-slice-automation: Stop hook reminds exact post-slice + state update + lease release.
- agents/rules/: 12 modular (subagent-protocol, agent-consult with exact work-order template + "only then spawn", long-running-autonomy with scheduler_create + monitor recommendation, grok-harness-usage, drift-toil-prevention, etc.). All loaded via .grok/rules/ symlinks (and claude/cursor mirrors).
- Sync script, authority classification (agents/rules/ as agent-methodology, mirrors current-ref, plugins current-ref), grok inspect works, lsp for monorepo.
- Proven in #6: search_replace fires hooks, spawn_subagent (explore, read-only) successfully mapped to chief-coordinator with full protocol (confirm files, read 9 charters/memories, no drift, rec next product), post-slice, guards green.
- States record the work and point to next product (UI-XR consumer or peds validation).

This gets us very close to LOW_TOKEN + guarded + role-aware operation. The daily driver (small deterministic slices, lease, post-slice, states only) is manual or prompted.

**Goal for "full autonomy mode"**: The harness (Grok in this TUI env, which has full execution + spawn_subagent + scheduler_create + monitor + file tools) can run unattended for days using the *repo-defined agents/** (chief-coordinator as orchestration, openclaw-drift-police as adversarial, implementation-planning-lead, xr-systems-architect, pediatrics-physician, etc.) as the persistent expert team. Main "worker" loop self-orchestrates: rehydrate, lease, select next from queue, delegate sub-tasks via live subagents (or local consult), record only in canonical states, post-slice, continue. Stop only on explicit or true blocker. Aligns with Grok adapter in openclaw-tool-adapters (full local execution makes Grok primary runner, not just bounded specialist).

**High-priority remaining gaps** (in rough priority for days-long unattended with repo agents):

1. **No self-driving orchestration / heartbeat loop** (biggest gap for "full autonomy")
   - Current: SessionStart/PostToolUse/Stop are reactive reminders. We manually (or via user "continue") do rehydrate -> lease -> pick slice from AUTONOMOUS -> work (sometimes delegating) -> record -> post-slice.
   - Needed: A plugin/hook or pre-wired scheduler that, on recurring trigger (turn_complete, or env scheduler_create for "every 15-60m heartbeat"), runs the universal OpenClaw prompt + automation-prompt logic:
     - Re-read snapshots (4 files).
     - `pnpm openclaw:lease -- acquire --owner grok-heartbeat --slice "<next-from-queue>"`.
     - If lease held by other, re-read states and wait.
     - Select highest-value approved slice (product preferred; small support only if enables product).
     - Execute (using spawn_subagent mapped to appropriate repo role per agent-consult + subagent-protocol, or local read of charter/memory for cheap consults).
     - Update only canonical states.
     - `pnpm openclaw:post-slice`.
     - Release.
   - Recommendation: Extend the openclinxr-post-slice-automation plugin (or new "openclinxr-orchestrator" plugin) with a "heartbeat" hook or command. Provide a ready one-liner using the env's `scheduler_create` tool + the automation-prompt. Add to long-running-autonomy.md and a new short "agentex-heartbeat-setup.md" rule. SessionStart hook can suggest starting the scheduler.

2. **Repo role subagents are prompt-based, not first-class discoverable**
   - Current: Excellent prompt template in agent-consult.md. We spawn generic "explore" and tell it "you are chief-coordinator, first read your charter+memory from agents/coordinator/chief-coordinator/..., use this work order template".
   - Gap: No registration so Grok's subagent/persona system (or /agents modal) knows the 9 core roles natively. No automatic injection of charter + memory excerpt when spawning "as chief-coordinator".
   - Why avoided: Full .grok/agents/ symlinks were rejected (drift police + doc-authority-registry would see duplicate paths for existing MDs; see config and sync script comments).
   - Recommendation: 
     - Lightweight pointer mechanism in .grok/ (e.g. .grok/agents/repo-roles-index.md or a plugin that registers "repo-chief-coordinator" etc. as custom agent types with system prompt that includes "load from ../../agents/.../charter.md and memory.md (use read_file with limit)").
     - Or enhance the spawn_subagent usage in the orchestrator plugin to do the load automatically.
     - Update subagent-protocol.md and agent-consult.md with "how to register repo roles for this harness".
     - This lets us "operate *with* agents defined in repo" as true delegation targets.

3. **Memory is read-heavy; no automated write-back of new lessons**
   - Current: SessionStart hook + [memory] injection + watcher read from .agent-factory/memory-index.json and agents/**/memory.md. Good for rehydration.
   - Gap: After a slice that produces durable insight (new risk, heuristic, lesson from using a role), there is no automatic (or even suggested) append to the relevant role's memory.md or update to the index. Lessons stay only in the per-slice record in states.
   - Recommendation: Enhance the post-slice plugin/hook to (optionally, gated) extract "durable lessons" from the just-written state record and propose/apply a small append to the consulted role's memory.md (then run drift-check or consult drift-police). Add a "memory write-back" step to the Required Per-Slice Record guidance. Use tools/agent-factory/build-memory-index.ts when appropriate.

4. **Lease and safety automation is reminder-only**
   - Current: Good echoes and "acquire before edits" in practices. PostToolUse guard runs on coord changes.
   - Gap: No PreToolUse that *requires* or auto-suggests/acquires lease before editing AUTONOMOUS/PROJECT/worker matrix (or other coord). No auto-release of *stale* leases on recovery. No hook that checks lease on every long-running turn.
   - Recommendation: Add a PreToolUse matcher for search_replace/write on the 3 state files + AGENTS.md that runs a lease check/acquire helper (fail-open or echo command to run). Enhance the orchestrator plugin with "auto lease manager" on Stop if state is clean.

5. **Grok posture as primary runner not fully asserted in harness**
   - Per openclaw-tool-adapters (protected): Grok is "bounded specialist for critique, external research, drift-police" *unless it has full local execution*. This TUI env *does* (run_terminal_command, search_replace, spawn_subagent, scheduler_create, monitor, read_file, grep, full pnpm openclaw:* , git, etc.).
   - Current: Our config + hooks + rules + #6 proof make it capable as primary. SessionStart mentions resume. But no explicit "in this env Grok is primary OpenClaw runner with full capabilities per Grok adapter; load the universal prompt + Grok notes".
   - Recommendation: Add to SessionStart hook (or a dedicated openclaw-kickoff hook) the full universal OpenClaw prompt + Grok adapter notes from the tool-adapters doc. Create a short rule or section in grok-harness-usage.md: "Grok primary runner posture in this TUI".

6. **Scheduler/monitor examples are described but not pre-wired for this env**
   - Rules (hyper-token-efficient, rehydration, long-running-autonomy) correctly say: "Use AI `scheduler_create` + `monitor` tools (this env) for persistent background heartbeat/lease watch".
   - Gap: No example invocation or pre-created scheduler task that wires our rehydrate + lease + role consult + small slice logic. User (or main agent) must manually call scheduler_create each time.
   - Recommendation: In the post-slice plugin or a new small "openclinxr-autonomy-scheduler.sh" (or TS), provide the exact `scheduler_create` call for recurring "rehydrate + openclaw heartbeat using automation-prompt + our hooks". Document in long-running-autonomy.md. The env's scheduler tool can persist it across sessions.

7. **Self-invocation of repo roles (esp. Drift Police) is not automatic**
   - Current: agent-consult.md + subagent-protocol say when to consult (after compaction, 2+ evidence, suspected drift). We do it manually or prompt subagent.
   - Gap: No hook that, on "new non-canonical MD", "after N slices", "drift-check fail", or "turn_complete with certain state", automatically does a narrow read-only spawn_subagent (or local consult) as openclaw-drift-police / chief-coordinator and records the result in states.
   - Recommendation: Add a lightweight "drift-event hook" in the plugin or a matcher in post-coord guards that, for certain patterns, runs the consult + subagent for drift-police.

8. **End-to-end autonomy smoke / verification**
   - We have #6 manual proof.
   - Gap: No deterministic local command (e.g. `pnpm agentex:autonomy-smoke` or in tools/agent-factory/) that exercises one full unattended cycle (lease acquire for "test-slice", local role consult or spawn, tiny no-op or support record in a temp state, post-slice, release, assert no drift) without interactive prompts.
   - Recommendation: Add a small smoke in the autonomy plugin or a new test harness that uses the existing tools. Run it as part of post-slice or preflight for harness changes.

**Lower / nice-to-have**:
- Better .grok/agents/ pointers (safe index without content dup) so subagent discovery lists the repo 9 roles.
- Integration of grok_com_github MCP for "if slice requires publish to github, use it" (already declared).
- Headless mode config examples tuned for long runs (permission always-approve already good).
- Direct exposure of pnpm openclaw:* as plugin-provided tools (if plugin system supports custom tools beyond hooks).

**Impact on product**:
Filling these lets the harness (with repo agents as the team) sustain the daily driver for many days with minimal intervention, directly enabling more product slices (UI-XR consumer, peds launch validation, faculty review determinism, etc.) without the main agent having to restate context or manually orchestrate every heartbeat.

**How to implement (small slices, anti-toil)**:
- Prioritize 1 (orchestrator plugin/hook + scheduler example) and 2 (role subagent mapping).
- Each addition must itself follow OpenClaw: update states with per-slice record (harness capability as "agent cap" for Q in mission), guards, no scattered files.
- Consult chief-coordinator + openclaw-drift-police + implementation-planning-lead memories before broad changes.
- Register new MDs via pnpm docs:authority.
- Test with #6-style loop (hook fire + subagent consult + record).

**Current state files already call this out** (see AUTONOMOUS / PROJECT / worker snapshots): the 1-5+6 work "prepares" this; next after product pivot is deeper harness autonomy if it unblocks sustained factory work on M1 Max.

Run `pnpm docs:authority` after adding this file. Add a support checkpoint to the 3 states. Re-run guards.

This document is the durable record of the gap analysis (not chat-only).
