# Room-Realism Dual-90 Ideation Plan (Muse Spark, 2026-09-25)

## 1. Where Grok left off (read from logs)
- Session `01a0c701-2de0-7c91-b7b0-4b81a622ad55`: 3369 assistant messages, 4539 tool calls, 18 compactions, models `grok-4.7` + `muse-spark-1` (signals.json).
- Goal: empty Infinigen clinic room vs Grok Imagine reference `images/1.jpg`; Muse judge scores CEILING/FLOOR/WALL/DOOR/LIGHT 0-20, TOTAL=sum; bar is TWO independent Muse totals >= 90 on ONE still.
- Surviving artifacts (verified live): `render_clinic_ga.py` + `room-clinic-ga.png`, `render_clinic_wc.py` + `room-clinic-wc.png` (WC = GA + pale emissive full-length lite card), 642 render scripts, session images 1-15.
- Ledger/proofs: attempts.json ABSENT (prior scratch wiped), score.json / room-final.png / muse-score.log ABSENT. Remembered highs (WC 88, GA 86, LI 82) are HEARSAY until re-scored.
- Grok is out of credits; Muse subagents also 402 on retry. One Muse subagent round completed (R4 judge-integrity). Remaining rounds run inline below as Muse Spark contributor.

## 2. Operator options considered
- operator-steering-needed-questions.md: Grok image credits exhausted (equipment lane parked); Quest worn-headset re-run deferred; no new blockers for room loop.
- operator-open-questions.md: MPFB2 GPL-3 posture, CMU vs MB-Lab locomotion licence, arena-physics R7 deferral — none block the room loop; defaults hold.
- Operator prompts in this thread: (a) use Imagine for different angles of same room as aid — DONE (images/11 floor, 12 ceiling, 13 door studies); (b) per-surface factory sub-stations reusable across rooms — adopted as Round 3/workstream C; (c) Grok 4.7 review + 4-6 ideation rounds + markdown plan — this file; (d) skip Grok, Muse Spark only, pick up where Grok left off — obeyed (no Grok calls).

## 3. Ideation rounds (5)
### Round 1 — Ledger rebuild (protocol)
- Schema per entry: treatment, still path, muse_session_id (!= implementer `01a0c701-2de0-7c91-b7b0-4b81a622ad55`), five ints 0-20, total==sum, note (tool_calls=2, pixel delta n>=8, bbox, exterior check).
- Order: GA fresh first, then WC fresh, then one challenger at a time. Hearsay scores never copied in.
- Why: every "best" claim since the wipe repeated the reconciliation failure; file-backed ledger first.

### Round 2 — Treatment search from WC
- Hold lite card fixed. Floor/wall (17s) are the gap; ceiling 18 + door 18 already there.
- Priority: (1) down-light Z 2.60->2.30 (moves ~100ks px, no card/floor-mix/wash change); (2) camera Y 11.45->11.30 (framing-only fallback); (3) wash X micro-move ONLY if no light-plane band (band = reject unscored, cf. WL).
- Closed: down size/energy/X/Z scored variants, wash energy/size/Z, cove color, exposure/gamma/world-strength, floor mix/roughness/specular, troffer Color2/emission, ceiling scale/Bright/Contrast, lens/camera-X stacks, second light, yaw, geometry, GI.
- Stacks of good singles fail (WC+WD=75); single-parameter steps only.

### Round 3 — Factory sub-stations per surface
- Reusable: photo-texture material fn, procedural vinyl network fn, flat paint fn, rectangle-card placer fn (inputs: mesh/plane + opening rect + finish ref + bbox; output: meshes for bake).
- Room-specific (never stationised): door/window coordinates, camera, light plan per bbox.
- Placement: between room_generate bake/simplify and lighting_design rig; lite card + vinyl become deterministic inputs.
- First slice: card-placer station + vinyl-network params from WC, proven by re-baking one new room.

### Round 4 — Judge integrity (Muse subagent, completed)
- Pre-score pixel gate (>=1000px delta>=8, interior bbox, no blue/green exterior, troffer louver visible, lever in frame); fail = no Muse call.
- Reply validation: six lines, total==sum, tool_calls==2 with both read_file, session != implementer.
- Rescore: <90 final never rescored; >=90 triggers immediate independent rescore before proof files.
- Proof gate: score.json + room-final.png byte copy + muse-score.log both transcripts, only on dual >=90.

### Round 5 — Synthesis / stop rule
- Loop GA->WC fresh scores, then one treatment at a time from Round 2 order.
- Stop only on dual independent >=90 on one still; write proofs then. No website/learner-GLB/progress-page changes; never git add -A; pulse.jsonl stays unstaged.

## 4. Detailed course of action
1. Re-score GA fresh (Muse judge, both images), append to fresh attempts.json in live scratch.
2. Re-score WC fresh, append. These two rows re-anchor the ledger.
3. Render WN-equivalent: WC + down-light Z 2.30; pixel-gate vs WC; inspect PNG; score iff gate passes.
4. If <90: camera-Y fallback; then wash-X micro-move with band check. One variable per still.
5. On any single >=90: immediate second independent Muse pass on same PNG; proofs only on dual >=90.
6. In parallel (non-blocking): land card-placer + vinyl params as factory-station slice per Round 3.
7. Report back with ledger rows + PNG paths; no completion claim before dual-90 verification.

## 5. Risks / non-goals
- Scorer noise (+-4 total) means true ~92 needed; do not chase single 89s.
- No new furniture/people/equipment, no Quest/clinical claims, no learner GLB touch, no proof files before dual-90.
