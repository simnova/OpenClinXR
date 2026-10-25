# HANDOFF 2026-10-23 — stalled. Another agent owns the part.

Status: STALLED. Keeper is part-open8. part-stream1 is a regression and is not the parent.

Row 96 skin run, channel-sum above 150, column 512: target 15, part-open8 36, part-guide1 48, part-stream1 50, part-sheet1 24. Decision rows 96, 100, 104, 108, 116, 124, 132, 140 absolute gap error: part-open8 43, part-stream1 55, part-sheet1 86. Thirteen-row absolute error: part-open8 89, part-stream1 92. Row 96 right hair edge: target column 535, part-open8 column 539, part-stream1 column 552.

2026-10-23T19:06Z: part-sheet1 STOP. Session 25a52569-cb94-4dc2-bf41-56aab440d4d2, proofsOk true, dispatch exit 0. Parent part-open8. Guides from curves_world_src. In-scope shaft points walked toward own-side |x|=1.5 mm, steps at most 8 mm, endpoint and midpoint sdf at least 1. RESULT GUIDE_PTS 13191, CHILD_SAMPLES 1755825, MM_P50 2.48. Canonical rescore of part-sheet1/studio/front.png (1024 px, skin run threshold 150, column 512): gaps rows 92–172 are 1024, 24, 8, 9, 5, 3, 3, 7, 6, 26, 37, 48, 73. Same scorer on part-open8: 10, 36, 21, 15, 9, 13, 18, 23, 37, 60, 113, 141, 163. Row 92 on part-sheet1 is a 1024 px skin run. Do not parent from part-sheet1. treated.npz is 153066614 bytes on the hillclimb worktree. No part-r45. No part-sheet2.

Groom binaries stay on disk. Each treated.npz is about 146 MB, GitHub rejects a file over 100 MB, and the set is 9.5 GB. Path: `/Users/patrick/.grok/worktrees/src-openclinxr/hair-hillclimb/tools/openclinxr/evidence/hair-muse4h/`.

Parent the next child points from `part-open8/treated.npz`. Guide curves come from `part-guide1/guides.npz` key `curves_world_src` only. `curves_world` in that file is the 2.5 mm snap. Do not parent children from `part-guide1/treated.npz`. Leave `part-r44/treated.npz` untouched. Do not write part-r45.

Already failed, do not repeat: snap wrong-side guide x to ±2.5 mm (part-guide1, row 96 from 36 to 48); walk own-side hooks outward in 8 mm steps (part-stream1, 4487 hook points, row 96 from 36 to 50); walk shaft points inward onto the |x|=1.5 mm floor (part-sheet1, decision-row absolute error 86); root slide; whole-wall z raise; gradient push; even/odd tuft restore (part-open9 stripe); Catmull-Rom (front channel-sum delta max 6).

Grade rows 96-140. Rows 148-172 are the forehead hairline. A part is two streams leaving a planted root line. Do not empty that line, and do not widen the slot to chase the forehead. Native 1:1 crop wins. Cycles front, cameras-scorer-v3, HAIR_BEAUTY_ONLY=1. Images committed beside this note: `tools/openclinxr/evidence/hair-muse4h/handoff-2026-10-23/`.

# Hair Muse Go campaign

Started 2026-10-23T02:48Z. Deadline is fixed at 2026-10-23T06:57:10Z (`/tmp/hair-muse4h/DEADLINE`). Do not reset it.

2026-10-23T04:16Z: part-r13 PASS parent-checked. Span 376→376. Near 307186→33034. Moved 274152, all to |x|=3 mm, sign flips 0, deep 0, oob 0.

2026-10-23T04:22Z: part-r14 PASS parent-checked. Near 33034→2133. Span 376. Moved 30901. Flip 7967. Deep 0. Oob 0. Remainder 1708 roots + 425 samples on 19 strands.

2026-10-23T04:26Z: part-r15 PASS parent-checked. Near 2133→440. Span 376. Moved 1693 roots, all at |x|=3 mm, children unchanged, deep 0, min sdf of those roots +0.07 mm. Skip 15. Part push stops: 80 of 489 geometric centre samples can leave the band without a new span.

2026-10-23T04:31Z: join-r1 PASS parent-checked. Copied 920 ear samples bitwise, every other sample matches part-r15, span 376, OCC 0.3434.

2026-10-23T04:35Z: part-r16 STOP. 1e-5 m band counted 308055 samples and 1740 roots. No samples pushed.

2026-10-23T04:38Z: part-r17 PASS parent-checked. 306746 samples at |x|=12 mm, sign kept, yz unchanged, other samples unchanged, ear copies still match ear-r9, span 376, deep 0, min sdf -1.780 mm, OCC 0.3434. 14 mm deep count is 1. Widen stops.

2026-10-23T04:45Z: ear-r13 RESULT MISS on owned-guide OCC 0.3434→0.3434. Parent rescore on all samples: 0.6476→0.988. Moved 636 samples, 212 strands, exactly 3 each, 0 roots, 0 on guides 1144/2519. All 212 bend edges sdf>=-2. Stored deep 0, min sdf -0.77 mm, span 376. 43 samples move more than 90 mm (max 132).

2026-10-23T04:50Z: part-r18 PASS parent-checked. Near 440→15. Span 376. Moved 474, all at |x|=12 mm on the farther side, yz unchanged, roots unchanged, deep 0, min sdf +0.32 mm. Owned OCC 0.3434. All-sample OCC 0.988.

2026-10-23T04:52Z: part-r19 PASS parent-checked. Near 15→0. Span 376. Moved 15 roots, children unchanged, |x|=12 mm, deep 0, min sdf +1.37 mm. Owned OCC 0.3434. All-sample OCC 0.988.

2026-10-23T04:57Z: part-r20 PASS parent-checked. Moved 143, dy +28 to +38 mm, none toward -y, span 376, near geometry 0, deep crossings 0, moved min sdf +24.1 mm. Owned OCC 0.3434. All-sample OCC 0.988.

2026-10-23T05:05Z: part-r21 PASS parent-checked. 484 samples, z +8 mm, x and y bitwise equal to part-r20, span 376, near 0, NEG 241→24, moved min sdf -0.982, neighbor min -1.989, deep 0, oob 0. Owned OCC 0.3434. All-sample OCC 0.988. A second +8 mm on the 24 puts 2 points under -2 mm.

2026-10-23T05:14Z: part-r22 PASS parent-checked. Moved 4243, mask matches, 214 roots dy +20 mm, 4029 children dy +70 mm, |x|=12 mm, z bitwise, unmoved bitwise, span 376→0, crossings 487→0, near 0, deep 0, oob 0, min sdf +0.715, median sdf +66.6 mm, edge min +1.425. Owned OCC 0.3434. All-sample OCC 0.988.

2026-10-23T05:18Z: part-r23 PASS parent-checked. x,z bitwise to part-r22. Non-children bitwise to part-r22. Children 3901/72/45/11 at dy 40/50/60/70 mm. Span 0. Crossings 0. Near 0. Deep 0. Point min sdf +0.048. Edge min +0.128. Median sdf +40.0 mm.

2026-10-23T05:24Z: part-r24 PASS parent-checked. x,z bitwise to part-r23. Outside the child and root sets bitwise to part-r23. Children 2834/398/480/189/72/45/11 at 10/20/30/40/50/60/70 mm. Roots 192 at 0 mm, 22 at 10 mm. Span 0. Crossings 0. Near 0. Deep 0. Point min sdf +0.011. Median sdf +12.1 mm. Four pinna pixels bare, nearest hair 25 to 49 mm behind.

2026-10-23T05:29Z: part-r25 PASS parent-checked. Kept 2589 at part-r21 y. Restored 245 bitwise to part-r24. Outside the cohort bitwise to part-r24. Span 0. Crossings 0. Near 0. Child-point min sdf +0.011. Median sdf +6.2 mm. Deep 0. A further 10 mm drop on 1195 samples kept 2.

2026-10-23T05:35Z: part-r26 PASS parent-checked. Moved exactly the 12 dogleg slots. Formula error 0. Span 0. Crossings 0. Stored min sdf -0.056. Deep 0. All-sample OCC 1.000. Owned OCC 0.3434.

2026-10-23T05:40Z: part-r27 PASS parent-checked. Kept 580 at y -5 mm. Restored 615 bitwise to part-r26. x,z bitwise. Span 0. Crossings 0. Near 0. Point min sdf +0.011. Median sdf +3.3 mm. Deep 0. A second 5 mm step keeps 31 of 1131.

2026-10-23T05:43Z: part-r28 launched from part-r27. Band 1.5 mm < |x| < 8 mm is 447307 samples. Move to sign(x)*12 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 445595, restored 1712, |x|<8 mm becomes 1712, span 0, crossings 0, kept-point min 0.000, mixed-edge min -0.411, deep 0. A 10 percent shorten of the 43 long forward bends drops cover to 326, so that shorten is not launched.

2026-10-23T05:47Z: part-r28 PASS parent-checked. yz bitwise to part-r27. Differ 445595, all at |x|=12 mm, sign match. |x|<8 mm is 1712. Span 0. Crossings 0.

2026-10-23T05:48Z: part-r29 launched from part-r28. Band 8 mm <= |x| < 10 mm is 138671 samples. Move to sign(x)*12 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 138048, restored 623, |x|<10 mm becomes 2335, span 0, crossings 0, point min +0.004, edge min +0.001, deep 0.

2026-10-23T05:51Z: part-r29 PASS parent-checked. yz bitwise to part-r28. Differ 138048, all at |x|=12 mm, sign match. |x|<10 mm is 2335. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000.

2026-10-23T05:51Z: part-r30 launched from part-r29. Band 10 mm <= |x| < 12 mm is 141246 samples. Move to sign(x)*12 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 140173, restored 1073, |x|<12 mm becomes 3408, span 0, crossings 0, point min 0.000, edge min 0.000, deep 0. The 2335 samples inside 10 mm keep 49 at an 11 mm target.

2026-10-23T05:54Z: part-r30 PASS parent-checked. yz bitwise to part-r29. Differ 140173, all at |x|=12 mm, sign match. |x|<12 mm is 3408. Exact |x|=12 mm count is 1032936. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000.

2026-10-23T05:54Z: part-r31 launched from part-r30. Exact |x|==float32(0.012) moves to sign(x)*13 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 1032065, restored 871, point min 0.000, edge min 0.001, deep 0, span 0, crossings 0. The 3408 samples inside 12 mm keep 43 at 11.5 mm. 14 mm is not the target.

2026-10-23T05:55Z: parent probe on part-r30, same wall straight to 14 mm: kept 1032021, restored 915, point min 0.011, edge min 0.003, deep 0, span 0, crossings 0. Not launched while part-r31 is in flight.

2026-10-23T05:58Z: part-r31 PASS parent-checked. yz bitwise to part-r30. Differ 1032065, all at |x|=13 mm, sign match. Exact |x|=12 mm is 871. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000.

2026-10-23T05:58Z: part-r32 launched from part-r31. Exact |x|==float32(0.013) moves to sign(x)*24 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 1031831, restored 234, point min 0.000, median sdf 8.655, edge min 0.010, deep 0, span 0, crossings 0. Same set at 32 mm keeps 1031743, median sdf 10.713. Same set at 40 mm keeps 1031676, median sdf 13.956. This round stops at 24 mm.

2026-10-23T06:02Z: part-r32 PASS parent-checked. yz bitwise to part-r31. Differ 1031831, all at |x|=24 mm, sign match. Exact |x|=13 mm is 234. Span 0. Crossings 0. Wall median sdf 8.655. Worker OCC 0.3434 / 1.000.

2026-10-23T06:02Z: part-r33 launched from part-r32. Exact |x|==float32(0.024) moves to sign(x)*32 mm. Restore a sample whose point or neighbor edge has sdf < 0. Parent: kept 1031748, restored 83, point min 0.018, median sdf 10.713, edge min 0.002, deep 0, span 0, crossings 0. A 5 mm y decrease keeps 956785 with edge min -3.805. A 5 mm z decrease keeps 934162 with edge min -3.256.

2026-10-23T06:05Z: part-r33 PASS parent-checked. yz bitwise to part-r32. Differ 1031748, all at |x|=32 mm, sign match. Exact |x|=24 mm is 83. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000.

2026-10-23T06:06Z: part-r34 launched from part-r33. Interior |x|<32 mm is 1335077 samples. Move to sign(x)*32 mm. One sdf<0 restore keeps 1326227 with edge min -1.179. Three further edge passes remove 22, then 3, then 1. Final kept 1326201, |x|<32 mm becomes 8876, point min 0.000, median sdf 8.095, edge min 0.000, deep 0, span 0, crossings 0.

2026-10-23T06:08Z: the part-r34 session exited before RESULT.txt. The worker script was already written. Running that script finished PASS: kept 1326201, restored 8876, edge passes 22,3,1,0, edge min 0.000, median sdf 8.095, OCC 0.3434 / 1.000.

2026-10-23T06:11Z: part-r34 PASS parent-checked. yz bitwise to part-r33. Differ 1326201, all at |x|=32 mm, sign match. Outside the interior bitwise. |x|<32 mm is 8876. Span 0. Crossings 0. The 32 mm set median sdf is 9.572.

2026-10-23T06:12Z: part-r35 launched from part-r34. The 8876 samples move to sign(x)*32 mm and z -10 mm. Edge-restore loop. Parent: kept 5317, point min 0.000, median sdf 2.003, edge min 0.002, span 0, crossings 0. A 5 mm y drop on the 32 mm wall keeps 2240690 and the median sdf stays 9.522.

2026-10-23T06:15Z: part-r35 PASS parent-checked. y bitwise to part-r34. Differ 5317, all at |x|=32 mm, z lower by 10.0 mm. Restored 3559 bitwise. Outside bitwise. |x|<32 mm is 3559. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Edge passes 90,0. Median sdf 2.003.

2026-10-23T06:16Z: part-r36 launched from part-r35. Exact |x|==float32(0.032) is 2363266, median sdf 9.558. z -5 mm with the edge-restore loop. Parent: kept 2158174, median sdf 7.875, point min 0.000, edge min 0.000, span 0, crossings 0. The 3559 leftovers keep 357 at z -15 mm.

2026-10-23T06:19Z: part-r36 PASS parent-checked. x and y bitwise to part-r35. Differ 2158175, all on the 32 mm set, dz -5 mm. Restored bitwise. Off-wall bitwise. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Wall median sdf 7.160. Worker kept-subset median 7.875.

2026-10-23T06:19Z: part-r37 launched from part-r36. Same wall, z -5 mm, edge-restore loop. Parent: kept 1773480, full-wall median sdf 5.388, point min 0.000, edge min 0.000. The loop clears on the eighth rescore.

2026-10-23T06:22Z: part-r37 PASS parent-checked. x and y bitwise to part-r36. Differ 1773479, all on the 32 mm set, dz -5 mm. Restored bitwise. Off-wall bitwise. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Wall median sdf 5.388.

2026-10-23T06:22Z: part-r38 launched from part-r37. Same wall, z -5 mm, edge-restore loop. Parent: kept 1506694, full-wall median sdf 4.229, point min 0.000, edge min 0.000. The loop clears on the eighth rescore.

2026-10-23T06:25Z: part-r38 PASS parent-checked. x and y bitwise to part-r37. Differ 1506693, all on the 32 mm set, dz -5 mm. Restored bitwise. Off-wall bitwise. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Wall median sdf 4.229.

2026-10-23T06:25Z: part-r39 launched from part-r38. Same wall, z -5 mm, edge-restore loop. Parent: kept 1342104, full-wall median sdf 3.533, point min 0.000, edge min 0.001. The loop clears on the eighth rescore.

2026-10-23T06:28Z: part-r39 PASS parent-checked. x and y bitwise to part-r38. Differ 1342103, all on the 32 mm set, dz -5 mm. Restored bitwise. Off-wall bitwise. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Wall median sdf 3.533.

2026-10-23T06:28Z: a fifth z -5 mm keeps 1231069, full-wall median 3.196, kept-sample median 22.535, edge min 0.000. Not launched. A y -5 mm move on the 768275 samples with sdf > 15 mm leaves their median at 25.355.

2026-10-23T06:28Z: part-r40 launched from part-r39. Band 32 mm < |x| < 40 mm is 555915. Move to sign(x)*40 mm. Edge-restore loop. Parent: kept 553460, point min 0.000, median sdf 6.774, edge min 0.001. The exact 32 mm wall stays.

2026-10-23T06:32Z: part-r40 PASS parent-checked. yz bitwise to part-r39. Differ 553460, all at |x|=40 mm, sign match. The 32 mm wall is bitwise, count 2363266. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Kept median sdf 6.774.

2026-10-23T06:34Z: part-r41 ROUND_START from part-r40, wall 1272s. Band 40 mm < |x| < 48 mm is 690476. Move to sign(x)*48 mm. Edge-restore loop. Parent: kept 688693, point min 0.000, median sdf 8.708, edge min 0.000, span 0, crossings 0. The exact 40 mm set stays.

2026-10-23T06:36Z: part-r41 PASS parent-checked. yz bitwise to part-r40. Differ 688693, all at |x|=48 mm, sign match. The 32 mm wall is bitwise, count 2363266. The 40 mm set is bitwise, count 553460. Span 0. Crossings 0. Worker OCC 0.3434 / 1.000. Kept median sdf 8.708.

2026-10-23T06:37Z: part-r42 ROUND_START from part-r41, wall 1080s. Band 48 mm < |x| < 56 mm is 784637. Move to sign(x)*56 mm. Edge-restore loop. Parent: kept 780745, point min 0.000, median sdf 10.337, edge min 0.000, span 0, crossings 0. The exact 48 mm set stays.

2026-10-23T06:39Z: part-r42 session exited with VERDICT NONE and no npz. part_r42.py was on disk. Foreground run PASS: kept 780745, restored 3892, point min 0.000, median sdf 10.337, edge min 0.000, span 0, crossings 0, OCC 0.3434 / 1.000.

2026-10-23T06:40Z: part-r42 PASS parent-checked. yz bitwise to part-r41. Differ 780745, all at |x|=56 mm, sign match. The 32 mm wall is bitwise, count 2363266. The 40 mm set is bitwise, count 553460. The 48 mm set is bitwise, count 688693. Span 0. Crossings 0.

2026-10-23T06:41Z: part-r43 ROUND_START from part-r42, wall 858s. Band 56 mm < |x| < 64 mm is 844278. Move to sign(x)*64 mm. Edge-restore loop, cap 10, parent clears on rescore index 8. Parent: kept 839389, point min 0.001, median sdf 10.662, edge min 0.000, span 0, crossings 0. The exact 56 mm set stays.

2026-10-23T06:44Z: part-r43 PASS parent-checked. yz bitwise to part-r42. Differ 839389, all at |x|=64 mm, sign match. The 32 mm wall is bitwise, count 2363266. The 40 mm set is bitwise, count 553460. The 48 mm set is bitwise, count 688693. The 56 mm set is bitwise, count 780745. Span 0. Crossings 0. Worker OCC 0.3434 / 0.9910. Parent cover 329/332. A 64–72 mm move keeps 1476918 and covers 219/332, so that widen stops.

2026-10-23T06:46Z: part-r44 prepared from part-r43. Exactly 3 samples cover the 3 bare pixels. Restoring their x from part-r42 leaves edge failures 0, edge min 1.581, span 0, crossings 0, cover 332/332.

2026-10-23T06:47Z: part-r44 ROUND_START from part-r43, wall 516s. Restore those 3 x values from part-r42. Every other sample stays.

2026-10-23T06:49Z: part-r44 PASS parent-checked. yz bitwise to part-r43. Differ 3, each x bitwise to part-r42. Every other sample bitwise to part-r43. Span 0. Crossings 0. Cover 332/332. Edge min 1.581.

2026-10-23T06:51Z: part-r45 did not start. Remain was under the campaign driver's 600s floor, so the driver returned without a round. Hold probe on part-r44, not written to a file: pinna-cover samples 1460 stay. Movable band 1489829 of 1490218. To 72 mm keeps 1476656, point min 0.009, median sdf 11.602, edge min 0.000, span 0, crossings 0, cover 332/332, clear on rescore index 4. An open move of the same band covers 219/332.

2026-10-23T06:59Z: deadline 06:57:10Z passed. No campaign process. Keeper is part-r44/treated.npz.

2026-10-23T10:40Z: part fix dispatched. The scalp stripe is part-r34's 32 mm wall (crown inner edge 32.00 mm, 64 mm hole, 140 px on the front camera). Restore source is part-r27 (crown inner edge 1.87 mm, inside the target's 2.7–5.5 mm). Worker copies that npz bitwise into part-restore27, Cycles-renders four views, and measures the front gap. No coordinate edit. part-r44 stays on disk.

2026-10-23T10:54Z: part-restore27 rendered. Points bitwise equal to part-r27. Worker front-gap max is 23 px at y=99 over rows 85–134 (luminance under 70). The same window on part-r44 is 152 px. Worker verdict line says MISS because the gate was 2–20 px. The npz was not edited after the copy. Sheet: part-restore27/head-vs-target-vs-r44.png.

2026-10-23T11:10Z: part-fan1 dispatched. 309120 samples sit at exactly |x|=12 mm. 232043 of them were inside 2 mm on groom36. The round fans that rail outward from the previous sample (slope 0.35–0.60 mm per sample, floor 3.5 mm). Parent probe: 155 of those samples have sdf under 0, minimum -0.89 mm. The script restores those. No other samples move.

2026-10-23T11:13Z: part-fan1 PASS. Kept 308220. Rail left 900. Point restores 143. Edge passes 756,1,0. Inward steps on the moved set 411. Near 0. Span 0. Pixels differing by more than 20 from part-restore27: front 445, three-quarter 533, profile 1030, back 2768. Changed crown samples sit at |x| p50 6.2 mm. The crown clump and the lifted tail remain. 7798 crown steps rise more than 4 mm and go back; laying them on the previous sample puts 6187 inside the body, minimum sdf -6.5 mm. That drop was not launched. 62375 crown steps still run toward the part by more than 3 mm.

2026-10-23T15:28Z: one-hour image review started. Deadline 2026-10-23T16:27:53Z. part-slide1 lays the 7798 rising-back steps onto the sdf=1 mm shell along the line to the previous sample. Kept 7731. Travel median 7.31 mm, p90 11.53 mm. 3669 of those steps remain. Render of front, profile, three-quarter is in flight.

2026-10-23T15:40Z: part-slide1 render finished. Pixels differing by more than 20 from part-fan1: front 0 (max 5), three-quarter 0 (max 15), profile 160 (max 60). Native front and profile still show the braided crown and the lifted rear tuft. Crown sdf at z>1.60: n 2931149, p50 3.45 mm, p90 7.24 mm. Front-visible crown tangents: outward p50 -0.699, fraction with outward>0.3 is 0.197, fraction with dz>0.3 is 0.387.

2026-10-23T15:46Z: part-lay1 rendered. Flipped crown steps with toward-part dx or upward dz, tail translated, per-strand scale until sdf>=1. Kept 67618 strands. Reverted 66500. Span created 0. Near created 0. Moved-crown front pixel shift p50 27.09. Pixels differing by more than 20 from part-slide1: front 15403, profile 12264, three-quarter 16053. The centre part is thin. The front crown is still roped. The rear sheet falls with fewer lifted wisps than part-slide1.

2026-10-23T16:02Z: part-lay2 rendered from part-lay1. Remaining toward-part and upward crown steps were shell-slid on the sdf tangent plane, cap 8 mm. Slid 1801763 samples, 88121 strands. Drop body 17048. Span created 0. Near created 0. Front pixel shift p50 17.94. Pixels differing by more than 20 from part-lay1: front 6132 (max 136), profile 3011 (max 129), three-quarter 5641 (max 138). 1:1 front crop is coarse overlapping locks, a thin centre part, scalp through the part. 1:1 profile crop is a dreadlock at the front hairline, then parallel ridges.

2026-10-23T16:06Z: part-fill2 from part-lay2. Buried samples in front rows 108–124, depth 3–12 mm behind the sheet, raised toward row 99, cap 8 mm. Kept 62241. Pixels differing by more than 20 from part-lay2: front 861 (max 92), profile 815 (max 162). Hair pixels in columns 420–600: row 96 went 66 to 4, row 100 went 18 to 67, row 102 went 38 to 116. Target row 100 is 152. Do not continue from part-fill2.

2026-10-23T16:08Z: part-comb1 written from part-lay2 and not rendered. Crown samples above the previous sample were lowered, then pushed along the sdf gradient by up to 6 mm. Moved 1404168 samples, 110305 strands. Profile top row collapsed to about 60.6 across columns 300–560. Front shift p90 248 px. Leave the file unrendered.

2026-10-23T16:10Z: part-spread1 from part-lay2. Crown knot moved +28 mm in y. Kept 327995. Profile column shift 59.1 px. Knot sample count 447221 to 237753. Pixels differing by more than 20 from part-lay2: front 2887 (max 144), profile 1669 (max 144). Native profile shows gaps and overlapping sections. Do not continue. Do not add another +y move.

2026-10-23T16:12Z: part-feather1 from part-lay2. Children of each guide offset by rank times 8 mm in the xy perpendicular of the strand, scale halved while sdf stayed under 1 mm. Kept 61574 strands at scale above 0.2. Scale median of moved strands 0.031. 141992 strands stayed inside at scale 0.031. Front projection p50 8.39 px. Pixels differing by more than 20 from part-lay2: front 8952 (max 145), profile 3873 (max 144). 1:1 crops are still a coarse braid and a front-hairline knot.

2026-10-23T16:13Z: part-flat1 from part-feather1. Crown samples that climb more than 1 mm were dropped by at most 4 mm. Revert when sdf under 1 mm. No gradient push. Moved 487077 samples. Profile row delta p50 +7.52 px, down the frame. Pixels differing by more than 20 from part-feather1: front 1260 (max 120), profile 1572 (max 112). The knot is still on the native frames.

2026-10-23T16:14Z: part-feather2 from part-lay2. The same 8 mm child offset was projected onto the sdf tangent plane and capped at 6 mm. Tangent travel median 3.01 mm. Reverted 440065 samples for sdf under 1 mm. Moved 2339610 samples. Front pixel shift p50 3.95. Front render only, 52.5 s. Pixels differing by more than 20 from part-lay2 front: 3727 (max 128). 1:1 front crop is still a coarse braid, thin part, scalp at the part.

2026-10-23T16:17Z: sheet written at part-lay2/hour-review.png, 3072 by 2128. Columns are the aisha-v3 target, part-lay2, and part-feather1. Rows are front and profile. Tiles are native 1024 with a 40 px label. Profile top-row ripple, absolute residual from a 21-column mean, hair channel-sum under 80, rows 70–320 and cols 280–680: part-lay2 median 9.71 px, target profile median 1.33 px. Hour stops at 16:27:53Z. No part-r45. No campaign relaunch. No commit. A few millimetres of offset on the current guide paths leaves the rope. The scalp-tangent budget measured on part-feather2 is 3.01 mm median.

2026-10-23T16:30Z: operator note — the part still needs an update. NEAREST x6 front crops, same boxes on aisha-v3 target-front-a1 and part-lay2 studio front. Slot rows 96–176 cols 470–560. Lip rows 104–148 cols 488–540. Fall rows 150–250 cols 460–570. Sheet part-lay2/part-zoom-vs-target.png. Centre gap containing column 512, channel-sum above 150: target row 100/120/130/140/150/170 = 12/13/19/35/89/90 px. part-lay2 = 57/10/7/10/9/61 px. Fall-box hair fraction at channel-sum under 120: target 0.001, part-lay2 0.132. The target slot feathers and the gap opens down the forehead. part-lay2 is a wide scalp hole at row 100, then a pinched zigzag gap through row 150.

2026-10-23T16:30Z: bend on the 13982 part-lay2 strands that project into the lip box. Crown joint turn p50/p90/p99 9.38/44.89/123.75 degrees. Joints over 20° are 26.4%. Joints over 45° are 10.0%. Lateral reversals over 0.4 mm are 3.49% of crown joints. First crown step with |dx| over 0.3 mm is outward on 90.2% of those strands, median 3.37 mm. Crown step length p50/p90 3.0/13.96 mm. Radius p50/p90/max 0.037/0.049/0.050 mm.

2026-10-23T16:30Z: render_studio.build_strand_hair writes one hair-curves object, 32 points, position and radius only. No curve type. No hair geometry-node modifier. Principled Hair BSDF model HUANG, parametrization COLOR, color from look7 directColorLinear, TT lobe 0.5. R lobe, TRT lobe, and Roughness stay at the node default unless HAIR_R, HAIR_TRT, or HAIR_ROUGH is set. Huang shades the cylinder. The bend is the polyline. Catmull-Rom or Smooth Hair Curves can round a 45° corner on these points. Interpolate Hair Curves can make a sheet if the guides leave the part and the gap opens down the forehead. Clump Hair Curves increases the ropes on this edge. Frizz past the crown sdf clearance, median about 3 mm, enters the head. A thicker radius than 0.037 mm would cover the pinch with a solid edge.

2026-10-23T20:22Z: part-open8 is the keeper. Parent chain part-lay2, part-open1, part-open5, part-open6, part-open8. Front skin-run through column 512, channel-sum above 150. Absolute error versus aisha-v3 across rows 92, 96, 100, 104, 108, 116, 124, 132, 140, 148, 156, 164, 172: part-open4 152, part-open5 141, part-open6 112, part-open8 89. part-open8 gaps: 10, 36, 21, 15, 9, 13, 18, 23, 37, 60, 113, 141, 163. Targets: 21, 15, 12, 11, 11, 12, 17, 20, 35, 78, 119, 146, 169. Rows 108–140 are within 3 px. Rows 156–172 are within 6 px. 65294 forehead-edge samples moved, median 2.15 mm, 0 climbed. Front pixels differing from part-open6 by more than 20: 890, max 130.

2026-10-23T20:22Z: row 96 stayed 36 px versus target 15. part-open6 slid the visible lip (8116 samples, 12 mm inward, 2 mm toward the camera, 7837 kept) and the rendered left edge moved from column 469 to 500. Columns 456–476 at row 96 went from hair (channel-sum 102–143 on part-open5) to skin (186–268). part-open9 returned 4295 even-guide samples of that tuft to part-open5. Columns 464–468 went back to hair (channel-sum 119–124) and columns 480–492 lightened to 168–188. The gap stayed 35 px. Half the shell does not hold both the edge and the sheet. part-open7 brought 7513 buried samples 6 mm forward and 1.57 mm down. Row 96 went 59 to 50. Those samples still do not render as the edge.

2026-10-23T20:22Z: row 148 stayed 60 px versus target 78. The samples still inside that extra band need about 1.9 mm outward. End-and-mid sdf survival of that step is 0.07 with 2 mm toward the camera, and 0.19 with 4 mm or 6 mm. They stay.

2026-10-23T20:22Z: Catmull-Rom on part-open8, copy of render_studio at /tmp/hair-muse4h/render_studio_catmull.py, product file untouched. CURVE_TYPE printed catmull_rom 269480. Front pixels with channel-sum delta above 20 versus the poly render: 0. Crown crop max delta 1. The bend on screen is the point positions.

2026-10-23T20:22Z: MY GRADE. Native part-open8 front, same camera as the aisha-v3 target, is still coarse locks with a broken crown slot and strands crossing the forehead part. The target slot is a narrow soft gap that opens down the forehead. 1:1 crop /tmp/hair-muse4h/part-zoom/open8-native-1to1.png. No part-r45. No commit.

2026-10-23T17:49Z: Guides from guides-36.npz are in part-guide1/guides.npz, 2741 curves resampled to 32 world points. Shallow crossings, worst |x| at most 8 mm, 262 guides, 2247 points, moved to root-side |x|=2.5 mm when end and mid sdf stayed at least 1. Kept 2243. dy 0 mm kept 2176, dy -2 mm kept 32, dy -4 mm kept 26, dy -6 mm kept 9, left 4. The 66 deep guides stayed at groom36 x. Deep wrong points 1545, |x| mm p50 13.0, p90 57.5, max 90.5. Straight-chord sdf survival on those points is 1304/1545 and the chord was left unused. Children parented from part-open8. Opposite-side guide weights zeroed on 12 strands, 48 weights. 67352 children reference a moved same-side guide. Samples over 0.05 mm: 524696. Kept 503109, left 21587, median 2.52 mm. Front-row climb over 4 px: 0. New span strands: 0. New |x|<1.5 mm strands: 0. Wrong-side child samples stayed 10695 on 345 strands, depth mm p50 17.9. 321 crossing strands have a deep primary guide. Front skin-run abs err versus aisha-v3: open8 89, guide1 96. guide1 gaps: 10, 48, 21, 13, 8, 14, 21, 21, 37, 61, 116, 141, 165. open8 gaps: 10, 36, 21, 15, 9, 13, 18, 23, 37, 60, 113, 141, 163. Targets: 21, 15, 12, 11, 11, 12, 17, 20, 35, 78, 119, 146, 169. px>20 versus open8: 3768, max 157. Crown rows 70-120 cols 430-600: 1084. Forehead rows 140-180 cols 430-600: 446. Profile camera on moved samples: median row delta -0.01 px, 212 samples over 4 px, max 4.71. Profile not rendered. MY GRADE: native front still coarse locks, row 96 slot 48 px versus open8 36 and target 15. 1:1 crop /tmp/hair-muse4h/part-zoom/guide1-vs-target-open8-1to1.png. Keeper remains part-open8. No part-r45. No commit. Render front 36.1 s, exit 0.

OpenCode Go (`opencode-go/muse-spark-1.3-contributor`) returned `api_key_expired`. The free model id is gone. The live contributor model is `openrouter/meta/muse-spark-1.3-contributor`. Worktree `wt/hair-hillclimb`. Directory is the last argument to `opencode run`.

Order: part-r1, part-r2 only if the first misses, crown-r1, crown-r2 only on a miss, ear-r1, ear-r2 only on a miss. A PASS skips that lane's pivot. Wall 35 min per round. Idle 300 s kills the round and pivots.

Write root: `tools/openclinxr/evidence/hair-muse4h/` in the worktree. No commit. No asset-store writes. No edits under `hair-hillclimb/`.

Log: `/tmp/hair-muse4h/campaign.log`.

2026-10-23T18:31Z: part-stream1 ran from part-open8 child points and part-guide1 curves_world_src. Wrong-side guide points in scope walked toward own * max(|x|, 2.5 mm) in 8 mm steps. Own-side hooks with |x|<25 mm, z>1.55, y<0.05, inward versus the previous sample, stepped at most 8 mm outward. End and mid sdf >= 1. Front-row climb versus the original point <= 4 px. New |x|<1.5 mm landings rejected. Roots frozen. Guide points moved 6985. Hook points moved 4487. Polyline midpoints inside the head reverted 10 points. Child samples moved 1434928, median 1.45 mm. Root-sign opposite count on part-open8 and part-stream1 is 0. Front skin-run, channel-sum > 150, column 512. Gaps target / open8 / stream1: r92 21/10/15, r96 15/36/50, r100 12/21/20, r104 11/15/10, r108 11/9/9, r116 12/13/15, r124 17/18/19, r132 20/23/22, r140 35/37/37, r148 78/60/61, r156 119/113/115, r164 146/141/141, r172 169/163/164. Absolute error 13 rows: open8 89, stream1 92. Decision rows 96-140: 43 and 55. Row 96 hair edges target (508, 535), open8 (500, 539), stream1 (500, 552). px>20 versus open8: 13708, max 410. Crown rows 70-120 cols 430-600: 2771. Forehead rows 140-180 cols 430-600: 619. Hair runs at row 96, cols 440-600, thr 140: target 6, open8 6, stream1 6. Row 140 runs: 2, 3, 5. Cycles front 49.1 s, 1024 px, 64 spp, exit 0. MY GRADE: native 1:1 crop rows 80-190 cols 430-600 shows a wider crown slot and the same clumped locks. Keeper remains part-open8. No part-r45. No commit. Crop /tmp/hair-muse4h/part-zoom/stream1-vs-target-open8-1to1.png. Front worktree tools/openclinxr/evidence/hair-muse4h/part-stream1/studio/front.png.
