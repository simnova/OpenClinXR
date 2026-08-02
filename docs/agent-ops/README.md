# Agent operations (OpenClinXR)

Governance for the **agent roster** (not product XR runtime). Owner role: **`hrbp`**.

| Doc | Role |
|-----|------|
| `MAIN-SESSION-ORCHESTRATOR-ONLY.md` | **Policy:** main = orchestrator CEO only; never product IC |
| `CEO-VOICE.md` | Main→human communication SSOT; **BOD decision contract** (recommendation-first, research-before-ask, explicit approval string) |
| `PATH-SCOPE.md` | **Policy:** structured agent write boundaries (writeRoots / forbidden / outputRoots); higher options (worktree isolation, sole-author locks, preferredCli); **context-opt-grok45-v2** (team-spawn PATH SCOPE + path constraint + isolation top-level); **context-opt-charter-agentsmd-v3** (dual-stack path pointer, specialist `agents_md: false` / orchestrator true, slim spawn rehydrate); **Wave A enforcement matrix** (soft vs hard path/isolation); **Wave B tool-surface hygiene** (soft vs hard tools, preferredCli soft, image non-visual, **B3 KEEP** CEO write/shell); **Wave C** (C-arch: architect + composition hard law + role-mapped delivery; C-worktree: promote CLI loop; thrash gate + BOD override); **docs-warehouse-v1** (archivist + `docs/_archive/**` rehydrate exclusion; hot SSOT never freezes); SoD audit source |
| `COMPOSITION-ROOTS.md` | **Doctrine / hard law (Wave C):** apps = composition hosts / runtime shells; packages = features; tools = factory/pipeline CLIs; **owner architect** (sole-author); hrbp reviews |
| `WORKTREE-PROMOTE.md` | **Wave C-worktree:** parent promote flow after `isolation=worktree` (`pnpm openclaw:worktree:{list,status,promote}`) |
| `DOC-WAREHOUSE.md` | **Process (docs-warehouse-v1):** hot ODS vs cold **wiki-capable** warehouse; never-archive list; freeze CLI (`--set agent-ops\|cruft\|all`); rehydrate excludes `docs/_archive/**` |
| `DOC-HYGIENE-CADENCE.md` | **Cadence SSOT (owner `pmo`):** thresholds + weekly + SessionStart `--auto-run` unattended catch-up; mermaid; `pnpm docs:hygiene:*` |
| `TEMPORAL-DECISIONS.md` | **Temporal revisit workflow (owner `pmo`):** catalog time-bound decisions (workarounds, pins, model gaps); `pnpm temporal:review` |
| `temporal-decisions-catalog.json` | Machine catalog of open/due decisions + analysis/execute owners |
| `temporal-review-queue.md` | Warm regenerated queue of due analyses (not product law) |
| `REVISION-INDEX.md` | **Warm catalog:** frozen batches + wiki topic pointers (not living law) · cold home [`docs/_archive/README.md`](../_archive/README.md) |
| `REVIEW-CADENCE.md` | Who reviews whom, how often (includes doc warehouse hygiene row → DOC-HYGIENE-CADENCE) |
| `RACI.md` | RACI across agent types |
| `CAPABILITY-EVOLUTION.md` | Agent → hrbp → human for tool/model/MCP constraints |
| `capability-requests/` | Request queue |
| `YYYY-MM-DD-roster-review.md` | Dated HRBP reviews |
| `YYYY-MM-DD-ceo-bod-voice-revision.md` | Voice revision records (CEO → BOD communication upgrades) |
| `2026-08-02-path-scope-policy-v1.md` … `2026-08-02-context-opt-wave-c.md`, `2026-08-02-docs-warehouse-v1.md` | Revision records (policy decisions → implementation); **dated bodies freeze to cold warehouse** after `pnpm docs:archive` — stubs remain hot-path pointers |

### Temporal hygiene (PMO) + cold retrieval (archivist)

| Role | Path | Duty |
|------|------|------|
| **`pmo`** | `agents/coordinator/pmo/` (+ generated `.grok/agents/pmo.md`) | **When** hygiene runs: cadence SSOT, SessionStart auto-run, weekly script, last-run state; never product IC; never roster SoD |
| **`archivist`** | `agents/coordinator/archivist/` (+ generated `.grok/agents/archivist.md`) | Read-only retrieve from `docs/_archive/**` + slice-archive; map successor SSOT; never rewrite hot law; never product IC |

```bash
pnpm docs:archive -- status|plan|freeze
pnpm grok:agent:spawn-spec -- --role archivist --task "locate historical revision for …"
```

## Dual stack

| Layer | Location |
|-------|----------|
| OpenClaw roles | `agents/**` (charter + memory) |
| Grok-native agents | `.grok/agents/*.md` (YAML frontmatter per user-guide 16-subagents) |
| Personas | `.grok/personas/*.toml` |
| Tiers / sandbox | `packages/openclinxr/agent-loop/src/role-harness-policy.ts` |
| CLI-first MCP | `docs/TOOLING.md`, `pnpm env:doctor` |

## Spawn HRBP

```bash
pnpm grok:agent:spawn-spec -- --role hrbp
# or open session with agent definition hrbp
```

```text
subagent_type=general-purpose (or hrbp agent if selected)
Task: Full roster review — SoD, success criteria, tools/MCP vs CLI-first, model/effort, cadence, BOD voice.
Write docs/agent-ops/<date>-roster-review.md; apply safe definition fixes.
```

## Related

- Grok user-guide: `16-subagents.md` (Agents vs Personas)
- `.grok/prompts/agentic-io-contract.md`
- `agents/coordinator/hrbp/charter.md`
