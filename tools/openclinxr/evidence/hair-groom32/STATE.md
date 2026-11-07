# hair-groom32 STATE (final)

Goal: render + score build-31/strands.npz WITHOUT settle (groom32). DONE.

DONE (all in this round):
- Step 1: sha256 build-31 = build.json (74a3eefb...115c58); calibrate31 EXACT.
- Step 2: renders-32, Blender 5.1.1 1024/64spp/seed7, 752.3s.
- Step 3: score31-32.json (IoU 0.7737/0.7003/0.7275/0.7753; insideBody 0;
  concha 0/0/0); earlobe-gate31.json (3D 1+0; img 4645/5812);
  shirt-gates32.json (insideShirt 79300; hem 7.3%/35.3%);
  metrics-grad31.json opt32 0.6256; metrics-cross32.json 935.
- Step 4: det-32.json pass=true (sha identical, maxAbsDiff 0.0mm; exact
  recipe without --lobe-tuck).
- Curtain-width suspect CONFIRMED with numbers + crops; spike predates
  settle (visible in renders-31/three_quarter.png).
- sheet.png (target|groom30|groom32) + crops.png written.
- RESULT.txt (VERDICT NO-GO, GATES_PASS: NO) written. No .npz in E.

NEXT: commit E dir, then DONE.txt already written -> card complete.

OPEN PROBLEMS: lobePostSweep must be dropped/bounded next card (see RESULT).
