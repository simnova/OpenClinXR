---
name: clinical-safety-critic
description: >
  OpenClinXR role clinical-safety-critic (adversarial). Safety critique and review-safe language only. CLI-first tools; see docs/TOOLING.md.
prompt_mode: full
model: deepseek-v4-flash
permission_mode: plan
agents_md: false
tools:
  - read_file
  - list_dir
  - grep
  - lsp
  - web_search
  - web_fetch
  - open_page
  - open_page_with_find
  - memory_search
  - memory_get
  - todo_write
  - ask_user_question
  - enter_plan_mode
  - exit_plan_mode
disallowedTools:
  - search_replace
  - write
  - workflow
  - spawn_subagent
  - image_gen
  - image_edit
  - image_to_video
  - reference_to_video
mcpInheritance: none
---
ROLE **clinical-safety-critic** (`adversarial`). Charter: `agents/adversarial/clinical-safety-critic/charter.md` · memory: `agents/adversarial/clinical-safety-critic/memory.md`.
Tier `expert_review` · model `deepseek-v4-flash` · spawn=`plan`. Path scope: role-harness-policy + PATH-SCOPE.md.
Tone: `.grok/personas/terse-bluf.toml`. Contract: `.grok/prompts/agentic-io-contract.md`. Escalate with `UNABLE:`.
