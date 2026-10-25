Source: operator (Patrick) drafts, 2026-10-19; installed by card hx-rules.
scope: every new OpenClinXR card, in every lane

# Prior art and compute first

**Step 0 of every new card is a brief of about 300 words.** It runs as a cheap worker task (DeepSeek Flash Free, then Go Muse; never a frontier model), writes no code, and lives in the card body (cited by the `Prior art -` line of skill `pre-dispatch-alignment`) or in the asset store at `/Volumes/files/openclinxr-assets/store/<card>/prior-art.md`. The brief answers five questions:

1. **What is the standard technique?** Name how industry solves this problem, for example:
   - hair: collision shells and tuck/guide curves in XGen, Ornatrix or Houdini Groom
   - skin: SSS/AO bakes
   - locomotion: foot-placement IK, motion matching
   - XR runtime: WebXR/IWSDK patterns
2. **Which references?** Give 1–3 tool docs, papers or talks, with links.
3. **How do professionals verify it?** Say what a lead artist, animator or XR engineer actually inspects, and in which views or tools.
4. **What does Quest need?** Cover the browser and mobile GPU adaptation: frame budget at 72–90 Hz, draw calls, texture memory, no real-time SSS or strand rendering (so bake, use cards, or use LODs), and WebXR API limits.
5. **Can the search be automated?** If the gates are numeric, the card tunes with an **optimizer on CPU/GPU, not LLM iterations**. Pick one:
   - Grid or Latin-hypercube/Sobol sweeps for 1–4 knobs.
   - Hill climbing or Nelder–Mead/Powell for smooth, cheap objectives.
   - CMA-ES or differential evolution for 5–20 continuous knobs.
   - Bayesian optimization (e.g. Optuna TPE) when trials cost minutes.
   - Property-based testing or fuzzing for code.
   - Differentiable rendering or gradients where the pipeline allows it (torch is present).

   If the brief says "no", it states why in one line, for example "structural change, not numeric" or "no metric exists yet; make one first".

## How the card proceeds
- **Build on the technique, or explain the deviation** in one paragraph. "We tried our own approach first" is not a reason.
- **The LLM's job is to frame and review, not to turn knobs.** It defines:
  - the parameter space: knobs, ranges, types, and which knobs are frozen
  - the objective: weighted gates, with hard gates as constraints
  - the trial budget
  It then reviews the top 3–5 winners. Code, not chat, runs the trials.
- **Gates mirror how a professional judges the result.** At least one gate checks what a pro would check: 3D penetration against the real mesh, an in-headset view, or a turntable. Proxies support it but never stand alone.

## Guardrails
- **Goodhart risk.** An optimizer will find gaps in any proxy. In the hair lane, the image ear gates passed while about 2,000 strands per side still sat inside the 3D ear shell, after 37 grooms. Every objective therefore includes a professional-judgment gate, and nothing is promoted without a human or eye check of the finalists.
- **Budgeted and queued.** Optimizer runs are queued by class (render, bake or test class), with an explicit `--trials N --wall H`. Remember: until a heavy-job queue exists, one heavy job at a time. Cheap stages are searched first; expensive renders run only for the top-k.
- **Log every trial.** Write one row per trial (params, seed, every gate value, cost in seconds, artifact sha256) to `.openclinxr/opt/<card>/trials.csv` or an Optuna SQLite file. Report the table; don't summarize from memory.
- **Reproducible.** Record the seed and code sha for every trial. Before reporting a winner, rerun it and get identical gate values.
- **Free models first** for any LLM step, including the review. Adding an optimizer library is a dependency change: propose it, don't install it unasked.
- **Reviewers reject a card** with no brief, with only proxy gates, or with a numeric tuning loop run as LLM iterations without a "no" answer in Q5. A card already in flight adds the brief at its next re-brief.

## Appendix: Compute-first candidates (survey, 2026-10-19)

# Compute-first candidates (read-only survey, Mon Oct 19 2026, ~9:40 AM ET)

**Libraries on the Mac:**
- mise Python 3.13.14 (`mise exec -- python3`, used by the workers) has **scipy 1.18.0, numpy 2.5.1, torch 2.13.0 and trimesh 5.0.0**. **Optuna, nevergrad, cma, scikit-optimize, hypothesis and scikit-learn are not installed.**
- Blender 5.1's bundled Python 3.13.9 has **numpy 2.4.6 only**.
- Homebrew Python 3.14 has none of these.
- The JS side has no `fast-check` in the repo.

So a v1 needs no installs. It can use `scipy.optimize` (`differential_evolution`, `minimize` with Nelder–Mead or Powell, `dual_annealing`) and `scipy.stats.qmc` (Latin hypercube, Sobol). Blender would run as the evaluator subprocess, with the optimizer outside it. Optuna (TPE/CMA-ES with a SQLite trial log) is the one library worth proposing; installing it is a dependency change that needs Patrick's OK.

| # | Loop now run by the LLM | Gate metrics (numeric) | Knobs | Rough cost per trial | Optimizer fit |
|---|---|---|---|---|---|
| 1 | **Hair groom33–38** (hair-tgt2; 37 grooms so far) | per side: child segments in 3 mm ear shell = 0, earlobe column = 0, ear boxes (profile 0 px, 3q ≤ 842), concha 0/0/0, insideBody 0; segments > 30 mm ≤ 1789; IoU front ≥ 0.79 / 3q ≥ 0.83 / profile ≥ 0.84; back crossings ≤ 935; gradAniso ≤ 0.70; determinism | blend kernel and cutoff, routed-guide fraction (0.85), gap gate, far-snap radius, ear-shell margin, root-class thresholds, length jitter, guide tuck offsets behind the ear (structural flags stay LLM-chosen) | groom37 measured: Blender build **about 7 min**, 3D gates **about 10 s**, IoU about 1 s, render pack **about 25 min**. Search on build plus 3D gates (about 7.5 min) and render only the top 3 | **Bayesian (Optuna TPE) or scipy `differential_evolution`**, small population, 20–30 trials (about 3–4 h) in the `bake` queue class. Shell and column = 0 are hard constraints and IoU/crossings are weighted. Eye check of `ears.png` before promotion |
| 2 | **Skin detlips** (lip mask/halo fix, de-detlips-fix) | G1 rim: R1 L* rms ≤ 6.0 and mean ≥ −2.9; G2 grain: forehead/cheek added-RMS delta ≤ 0.08 and forehead ≥ 3.42; G3 under-lip band dL in [−1, +1]; halo-untouched / lm_lipcheck 0.000 | `detail_bands.py:131-154` mask rule: ring width (12–24 tex), peak percentile (95), edge factor (0.5 × (peak − skin)), close/fill radii | 2D numpy image ops on fixed inputs: **seconds** (estimate). Chain re-derive and room-rig renders only for finalists | **Grid or Latin-hypercube sweep** (4–5 knobs, a few hundred trials in minutes), then Nelder–Mead polish. Also suits **property-based tests** on the synthetic defect fixture |
| 3 | **Skin browskin** (hb1–hb5, 7 briefs) | G1 aisha D < PRE 3.49; G2 body2 dL < −45.9 and dC < −5.6; G6 per-hair max ≤ 2; G7 ≥ −2; G8 and G9 energy in 0.7–1.3; G9 coherence Δ ≤ +0.05; G10 banded ≤ 2; halo 0; lipcheck 0/1.0; FFT no new bins | per-case (dL, dC) shift, coverage gate window (0.15–0.45 → 0.03 + dilation), feather width, grain sigma / splat size (4 px) / gain (1.53), high-pass radius (16), seed | texture-stage numpy on 2–3 subjects: **seconds to about 1 min** (estimate). Room-rig renders (G5) for finalists only | **CMA-ES** (6–10 continuous knobs, via Optuna or a scipy DE fallback), with the multi-gate objective as constraints plus a weighted distance to the gate midpoints. A lane-manager eye grade of the crops before merge |
| 4 | **Loco gait** (split-stance, heel-strike, head-lead, arms) | heel plant Y band 0.02 m plus speed gate (`heel-audit.ts`); head lead 0.1–0.4 s; ankle clearance; arrived toe travel; foot-base divergence; route length 1.31 ± 0.005 m; arms capsule margin +0.01 m | `HEEL_STRIKE_PITCH_CAP_DEG` 23, `FOOT_BASE_DEFAULT_SCALE` 0.707, `LEAD_S` 0.25, split-stance width / stance phase, arm-settle damping | headless clip evaluation via the slide-phase meters (Node/Playwright): **about 10 s–1 min** per clip (estimate; measure first) | **Optuna TPE or a 3–4-knob grid**; the multi-clip objective with the hard bands as constraints. Plus **fuzzing**: randomized routes, speeds and turn angles against the same meters to find clips that break the gates |

**Suggested first pilot: #2, detlips.** It's the cheapest trial, deterministic, and its thresholds are already written as midpoints between known-good and known-bad. A sweep there would show the pattern in under an hour of CPU time. #1, hair, has the biggest payoff, but it needs the 3D ear-shell gate as the hard constraint and an eye check, because image gates alone were what passed bad grooms.
