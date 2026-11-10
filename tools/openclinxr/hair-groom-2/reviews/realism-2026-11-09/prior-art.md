# Prior art: production real-time hair cards (survey 2026-11-09)

Research subagent survey, sources cited inline. Not independently re-verified.

## Card workflows
- Unreal Hair Card Generator: groups strands into blockout / mid / top / flyaway card groups; multi-card clumps; few shared atlas islands ("Num Textures"); per-LOD settings; LODs reuse the previous atlas. https://dev.epicgames.com/documentation/en-us/unreal-engine/hair-card-generator-for-grooms-in-unreal-engine
- Generator texture outputs (user reports): Depth R8, Coverage R8, Tangent RGB8, Attributes (root UV, U coordinate, seed/ID). https://forums.unrealengine.com/t/converting-metahuman-grooms-to-cards/616003 . inZOI packs depth / ID / root / opacity into one RGBA ("DIRO"). https://mod-docs.playinzoi.com/docs/modkit-docs/modkit/project/caz/hair/05-texturesetup
- MetaHuman LODs: LOD0-1 strands + cards (30k/15k card verts), LOD2-4 cards (10k/3k/1.5k verts), LOD5-7 helmet. Mobile: cards only, best LOD3 (~3k verts), max texture 2048. https://dev.epicgames.com/documentation/metahuman/platform-support-and-lod-specifications-for-metahumans
- Layering convention: scalp-coloured inner coverage shell, mid and top clump cards, thin flyaways.
- Unity HDRP: cards with overlapping UVs, AO on UV1, strand-direction input, manual back-to-front sort for blended cards. https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/hair-shader.html
- Academic: Strands2Cards (SIGGRAPH Asia 2025) https://kenji-tojo.github.io/publications/strns2cards ; DiffHairCard https://arxiv.org/html/2505.18805v1
- Frostbite moved hero hair to compute strands (~3 ms console); cards called cheap to render, slow to author. https://www.ea.com/frostbite/news/frostbite-hair-rendering-and-simulation

## Shading
- Kajiya-Kay: diffuse + sin(T,H)^p specular from the strand tangent.
- Marschner R (white, shifted to tip), TT (backlit transmission), TRT (pigment-tinted, shifted to root, sparkly). https://cseweb.ucsd.edu/~henrik/papers/hair/
- Scheuermann (ATI 2004), the standard game approximation: two Kajiya-Kay lobes, different colour/exponent, tangent shifted along the normal by a shift texture; noise texture masks the secondary lobe; AO-softened diffuse. https://history.siggraph.org/wp-content/uploads/2022/12/2004-Talks-Scheuermann_Practical-Real-Time-Hair-Rendering-and-Shading.pdf
- UE hair (Karis 2016): energy-aware Marschner + cheap multiple scattering. https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf
- Fine strand streaks come from a per-strand shift / ID / noise texture, not geometry. A single smooth band means the shift map is missing or low-frequency.
- three.js MeshPhysicalMaterial anisotropy = one anisotropic GGX lobe: no tinted second lobe, no opposite shifts, no TT. https://threejs.org/docs/pages/MeshPhysicalMaterial.html
- WebGL references: Galacean two-lobe Kajiya-Kay hair shader https://galacean.antgroup.com/engine/en/docs/graphics/material/builtinShaders/digitalHuman/hair ; threepipe AnisotropyPlugin https://threepipe.org/plugin/AnisotropyPlugin.html . No maintained three.js hair shader found.

## Transparency on Quest
- Alpha-to-coverage needs MSAA; 4x gives 5 levels; Quest reports of grid/banding at 4x. three.js `material.alphaToCoverage` works with an antialiased framebuffer. https://communityforums.atmeta.com/discussions/dev-unreal/alpha-to-coverage---grid-like-artifact/1311998
- Hashed alpha is noisy without TAA; three.js WebXR has no TAA.
- Opaque core (alpha test, depth write) + blended fringe (no depth write), with build-time triangle order (inner first) since three.js sorts objects, not triangles.
- OIT too bandwidth-heavy for Quest's tiled GPU.

## Scalp, root, AO
- Scalp shell/texture tinted to hair hides gaps; root darkening from root-tip gradient; AO baked per card (from depth) or per vertex (layer index, distance from scalp). Deep opacity maps for real-time self-shadow on desktop only.

## Checks and optimization
- Compare cards to source strands under the same light (Frostbite, Strands2Cards); turntable for card edges/sort; motion for A2C shimmer; backlight for TT.
- Ladder: strands -> cards LODs (fewer flyaways first, atlas reused) -> helmet. Quest: ASTC via KTX2/Basis (UASTC for coverage/tangent data). https://developers.meta.com/horizon/blog/top-tips-from-arm-for-vr-asset-optimization/
