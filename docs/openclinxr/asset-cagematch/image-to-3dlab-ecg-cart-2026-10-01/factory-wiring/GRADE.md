# Factory-wired ECG cart: coordinator grade

2026-10-02, MY GRADE, native 1280 px EEVEE stills (`renders-station/` vs `renders-round5b/`, same camera and lights).

Source: `equipment_generate` with `exportTreatment: "r5-best"`, subject `ecg-cart`, seed 42, oracle conditioning image. 37,828 tris, 1,794,068 bytes, 512 PBR maps, sha `01e11ed0…`.

| check | station output | round 5b (adopted) |
|---|---|---|
| screen, bezel, seven-button row | present; bezel edge cleaner | present; dark speckles along bezel |
| six connector rings | present; ring 2 (blue) is a broken C overlapped by ring 3 | six separate rings |
| ring 3 colour | tan | yellow (matches oracle) |
| column, base, four casters | present | present |

Adopted as the runtime cart in place of the 22,988-byte Blender-primitive placeholder. The connector-row defects are generation-side (the fresh station decode, 35 -> 7 kept islands, differs from the round-5b checkpoint, 18 -> 1); they are the target of the next cart round, not of the treatment.
