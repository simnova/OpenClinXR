# 04 K4 front hairline root keep (structural, from probe 00 verdict S2)

Source: queue/00 verdict S2 (pre-fade 177, faded 173, target 140, strands 142, P3 frame); K4 at DESIGN-realism.md:181
(lane W, "card = cluster mean; outliers dropped"). CEO STEP3 2026-11-10. Status: queued; first probe is CPU only.

## Hypothesis
The front hairline sits 31-35 rows (P3 frame) below the strands because the front-edge cards' root ends sit behind the
front-most member roots. cards_from_strands.py step 3b moves station 0 to the ROOT_PCT = 2 percentile of member roots along
the first tangent (line 81), and the k-means features weight the 30/80/200 mm points like the root, so strands rooted at
the hairline share clusters with strands rooted further back.
Two mechanisms, separable by measurement:
- M-a (along-tangent): card root end is behind the front-most member root of its own cluster (ROOT_PCT, root offsets).
- M-b (across clusters): the front-most strand roots fall into clusters whose card root lies further back (clustering).

## First probe (CPU, numpy, no render)
Inputs (read-only): EV/r10/tw35ta15sm2/cards.npz, card-members.npz (with 'strand'), EV/groom-r9/s1/strands.npz.
For the strands rooted in the front hairline band (head-local: front-most 10 mm of roots in y, |x| <= 50 mm):
1. per strand: distance (mm, head-local, projected on the front-view vertical) from its root to its card's station-0 point.
2. per front card: station-0 vs the min / p2 / p10 of its member roots along the tangent (M-a).
3. count of front-band strands whose card root is > 3 mm (one hairlineRow scale of 4 px at the P3 frame ~0.8 mm/px is
   ~3 mm) behind their own root (M-b if M-a gaps are small).
Output: probe04/roots.json + one line per mechanism with median and p90 gaps in mm.

## New knobs and ranges (after the probe names the mechanism)
- M-a: `--root-pct` exposing ROOT_PCT, range [0, 2] (0 = front-most member root).
- M-b: `--front-root-region` clustering the front band on roots (mirror of `--root-region`, which only accepts |x| >= X),
  N members per card [8, 40]; tris budget 63,024 (HARD) bounds the extra cards.
Ranges are proposed, not sourced.

## Accept rule (proposed thresholds)
- Front hairlineRow in the P3 frame <= 150 (within 2 x the 4 px scale of strands 142) on the rebuilt pre-fade material.
- Then a ship check under SPEC A4 S1-S4 with the trial-24 tint on top; tris <= 63,024.
- Probe shows median gap < 3 mm for both mechanisms: K4 is not the cause; report the measured gaps and close this card.
