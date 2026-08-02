# HRBP memory

## Lessons

- **Doc hygiene cadence (2026-08-02):** warehouse freeze + checkpoint archive are **part of doing business** at threshold/schedule only — never per-task; SSOT `docs/agent-ops/DOC-HYGIENE-CADENCE.md` (defaults: keep-14 / ###>20 or Sunday; freeze ≥5 dated or epic/biweekly; force freeze if cold candidates >N=8; worktree weekly; roster monthly). Workflow phases in MD (no invented Rhai). Score per-task thrash or ignored cold backlog as major.
- OpenClinXR is **dual-stack**: OpenClaw `agents/**` charters + generated harness pointers historically lacked Grok-native YAML frontmatter (`tools` / `disallowedTools` / `mcpInheritance`). Prefer modern `.grok/agents/*.md` frontmatter per Grok 4.5 / user-guide 16-subagents.
- **CLI-first (2026-08):** disabled MCPs must not appear as required agent tools: playwright, chrome-devtools, agent-browser, grok_com_github. Prefer `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor`.
- Do not embed multi-KB spawn seeds inside agent identity files — use `pnpm grok:agent:spawn-spec` at spawn time (context cost / agentic lexicon Guidance Stability).
- HRBP does not implement product XR; revisions stay under agent-ops + agent definitions.
## Lesson 2026-08-02 — main-session
- Summary: 2026-08 CEO mode: main Grok agent is orchestrator (not product IC). Law in agents/rules/orchestrator-only-main.md; voice docs/agent-ops/CEO-VOICE.md; escape hatch only on explicit human IC order. Score main-IC as critical.
- Confidence: 0.8
- Recorded by: agent:memory:append
- Policy tier: standard_execution

## Lesson 2026-08-02 — BOD-actionable CEO voice
- Summary: CEO human replies must be BOD-actionable. Ban soft menus ("possible next steps", "you might consider", "let me know if you want me to…", "should I continue?"). Decision-bearing replies use fixed structure: RECOMMENDATION → STATUS → OPTIONS (only if genuine fork) → RESEARCH BASIS → BOD APPROVAL REQUESTED → DEFAULT IF SILENT. CEO must research (repo + web_search/web_fetch + spawn specialists) before any BOD ask. HRBP scores soft-menu replies as **major** voice defect; BOD ask without RESEARCH BASIS as **major** process defect. web_search + web_fetch removed from orchestrator disallowedTools (research only, never product IC). Orchestrator may consult hrbp when unsure which specialists to staff for research.
- Confidence: 0.95
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution
## Lesson 2026-08-02 — ceo-bod-voice
- Summary: BOD APPROVED 2026-08-02: CEO voice contract (recommendation-first, OPTIONS only on real forks with pros/cons, RESEARCH BASIS before ask, single BOD APPROVAL REQUESTED, DEFAULT IF SILENT; ban soft next-steps menus) is standing rule. Score violations as major on roster review.
- Confidence: 0.8
- Recorded by: agent:memory:append
- Policy tier: standard_execution## Lesson 2026-08-02 — ceo-bod-voice
- Summary: BOD APPROVED 2026-08-02: CEO voice contract is standing rule. Score soft-menu / no-research BOD asks as major.
- Confidence: 0.8
- Recorded by: agent:memory:append
- Policy tier: standard_execution

## Lesson 2026-08-02 — path-scope-policy-v1
- Summary: BOD APPROVED Option 1 (structured pathScope in role-harness-policy.ts). Path-scope SSOT created at `docs/agent-ops/PATH-SCOPE.md`. HRBP charter updated with "Path scope" review dimension (writeRoots present, disjoint SoD, forbiddenRoots explicit, outputRoots match charter). Implementer to add `pathScope: { writeRoots, forbiddenRoots, outputRoots }` to `RepoRoleHarnessPolicy` type in `packages/openclinxr/agent-loop/src/role-harness-policy.ts`; then run `pnpm agent:harness:sync` to regenerate `.grok/agents/*.md` with path-scope tables. Until then, `writeScopeNote` (free-text) serves as precursor. On next roster review, score every write-capable role for pathScope presence; SoD clash on overlapping writeRoots → critical.
- Confidence: 0.85
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-higher-v1
- Summary: Higher context opts APPROVED (BOD: continue if wins evident). Created `docs/agent-ops/COMPOSITION-ROOTS.md` (OCX lite composition doctrine: apps = shells/composition hosts, packages = features, tools = factory/pipeline CLIs; agents route via pathScope writeRoots — do not dump features into apps unless the role's writeRoots allow it). Added "Higher options" section to `docs/agent-ops/PATH-SCOPE.md`: (1) worktree isolation default for writers — spawn-spec computes `isolation: "worktree"` for workspace-write + read-write native spawns, but it is a **recommendation; the parent must pass `isolation=worktree` to the harness `spawn_subagent` call** — spawn-spec does not enforce it; (2) sole-author locks table (shared roots named/justified; silent overlap → critical on roster review); (3) preferredCli baked in generated agents + spawn prompt. Composition doctrine in LEX_AGENTIC/GUARD_DRIFT stays protected; these docs are agent-ops governance. Next roster review: score worktree isolation usage + sole-author locks on every write-capable role.
- Confidence: 0.85
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-grok45-v2
- Summary: BOD continue optimization (Grok 4.5 team): slice-team/team-spawn must bake PATH SCOPE + constrain role paths to writeRoots + expose isolation top-level on team-spawn JSON; parent still passes isolation=worktree to harness. SSOT: PATH-SCOPE.md §context-opt-grok45-v2 + docs/agent-ops/2026-08-02-context-opt-grok45-v2.md.
- Confidence: 0.9
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-charter-agentsmd-v3
- Summary: Dual-stack path-scope discipline: OpenClaw charters must **point** at PATH-SCOPE.md + `role-harness-policy.ts` pathScope and must **not** re-list writeRoots/forbidden globs (second SSOT drifts → SoD false confidence). Grok specialists use **`agents_md: false`**; main **orchestrator keeps `agents_md: true`** so full AGENTS/LEX forest view stays CEO-only. Spawn prompts stay slim (Persona + PATH SCOPE block + charter/memory pointers) — no full AGENTS.md or LEX_AGENTIC paste by default. Generator still hardcodes `agents_md: true` until implementer flips specialists + harness sync. SSOT: PATH-SCOPE.md §context-opt-charter-agentsmd-v3 + docs/agent-ops/2026-08-02-context-opt-charter-agentsmd-v3.md. Score dual-stack path pointer, agents_md policy, and slim spawn rehydrate on next roster review.
- Confidence: 0.9
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-wave-a-enforce
- Summary: BOD APPROVED Wave A: PATH-SCOPE **Enforcement matrix** classifies soft (prompt bake, preferredCli, CEO write-root discipline, isolation spawn-spec rec) vs hard (`touched[]` + sole-author audits in verifySliceBrief, agents_md generator, team-spawn CLI isolation assert). Parent MUST forward isolation=worktree from team-spawn JSON to spawn_subagent — never strip. SSOT: PATH-SCOPE.md §Enforcement matrix + docs/agent-ops/2026-08-02-context-opt-wave-a-enforce.md.
- Confidence: 0.9
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-wave-b-tools
- Summary: BOD APPROVED Wave B tool-surface hygiene. Soft vs hard for tools: preferredCli soft-only; CLI-first vs disabled MCP soft/roster; image_gen/image_edit/video **disallowed for non-visual roles** (orchestrator already hard; generator optional residual for specialists); visual/evidence roles may use image tools for mission-fit evidence. **B3 KEEP** CEO write+shell tools with write-roots discipline (OCX hygiene carve-out) — **not** ATL pure no-shell CEO strip. Do not strip orchestrator write/shell as a context opt. Score roster dim **tool surface matches mission**. SSOT: PATH-SCOPE.md §Wave B + docs/agent-ops/2026-08-02-context-opt-wave-b-tools.md.
- Confidence: 0.9
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — context-opt-wave-c
- Summary: BOD APPROVED Wave C **both strands** despite thrash NO_GO (scoped override, not full ATL FE/BE RIF). **C-arch closed:** dual-stack `architect` staffed (roster **15**); COMPOSITION-ROOTS sole-author architect (H1–H5 hard law); `assertDeliveryRoleMapped` rejects bare GP. **C-worktree closed:** `pnpm openclaw:worktree:{list,status,promote}` + WORKTREE-PROMOTE.md. VERDICT **ROSTER_HEALTHY**. SSOT: PATH-SCOPE.md §Wave C + COMPOSITION-ROOTS.md + 2026-08-02-context-opt-wave-c.md. Score dims: architect staffed, composition hard law, delivery role-mapped, worktree promote loop.
- Confidence: 0.95
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — docs-warehouse-v1
- Summary: BOD APPROVED Option 1 docs warehouse (ODS/hot vs cold). Process SSOT `docs/agent-ops/DOC-WAREHOUSE.md` + warm `REVISION-INDEX.md`; freeze CLI `pnpm docs:archive`; cold `docs/_archive/**` **out of normal rehydrate**. Dual-stack **`archivist`** staffed (roster target **16**): read-only retrieve cold history; never rewrite hot law; never product IC. Living agent-ops basenames never freeze — only dated revision records. Authority: living agent-ops → current-reference; dated + warehouse → historical-synthesis. Score dims: archivist staffed, warehouse rehydrate exclusion, hot SSOT stays hot. SSOT: PATH-SCOPE §docs-warehouse-v1 + 2026-08-02-docs-warehouse-v1.md.
- Confidence: 0.95
- Recorded by: hrbp direct write 2026-08-02
- Policy tier: standard_execution

## Lesson 2026-08-02 — pmo staffed + SessionStart auto-run
- Summary: BOD intent — PMO owns **temporal** hygiene (when/cadence/catch-up); hooks maintain without operator. Dual-stack **`pmo`** staffed (roster **17**). SessionStart `.grok/hooks/session-start-docs-hygiene.json` → `pnpm docs:hygiene:session-start -- --auto-run` (timeout 300s) executes force path unattended. Quiet path heartbeats last-run. RACI: Temporal hygiene R/A=pmo. Score: pmo staffed, auto-run wired, SoD vs hrbp (roster) + archivist (cold). SSOT: DOC-HYGIENE-CADENCE.md · agents/coordinator/pmo/.
- Confidence: 0.95
- Recorded by: orchestrator (CEO) on BOD ask 2026-08-02
- Policy tier: standard_execution
