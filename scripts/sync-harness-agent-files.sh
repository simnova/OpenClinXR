#!/bin/bash
# Sync script for agentic files (rules + hooks) to harness-specific directories for multi-harness standardization.
# Run from repo root.
# Grok loads only CORE rules from .grok/rules/ (~40% token savings vs full ruleset).
# Claude/Cursor still receive all agents/rules/*.md for compat.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CORE_RULES=(
  LEX_AGENTIC.md
  GUARD_BLUEPRINT.md
  GUARD_DRIFT.md
  MANDATE_VISIBILITY.md
  PROTO_SUBAGENT.md
  EXEC_AUTONOMY.md
)

echo "Syncing agentic files for multi-harness support."

rm -rf .grok/skills/* .claude/skills/* .cursor/skills/* .codex/skills/* .grok/rules/* .claude/rules/* .cursor/rules/* 2>/dev/null || true
rm -rf .claude/hooks .cursor/hooks 2>/dev/null || true

mkdir -p .grok/skills .claude/skills .cursor/skills .codex/skills
echo "  Skills: config [skills].paths only (no symlinks)"

mkdir -p .grok/rules .claude/rules .cursor/rules

for rule in "${CORE_RULES[@]}"; do
  if [ -f "agents/rules/$rule" ]; then
    ln -sfn "../../agents/rules/$rule" ".grok/rules/$rule"
    echo "  Grok core rule: $rule"
  fi
done

for rule in agents/rules/*.md; do
  [ -f "$rule" ] || continue
  name=$(basename "$rule")
  ln -sfn "../../$rule" ".claude/rules/$name"
  ln -sfn "../../$rule" ".cursor/rules/$name"
  echo "  Claude/Cursor rule: $name"
done

pnpm agent:harness:sync

mkdir -p .grok/hooks
if ls .grok/hooks/*.json >/dev/null 2>&1; then
  node - <<'NODE'
    const fs = require("fs");
    const hooks = {};
    for (const f of fs.readdirSync(".grok/hooks").filter(n => n.endsWith(".json"))) {
      const j = JSON.parse(fs.readFileSync(".grok/hooks/" + f, "utf8"));
      for (const [ev, arr] of Object.entries(j.hooks || {})) {
        hooks[ev] = (hooks[ev] || []).concat(arr);
      }
    }
    const neutralizeForCompat = (value) => typeof value === "string"
      ? value
        .replaceAll("grok-autonomy", "harness-autonomy")
        .replaceAll("In this TUI env Grok has FULL local execution (shell, edit, spawn_subagent, scheduler_create, monitor, pnpm openclaw:*) so it is PRIMARY OpenClaw runner per Grok adapter in docs/openclinxr/openclaw-tool-adapters-2026-05-27.md (not just bounded specialist). ", "Use this harness as an OpenClaw runner only to the extent it has local file, shell, edit, browser, and subagent capabilities; otherwise follow the adapter fallback matrix. ")
        .replaceAll("Grok notes:", "Harness notes:")
        .replaceAll("sed -n '/## Grok Adapter/,/## Cursor Adapter/p' | head -20", "sed -n '/## Shared Host Requirements/,/## Universal OpenClaw Prompt/p' | head -40")
      : value;
    const walk = (value) => {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
      }
      return neutralizeForCompat(value);
    };
    const out = walk({ hooks });
    fs.writeFileSync(".claude/hooks.json", JSON.stringify(out, null, 2) + "\n");
    fs.writeFileSync(".cursor/hooks.json", JSON.stringify(out, null, 2) + "\n");
    console.log("  Merged .grok/hooks/*.json -> .claude/hooks.json + .cursor/hooks.json");
NODE
else
  echo "  Warning: no .grok/hooks/*.json found."
fi

echo "Done. Grok core rules: ${#CORE_RULES[@]}. Run pnpm agent:alignment && pnpm docs:drift-check after rule edits."