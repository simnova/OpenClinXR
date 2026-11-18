# OpenClinXR

OpenClinXR is a **Step 2 CS–inspired XR clinical skills exam platform**: timed multi-station encounters, WebXR learner runtime, faculty/admin review, scenario authoring, and an evidence-gated path from case definitions to runtime scenes.

**Claim control:** this is **not** an exam-equivalence product and does **not** claim clinical validity, licensure readiness, or production Quest certification. Early-stage R&D and local tooling first.

**Project page:** [developers.simnova.com/OpenClinXR](https://developers.simnova.com/OpenClinXR/)  
**Site source (GitHub Pages):** [`docs/`](https://github.com/simnova/OpenClinXR/tree/main/docs) on branch `main`

### Four product tiers

| Tier | What it is |
|------|------------|
| **Production exam platform** | Author, review, assemble, run, trace, and replay timed clinical encounters (learners, faculty, admins, scenario authors). |
| **Encounter Blueprint Factory** | Turn reviewed case definitions into WebXR scenes, actor behavior, dialogue policies, emotion timelines, review packets, and persistence records. |
| **Clinical Asset Commons** | Reuse rooms, equipment, clothing, humanoids, animation, and provenance across encounters. |
| **Capability Arena** | Cage-match candidate tech (TTS, speech, humanoid generation, IWSDK sidecars, providers) before any production promotion. |

Local/offline is the default development path. Promotion gates for providers, Quest readiness, learner production, and clinical/scoring claims stay **false** unless explicitly approved and evidenced.

---

## Prerequisites

Pins live in [`mise.toml`](mise.toml) and `package.json` `engines` / `packageManager`. Prefer **mise** over nvm/system Python. Full detail: [docs/TOOLING.md](docs/TOOLING.md).

| | Tool | Notes |
|---|------|--------|
| **Must** | [mise](https://mise.jdx.dev) | Project pins win; owns Node / pnpm / Python |
| **Must** | Node **24** (LTS) | `engines.node`: `>=24.15.0` |
| **Must** | pnpm **11.18.x** | `packageManager`: `pnpm@11.18.0` — do **not** use corepack |
| **Must** | Python **3.13** via mise | Asset / Anny / voice scripts (`python3`) |
| **Must** | git | Clone and worktrees |
| **Must** | [direnv](https://direnv.net) (recommended) | Activates mise + loads `.env.local` on `cd` |
| **Optional** | Bun **1.3.x** | Local experiments (`mise` pin) |
| **Optional** | MongoDB | Durable persistence; many smokes use in-memory fixtures |
| **Optional** | Blender | Anny / humanoid asset pipeline |
| **Optional** | [GitHub CLI](https://cli.github.com) (`gh`) | PRs/issues — preferred over any GitHub MCP |
| **Optional** | `DEEPSEEK_API_KEY` | Agent assist only; never commit |
| **Optional** | Playwright browsers | `pnpm playwright:install` for browser evidence |

---

## Get started

### 1. Host setup (once per machine)

```bash
# Install mise: https://mise.jdx.dev
# Install direnv: https://direnv.net

mkdir -p ~/.config/direnv/lib
mise direnv activate > ~/.config/direnv/lib/use_mise.sh

# ~/.zshenv — shims first on PATH:
#   export PATH="$HOME/.local/share/mise/shims:$PATH"
# ~/.zshrc:
#   eval "$(direnv hook zsh)"

# Open a new terminal after editing shell config, or: exec zsh -l
```

Do **not** combine `eval "$(mise activate zsh)"` **and** direnv `use mise` — pick direnv + shims (this repo’s pattern).

### 2. Clone setup (once per clone)

```bash
git clone <repo-url> openclinxr && cd openclinxr

mise trust
mise install

cp .envrc.example .envrc
cp .env.local.example .env.local   # optional: DEEPSEEK_API_KEY, MONGODB_URI, …
direnv allow

pnpm install
```

`.envrc` is `use mise` only — **secrets go in `.env.local`**, never in `.envrc`.

Without direnv, from the repo root:

```bash
eval "$(mise env -s zsh)"   # or: mise activate zsh
```

### 3. Verify the workstation

```bash
pnpm env:doctor            # mise pins, PATH, turbo, install health
# or:  mise run doctor

pnpm openclaw:preflight    # env:doctor + alignment + drift + lease status
pnpm local:exam:smoke      # deterministic ED station harness (no cloud)
```

Useful variants: `pnpm env:doctor:json`, `pnpm env:doctor:strict`.

### 4. Run apps (local)

Each in its own terminal, from repo root with mise/direnv active:

```bash
pnpm --filter @openclinxr/api dev
pnpm --filter @openclinxr/ui-admin dev:portless   # default port 5174
pnpm --filter @openclinxr/ui-xr dev:portless      # default port 5173
```

Arena / tooling (optional):

```bash
pnpm --filter @openclinxr/model-vetting-studio dev:portless   # humanoid cage-match UI
pnpm arena:iwsdk:dev                                         # IWSDK WebXR spike
```

---

## Repo layout

| Path | Role |
|------|------|
| `apps/api`, `apps/ui-admin`, `apps/ui-xr` | Production-facing API and UIs |
| `apps/arena/*` | Capability Arena sidecars (IWSDK, voice, model vetting, …) |
| `packages/openclinxr/*` | Domain, runtime, gateways, persistence, review, fixtures |
| `packages/openclinxr/arena/*` | Spike / experimental packages |
| `tools/openclinxr/factory/*` | Blueprint → runtime / review / materialization generators |
| `tools/openclinxr/evidence/*` | Validators, benchmarks, capture helpers |
| `tools/openclinxr/openclaw/*` | Build-ops CLIs (env doctor, lease, preflight, …) |
| `docs/openclinxr/` | Product docs, runbooks, evidence |
| `docs/TOOLING.md` | Toolchain, PATH, agent shells |

Encounter flows are meant to be **blueprint-driven** through the factory, not hand-authored one-off scenes.

---

## Asset licensing constraints

OpenClinXR ships generated 3D assets. Several tools that can produce them carry licences whose terms
depend on **facts about the product**, not about the code — so the same tool can be fine today and
prohibited later. The parameters are recorded in
[MADR 0046](docs/madr/0046-licence-gate-parameters-revenue-and-territory.md):

| Parameter | Current value |
|---|---|
| Annual revenue | **below USD 1,000,000** |
| Operating territory | **United States only** |
| Distribution model | **not yet stated** — affects notice obligations |

**If either of the first two changes, re-read this table before generating another asset.** Two of the
restrictions below terminate or reach backwards into assets already produced.

### Restricted by REVENUE

| Tool | Gate | What happens at the threshold |
|---|---|---|
| **Stable Fast 3D** | Stability AI Community License, ~USD 1M annual revenue (org-wide, any source) | The licence **terminates automatically**. An Enterprise licence is required to continue. Commercial use below the threshold also requires registration at `stability.ai/community-license`. |

Treat the revenue threshold as a **hard product gate with a tripwire**, not a reminder. Outputs you
already generated are yours (§IV.c.iii), but continued use of the model is not.

### Restricted by GEOGRAPHY

| Tool | Gate | What happens outside it |
|---|---|---|
| **Hunyuan3D-2** | Tencent Community License: Territory is worldwide **excluding the EU, the UK and South Korea** | AUP §5.c bars distributing or **displaying the Outputs** outside Territory — not just the model. Expanding to those markets **re-blocks meshes already generated**. |

Because the restriction follows the Output, anything generated this way must record its **generator**
in the MADR 0016 asset manifest, not merely its licence — otherwise a future territory change means
auditing every asset by hand.

Hunyuan also carries a 1M-monthly-active-user gate measured at its 2025-01-21 release date, and an AUP
whose medicine clauses (§14 high-stakes automated decisions, §20 unlicensed practice) restrict
**automated clinical decision-making**, not the generation of props for a training simulator. Neither
binds today.

### Restricted by COPYLEFT — unchanged by revenue or geography

| Tool | Licence | Posture |
|---|---|---|
| **MPFB2** | GPL-3.0-or-later | Out-of-repo authoring tool. Never vendored, never imported by repo code, never shipped. |
| **StableGen** | GPL-3.0 | Same. Also does not complete headless — its generation is a modal Blender operator. |
| **ComfyUI** | GPL-3.0 | Same. Output textures are governed by the **checkpoint** licence, not ComfyUI's. |

The outputs of these tools ship; their code does not. That split is the whole posture — see
[MADR 0044](docs/madr/0044-makeclothes-with-anny-as-reference-cagematch.md).

For MakeHuman-derived assets the safer factual basis is the **asset** licence, not the tool's: the
`hm08` base mesh is explicitly CC0, and each community garment carries its own `license:` field in its
`.mhclo` header — machine-readable, so a parser can feed the manifest directly.

### Blocked for other reasons

| Tool | Why |
|---|---|
| **TRELLIS** | Core is MIT, but `diffoctreerast` and the Inria gaussian-splatting family are **research / non-commercial**. Also requires CUDA, which this workstation does not have. |
| **Infinigen** (whole rooms) | BSD-3-Clause and licence-clean. Blocked on **geometry**, not licence: ~15.5M triangles against a 180,000 per-station budget. Its `infinigen_gpl` submodule is snow and particles, and is not on the indoor path. |

### Permissive, no gate

Poly Haven and ambientCG are CC0 by site policy — but **their APIs carry no per-asset licence field**,
so record the policy URL plus a byte hash in the manifest rather than scraping a page. NIH 3D is
per-entry and must be read individually.

**This section is an engineering reading of licence texts, not legal advice.** Counsel should sign
anything that ships.

---

## Useful links

| Doc | Role |
|-----|------|
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | **Canonical project state** (priority, active work, backlog, strategy) |
| [docs/openclinxr/worker-backlog-and-validation-matrix.md](docs/openclinxr/worker-backlog-and-validation-matrix.md) | Worker ownership + validation matrix |
| [docs/TOOLING.md](docs/TOOLING.md) | mise, direnv, env doctor, MCP→CLI |
| [AGENTS.md](AGENTS.md) | Agent operating contract (for AI/agent contributors) |
| [docs/openclinxr/](docs/openclinxr/) | Product docs and evidence |
| [docs/madr/README.md](docs/madr/README.md) | Architecture decision records / arena-to-decision map |
| [docs/madr/0046-...](docs/madr/0046-licence-gate-parameters-revenue-and-territory.md) | **Licence gate parameters** — revenue band, territory, and what they unblock |

**Not live SSOT** (historical names only — recover from git history if needed; do not recreate as living ledgers):

- `AUTONOMOUS_WORK_PLAN.md` / `PROJECT_COORDINATION_INDEX.md` → purged 2026-08-05; successor is `PROJECT_STATUS.md`

Warehouse process: [docs/agent-ops/DOC-WAREHOUSE.md](docs/agent-ops/DOC-WAREHOUSE.md). Status purge audit: [docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md](docs/openclinxr/reviews/2026-08-05-status-doc-purge-manifest.md).

---

## How we build (OpenClaw)

**OpenClaw** is the **repo-native build operating model**, not the product. There is no external OpenClaw daemon or SaaS required to develop.

Work is sliced, lease-gated, and checked with deterministic scripts so humans and coding agents share the same guardrails. Day-to-day for developers:

```bash
pnpm env:doctor            # “can I run tools?”
pnpm openclaw:preflight    # broader readiness (env + docs alignment + drift + lease)
pnpm local:exam:smoke      # cheap product-path smoke without cloud services
```

Agents and long-running automation also use `pnpm openclaw:post-slice`, leases, and the protected runbooks under `docs/openclinxr/`. Contributors who only need apps and packages can stay on the Get started path above and ignore agent automation until they need it.

### Copy-paste kickoff prompts

Condensed host prompts (full contract: [AGENTS.md](AGENTS.md)). State SSOT is **`PROJECT_STATUS.md`** (not archived coordination ledgers).

`Codex`

```text
Continue in repo-native OpenClaw mode in /Volumes/files/src/openclinxr using Codex local tools.
Read AGENTS.md, PROJECT_STATUS.md (snapshot), docs/openclinxr/worker-backlog-and-validation-matrix.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, docs/openclinxr/openclaw-tool-adapters-2026-05-27.md, and docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md as needed.
Use terminal, file edits, focused verification. Run pnpm docs:drift-check and pnpm agent:alignment before long unattended work. Select the next approved product slice from PROJECT_STATUS.md Next dequeue and continue without treating slice completion as a stop condition.
```

`Claude`

```text
Operate as a repo-native OpenClaw agent for /Volumes/files/src/openclinxr, not as generic Claude chat.
Use AGENTS.md, PROJECT_STATUS.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and docs/openclinxr/openclaw-tool-adapters-2026-05-27.md as the source of truth. Keep work blueprint/factory-driven.
If you have shell and file access, implement the next smallest approved product slice and run focused verification. If not, act as a bounded planner/reviewer without inventing status ledgers.
```

`Grok`

```text
Main session = orchestrator only (chief-coordinator). Spawn role-mapped subagents for product IC.
Use AGENTS.md BLUF, PROJECT_STATUS.md snapshot, docs/agent-ops/PATH-SCOPE.md / TEMPORAL-DECISIONS.md / TASK-COST-ROLLUP.md as needed.
Prefer pnpm openclaw:slice-token:start → team work → openclaw:slice-token:finish for token + task cost lines.
```

`Cursor`

```text
Run Cursor in repo-native OpenClaw mode for /Volumes/files/src/openclinxr.
Use AGENTS.md, PROJECT_STATUS.md, docs/openclinxr/openclaw-runbook-2026-05-27.md, and blueprint-factory-drift-guardrails before editing.
Make focused diffs against the next approved product slice; run the smallest relevant verification before claiming completion.
```

---

## More verification (when you need it)

```bash
pnpm agent:alignment       # cheap coordination check
pnpm docs:drift-check      # doc / coordination drift
pnpm pages:validate        # public site (docs/) consistency

# Focused package test example:
pnpm --filter @openclinxr/api test -- app.test.ts -t "name"
```

Prefer focused filters over full monorepo `pnpm verify` unless you are closing a release-style gate. See [docs/TOOLING.md](docs/TOOLING.md) for turbo agent vs human scripts and known tooling constraints.
