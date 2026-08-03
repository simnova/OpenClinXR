---
name: per-job-temp
description: Unique per-pid/per-mesh temp paths for parallel asset/Blender/Python jobs. Use when writing under /tmp, sharing caches, multi-mesh skin/albedo, or any parallel file-producing pipeline to prevent output corruption.
when-to-use: /tmp race, parallel Blender, shared temp, albedo png, mktemp, OPENCLINXR_JOB_TMP, mesh batch
---

# Per-job temp-file convention

## Incident class

Parallel Blender/Python jobs writing the same fixed path (e.g. `/tmp/openclinxr_skin_albedo_mixed.png`) **corrupt outputs**. Fix is unique paths per job and per mesh.

## Convention

```bash
export OPENCLINXR_JOB_TMP="${OPENCLINXR_JOB_TMP:-${TMPDIR:-/tmp}/openclinxr-job-${USER:-u}-$$-${OPENCLINXR_JOB_ID:-$(date +%s%N)}}"
mkdir -p "$OPENCLINXR_JOB_TMP"

# Prefer:
#   $OPENCLINXR_JOB_TMP/<meshId>_<stage>_$$.png
#   mktemp "$OPENCLINXR_JOB_TMP/${MESH_ID}_albedo.XXXXXX.png"

mesh_tmp() {
  local mesh="${1:?mesh id}" stage="${2:?stage}" ext="${3:-png}"
  mktemp "${OPENCLINXR_JOB_TMP}/${mesh}_${stage}_$$.XXXXXX.${ext}"
}
```

## Code / scripts

- Accept `OPENCLINXR_JOB_TMP` or `--job-tmp` / `--tmp-dir` overrides.
- Default temp root = job dir, not bare `/tmp`.
- Include mesh id + pid + random suffix in every intermediate artifact name.
- Clean up only **own** job tmp on exit (`trap` on `$OPENCLINXR_JOB_TMP` when you created it).

## Forbidden

- Hardcoded `/tmp/openclinxr_*.png` / `.exr` / `.blend` shared across workers
- Two meshes writing the same intermediate basename
- Relying on process scheduling order for exclusive `/tmp` use
