# Ceiling perimeter trim A/B

This packet presents four learner-runtime arms without selecting a winner. V1 removes the cornice; V2 is the checked-in 24 mm T-bar off-white wall angle; V3 uses a 15 mm leg in the same T-bar material; V4 uses a 24 mm leg with the room wall material. The operator decides from the full sheets and 4× native-pixel junction crops.

## Measurements

Values are junction-band mean minus adjacent-wall mean in Rec.709 luminance points. More negative is darker than the adjacent wall. `measurements.json` contains the band, wall, and crop boxes and all source-image paths. The V2 reference delta is the same-camera checked-in V2 arm; ward sheets additionally carry the prior v2 visual-reference image as a fifth panel.

| Room / pose | V1 none | V2 current / reference delta | V3 15 mm T-bar | V4 24 mm wall-coloured | V1 pixels < wall−40 |
|---|---:|---:|---:|---:|---:|
| Ward 01 | -38.96 | -5.57 | -13.27 | -5.08 | 590 / 1,400 |
| Ward 02 | -43.76 | -1.49 | -13.91 | -0.90 | 868 / 1,800 |
| Ward 03 | -40.35 | +0.41 | -13.24 | +1.13 | 150 / 300 |
| Ward 05 | -38.40 | -6.62 | -18.53 | -6.17 | 184 / 420 |
| Step-down 01 | -35.79 | -15.96 | -21.93 | -15.65 | 780 / 2,750 |
| Step-down 02 | -27.79 | -13.05 | -17.48 | -12.81 | 558 / 3,000 |
| Step-down 04 | -50.46 | +14.94 | -3.24 | +15.73 | 41 / 44 |
| Step-down 05 | -34.36 | -9.84 | -18.24 | -9.73 | 406 / 1,120 |

The V1 count is taken inside the named junction-band box, using that pose/variant's adjacent-wall mean minus 40 as the threshold. It is a seam/gap indicator, not a pass/fail rule.

## Native-pixel boxes and sheets

| Room / pose | Junction band | Adjacent wall | Magnified source crop |
|---|---|---|---|
| Ward 01 | `[360,183,560,190]` | `[360,198,560,218]` | `[320,145,600,235]` |
| Ward 02 | `[300,143,500,152]` | `[300,165,500,185]` | `[260,115,540,205]` |
| Ward 03 | `[50,492,100,498]` | `[50,510,100,530]` | `[20,455,160,550]` |
| Ward 05 | `[900,633,960,640]` | `[900,650,960,670]` | `[850,580,1030,680]` |
| Step-down 01 | `[200,149,450,160]` | `[200,172,450,192]` | `[160,115,490,215]` |
| Step-down 02 | `[350,198,650,208]` | `[350,218,650,238]` | `[310,165,690,260]` |
| Step-down 04 | `[820,96,831,100]` | `[820,110,831,120]` | `[730,40,1000,140]` |
| Step-down 05 | `[900,557,1040,565]` | `[900,580,1040,600]` | `[850,520,1100,620]` |

Full sheets are under `ward/sheets/` and `stepdown/sheets/`. The corresponding 4× nearest-neighbour crops are under `ward/crops/` and `stepdown/crops/`; one native source pixel is a visible 4×4 block. Ward uses hand-placed poses 01/02/03/05. Step-down uses the frozen derived-pose file for 01/02/04/05. Every arm is a 1280×720 learner-runtime capture with the same room-specific camera.

## Build and no-op proof

V1/V3/V4 were built through `runRoomChain` only under `.openclinxr/evidence/cornice-ab/<environment>/<variant>` and were not promoted. Their SHA-256 values are:

| Room | V1 | V3 | V4 |
|---|---|---|---|
| Ward | `011060ac7df47cfada4a5daea78da241c7b6be4aece6aeccb116d9728de8fd11` | `44cd0f019a57be2893ff15ee35b46921e3592535f4c3e028ce927e1fd4eb7ede` | `5b5908c3856835c178ff7123c70c6ef756e8f7aaf55ce01d47fa7a737646081e` |
| Step-down | `db43739615ac2a98b180aab6ef1156084f8211277e8bb4a646fcc3c61fc92625` | `048493427084311d2c288916e0f213c7ccd6c703927d7708ed0d726fb3bdcb61` | `e004e3a4370c44e24361ff714b16b95ec516ee162eb1c28267511c5f188d7a22` |

Default promote was run for both rooms. Step-down reproduced its checked-in GLB exactly; ward's rebuilt GLB differed only in one normal-map channel by 1/255 and its PNG/container encoding, so promotion's content-equivalence guard retained the checked-in bytes. Both commands reported `changed: []`. Final shipped GLB hashes remain `0048430f5361df1398edcacb65e8bd829cfb72f1ecf7b6ff0fef86ee6e504b18` (ward) and `3c6e25ca9cd166dc916a11ad5be2f3f3f936d861bf7db64b77929955c7bfaeca` (step-down).

These captures are not evidence for Quest-headset readiness or clinical validity.
