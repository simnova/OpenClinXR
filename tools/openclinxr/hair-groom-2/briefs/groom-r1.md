# BRIEF::hair-groom-2-groom-r1 | FORMAT::DENSE_v1 | ROLE::worker
W::/Users/patrick/.grok/worktrees/src-openclinxr/hair-groom-2   # git worktree, branch wt/hair-groom-2
B::/Applications/Blender.app/Contents/MacOS/Blender              # 5.2.3 LTS, Metal GPU enabled in userprefs
BPY::/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 with PYTHONPATH="$HOME/Library/Application Support/Blender/5.2/scripts/modules" (numpy 2.3.4, Pillow 11.3.0)
ASSETS::/Applications/Blender.app/Contents/Resources/5.2/datafiles/assets/nodes/procedural_hair_node_assets.blend  # 32 node groups
EV::W/.openclinxr/evidence/hair-groom-2/groom-r1   # gitignored

## RULES
R1::all work in W. Never write to /Volumes/files/src/OpenClinXR or /Volumes/files/src/openclinxr (shared main checkout).
R2::Blender headless only: `B --background --factory-startup --python <script> -- <args>`. Load node groups from ASSETS with bpy.data.libraries.load(link=False).
R3::macOS has no `timeout`. Run long renders with a sample count that finishes; record wall time.
R4::commit code (not images) on wt/hair-groom-2 when a round lands; pre-commit hook must run. Never --no-verify, never push. Message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
R5::read before writing: W/tools/openclinxr/hair-groom-2/DESIGN.md (S1-S3, V4, V5, V7), W/tools/openclinxr/hair-groom/cards/provisional_guides.py, W/tools/openclinxr/hair-groom/cards/_blender_dump_body.py, W/packages/**/hair_editor/scalp_mask/scalp_mask.py (commit d7bec5dbc, hairline + part band).

## SCOPE
write = W/tools/openclinxr/hair-groom-2/groom/** (new) ; EV/** ; one commit per landed round
read = W/** ; ASSETS ; the shipped body W/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb

## FORBID
- per-strand or per-point coordinate edits chosen to match the photo (D1, D9). Geometry comes only from recipe parameters fed to the bundled node groups or to a documented procedural field (gravity, part-plane direction, collision/shrinkwrap). The v1 campaign failed this way [ref:W/tools/openclinxr/hair-groom-2/DESIGN.md Problem 4].
- any network download, any paid or unlicensed add-on, any LLM call inside the scripts.
- editing shipped GLBs, the materializer, apps/**, packages/**.
- upscaled images in any sheet or grade.

## DEFECT
D1::shipped and library hair do not match the target: target = near-black straight hair, centre part, no fringe, ends at collarbone falling in front of the shoulders [ref:W/tools/openclinxr/evidence/hair-eval/fixtures/target.png, 512x512]. Library candidates are jaw-length bobs; none has a centre-parted collarbone sheet [meas:W/.openclinxr/handoffs/hair-groom-2.md "Target review"].
GOAL::a procedural strand groom on aisha's head, recipe-driven and seeded, rendered in Cycles with Principled Hair BSDF (model HUANG), that a grader can compare with the target. This is the strand source that hair cards will later be baked from.
WHY::procedural groom satisfies D1/D9 where v1 did not ∵ geometry = f(recipe, seed), no coordinate edits [op:2026-11-07 "can you not procedurally generate new hair"].

## PREM (verify first, report each)
P1::ASSETS loads headless and exposes Generate Hair Curves, Interpolate Hair Curves, Clump Hair Curves, Frizz Hair Curves, Trim Hair Curves, Shrinkwrap Hair Curves, Attach Hair Curves to Surface (probe: list bpy.data.node_groups after load).
P2::the shipped aisha GLB imports with a body mesh carrying TEXCOORD_0 usable as the hair surface UV. Remove or hide its library hair mesh (name contains `makeclothes_library_hair_`) before grooming.
P3::Principled Hair BSDF exposes model HUANG [meas: enum CHIANG|HUANG in 5.2.3].

## METHOD
M1::recipe JSON `W/tools/openclinxr/hair-groom-2/groom/recipes/straight_centre_part_collarbone.json`: seed, guide count, child count, per-region length (crown, temples, nape, front) in mm, part = centre with partWidthMm, clump, curl, frizz, tip trim noise, melanin, melanin redness, roughness, strand root/tip radius. Every number the script uses comes from the recipe or is a named constant with a comment.
M2::scalp roots: reuse scalp_mask.py logic or derive a scalp region from head geometry in head-local coordinates (hairline above brow, behind ears, nape line). Report how many roots and the region rule.
M3::guides: procedural fall. Root direction = away from the part plane + downward; then gravity-like bending; keep strands outside the head with Shrinkwrap Hair Curves or a signed-distance push using a fixed offset. Length per region from the recipe. Hair must fall in front of the shoulders like the target; if the shoulders block it, use the body as a collision surface or a deflection field, not point edits. OQ::the 5.2 experimental hair simulation, optional, only if it runs headless.
M4::children via Interpolate Hair Curves, then Clump, a small Frizz, Trim with noise so the tip line is not a straight hem.
M5::shading: Principled Hair BSDF HUANG, melanin near-black, roughness ~0.25-0.35 start. Do not tune colour to the photo by sampling it; set melanin from the recipe.
M6::render Cycles GPU 1024x1024, neutral grey world, 3-point-ish studio light; cameras front (framed like target: head and shoulders, eyes ~37% from top), three_quarter_left, side. Hide garments only if they occlude hair; record which. Denoise allowed; record samples.
M7::script entry `W/tools/openclinxr/hair-groom-2/groom/groom.py` (Blender) with args --body --recipe --out-dir --views; writes groom stats JSON + PNGs.

## GATE (worker self-check is EVIDENCE, not a verdict; the orchestrator grades)
G1::determinism: two runs, same recipe+seed ⇒ identical sha256 of the evaluated curve positions array; seed+1 ⇒ different [ref:DESIGN V1].
G2::clearance: min signed distance strand point → head/body surface ≥ 0 mm over all points, sign from nearest face normal [ref:DESIGN V4(a)].
G3::renders exist for 3 views at 1024x1024, Cycles, HUANG; stats JSON lists strand count, points, samples, wall time per view.
G4::closed checklist per view, each `present|absent` with the pixel rows/cols you looked at: centre_part_visible, fringe_present, tips_reach_collarbone, hair_in_front_of_shoulders, bare_scalp_patch, strand_crosses_face, straight_hem_tip_line, helmet_outline, hair_inside_head.

## MEASURE
X1::strand count, points per strand, total points, render seconds per view.
X2::sheet `EV/r<n>/sheet.png`: target.png at native 512 beside the front render downscaled to 512 (LANCZOS, downscale only), plus 1:1 front 1024 saved separately.

## OUT
O1::EV/r<n>/{front,three_quarter_left,side}.png, sheet.png, stats.json, recipe used (copy).
O2::code under W/tools/openclinxr/hair-groom-2/groom/, committed.
O3::result envelope (below) as your final message, ≤ 250 words.

## ITERATION
You may run up to 6 rounds r1..r6, changing ONLY recipe values or the procedural method (not point edits). Each round records what changed and why in `EV/rounds.tsv` (round, change, G4 checklist, X1). Stop iterating when G4 reads: centre_part_visible present, fringe_present absent, tips_reach_collarbone present, hair_in_front_of_shoulders present, bare_scalp_patch absent, strand_crosses_face absent, helmet_outline absent, hair_inside_head absent.

## STOP (report and stop on any)
- P1, P2 or P3 false.
- a render view takes > 20 min at the lowest sample count that is not noise-dominated.
- the only way forward needs a write outside SCOPE or a FORBID item.
- 6 rounds done without the G4 stop condition.
- determinism G1 fails and the cause is not found within one round.

## RESULT envelope
RESULT::groom-r1 / P1..P3::true|false / ROUNDS::n / G1..G4::value PASS|MISS / X1::... / BEST::EV/r<n> / COMMIT::<sha>|none / CAUSE::(for any MISS) / STILL::(open defects seen, named by view and region) / BRIEF_MISSING::... / HARM::none|<what>
END_BRIEF
