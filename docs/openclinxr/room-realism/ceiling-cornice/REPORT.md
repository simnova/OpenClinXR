# Ceiling cornice replacement

The shipped ward and step-down GLBs previously contained
`bedroom_0/0.skirting_ceiling` using `shell_bake_skirting` (ward) or
`shell_bake_skirting.001` (step-down), both with the matte floor-cove base
colour `[0.313, 0.323, 0.352]`. The two room recipes now declare
`finish.ceiling.cornice: "wall-angle"`; the finish removes that mesh and
emits a 24 × 24 mm L-profile using `openclinxr_finish_tbar`. The grey floor
cove remains unchanged. Step-down's wall-matched transom infill still reaches
the 2.6 m opening head.

`junction-measurements.json` records native 1280 × 720 learner-runtime crop
means. After replacement, band-minus-wall luminance is -5.56/-1.49 in ward
poses 01/02 and -15.96/-13.05 in step-down poses 01/02; all clear the -30
threshold. Ward v2 reference junctions measure -12.44/-5.09. Crop overlays
are under each room's `junction-boxes/` directory.

The ward no-regression rerun in `ward/runtime-measurements.json` passes every
door-finish/floor-cast surface at ±3 RGB. Promoted decoded budgets are
49.2983 MiB (ward) and 49.3399 MiB (step-down), both below 56 MiB. The six
ward frames use the frozen hand-placed poses; the six step-down frames use
the promoted room's derived poses. These captures are not Quest-headset or
clinical-validity evidence.
