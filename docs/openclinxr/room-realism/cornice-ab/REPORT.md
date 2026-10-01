# Ceiling perimeter trim V4-flush promotion

The selected default for the ward and step-down rooms is V4-flush: a wall-coloured 24 mm horizontal perimeter leg whose underside is coplanar with the acoustic-tile faces. The tile field is inset 24 mm rather than overlapped, the wall-side angle edge extends only 3 mm below the tile plane, and a wall-coplanar 0.5 mm paint band masks the shell's baked contact-shadow seam without creating a lip.

Measured from GLB accessor bounds (Blender Z exports as glTF Y), both the shipped `6f9fdda4a` wall angle and rebuilt V4 have 24.000 mm horizontal and vertical legs. Their horizontal underside is 3.000 mm below the tile face and the vertical leg reaches 24.000 mm below it. V4-flush measures 24.000 mm wide, 0.000 mm underside offset, and 3.000 mm vertical edge below the tile face.

## Measurements

Values are junction-band mean minus adjacent-wall mean in Rec.709 luminance points. More negative is darker than the adjacent wall. `measurements.json` contains the band, wall, and crop boxes and all source-image paths. The V2 reference delta is the same-camera checked-in V2 arm; ward sheets additionally carry the prior v2 visual-reference image as a fourth panel.

| Room / pose | V2 delta | V4 delta | V4-flush delta | Flush − V2 | Gap pixels | Repeat mean diff |
|---|---:|---:|---:|---:|---:|---:|
| Ward 01 | -5.57 | -5.08 | +3.42 | +8.99 | 0 | 0.0000 |
| Ward 02 | -1.49 | -0.90 | +5.94 | +7.43 | 0 | 0.0000 |
| Ward 03 | +0.41 | +1.13 | +13.66 | +13.25 | 0 | 0.0000 |
| Ward 05 | -6.62 | -6.17 | -1.73 | +4.89 | 0 | 0.0000 |
| Step-down 01 | -15.96 | -15.65 | -12.40 | +3.56 | 0 | 0.0000 |
| Step-down 02 | -13.05 | -12.81 | -10.95 | +2.10 | 0 | 0.0000 |
| Step-down 04 | +14.94 | +15.73 | +29.69 | +14.75 | 0 | 0.0000 |
| Step-down 05 | -9.84 | -9.73 | -4.58 | +5.26 | 0 | 0.0000 |

Gap pixels are pixels below adjacent-wall luminance minus 40 that belong to a horizontal run of at least five native pixels; isolated texture/shadow specks are retained as raw counts in `measurements.json` but are not gaps. V1's earlier raw metric found 41–868 dark pixels. V4-flush has zero seam-run pixels in every pose. Its two captures are byte-identical per pose, giving 0.0000 mean channel difference (<0.5). Adjacent-wall luminance is identical to V2 in every pose, and the 49.2983/49.3399 MiB ward/step-down decoded budgets remain below 56 MiB.

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

## Build and promotion proof

V4 and V4-flush were built through `runRoomChain`. Default promotion re-derived both rooms and their six pose pins. The installed results are:

| Room | V4 angle | Promoted V4-flush |
|---|---|---|
| Ward | `b91a7d6d8f4406cb52f2d1f69770dfc5e5cf275e6a247cfdbe890e70957f5b21` | `a25fc5680a64d7c73c6732eda76e968dd82d3594404c6b64ac2258f0847bffac` |
| Step-down | `e004e3a4370c44e24361ff714b16b95ec516ee162eb1c28267511c5f188d7a22` | `40dfbb57c8bdcd5521d76571325c4fe955420e13d11567e5e5c3d11f99e79c8b` |

These captures are not evidence for Quest-headset readiness or clinical validity.
