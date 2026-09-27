# Ward finish grading checklist (Imagine multiview reference set)

Source views: `01-toward-door.jpg` … `06-floor-base.jpg` in this directory
(manifest: `manifest.json`). Apply per capture: pass / fail / note.
Recorded grades: `../ward-multiview/grades.json` with `pair-*.jpg`
comparisons in the same directory.

## Criteria

1. **enclosure** — Room reads fully enclosed. No flat uniform dark-navy
   (`#101820` background-colour) voids where wall should be.
2. **wall-colour** — Walls read off-white / cream, even across the frame.
   No dark patches, gray holes, or strong stains. (Minor corner AO
   shading noise is a note, not a fail.)
3. **troffer-flush** — The 2x4 troffer lens and frame sit coplanar with the
   surrounding tiles: seated in the grid, not floating below it or proud
   of the ceiling plane. (Assess on ceiling views 03/05.)
4. **tbar-grid** — T-bar spacing reads as plausible 0.6 m tile modules with
   thin exposed bars running both directions. (Assess on 03/05.)
5. **cove-base** — A gray vinyl cove strip (~0.1 m tall) runs along the
   wall-floor junction, visibly distinct from both the wall white and the
   floor tone. (Assess on 01/02/06; 06 close-up is decisive.)
6. **door-trim** — Door has a light-coloured casing/trim frame plus a maple
   leaf with a narrow vertical vision lite. (Assess on 01/04.)
7. **floor-vinyl** — Floor reads as pale speckled sheet vinyl with a slight
   sheen: near-white warm gray, fine speckle, faint sheet seams. Fail on
   coarse gravel read, wood grain/plank seams, or bare-concrete look.
   (Assess on 01/02/06; 06 close-up is decisive.)
8. **ceiling-tiles** — Ceiling reads as an acoustic-tile field (visible tile
   texture and grid), not bare concrete or open structure. (Assess on 03.)

## Viewpoints (runtime captures in `../ward-multiview/`)

| # | reference | runtime | framing |
|---|---|---|---|
| 01 | 01-toward-door.jpg | runtime-01-toward-door.jpg | eye-level toward the door (== WC v3 pose) |
| 02 | 02-toward-bed-wall.jpg | runtime-02-toward-bed-wall.jpg | eye-level away from door, bare bed wall fills frame |
| 03 | 03-ceiling-corner.jpg | runtime-03-ceiling-corner.jpg | floor corner looking steeply up at grid + troffer |
| 04 | 04-door-inside.jpg | runtime-04-door-inside.jpg | close to door: casing, trim, vision lite read clearly |
| 05 | 05-troffer-junction.jpg | runtime-05-troffer-junction.jpg | tight on troffer edge meeting tiles/T-bar |
| 06 | 06-floor-base.jpg | runtime-06-floor-base.jpg | low on vinyl meeting cove base at wall junction |
