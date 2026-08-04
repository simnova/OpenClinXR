# Standing commit authority (OpenClinXR)

**Owner:** hrbp (policy) · chief-coordinator / orchestrator (delegation)  
**Established:** 2026-08-04  
**Status:** Active — standing authority for **worktree-local** green commits; main land is promote-gated  
**ATL source pattern:** atlantis-cameras-v2 `docs/agent-ops/COMMIT-AUTHORITY.md` (adapted; OCX is **stricter** on origin/main)  
**Binding:** `WORKTREE-PROMOTE.md` · `PATH-SCOPE.md` · `orchestrator-only-main.md` · `.agents/skills/delegated-worker-contract/SKILL.md`

## Principle

Typed worktree workers may **`git add` + `git commit` (and push the *worktree lane branch*) without asking the human per commit** when in-lane verification is green. That is standing pre-approved authority for routine lane work.

OpenClinXR does **not** copy Atlantis “push origin same branch = done.” Landing into the **main workspace / integration line** is **parent/human-gated** via the existing worktree promote flow (`pnpm openclaw:worktree:promote`). Children never force-push, never rewrite published history, and never blind-copy or blind-push worktree trees into main or shared origin as a substitute for promote.

The orchestrator main session does **not** own product commits as IC — it **delegates** to typed roles in isolated worktrees, then **promotes** intended files.

## What children may do (without human confirm)

| Action | Condition |
|--------|-----------|
| `git add` + `git commit` **in their worktree** | Work is coherent, **in-lane** (`writeRoots` + task scope), and verification is **green** for touched packages/docs |
| `git push` of the **worktree’s own lane branch** (no force) | After green commit — for durability of lane work only; **not** a main-merge claim |
| Commit messages | Complete sentences: **what** and **why** (not `wip` / `fix`) |
| Small logical commits | Prefer focused commits over one giant batch |
| Amend **local unpublished** commit | Only if that commit has never been pushed / never seen by others |

## When children must residual / ask human (or parent)

| Situation | Reason |
|-----------|--------|
| Secrets or credentials in any file | Security — do not push; flag in STATUS / residual; human-gated |
| Force-push (`--force` / `--force-with-lease`) | Destructive to remote history — **never** child authority |
| Amend, rebase, or rewrite **published** history | Already visible to other clones |
| Merge / push to `main` or release branch | Policy — parent promote + human merge gate |
| **Promote into main workspace** | Parent/integrator only: `pnpm openclaw:worktree:{list,status,promote}` |
| Blind copy/rsync of worktree → main or origin | Bypasses path-scope allowlist + intended-files audit |
| Out-of-lane paths (outside `writeRoots` / task) | Residual to owning role or parent — do not commit |

## OpenClinXR vs Atlantis mapping

| Atlantis | OpenClinXR |
|----------|------------|
| Child commits + **pushes origin same feature branch** as the close loop | Child commits (+ optional non-force push of **worktree lane branch**); **close loop = parent promote CLI** into main workspace |
| Merge to `main` human-gated | Same — plus worktree promote before main verify/post-slice |
| Force-push human-gated | Same — **never** child |
| Secrets residual | Same |

## Orchestrator / parent behavior

| Context | Action |
|---------|--------|
| Child reports green + commits in worktree | **Do not ask** “shall I commit?” — standing authority already applies in-lane |
| Child reports done | Run **promote** (or dry-run) for intended paths; then main verify / post-slice |
| Child reports blocker | Synthesize to human; do not invent commit permission for red or partial out-of-lane work |
| Child about to force-push / main-merge / secret | Residual **blocker** — no silent override |

## Safety (intended-files + isolation)

- **Worktree isolation:** writers use `isolation=worktree`; parent **must pass** isolation through (Wave A). See `PATH-SCOPE.md` + `WORKTREE-PROMOTE.md`.
- **Take intended files only:** `git status` / `git diff` / `git diff --cached` before commit; never stage unrelated dirty paths or sibling-worktree noise.
- **Path-scope:** commit only paths inside role `writeRoots` (+ handoff JSON). Promote allowlist re-checks the same globs.
- **Verification before commit:** affected tests/typecheck (and docs guards when docs touched) green — see delegated-worker-contract skill.
- **No force-push; no history rewrite on published commits.**

## Implementation detail

1. Parent spawns typed role (`pnpm grok:agent:spawn-spec --role …`) with worktree isolation when writing.
2. Child implements **in worktree**, runs in-lane verify, **commits on green** (authority standing).
3. Optional: non-force push of the **lane branch** for durability — never claims main integration.
4. Child STATUS includes commit hashes + evidence; does not wait for human commit OK.
5. Parent runs `pnpm openclaw:worktree:promote` for allowlisted paths → main verify → post-slice.
6. Secrets / main merge / force history remain human-gated residuals.

## Cadence

| Event | Action |
|-------|--------|
| Policy added / changed | Index in `docs/agent-ops/README.md`; roster review spot-check |
| Monthly roster review | Sample child commits: messages, path locks, no force-push |
| Path-lock / wrong-tree incident | Audit commit + promote behavior vs this policy |
| Human says “stop auto-committing” | Respect immediately; residual to orchestrator |

## Related

- `docs/agent-ops/WORKTREE-PROMOTE.md` — promote CLI SSOT  
- `docs/agent-ops/PATH-SCOPE.md` — writeRoots / isolation  
- `docs/agent-ops/DELIVERY-ROLES.md` — named roles over bare `general-purpose`  
- `docs/agent-ops/TOOLING-TOPOLOGY.md` — CLI-first surfaces  
- `.agents/skills/delegated-worker-contract/SKILL.md` — worker bake-in  
