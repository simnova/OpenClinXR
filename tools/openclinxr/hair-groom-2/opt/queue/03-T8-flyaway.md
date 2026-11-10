# 03 T8 flyaway / hem-tip card group from dropped members (stub)

Source: DESIGN-realism.md:191 (T8, "K4, outline realism"; untested); K4 at DESIGN-realism.md:174 (cluster mean drops outliers, side
hem loses front tip columns, flyaways lost). Status: stub.
- hypothesis: a small card group built from the members cards_from_strands.py drops restores hem tips and outline falloff
  (iou side/back, bandRowVec, hairlineFalloff) without moving the part.
- files: cards/cards_from_strands.py, cards/simplify_cards.py; tris budget 63,024 (HARD) bounds the group size.
- new knobs + ranges: group card count and length; ranges UNKNOWN.
- accept rule: fill before queueing; same ship rule as 01, plus tris <= 63,024.
