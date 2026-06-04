# openclinxr-autonomy-orchestrator (Grok plugin, evolved from post-slice)

Project plugin for full OpenClaw-style unattended autonomy with repo-defined agents/** (chief-coordinator, drift-police, etc. as the persistent team).

Addresses gaps 1-7 from docs/agent-factory/agentex-openclaw-full-autonomy-gaps.md (post 1-5+6 foundation).

## Contents
- `hooks/hooks.json`: lifecycle hooks
  - `Stop`: full autonomy heartbeat/orchestrator (rehydrate snapshots, lease acquire, select next from AUTONOMOUS_WORK_PLAN queue, execute/delegate to repo role via agent-consult + spawn_subagent or local consult, update states with per-slice record (Q1/Q4/Q5), post-slice, memory write-back stub to role memory.md, release).
  - `Notification` / `UserPromptSubmit`: reminders for cycle, drift self-trigger (gap6), orchestrator.
- README: this file with setup for scheduler heartbeat (gap1), role mapping (gap2), write-back (gap3), lease (gap4), primary runner (gap5), self-drift (gap6), smoke (gap7).

## Usage for Full Autonomy (execute on 1-7)
- Plugin auto-discovered from `.grok/plugins/` .
- On Stop/Notification: surfaces the orchestrator steps for 1 (heartbeat loop), 3 (memory write-back), 6 (drift-police).
- Lease safety (gap4): see enhanced .grok/hooks/post-coord-edit-guards.json (PreToolUse auto-suggests acquire for coord edits).
- Grok primary runner (gap5): SessionStart (in post-coord hooks) asserts full exec in this TUI env + injects universal prompt + Grok adapter excerpt from protected tool-adapters.
- Role subagents (gap2): use agent-consult.md + spawn_subagent with "as chief-coordinator" (plugin/ hooks encourage auto load of charter/memory from agents/<role>/ ). For first-class, see below.
- Scheduler for recurring (gap1,7): Use the env scheduler_create tool (or manual) with a prompt like the one below. Example (executed during this implementation):

  (See actual scheduler tasks via scheduler_list if set.)

- To set up recurring autonomy heartbeat (addresses 1 + 7):
  Use the AI scheduler_create tool with interval e.g. "30m", recurring true, prompt = the universal OpenClaw + "rehydrate from snapshots, pnpm openclaw:lease -- acquire --owner grok-autonomy --slice next, select from states (product first), consult agent-consult for role e.g. chief-coordinator, spawn_subagent if live or local read memory, do small slice or no-op, update states with record, pnpm openclaw:post-slice, release. Use monitor for lease if long."

- Memory write-back (gap3): in Stop hook, the echo includes "extract lessons and append to agents/<role>/memory.md". Implement by editing the command to use search_replace or echo >> on the memory file (gated, then drift-check).
- E2E smoke (gap7): run a manual cycle or use scheduler + spawn_subagent as in #6 proof, assert states updated, no drift. Add `pnpm agentex:autonomy-smoke` later if needed (current: use the plugin Stop + scheduler demo).
- Self drift (gap6): Notification hook mentions "Drift event? auto consult openclaw-drift-police". Enhance command to parse and auto-spawn read-only subagent as openclaw-drift-police on conditions (e.g. if new MDs detected via ls).

## Setup for repo-role subagents (gap2)
To make first-class without duplication (respecting previous no-symlink decision for drift):
- The plugin + agent-consult encourage "spawn_subagent as explore mapped to chief-coordinator, first read agents/coordinator/chief-coordinator/{charter,memory}.md with limit".
- For better discovery: .grok can use plugin-bundled agents/ or custom in config. Example pointer in plugin future: a agents/ dir with md that says "Definition lives at repo root agents/coordinator/chief-coordinator/ . Load via read_file for charter + memory on spawn."
- Current .grok/config already has comments for this.

GROK_PLUGIN_ROOT and GROK_PLUGIN_DATA available (use for writable state in write-back).

Part of AgentEx gaps 1-7 execution for full autonomy (enables days-long product slices like UI-XR consumer using the repo team). 

Re-run sync after changes. Run guards on state/coordination touches.
