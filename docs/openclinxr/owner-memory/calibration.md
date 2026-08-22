# Calibration (grade strikes, instrument reliability)

| date | artifact class | event | count |
|---|---|---|---|
| 2026-08-22 | owner direct writes | board-conduit claimed written but absent on tree (write failed or unissued; cause UNKNOWN). Standing rule: every owner write gets read-back verification before claiming. Strike 2 of 3 — third strike ends owner direct-write authority (bytes handed to delegator instead) | 2 |

Note: strike 1 = "~/.claude/skills/" misdirection (claimed live set at wrong path;
repo `.claude/skills/` is what loads).

## 2026-08-22 — memory store location defect (self-inflicted, structural)
All five owner-memory files written under `.openclinxr/owner-memory/`, which
`.gitignore:9` excludes — the durability guarantee was void on arrival; files are
machine-local only. Caught by delegator's BLOCKED. Correction pending: relocate to
a tracked path. Lesson generalized: check ignore rules BEFORE choosing any
durability-critical path; `.openclinxr/**` is gitignored by design.
Count: separate from write-authority strikes (this was a correct write to a wrong
location), but logged here because it is the same failure surface — unverified
durability claims.

# Grade record — #557 seated clip capture (2026-08-22)

Artifacts graded at native resolution: front + three_quarter PNGs (1280x1280),
read directly. Webm NOT graded — no video frame extraction performed this turn.

MY GRADE (front, lit): figure upright, anatomically plausible proportions,
bipedal stance on grid floor. Garment: grey t-shirt + grey trousers covering
torso and legs; skin tone visible on arms/face/hands. Face has hair mesh, eyes,
mouth. NO SEATED POSE VISIBLE in the front still — figure is STANDING, arms
slightly raised at sides (~30° abduction), palms forward-ish.

MY GRADE (three_quarter, lit): same verdict — standing pose, slight arm raise.
No sitting, no chair interaction visible in either still.

MEASURE (delegator's numbers): 71/137 bones driven over 90 keyframes with
nonzero rotational deltas — so the CLIP contains seated-talking motion data.
The STILL FRAMES show a standing T-pose-adjacent posture instead.

CONTRADICTION between planes: driven-joint probe says the animation track moves
clavicles/fingers; the rendered stills show a static bind/T-pose-like stance.
Hypothesis space (UNVERIFIED): (a) turntable-capture renders frame 0 / bind pose
rather than sampling the clip mid-playback; (b) the clip plays but the sampled
frames land before the seated transition; (c) the GLB exports the clip but the
studio does not auto-play animations in isolated-model captures. NOT TESTED:
webm content — if body_motion_probe.webm shows motion, hypothesis (c) or (a) is
disproven and the stills are simply early-frame samples.

VERDICT: #557 is NOT closed. The clip-binding work is measured-good (probe) but
the visual plane does not yet show a seated conversing figure. Per A2 protocol:
this is a CONTRADICTED pair (probe vs pixels), resolution requires either webm
frame extraction showing the seated transition, or re-capture sampling a mid-clip
timestamp. The slice stays open until one of those lands.

## 2026-08-22 — #557 webm frame grade (t=2s/5s/8s) — hypothesis (c) CONFIRMED

MY GRADE (all three frames, native res): figure STANDING in the identical
T-pose-adjacent stance across 2s, 5s, 8s — arms abducted ~30°, legs slightly
apart, no hip/knee flexion, no seating motion at any sampled timestamp. Frames
carry green joint-marker overlay (motion-probe debug visualization: spheres at
joints + limb trails). Zero pose delta between t2/t5/t8.

DISCRIMINATOR RESOLVED: hypothesis (c) holds — the capture harness renders the
model WITHOUT playing the clip. The nonzero luminance deltas the delegator
measured are the camera orbit + the static debug overlay, not skeletal motion.
The probe numbers (71/137 bones driven over 90 kf) remain valid for the CLIP
DATA inside the GLB; nothing on the visual plane has shown it play.

CONSEQUENCE: #557's done-gate cannot be satisfied by any re-capture with the
current harness. Required next: owner-authored card for an animation-playback
path in model-vetting-turntable-capture (sample mid-clip frames or drive
mixer.setTime), then re-capture stills. Slice stays open; binding work is done,
visual proof of the seated pose is the remaining gate.

Note: this also means EVERY prior "body_motion_probe" capture in this repo that
was graded as showing motion may have been camera-orbit-only — audit candidate,
not assumed. Flagged to owner by owner; check before trusting old motion probes.
