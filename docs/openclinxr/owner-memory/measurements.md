# Measurements (append-only; dead premises stay visible)

| date | subject | number/fact | verdict | ref |
|---|---|---|---|---|
| 2026-08-22 | #557 seated clip, driven joints (delegator probe) | 71/137 bones nonzero over 90 kf; clavicle.L 0.11825 rad, clavicle.R 0.10836 rad; 28 finger joints to 0.24066 rad | PASS vs gate >=1 clavicle, >=3 finger | TICK + contract-verify 4/4 |
| 2026-08-22 | #557 clip diff on shipped GLB | ADDED openclinxr_retarget_seated_talking_cc0, REMOVED cmu_07_01_walk; main.ts walk refs 1->0 | replacement accepted (see decisions) | worktree issue-557 diff |
| 2026-08-22 | cmu_07_01_walk reference | 26/137 driven, Twist 0, Clavicle 0 | baseline for comparison | same |
| 2026-08-22 | #557 harvest diff confusion | true merge-base diff = 13 files/840+/21-; earlier "1112 deletions" was merge-base artifact, no skill files touched | resolved; brief lesson: state merge-base when reporting diffs | delegator TREE line |
| 2026-08-22 | source map sizing (#557 stage) | settled at 52 entries, NOT padded to brief's 66 ("number is context" held) | anti-target instruction worked | stage report |

## Dead premises (withdrawn claims — do not re-derive)
| claim | withdrawn | because |
|---|---|---|
| "1112 deletions include skill files" | 2026-08-22 | merge-base artifact; real diff 13 files, no skills touched |
