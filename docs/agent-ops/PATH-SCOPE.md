# Path-scope policy (agent write boundaries)

**Owner:** `hrbp` (agent roster governance)  
**Policy tier:** standard_execution · **BOD status:** APPROVED 2026-08-02 (Option 1: structured pathScope; Option 2: handoff audit)  
**Source of truth:** `packages/openclinxr/agent-loop/src/role-harness-policy.ts` → `pathScope`

## Why

Agents only look at roots they maintain. Without explicit path-scope, agents drift into "silent full-stack catch-all" — the #1 SoD defect HRBP scores as **critical**.

Path-scope makes write boundaries **machine-checkable** (not just prose in charters) and **visible in generated agent definitions** (`.grok/agents/*.md`). Every role knows exactly which directories it may write, which it must never touch, and where its canonical outputs live.

## Source of truth

`packages/openclinxr/agent-loop/src/role-harness-policy.ts` → `RepoRoleHarnessPolicy.pathScope`:

```typescript
type RolePathScope = {
  /** Globs relative to repo root — agent may EDIT these */
  writeRoots: string[];
  /** Globs agent should prefer for READ/grep (always includes writeRoots + minimal rehydrate) */
  readRoots: string[];
  /** Globs agent must NOT edit; residual to parent/other owner */
  forbidden: string[];
  /** Where handoffs/artifacts for this role may be written */
  outputRoots: string[];
  /** Optional preferred package filters for CLI */
  preferredCli?: string[];
};
```

**Option 1 IN FORCE** — structured `pathScope` field populated for all **16** registered roles (incl. `architect` Wave C + `archivist` docs-warehouse-v1) with disjoint `writeRoots`, auto-built `readRoots` (writeRoots + `COORD_READ` + role agent dir + brief/handoff access), explicit `forbidden` covering product apps/packages, canonical `outputRoots`, and optional `preferredCli`. Used by:

- `getRolePathScope(roleId)` → full scope
- `assertTouchedWithinWriteRoots(touched, scope)` → `{ ok, violations[] }`
- `pathMatchesAnyGlob(path, globs)` → boolean
- `formatPathScopeBlock(scope)` → compact markdown block for spawn prompts
- `generate-harness-agents.ts` → `.grok/agents/*.md` tables
- `grok-repo-agent-spawn.ts` → spawn prompt PATH SCOPE block

## ATL parity

| Atlantis concept | OpenClinXR mapping |
|---|---|
| `writeRoots` | `pathScope.writeRoots` — e.g. `["docs/agent-ops/**", ".grok/agents/**", "agents/coordinator/hrbp/**"]` for hrbp |
| `forbiddenRoots` | `pathScope.forbidden` — e.g. `["apps/**", "packages/**"]` for non-product roles |
| `outputRoots` | `pathScope.outputRoots` — canonical handoff/evidence paths per charter "Output roots" |
| (n/a) | `pathScope.readRoots` — read preference (always super-set of writeRoots + coordination files) |
| (n/a) | `pathScope.preferredCli` — optional CLI filter (e.g. `pnpm --filter @openclinxr/asset-pipeline`) |

The pattern originated in `atlantis-cameras-v2` as a harness-level guard. OpenClinXR adapts it for dual-stack (Grok-native agents + OpenClaw roles) with the same discipline: writeRoots disjoint across roles → SoD enforceable at spawn time.

## Spawn bake + generated agent tables

`tools/agent-factory/generate-harness-agents.ts` (`grokNativeAgentMarkdown`) bakes `pathScope` into generated `.grok/agents/*.md`:

```markdown
## Path scope (from role-harness-policy)

| Write roots | Forbidden | Read preference | Output |
|---|---|---|---|
| `docs/agent-ops/**`, `.grok/agents/**`, `agents/coordinator/hrbp/**` | `apps/**`, `packages/**` | `AGENTS.md`, `PROJECT_STATUS.md`, ... | `.openclinxr/slices/*/handoffs/hrbp.json` |
```

The spawn prompt builder (`grok-repo-agent-spawn.ts` `buildRepoAgentSpawnPrompt`) injects pathScope via `formatPathScopeBlock()`.

## Higher options (context-opt-higher-v1)

Three refinements layered on Option 1/2 to reduce writer collision and make writer intent machine-checkable:

| Option | Status | What |
|---|---|---|
| **Worktree isolation default for writers** | **IN FORCE** (spawn-spec recommendation) | `grok-repo-agent-spawn.ts` computes `isolation: "worktree"` when `sandboxMode=workspace-write` + `capability_mode=read-write` + native `spawn_subagent`; read-only / frontier → `"none"`. Emitted in `GrokRepoAgentSpawnSpec.isolation` and `spawnSubagentCall.isolation`. **Isolation is a spawn-spec *recommendation* — the parent must pass `isolation=worktree` to the harness `spawn_subagent` call.** The spawn-spec does not enforce it; the Composer/chief-coordinator passes the parameter. |
| **Sole-author locks** | **IN FORCE** (governance table below) | Every writeRoot has a single owning author role by default; shared roots are named and justified (no silent overlap). HRBP roster review scores silent overlap → critical. |
| **preferredCli** | **IN FORCE** | Optional `pathScope.preferredCli` filters role CLI to package scope (e.g. `pnpm --filter @openclinxr/asset-pipeline`). Baked into generated `.grok/agents/*.md` tables and spawn prompts. |

### Sole-author locks (default ownership)

Each `writeRoots` entry is sole-authored unless listed as SHARED. Disjoint by default; shared roots must be intentional (cross-cutting tooling or co-owned evidence lanes).

| Root (glob) | Sole author(s) | Shared rationale |
|---|---|---|
| `docs/agent-ops/**` | hrbp | — (COMPOSITION-ROOTS.md covered by composition-roots lock; ownedCovering allows both) |
| `docs/agent-ops/COMPOSITION-ROOTS.md`, `packages/cellix/**`, `packages/openclinxr/architecture-rules/**` | **architect** | sole-author lock `composition-roots` |
| `packages/openclinxr/config-rolldown/**`, `docs/madr/**` | architect | topology/compose residual |
| `.grok/agents/**`, `.grok/personas/**`, `.grok/roles/**` | hrbp | generated/pointer files |
| `agents/coordinator/hrbp/**` | hrbp | — |
| `agents/core/architect/**` | architect | Wave C C-arch role home |
| `PROJECT_STATUS.md` | chief-coordinator (+ vp-engineering-delivery, hrbp legacy append) | SHARED (state SSOT, append-only) |
| `.openclinxr/slices/**` | chief-coordinator | — |
| `docs/openclinxr/**` | openclaw-drift-police + implementation-planning-lead | SHARED (drift police + planning lead both curate) |
| `agents/adversarial/**` | per-role dir (drift-police, gap-attacker, skeptic, realism-adversary, clinical-safety-critic) | — |
| `tools/openclinxr/asset-pipeline/**` | asset-pipeline-lead + rigging-animation-specialist | SHARED (pipeline + rigging land in same factory) |
| `apps/arena/model-vetting-studio/**` | asset-pipeline-lead | — |
| `apps/ui-xr/**`, `apps/arena/**`, `packages/openclinxr/arena/**`, `packages/openclinxr/xr/**` | xr-systems-architect | — |
| `packages/openclinxr/scenario-fixtures/**` | pediatrics-physician | — |

Enforcement: `assertTouchedWithinWriteRoots` checks path match (not author), so SHARED roots remain valid for all declared owners; the sole-author discipline is enforced by roster review + spawn-spec role mapping (never spawn a role whose `writeRoots` do not cover the requested edit). `findSoleAuthorLockViolations` allows a role that **owns** a lock covering the same path (Wave C-arch: architect vs agent-roster under `docs/agent-ops/**`).

### Composition doctrine (hard law)

Feature logic → `packages/openclinxr/*`; apps = composition hosts / runtime shells; tools = factory/pipeline CLIs. See **`docs/agent-ops/COMPOSITION-ROOTS.md`** (owner: **architect**) for hard rules H1–H5, architect residual table, and OCX domain role map (ui-xr / ui-admin / data / factory-assets / agent-loop / composition).

## Option 2 handoff audit (IN FORCE)

`verifySliceBrief()` in `packages/openclinxr/agent-loop/src/slice-team.ts` now appends path-scope audits after `done_when` rules:

- `auditHandoffsPathScope(handoffs)` iterates handoffs with `touched[]` length > 0
- For each handoff with a known `RepoRoleHarnessPolicy`, runs `assertTouchedWithinWriteRoots` on the cleaned paths (strips `:line` suffixes)
- Emits `DoneWhenCheck` with rule `path-scope:<roleId>`: `passed` if all touched paths match `writeRoots`; `detail` lists violations
- Unknown roles (no policy) or empty `touched` → skipped
- **Path-scope violations set `ok: false`** (hard gate for new verifies)

Exported as `auditHandoffsPathScope` from both `slice-team.ts` and `index.ts`.

| Phase | What | Status |
|---|---|---|
| **Option 1** | Structured `pathScope` field in `role-harness-policy.ts` for all **16** roles + generated agent tables | **IN FORCE** |
| **Option 2** | Per-slice handoff audit: `verifySliceBrief` checks whether subagent handoff `touched` files are inside `writeRoots` | **IN FORCE** |

## context-opt-grok45-v2 (slice-team / team-spawn bake)

**Slice:** `context-opt-grok45-v2` · **Track:** optimization only (not product authoring) · **BOD:** continue optimization with Grok 4.5 team  
**Revision record:** `docs/agent-ops/2026-08-02-context-opt-grok45-v2.md`

Closes the gap between **spawn-spec** path-scope/isolation (already IN FORCE via `grok-repo-agent-spawn.ts`) and the **OpenClaw slice-team** path (`pnpm openclaw:team-spawn` → `buildTeamSpawnReport` / `buildSliceTeamSpawnPrompt` / `slice-team-cli`).

| Contract | What | Status |
|---|---|---|
| **PATH SCOPE in team prompts** | `buildSliceTeamSpawnPrompt` (and/or team-spawn enrichment) bakes `formatPathScopeBlock(policy.pathScope)` into OpenClaw team spawn prompts so slice-team roles see the same ATL writeRoots/forbidden/outputRoots block as `pnpm grok:agent:spawn-spec` | Implementer (agent-loop); SSOT this section |
| **Role paths constrained to writeRoots** | Brief/template `roles.<id>.paths` must lie inside that role's `pathScope.writeRoots` (warn or hard-constrain at team-spawn / materialize); residual out-of-scope paths → parent, not silent full-stack | Implementer; Option 2 still hard-fails post-hoc `touched[]` |
| **isolation top-level on team-spawn JSON** | Each role in team-spawn report/JSON exposes **`isolation: "worktree" \| "none"`** at the **role top level** (not only nested under `spawnSubagentCall.isolation`) so parents cannot miss it when reading `slice-team-spawn-*.json` | Implementer; mirrors spawn-spec top-level `GrokRepoAgentSpawnSpec.isolation` |
| **Parent must still pass isolation** | Bake + top-level field are **recommendations / visibility**. Composer/chief-coordinator **must pass `isolation=worktree`** (when role is write + workspace-write) on the harness `spawn_subagent` call. Team-spawn JSON does not execute the spawn. | **Standing rule** (same as context-opt-higher-v1) |

### Parent / integrator checklist (team-spawn)

1. Run `pnpm openclaw:team-spawn -- --slice-id <id> --phase <scout|execute> [--json]`.
2. For each write role: read top-level `isolation` (and nested `spawnSubagentCall.isolation` if present).
3. When `isolation === "worktree"`, pass **`isolation=worktree`** to native `spawn_subagent`.
4. Confirm role `paths` ⊆ policy `writeRoots` (or honor team-spawn warnings); do not expand paths beyond path-scope.
5. Handoffs still audited by Option 2: `path-scope:<role>` hard-fails out-of-scope `touched[]`.

### Why this slice (SoD / context cost)

Without team-spawn bake, only `spawn-spec` single-role prompts carried PATH SCOPE; OpenClaw multi-role teams still used free-text `assignment.paths` and buried isolation under `spawnSubagentCall`. v2 makes path-scope + isolation **first-class on the team path** so Grok 4.5 multi-agent waves stay inside writeRoots and parent isolation forwarding is impossible to overlook.

## context-opt-charter-agentsmd-v3 (dual-stack pointer + agents_md slim)

**Slice:** `context-opt-charter-agentsmd-v3` · **Track:** optimization only (not product authoring)  
**Revision record:** `docs/agent-ops/2026-08-02-context-opt-charter-agentsmd-v3.md`

Closes dual-stack drift: OpenClaw charters were free to re-list path globs (stale vs `role-harness-policy.ts`), and Grok-native generators forced `agents_md: true` on every specialist — injecting full repo `AGENTS.md` into child sessions and defeating LOW_TOKEN spawn discipline.

| Contract | What | Status |
|---|---|---|
| **Dual-stack path pointer** | OpenClaw `agents/**/charter.md` **must not copy** writeRoots/forbidden/outputRoots globs. Charters point at path-scope SSOT: this file + `role-harness-policy.ts` → `pathScope` (+ optional one-line "pathScope owned by policy; see PATH-SCOPE.md"). Generated `.grok/agents/*.md` may still **render** compact tables from policy (machine SSOT → view); charters stay **pointers**, not second SSOT. | **IN FORCE** (SSOT governance); implementer: charter generator/path section + optional charter touch-ups |
| **Specialists `agents_md: false`** | Typed specialists / IC roles (everything except main-session orchestrator) ship Grok frontmatter **`agents_md: false`** so the host does not auto-inject full `AGENTS.md` into every child context. | **IN FORCE** (SSOT); implementer: `generate-harness-agents.ts` currently hardcodes `agents_md: true` for all — flip specialists; re-sync |
| **Orchestrator `agents_md: true`** | Main-session **orchestrator** (CEO / chief-coordinator embodiment) keeps **`agents_md: true`** — forest-view contract + `LEX_AGENTIC` / snapshot rehydrate remain main-thread only. Hand-maintained `.grok/agents/orchestrator.md` already has `agents_md: true`. | **IN FORCE** |
| **Spawn rehydrate slim** | Default spawn prompts (`buildRepoAgentSpawnPrompt` / team-spawn) **must not** paste full `AGENTS.md` or full `LEX_AGENTIC.md`. Slim rehydrate = Persona BLUF + PATH SCOPE block + charter/memory pointers + task + done_when. Full lexicon/AGENTS load is **orchestrator main** duty (or explicit frontier consult), not every specialist. | **IN FORCE** (SSOT); implementer: keep spawn builders pointer-only; avoid expanding COORD_READ dumps into prompt bodies |

### Dual-stack map (v3)

| Layer | Path scope representation | `agents_md` |
|---|---|---|
| **Policy SSOT** | `role-harness-policy.ts` → `pathScope` | n/a |
| **Governance SSOT** | this file (`PATH-SCOPE.md`) | n/a |
| **OpenClaw charter** | **Pointer only** — no glob tables | n/a (not Grok frontmatter) |
| **Generated Grok agent** | Compact table **from policy** (sync artifact) | **false** for specialists |
| **Main orchestrator** | Strict CEO path discipline in body + policy | **true** |
| **Spawn prompt** | `formatPathScopeBlock(pathScope)` only | host inherits frontmatter |

### Why (context cost + SoD)

1. **No dual SSOT:** copied globs in charters drift from policy → SoD false confidence. Pointers force one machine truth.
2. **Specialist context tax:** `agents_md: true` on every IC role reloads multi-KB forest contract that specialists must not re-own (orchestrator-only-main).
3. **Spawn bloat:** restating full AGENTS/LEX in every spawn defeats Guidance Stability + LOW_TOKEN; bake PATH SCOPE + persona, not the forest.

### Implementer surfaces (code — not HRBP write roots)

| Surface | Expected delta |
|---|---|
| `tools/agent-factory/generate-harness-agents.ts` | `agents_md: false` for generated specialists; never force true for non-orchestrator |
| `pnpm agent:harness:sync` | regenerate `.grok/agents/*.md` after frontmatter flip |
| `agents/**/charter.md` (optional) | add pathScope SSOT pointer section if missing; strip any hand-copied writeRoots tables |
| `grok-repo-agent-spawn.ts` / team-spawn | remain slim: PATH SCOPE block + pointers; no full AGENTS/LEX paste |
| `.grok/agents/orchestrator.md` | keep `agents_md: true` + path discipline (hand-maintained) |

### Parent / HRBP checklist (v3)

1. After sync: specialists show `agents_md: false`; orchestrator shows `agents_md: true`.
2. Charters: pathScope **pointer** present; no second glob inventory.
3. Spawn-spec / team-spawn prompts: PATH SCOPE block present; no full AGENTS/LEX body.
4. Roster review scores **Dual-stack path pointer** + **agents_md policy** rows below.

## Enforcement matrix (Wave A)

**Slice:** `context-opt-wave-a-enforce` · **Track:** optimization only · **BOD:** APPROVED Wave A 2026-08-02  
**Revision record:** `docs/agent-ops/2026-08-02-context-opt-wave-a-enforce.md`

Single view of **soft** (prompt / discipline / recommendation) vs **hard** (machine fail / generator invariant) path-scope controls. Soft does not fail verify; hard fails verify or blocks generation.

| Control | Soft | Hard | Where |
|---|---|---|---|
| **pathScope writeRoots in prompt** | soft (baked PATH SCOPE block; agent instructed to stay in roots) | — | `grok-repo-agent-spawn` + `openclaw:team-spawn` prompts |
| **pathScope touched[] audit** | — | **hard** (`ok: false` on out-of-scope `touched[]`) | `verifySliceBrief` → `auditHandoffsPathScope` |
| **sole-author locks** | — | **hard** (`ok: false` on lock violations) | `verifySliceBrief` → `auditHandoffsSoleAuthorLocks` |
| **isolation=worktree for writers** | soft rec on spawn-spec / team-spawn JSON (`isolation` top-level + nested) | **hard** on team-spawn CLI assert for workspace-write writers (Wave A) | spawn-spec recommendation + `slice-team` / `slice-team-cli` |
| **preferredCli** | soft (package-filtered CLI hint in tables/prompts) | — | prompt + generated `.grok/agents/*.md` only |
| **agents_md specialists false** | — | **hard** (generator invariant) | `generate-harness-agents.ts` → specialists `agents_md: false`; orchestrator hand-maintained `true` |
| **CEO write roots** | soft discipline (body + persona self-test; tools may still expose write) | — | `.grok/agents/orchestrator.md`, `orchestrator-only-main.md`, persona |

### Soft vs hard (definitions)

| Class | Means | Fail mode |
|---|---|---|
| **Soft** | Prompt text, recommendation fields, CEO/parent discipline, roster scoring | Roster **major/critical** on review; no automatic `verifySliceBrief` fail unless a **hard** control also trips |
| **Hard** | Machine gate on verify, CLI assert, or generator invariant | Slice verify `ok: false`, CLI non-zero, or sync produces wrong frontmatter |

### Parent MUST pass isolation (standing + Wave A)

Team-spawn / spawn-spec JSON **does not execute** `spawn_subagent`. When a writer role returns **`isolation: "worktree"`** (top-level and/or `spawnSubagentCall.isolation`):

1. Parent (Composer / chief-coordinator / orchestrator) **MUST** pass `isolation=worktree` into the harness `spawn_subagent` call.
2. Parent **MUST NOT** strip, ignore, or rewrite isolation to `"none"` for workspace-write writers.
3. Wave A hardens **team-spawn CLI** so writers with `workspace-write` policy are asserted toward `isolation=worktree` in the report/payload; **parent pass-through remains mandatory** even after CLI assert (JSON ≠ spawn execution).

Codified: `agents/rules/orchestrator-only-main.md`, `.grok/agents/orchestrator.md`, this matrix.

### Relation to prior slices

| Slice | Soft/hard contribution |
|---|---|
| `path-scope-policy-v1` | Soft writeRoots in tables → **hard** Option 2 `touched[]` audit |
| `context-opt-higher-v1` | Soft isolation rec + sole-author governance table + soft preferredCli |
| `context-opt-grok45-v2` | Soft PATH SCOPE + isolation top-level on team path; parent-pass standing rule |
| `context-opt-charter-agentsmd-v3` | **Hard** `agents_md: false` for specialists (generator) |
| **`context-opt-wave-a-enforce`** | Matrix SSOT; isolation soft→hard on team-spawn CLI; CEO isolation forward bullet |

## Wave B tool-surface hygiene

**Slice:** `context-opt-wave-b-tools` · **Track:** optimization only · **BOD:** APPROVED Wave B 2026-08-02  
**Revision record:** `docs/agent-ops/2026-08-02-context-opt-wave-b-tools.md`  
**B3 decision (authoritative):** **KEEP CEO write/shell tools** with **CEO write-roots discipline** (OpenClinXR hygiene carve-out). Not an ATL-style pure no-shell / tool-strip CEO.

Wave B governs **which tools each role may use** (Grok frontmatter `tools` / `disallowedTools`, preferred CLI, image surface) without changing path writeRoots. Soft guidance + roster scoring first; hard only where generator/frontmatter can already encode it.

### Soft vs hard (tools)

| Control | Soft | Hard | Where |
|---|---|---|---|
| **preferredCli** | soft (package-filtered CLI hint; agents *should* prefer listed CLIs) | — | `pathScope.preferredCli` → generated `.grok/agents/*.md` + spawn PATH SCOPE / tool-policy table |
| **CLI-first vs disabled MCP** | soft (TOOLING.md + agent Prefer/Avoid tables; roster **major** if role requires disabled MCP) | — | `docs/TOOLING.md`, `pnpm env:doctor`, generated agent Prefer/Avoid |
| **CEO write roots discipline** | soft (body + persona self-test; write tools present but only CEO roots may be edited) | — | `.grok/agents/orchestrator.md`, `orchestrator-only-main.md`, CEO-VOICE |
| **CEO write + shell tools retained (B3)** | soft policy standing rule (KEEP; do not strip) | — | this section + B3 record; orchestrator frontmatter |
| **Image / video tools (non-visual roles)** | soft roster score until generator encodes | **hard target** when generator/`disallowedTools` lists `image_gen`, `image_edit`, `image_to_video`, `reference_to_video` for non-visual roles | orchestrator already hard-disallows; specialists via `generate-harness-agents.ts` |
| **Image / video tools (visual roles)** | soft allow when mission is evidence/visual critique | — | e.g. asset-pipeline / visual-realism / capture-adjacent — spawn or hand-maintained allow |
| **mcpInheritance: none** | — | **hard** (generator invariant) | `generate-harness-agents.ts` + hand-maintained agents |
| **Specialist no spawn_subagent** | — | **hard** (generator) | specialists disallow `spawn_subagent` (chief-coordinator exception in generator) |

### preferredCli (soft guidance only)

- `pathScope.preferredCli` is a **hint**, not a verify fail.
- Writers with package scope (asset-pipeline, xr, etc.) **should** use listed filters (`pnpm --filter …`, role pipeline CLIs).
- HRBP scores missing preferredCli on package-write roles as **minor**; using disabled MCP as required tool as **major**.
- No Wave B hard gate on preferredCli (same as Wave A matrix).

### Image tools — non-visual vs visual

| Role class | Image tools (`image_gen`, `image_edit`, `image_to_video`, `reference_to_video`) |
|---|---|
| **Non-visual** (hrbp, drift-police, planning, clinical-safety, pediatrics, CEO/orchestrator, most coordinators) | **Disallowed** — cost + mission mismatch. Orchestrator already lists them under `disallowedTools`. |
| **Visual / evidence-adjacent** (asset-pipeline-lead, visual-realism-adversary, capture/evidence roles when staffed) | **Allowed** when the task is skeptic-visible evidence, cagematch critique, or website-grade visuals — not product IC rendering in apps/packages outside writeRoots. |

Roster: image tools present on a non-visual role → **major** tool-surface defect until frontmatter/generator corrected.

### B3 — KEEP CEO write/shell tools (not a strip)

| Option considered | Decision |
|---|---|
| **ATL pure CEO** — no shell / no write tools; spawn everything | **Rejected** for OpenClinXR |
| **B3 KEEP** — retain `run_terminal_command`, `write`, `search_replace` on orchestrator | **APPROVED** |

**Rationale (OCX hygiene carve-out):** Main-session CEO must run OpenClaw hygiene without IC escape hatch: `pnpm openclaw:*`, `pnpm env:doctor`, `pnpm agent:alignment`, `pnpm docs:drift-check`, `pnpm grok:agent:spawn-spec`, `mise …`, plus coordination SSOT edits under **CEO write roots only** (`PROJECT_STATUS.md`, worker-backlog, `operator-*.md`, slice hygiene, agent-ops when hrbp unstaffed). Soft path discipline + self-test replace a hard tool strip.

**Standing rules:**

1. **Do not strip** CEO write/shell from orchestrator frontmatter as a "context opt."
2. CEO **must not** use those tools for `apps/**` / `packages/**` product IC — spawn typed roles instead.
3. Image/video remain **disallowed** on CEO (research = `web_search`/`web_fetch` only among network tools).
4. HRBP scores main-session product IC as **critical** (SoD); scores unnecessary CEO tool-strip proposals as out-of-policy vs B3.

### Relation to Wave A

Wave A = path/isolation/sole-author **enforcement class**.  
Wave B = **tool surface** class (what tools exist vs mission). Both use soft vs hard vocabulary; B3 deliberately keeps CEO tools soft-disciplined rather than hard-stripped.

### Parent / HRBP checklist (Wave B)

1. Orchestrator still has write + shell tools; image tools still disallowed.
2. Specialists: `mcpInheritance: none`; no disabled MCP as required dependency.
3. Non-visual roles: no image tool allowance without mission justification.
4. preferredCli present (soft) on package writers; Prefer/Avoid CLI-first tables current.
5. Roster scores **tool surface matches mission** + B3 KEEP standing rule.

## HRBP roster review: path-scope checklist

On every roster review (`docs/agent-ops/YYYY-MM-DD-roster-review.md`), HRBP scores:

| Check | Pass when |
|---|---|
| **writeRoots present** | Every write-capable role has explicit `pathScope.writeRoots` |
| **Disjoint SoD** | No two roles share a writeRoot; residual overlaps named and justified |
| **Forbidden roots explicit** | Every role declares `forbidden` covering `apps/**` + protected docs + other roles' roots |
| **Output roots canonical** | `outputRoots` matches charter "Output roots" section |
| **Generated agents reflect** | `.grok/agents/*.md` show path-scope table (post-sync) |
| **Spawn prompt bakes** | `grok-repo-agent-spawn.ts` injects pathScope into spawn prompt |
| **Handoff audit enforces** | `verifySliceBrief` runs `auditHandoffsPathScope` — violations fail verify (ok: false) |
| **Worktree isolation used** | Writers spawn with `isolation=worktree` **passed by parent** (never stripped); Wave A: team-spawn CLI asserts worktree for workspace-write writers |
| **Team-spawn PATH SCOPE** | `openclaw:team-spawn` prompts include PATH SCOPE block; role paths constrained vs writeRoots |
| **Team-spawn isolation top-level** | team-spawn JSON has role-level `isolation`; parent still passes `isolation=worktree` to harness |
| **Sole-author locks held** | No silent writeRoot overlap; SHARED roots named + justified; **hard** verify via `auditHandoffsSoleAuthorLocks` |
| **preferredCli present** | Write-capable package roles declare `preferredCli`; baked in generated agents + spawn prompt (soft only) |
| **Dual-stack path pointer** | OpenClaw charters point at PATH-SCOPE.md + `role-harness-policy.ts` pathScope — **no hand-copied writeRoots/forbidden glob tables** |
| **agents_md policy** | Specialists / generated IC roles: `agents_md: false`; main orchestrator: `agents_md: true` |
| **Spawn rehydrate slim** | Spawn prompts use PATH SCOPE + persona/charter pointers; no full AGENTS.md / LEX_AGENTIC paste by default |
| **Enforcement matrix current** | Soft/hard classification in PATH-SCOPE §Enforcement matrix matches live verify/generator/CLI behavior |
| **Tool surface matches mission** | `tools` / `disallowedTools` fit role mandate; no disabled MCP required; image tools only on visual/evidence roles; **B3 KEEP** CEO write/shell with write-roots discipline (not stripped) |
| **preferredCli soft** | Package writers declare preferredCli; agents prefer listed CLIs (soft only — no verify fail) |
| **Image tools non-visual** | Non-visual roles disallow `image_gen` / `image_edit` / video tools (orchestrator already; specialists via generator or hand frontmatter) |
| **architect staffed (Wave C)** | Dual-stack `architect` present (charter + policy pathScope + generated agent); was roster **15** at Wave C close |
| **Composition hard law (Wave C)** | Features in packages; apps = shells; feature-in-app without owner writeRoots → critical |
| **Delivery role-mapped (Wave C)** | Delivery edits via typed pathScope owners / team-spawn — not silent multi-root `general-purpose` |
| **Worktree promote loop (Wave C)** | `pnpm openclaw:worktree:promote` used after worktree writers; path-scope allowlist enforced; isolation spawn not claimed as full lifecycle alone |
| **archivist staffed (docs-warehouse-v1)** | Dual-stack `archivist` present (charter + policy pathScope + generated agent); read-only retrieval; roster **16** |
| **Warehouse rehydrate exclusion** | `docs/_archive/**` not opened on normal rehydrate; cold history via archivist / explicit historical task only |
| **Hot SSOT stays hot** | Living agent-ops basenames never freeze; only dated revision records go cold |

Severity: **critical** (SoD clash — two roles share writeRoot silently; **charter dual SSOT globs that contradict policy**; **main session product IC**; **feature dump into apps outside owner writeRoots**); **major** (missing writeRoots on write-capable role; specialist still `agents_md: true` after v3 sync; spawn still dumps full AGENTS/LEX; **image tools on non-visual role**; required disabled MCP; **silent multi-root GP delivery**; **architect missing after Wave C claim**; **archivist missing after warehouse claim**; **agents treating cold warehouse as marching orders**); **minor** (forbidden incomplete but no current clash; pointer wording uneven; missing preferredCli on package writer; promote CLI unused after worktree writer; freeze stub wording uneven).

## docs-warehouse-v1 (ODS vs cold archive + archivist)

**Slice:** `docs-warehouse-v1` · **Track:** optimization only · **BOD:** APPROVED Option 1 2026-08-02  
**Process SSOT:** `docs/agent-ops/DOC-WAREHOUSE.md` · **Warm index:** `docs/agent-ops/REVISION-INDEX.md` · **Revision record (cold):** `docs/_archive/agent-ops/2026-08/2026-08-02-docs-warehouse-v1.md` (stub at `docs/agent-ops/2026-08-02-docs-warehouse-v1.md`)

Context optimization reduced spawn bloat; **doc surface bloat** remains (dated revision peers next to living law). Warehouse splits **hot (ODS)** living SSOT from **cold** frozen history under `docs/_archive/**`.

| Contract | What | Status |
|---|---|---|
| **Hot living SSOT** | Non-dated agent-ops law (`PATH-SCOPE`, `CEO-VOICE`, `COMPOSITION-ROOTS`, `DOC-WAREHOUSE`, …) + protected 6 + TOOLING — **never archive** | **IN FORCE** (process) |
| **Cold warehouse** | `docs/_archive/**` + `.openclinxr/slice-archive/**`; freeze via `pnpm docs:archive` leaves stubs at old paths | **IN FORCE** — first batch `context-opt-2026-08-02` frozen |
| **Rehydrate exclusion** | **`docs/_archive/**` is out of normal rehydrate** — agents must not open warehouse on session start / compaction | **IN FORCE** (process; see DOC-WAREHOUSE) |
| **`archivist` role** | Dual-stack read-only (explore / `fast_bounded`): retrieve cold history + manifests; map successors; **never rewrite hot law**; **never product IC** | **IN FORCE** — roster **16** (charter + policy pathScope + `.grok/agents/archivist.md`) |
| **Authority classes** | Living agent-ops → `current-reference`; dated revisions + `docs/_archive/**` → `historical-synthesis` | Implementer `docs:authority` |

### Archivist path-scope (summary)

Machine roots in `role-harness-policy.ts` (`getRolePathScope("archivist")`) — charter is **pointer only** (v3 dual-stack).

| | |
|---|---|
| **Sandbox** | Prefer **read-only** / explore — freeze/manifests owned by `pnpm docs:archive` CLI, not agent rewrite |
| **writeRoots** | Empty or minimal notes only (e.g. `.openclinxr/docs-archive/**` if policy allows); no hot agent-ops SSOT |
| **read preference** | `docs/_archive/**`, `REVISION-INDEX.md`, `DOC-WAREHOUSE.md`, registries, `.openclinxr/slice-archive/**`, hot successor SSOT (read map only) |
| **forbidden** | `apps/**`, product `packages/**`, rewrites of PATH-SCOPE / CEO-VOICE / COMPOSITION-ROOTS living bodies |

### Parent / HRBP checklist (warehouse)

1. Rehydrate hot/warm only — do not bulk-read `docs/_archive/**`.
2. Historical dig → spawn **`archivist`**, not product roles / silent full-stack.
3. After freeze: living basenames still hot; dated bodies cold; stubs + REVISION-INDEX + manifest consistent.
4. Roster scores: **archivist staffed**, warehouse rehydrate exclusion, no dual SSOT of archived bodies as law.
5. New dated agent-ops revision records may stay hot briefly, then freeze on next warehouse pass.

## Related

- `agents/coordinator/hrbp/charter.md` — review dimensions
- `docs/agent-ops/COMPOSITION-ROOTS.md` — composition doctrine (apps = shells, packages = features, tools = pipeline CLIs)
- `docs/agent-ops/DOC-WAREHOUSE.md` — ODS / warehouse process (docs-warehouse-v1)
- `docs/agent-ops/REVISION-INDEX.md` — warm freeze batch catalog
- `agents/coordinator/archivist/` — cold retrieval role
- `packages/openclinxr/agent-loop/src/role-harness-policy.ts` — `RepoRoleHarnessPolicy` type + policies
- `packages/openclinxr/agent-loop/src/slice-team.ts` — `auditHandoffsPathScope` + `verifySliceBrief` + team-spawn PATH SCOPE bake (v2)
- `tools/openclinxr/openclaw/slice-team-cli.ts` — `pnpm openclaw:team-spawn` enrichment (isolation top-level, spawnSubagentCall)
- `tools/agent-factory/generate-harness-agents.ts` — `grokNativeAgentMarkdown` generator (`agents_md` per v3)
- `packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.ts` — `buildRepoAgentSpawnPrompt` + spawn-spec isolation + slim rehydrate
- `docs/agent-ops/2026-08-02-context-opt-grok45-v2.md` — v2 revision record
- `docs/agent-ops/2026-08-02-context-opt-charter-agentsmd-v3.md` — v3 revision record
- `docs/agent-ops/2026-08-02-context-opt-wave-a-enforce.md` — Wave A enforcement matrix revision record
- `docs/agent-ops/2026-08-02-context-opt-wave-b-tools.md` — Wave B tool-surface hygiene + B3 KEEP CEO tools revision record
- `docs/agent-ops/2026-08-02-context-opt-wave-c.md` — Wave C C-arch + C-worktree revision record
- `docs/_archive/agent-ops/2026-08/2026-08-02-docs-warehouse-v1.md` — docs warehouse Option 1 revision record (cold; stub at agent-ops dated path)
- `docs/agent-ops/WORKTREE-PROMOTE.md` — Wave C-worktree promote parent flow + CLI
- `tools/openclinxr/openclaw/worktree-promote.ts` — `pnpm openclaw:worktree:{list,status,promote}`
- `docs/agent-ops/2026-08-02-context-opt-thrash-evidence.md` — thrash measurement (NO_GO alone; BOD override for scoped C)
- `docs/agent-ops/RACI.md` — role-to-area mapping (cross-check with pathScope)
- ATL source: `atlantis-cameras-v2` path-scope policy (historical reference)


## Thrash evidence gate (Wave C entry)

**Slice:** `context-opt-thrash-evidence` · **Date:** 2026-08-02  
**Artifact:** `.openclinxr/evidence/context-opt-thrash-evidence/thrash-evidence-2026-08-02.json`

### Rule (default)
Wave C opens from thrash evidence **only** if **current** thrash is proven:

| Signal | Threshold for GO |
|--------|------------------|
| Live workspace-write roles missing `isolation=worktree` | any |
| Live max spawn prompt size | > 5000 chars |
| Fresh team-spawn `isolationEnforce.ok` | false |

Historical pre-optimization spawn JSON **alone** is **not** sufficient (documents past debt already paid by Waves A–B).

### Thrash measurement 2026-08-02: **NO_GO on thrash alone**

| Evidence class | Finding |
|----------------|---------|
| Historical team-spawn (31 files, 59 roles) | 34/34 writers missing isolation; 0 PATH SCOPE — **pre-Wave-A thrash** |
| Live spawn-spec (15 roles post Wave C-arch) | All workspace-write → isolation=worktree; max prompt kept slim |
| Fresh team-spawn thrash-evidence execute | isolationEnforce.ok=**true**; asset pathWarnings stripped `apps/api/**`; writers worktree |

**Thrash conclusion:** Past thrash is real; **present thrash after A/B is not proven**.

### BOD override 2026-08-02: **Wave C APPROVED (scoped both strands)**

BOD approved **scoped** Wave C despite thrash NO_GO — not full ATL FE/BE RIF of every `general-purpose` spawn. Scope = **C-arch + C-worktree** only (see §Wave C below). Thrash gate remains the default bar for *future* expansion beyond these two strands.

## Wave C (architect composition + worktree promote)

**Slice:** `context-opt-wave-c` · **Track:** optimization only · **BOD:** APPROVED both strands 2026-08-02  
**Revision record:** `docs/agent-ops/2026-08-02-context-opt-wave-c.md`  
**Strands:** **C-arch** · **C-worktree**

Wave C closes two residuals left after A+B: (1) composition doctrine was soft-only and delivery still drifted toward unmapped `general-purpose`; (2) worktree isolation ends at spawn — **promote/merge/cleanup** was manual.

### C-arch — architect role + composition hard law + role-mapped delivery

| Contract | What | Soft / hard | Status |
|---|---|---|---|
| **`architect` role** | Typed OpenClaw role `architect` at `agents/core/architect/` (+ policy `pathScope`, generated `.grok/agents/architect.md`). Mandate: package/composition integrity, composition-root hard law, reject silent full-stack. **Not** XR runtime IC (`xr-systems-architect`); **not** agent roster (`hrbp`). | **hard** policy + dual-stack | **IN FORCE** (roster **15** at Wave C; **16** after archivist) |
| **Composition hard law** | Features → `packages/openclinxr/*`; apps = composition hosts / shells; tools = factory/pipeline CLIs. Dumping feature logic into apps without app-owner `writeRoots` is a **critical** SoD / composition defect. Hard rules H1–H5 in COMPOSITION-ROOTS.md. | soft roster + **hard** path `touched[]` + sole-author `composition-roots` | **IN FORCE** |
| **Delivery must be role-mapped** | Product/delivery edits spawn **typed roles** whose `pathScope.writeRoots` cover the paths. Silent bare `general-purpose` catch-all → **major/critical**. Helper: `assertDeliveryRoleMapped(roleId)`. Spawn safeguards + workspace-write COMPOSITION-ROOTS pointer. | soft parent + **hard** assert helper when called | **IN FORCE** |
| **composition-roots lock** | Owner **architect**: COMPOSITION-ROOTS.md, `packages/cellix/**`, `packages/openclinxr/architecture-rules/**`. `ownedCovering` allows hrbp agent-ops overlap on COMPOSITION-ROOTS only. | **hard** sole-author audit | **IN FORCE** |

#### Architect vs adjacent roles (SoD)

| Role | Owns | Does not own |
|---|---|---|
| **architect** | Composition-root hard law; package layering; architecture-rules / MADR fit; role-mapped delivery pressure | Agent roster (hrbp); UI-XR runtime IC (xr-systems-architect); Anny/asset factory IC (asset-pipeline-lead); CEO orchestration (orchestrator) |
| **xr-systems-architect** | `apps/ui-xr/**`, arena/xr packages (runtime shell bind) | Cross-monorepo composition policy |
| **hrbp** | Roster, path-scope SSOT, agent-ops | Product package structure implementation |
| **implementation-planning-lead** | Slice sequencing / plan docs | Hard composition enforcement |

#### C-arch parent / HRBP checklist

1. Prefer spawn `architect` (or role-mapped owners) for composition / layering / package-boundary work — not unmapped GP.
2. Delivery paths ⊆ owning role `writeRoots`; multi-root → multi-role team, not one silent full-stack agent.
3. After implementer: `agents/core/architect` exists; policy `getRolePathScope("architect")` defined; harness sync emits agent + `agents_md: false`.
4. Roster scores composition hard law + role-mapped delivery; silent GP multi-root → major/critical.

### C-worktree — promote CLI loop (**IN FORCE**)

Isolation spawn-spec + CLI assert + parent pass-through (Waves higher-v1 / A) are **done**. **Promote/merge CLI shipped** (Wave C-worktree):

**SSOT:** `docs/agent-ops/WORKTREE-PROMOTE.md` · CLI: `tools/openclinxr/openclaw/worktree-promote.ts`

| Stage | What | Owner |
|---|---|---|
| 1. Spawn | Writer `isolation=worktree` (hard team-spawn assert; parent MUST forward) | parent + spawn-spec / team-spawn |
| 2. Edit | Agent edits only inside worktree + `writeRoots` | writer role |
| 3. Test | Focused package tests / preferredCli in worktree | writer or parent |
| 4. **Promote** | `pnpm openclaw:worktree:promote -- --slice-id … --role …` copies writeRoots-allowed (+ role handoff) into main | parent / integrator on main |
| 5. Cleanup | Optional; **no force-delete** without future `--force` | parent (manual for now) |

| Control | Soft | Hard | Where |
|---|---|---|---|
| isolation=worktree for writers | soft rec on spawn-spec | **hard** team-spawn CLI (Wave A) | spawn-isolation / slice-team-cli |
| parent forward isolation | soft → process law | process **MUST** (never strip) | orchestrator-only-main |
| **promote/merge CLI loop** | — | **hard** CLI + unit tests; exit 2 on path-scope skips | `openclaw:worktree:{list,status,promote}` |
| promote only in-scope paths | — | **hard** allowlist = `writeRoots` ∪ role handoff JSON | promote CLI + Option 2 verify |

**Standing rules (C-worktree):**

1. Do **not** treat spawn isolation alone as a complete worktree lifecycle — run promote after writers finish.
2. Thin promote CLI is the intended yield (not full ATL FE/BE RIF of GP).
3. Promote **must not** bypass path-scope / sole-author: promoted paths still subject to Option 2 audits when recorded in handoff `touched[]`.
4. Parent/CEO may run promote hygiene CLI (B3 KEEP shell) without product IC.

#### C-worktree parent checklist

1. Spawn writers with `isolation=worktree` (forward from team-spawn JSON).
2. After writer done: `pnpm openclaw:worktree:promote -- --slice-id <id> --role <roleId>` (or `--dry-run` first).
3. Confirm handoff `touched[]` still inside writeRoots post-promote; run `pnpm openclaw:slice:verify`.
4. Do not leave worktree as second SSOT; cleanup is manual until `--force` cleanup lands.

### Soft vs hard (Wave C summary)

| Control | Soft | Hard | Where |
|---|---|---|---|
| architect role staffed | — | **hard** policy + charter + generated agent | dual-stack roster (15) |
| composition hard law | roster major/critical on feature-in-app dump | path `touched[]` + sole-author `composition-roots` | verify + COMPOSITION-ROOTS + architect |
| delivery role-mapped | parent discipline; silent GP multi-root = major | `assertDeliveryRoleMapped` when CLI/docs call it | CEO / team-spawn / agent-loop |
| worktree promote CLI | — | **hard** CLI + unit tests (C-worktree) | openclaw worktree promote |
| isolation continue | — | hard team-spawn + parent MUST | Wave A (unchanged) |

### Relation to prior slices

| Slice | Focus |
|---|---|
| `context-opt-higher-v1` | Worktree isolation **spawn** default; COMPOSITION-ROOTS **lite** doctrine |
| `context-opt-wave-a-enforce` | Soft/hard path + isolation CLI assert |
| `context-opt-wave-b-tools` | Tool surface + B3 KEEP |
| `context-opt-thrash-evidence` | Thrash NO_GO on measurement; **superseded for scoped C by BOD APPROVED** |
| **`context-opt-wave-c`** | **C-arch** architect + composition hard law + role-mapped delivery; **C-worktree** promote CLI loop |

### Not in Wave C scope

- Full ATL FE/BE RIF renaming every use of harness `general-purpose` subagent_type (typed **roles** still map to GP capability when write-tier).
- Product authoring / apps feature slices.
- CEO tool strip (B3 KEEP remains).

### Roster review rows (Wave C add)

| Check | Pass when |
|---|---|
| **architect staffed** | `agents/core/architect` + policy pathScope + generated agent; Wave C closed at **15** (was 14) |
| **archivist staffed** | `agents/coordinator/archivist` + policy pathScope + generated agent; docs-warehouse-v1 closed at **16** |
| **Composition hard law** | COMPOSITION-ROOTS doctrine enforced; feature dumps into apps without owner writeRoots scored critical |
| **Delivery role-mapped** | Delivery work uses typed roles / team-spawn path owners — not silent multi-root GP |
| **Worktree promote loop** | Promote CLI exists or residual explicitly tracked; isolation alone not claimed complete lifecycle |
