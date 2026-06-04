# openclinxr-post-slice-automation (Grok plugin)

Project plugin for OpenClinXR harness automation.

## Contents
- `hooks/hooks.json`: lifecycle hooks
  - `Stop`: prints reminder + exact post-slice command sequence (pnpm openclaw:post-slice + alignment + drift-check + lease status). Use after every coherent slice.
  - `Notification`: gentle reminder during long runs.

## Usage
- Plugin auto-discovered from `.grok/plugins/` (see [plugins] in .grok/config.toml and 09-plugins.md).
- After a slice (implementation + focused verif + state updates), the Stop hook fires on agent stop and surfaces the canonical post-slice steps.
- Manual: `pnpm openclaw:post-slice` (or the full guard sequence).
- Ties to AGENTS.md (post every slice, lease, guards), agents/rules/long-running-autonomy.md, docs/openclinxr/openclaw-runbook-2026-05-27.md.

## Extension ideas (for future 1-5)
- Bundle a small TS script invoked by hook that auto-appends a skeleton per-slice record to the state MDs (with $GROK_PLUGIN_DATA for writable state).
- MCP or skill for "agent-consult <role>" that reads charter+memory per subagent-protocol.

GROK_PLUGIN_ROOT and GROK_PLUGIN_DATA available to hooks.

Part of 1-5 harness amp-up for AgenticEx (automation + memory).
