# openclinxr-slice-runner (Grok plugin, evolved from post-slice)

Project plugin for event-driven OpenClaw-style / OpenClaw-inspired autonomy with repo-defined agents/** (chief-coordinator, drift-police, etc. as the persistent team). It is not an external OpenClaw runtime.

Addresses gaps 1-7 from docs/agent-factory/agentex-openclaw-full-autonomy-gaps.md (post 1-5+6 foundation).

## Contents
- `hooks/hooks.json`: lifecycle hooks
  - `Stop`: reminder to prefer `pnpm openclaw:run-next` over recurring heartbeat entries. The command selects the next approved slice and writes only `.openclinxr/openclaw/run-next-report.json`.
  - `Notification` / `UserPromptSubmit`: reminders for event-driven continuation, quiet watchdog, and drift-police consultation before canonical edits.
- README: this file with setup for quiet slice selection (gap1 replacement), role mapping (gap2), memory write-back after real slices (gap3), lease (gap4), primary runner (gap5), self-drift (gap6), smoke (gap7).

## Usage for Full Autonomy (execute on 1-7)
- Plugin auto-discovered from `.grok/plugins/` .
- On Stop/Notification: surfaces the event-driven runner steps for 1 (quiet continuation), 3 (memory write-back after real slices), 6 (drift-police).
- Lease safety (gap4): see enhanced .grok/hooks/post-coord-edit-guards.json (PreToolUse auto-suggests acquire for coord edits).
- Grok primary runner (gap5): SessionStart (in post-coord hooks) asserts full exec in this TUI env + injects the OpenClaw-style / OpenClaw-inspired universal prompt + Grok adapter excerpt from protected tool-adapters.
- Role subagents (gap2): use agent-consult.md + spawn_subagent with "as chief-coordinator" (plugin/ hooks encourage auto load of charter/memory from agents/<role>/ ). For first-class, see below.
- Quiet runner for continuation (gap1 replacement, gap7 smoke):

  ```bash
  pnpm openclaw:run-next
  ```

  This writes `.openclinxr/openclaw/run-next-report.json`, prints the selected slice, and does not edit canonical Markdown. The agent then acquires a lease and executes the slice.

- Optional quiet watchdog:

  ```bash
  pnpm openclaw:watchdog
  ```

  The watchdog only recommends `run-next` when the tree is clean, no active lease is held, the previous local report is stale, and a queued slice exists. If it idles, it records only the local report. Do not use scheduler heartbeats that append no-op records to `AUTONOMOUS_WORK_PLAN.md`.

- Memory write-back (gap3): append to agents/<role>/memory.md only after a durable lesson from a real slice, not after a no-op watchdog cycle.
- E2E smoke (gap7): run `pnpm openclaw:run-next`, execute the selected slice with lease protection, verify, update canonical state once, then run `pnpm openclaw:post-slice`.
- Self drift (gap6): Notification hook mentions "Drift event? auto consult openclaw-drift-police". Enhance command to parse and auto-spawn read-only subagent as openclaw-drift-police on conditions (e.g. if new MDs detected via ls).

## Setup for repo-role subagents (gap2)
To make first-class without duplication (respecting previous no-symlink decision for drift):
- The plugin + agent-consult encourage "spawn_subagent as explore mapped to chief-coordinator, first read agents/coordinator/chief-coordinator/{charter,memory}.md with limit".
- For better discovery: .grok can use plugin-bundled agents/ or custom in config. Example pointer in plugin future: a agents/ dir with md that says "Definition lives at repo root agents/coordinator/chief-coordinator/ . Load via read_file for charter + memory on spawn."
- Current .grok/config already has comments for this.

GROK_PLUGIN_ROOT and GROK_PLUGIN_DATA available (use for writable state in write-back).

Part of AgentEx gaps 1-7 execution for OpenClaw-style full autonomy (enables days-long product slices like UI-XR consumer using the repo team).

Re-run sync after changes. Run guards on state/coordination touches.
