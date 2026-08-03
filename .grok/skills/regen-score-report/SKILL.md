---
name: regen-score-report
description: Headless-friendly regenerate → score → report loop for OpenClinXR factory/evidence work. Use for model-vetting, orchestrate_character, garment/skin regen, or any bounded regen-then-measure cycle under OPENCLINXR_WORKER=1.
when-to-use: regen score report, model vetting loop, orchestrate then capture, headless evidence, cagematch regen
---

# Regen → score → report (headless)

Cheap, deterministic loop for workers. Parent sets scope + `OPENCLINXR_WORKER=1`; worker does **not** update SSOT registries or PROJECT_STATUS.

## Preconditions

```bash
export OPENCLINXR_WORKER=1
export OPENCLINXR_JOB_TMP="${TMPDIR:-/tmp}/openclinxr-job-$$"
mkdir -p "$OPENCLINXR_JOB_TMP"
# worktree cwd with pathScope writeRoots only
```

## Loop

1. **Regen** (bounded CLI only; unique outs under job tmp or worktree artifact dir)
   - Character/pipeline: repo `orchestrate` / package scripts with explicit `--out` / job-tmp
   - Never fixed `/tmp/openclinxr_*` basenames (`per-job-temp` skill)
2. **Score / verify** (code first, not LLM)
   - Focused package tests or existing report packers
   - Pixel/schema gates where available
3. **Report**
   - Write handoff / artifact-map under `.openclinxr/slices/<id>/handoffs/<role>.json` or assigned write root
   - BLUF + file:line evidence paths; no PROJECT_STATUS append (parent integrates)

## Headless invocation

```bash
OPENCLINXR_WORKER=1 grok -p "Follow .grok/skills/regen-score-report: regen X → score → write handoff only" \
  --model deepseek-v4-pro --yolo --cwd <worktree> --max-turns 30 \
  --output-format json
```

## Anti-patterns

- Running `docs:hygiene` / registry rewrites in the loop
- Sharing one Model Vetting output dir across parallel jobs without unique subdirs
- Calling frontier model for pure regen when deepseek-pro + scripts suffice
