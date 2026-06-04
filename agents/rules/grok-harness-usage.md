# Grok Harness Configuration and .grok/ Setup for AgenticEx

## Overview
This project uses a .grok/ directory for harness-specific config to amp up the agentic experience (AgenticEx) while maintaining standardization across tools (Grok, Claude, Cursor, custom agents).

## Key Components (per .grok/ project dir doc)
- .grok/config.toml : Project-scoped config (MCP, skills paths, subagents, memory, features, tools, hooks, compat, ui). Loaded with priority for repo-root.
- .grok/skills/ : (via config [skills] paths pointing to .agents/skills/ for canonical).
- .grok/rules/ : Modular *.md project instructions (symlinked from agents/rules/ for multi-harness).
- .grok/agents/ : (Note: using root agents/ for roles to avoid registry issues; see config).
- .grok/hooks/ : Lifecycle hooks for automation (e.g., auto guards on PostToolUse, PreCompact rehydration reminders).
- .grok/lsp.json : (Optional for LSP servers; add for TS code intelligence in agent edits).

## Multi-Harness Sync
Use `scripts/sync-harness-agent-files.sh` (run after adding rules/skills/hooks) to maintain symlinks in .grok/, .claude/, .cursor/ from canonical sources.

## Usage in Workflows
- Always start sessions with resume sequence (re-read snapshots + AGENTS.md).
- After edits to coordination files (AGENTS.md, .grok/config.toml, state files, rules), the PostToolUse hook auto-runs pnpm agent:alignment && pnpm docs:drift-check.
- Use subagents per protocol in subagent-protocol.md, with .grok/config.toml enabling explore/plan.
- For GitHub ops, the grok_com_github MCP is declared in config.
- Memory enabled for cross-session persistence aligned with project memory.

## Benefits
- Automates guards and reminders.
- Modular rules + skills keep AGENTS.md focused.
- Config tunes Grok for this repo's monorepo, agent roles, OpenClaw, low-token, etc.
- See .grok/config.toml for full details and comments referencing AGENTS.md.

Run `grok inspect` to see loaded instructions, skills, subagents, etc.
