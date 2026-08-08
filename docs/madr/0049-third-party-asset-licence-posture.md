# 0049 — Third-party asset licence posture, and what attribution costs in a headset

- Status: **proposed**
- Date: 2026-08-07
- Deciders: Patrick (operator) — asked how Meshy's licence requirements fit the experience
- Relates to: MADR 0016 (provenance manifests), 0046 (generative 3D licence survey)
- Issues: #164 (TRELLIS.2 `reject_measured`), #179 (no CC0/CC-BY articulating ward bed exists)

## Context

Local generation is blocked: #164 measured TRELLIS.2 returning `reject_measured` because
`Trellis2MultiViewImageToShape` imports `cumesh_vb` (CUDA CuMesh) inside shape generation, and no
macOS/MPS wheel exists. The operator's direction is to source assets from reputable marketplaces with
permissive licences when generation fails.

That makes third-party licence obligations a runtime design question rather than a paperwork question,
because this product ships into a headset where a learner cannot open a browser tab.

## Decision

**Prefer CC0 or our own generation for anything that ships. Treat CC BY as a deliberate, recorded
exception. Where a provider offers a paid tier that removes the attribution requirement, that is
usually cheaper than building and maintaining the compliance surface.**

## Meshy specifically — verified against the live terms, 2026-08-07

`meshy.ai/terms-of-use`, last updated 2026-03-07.

| tier | what it is | obligation |
|---|---|---|
| **Community / gallery** (§3.3) | content released to the Meshy Community | **CC0 1.0** — no attribution required |
| **Free plan** (§3.2) | assets we generate on the free tier | **CC BY 4.0**, attribution **to Meshy** |
| **Paid plan** (§3.2 + help centre) | generated privately | private ownership; **no attribution requirement** |

### A correction worth stating plainly

An earlier reading of §3.2 in this project described free-plan output as licensed "CC BY 4.0 **to**
Meshy". **The direction is inverted.** Meshy *owns* the AI Customer Output and *grants us* a licence
under CC BY 4.0; we attribute **to Meshy**. The obligation was right and the mechanism was backwards,
which matters because it changes who the licensor is on every credits line we would generate.

Meshy's own help centre suggests the string
`Model created with [Meshy](https://www.meshy.ai/) – [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)`
and states directly: *"If you need models without an attribution requirement, you'll need a paid plan."*

**No mandatory logo or "Made with Meshy" badge appears in the terms.** Using the Meshy wordmark as a
product badge is a separate trademark question — CC BY §2(b)(2) does not license trademarks, and CC
§2(a)(6) forbids implying endorsement.

## What CC BY actually requires, and where a WebXR product is weak

CC BY 4.0 §3(a)(1): retain creator identification, copyright notice, licence notice, warranty
disclaimer and a URI to the original where practicable; **indicate modifications**; state the licence
with its text or URI.

§3(a)(2) is the flexible part, and it nearly describes the obvious design: *"You may satisfy the
conditions in any reasonable manner based on the medium, means, and context… For example, it may be
reasonable to satisfy the conditions by providing a URI or hyperlink to a resource that includes the
required information."*

Three gaps specific to this product:

- **Serving raw GLBs is Sharing.** Assets live under `apps/ui-xr/public/**` and anyone can `GET` them
  without opening any page. The download path needs a complete sidecar beside the asset, not only an
  HTML rollup.
- **A headset learner never leaves the session.** A build-time credits page reachable only by removing
  the headset is the weakest defensible form. Nothing in the licence demands in-scene watermarks —
  nobody credible reads CC BY that way — but "reasonable to the medium" for a headset-first product
  means credits reachable *inside the app*.
- **Our pipeline produces Adapted Material.** §2(a)(4) exempts technical modifications needed to
  exercise the rights, and decimating, re-UV-ing, re-rigging and rebaking a clinical avatar is not
  that. Claiming "unmodified" after our pipeline would be false.

## Consequences

**The provenance manifests are not yet a compliance record.** They are a pipeline audit and a good one
— `derivationMode`, `sourceOriginChain`, `licenseChain`, `notEvidenceFor` — but they carry no TASL
(title, author, source, licence), no `licenseUri`, no `attributionRequired`, no provider plan tier, no
modification list, and no component-level rights for multi-source GLBs. A credits page generated from
today's files would print `licenseChain.status: "inherited_from_base_not_reverified"` and call it
compliance, which is worse than printing nothing.

**`inherited_from_base_not_reverified` is honest engineering and a compliance red flag.** Every
humanoid rebaked from a shared `.anny_base.obj` inherits that base's rights chain. If any base is ever
CC-BY rather than CC0, rights must be re-enumerated at promote-to-runtime rather than assumed from the
first generation.

**Baking does not launder rights.** A CC-BY mesh merged into a combined GLB, or used as a rebake base
while remaining recognisable, keeps its attribution obligation. An Adapter's Licence may cover our own
contributions but must not prevent recipients from complying with the original.

**Nothing here is contagious.** CC BY is not copyleft; CC0 requires nothing; our proprietary work stays
proprietary. The licences to keep out remain CC BY-SA, GPL and AGPL — unchanged from the existing
posture.

## The shape, if CC-BY assets are ever adopted

1. extend the manifest schema with the rights fields above, per component for multi-source assets
2. generate a credits index from the manifests at build time — manifests write, the page reads,
   nothing hand-maintained
3. link it from the admin app **and** from the learner session chrome, so a headset user can reach it
4. ship a complete sidecar next to every public GLB, for the raw-download path
5. record modifications structurally (`["decimate","re_uv","re_rig","rebake"]`) and generate the human
   sentence from that

## NOT DETERMINED

- whether a court would find a linked credits surface "reasonable" for a headset-only exam — this is a
  lawyer question and the answer is not codeable as a gate
- enforceability of Meshy's ownership claim over AI-generated output; US copyright in AI-generated
  works is contested, and **no product policy here may rest on "AI output is not copyrightable"**
- whether institutional customer contracts flow IP warranties down to us

## Claim scope

This record is an engineering posture, not legal advice, and nobody involved in producing it is a
lawyer. It is deliberately conservative: prefer CC0 and our own generation, so that the questions above
stay hypothetical.

## Update 2026-08-07 — the local Apple-Silicon path is licence-clear, and it changes the recommendation

Operator direction: evaluate `pedronaugusto/trellis2-apple` and `shivampkumar/trellis-mac` as
alternatives to Meshy, and check licences.

**They are not alternatives.** `trellis-mac`'s `setup.sh` clones `trellis2-apple` plus four Metal
kernel libraries by the same author; it is an installer around the other one. Both target TRELLIS.2.

### The CUDA wall that closed #164 has a Metal replacement, pinned by commit

`requirements_macos.txt` in `trellis2-apple` aliases the CUDA extensions to Metal implementations
under their original import names:

    cumesh      @ pedronaugusto/mtlmesh      (fork of JeffreyXiang/CuMesh, MIT)
    flex_gemm   @ pedronaugusto/mtlgemm
    mtldiffrast @ pedronaugusto/mtldiffrast
    mtlbvh      @ pedronaugusto/mtlbvh

and opens with `# NO: flash_attn, spconv, torchsparse (CUDA-only)`. `cumesh_vb` — the import inside
`stages.run_multiview_shape_generation` that returned `reject_measured` on this machine — is exactly
what `mtlmesh` replaces.

`mtldiffrast` is a Metal **replacement** for nvdiffrast rather than a derivative of it. That is the
distinction that made this project refuse AniGen-mac, whose vendored extension derived from NVIDIA
instant-ngp under a non-commercial licence.

### Licence position, verified per dependency

| dependency | licence | source |
|---|---|---|
| `microsoft/TRELLIS.2-4B` | **MIT** | HF API |
| `pedronaugusto/trellis2-apple` | **MIT** (Microsoft's, preserved through the fork) | GitHub API + LICENSE |
| `mtlmesh` / `mtlgemm` / `mtldiffrast` / `mtlbvh` | **MIT** ×4 | GitHub API |
| `JeffreyXiang/CuMesh` upstream | **MIT** | GitHub API |
| `facebook/dinov3-vitl16-pretrain-lvd1689m` | custom, **commercial permitted** | licence text read in full |
| `briaai/RMBG-2.0` | **CC BY-NC 4.0** — non-commercial | HF `license_link` |

**`shivampkumar/trellis-mac` is refused on licence.** Its README requires gated access to RMBG-2.0,
whose HuggingFace `license_link` resolves to `creativecommons.org/licenses/by-nc/4.0/`.

**`trellis2-apple` does not require it** — `requirements_macos.txt` contains no background remover at
all, and `app_mlx.py` imports none. That was the last open licence question.

### DINOv3, read in full

Grant: *"non-exclusive, worldwide, non-transferable and royalty-free limited license … to use,
reproduce, distribute, copy, create derivative works of, and make modifications."* **No commercial
restriction, no field-of-use restriction, and no Acceptable Use Policy annex** — unlike the Llama
family. Across the whole agreement: `Acceptable Use` 0 hits, `medical` 0, `health` 0, `field of use` 0.

Its conditions attach to **distributing the DINO Materials or derivative works thereof**: pass the
agreement along and prominently display "Built with DINOv3". We would not redistribute the weights —
the use is offline generation, shipping only the GLB — and §5(a) says derivative works we make are
ours. **Whether a generated GLB is a "derivative work of the DINO Materials" is a lawyer question and
is not answered here.** Adding "Built with DINOv3" to the credits surface costs nothing and means it
never has to be.

Three unusual terms, recorded because they are easy to miss: **§5(b)** patent-retaliation termination
plus an indemnity running from us to Meta; **§8** Meta may modify the agreement unilaterally with
changes *"effective immediately"*, so the accepted text and its date belong in the provenance record;
**§7** California law and exclusive California jurisdiction.

### What this changes, and what it does not

**Changes:** the local path is licence-open and strictly better than Meshy on every licence axis — MIT
model, our own generation, no attribution obligation on output, no cloud credential, no per-asset cost,
no operator approval gate. The recommendation in this record — prefer CC0 or our own generation —
now has a viable local implementation.

**Does not change:** whether the output is usable. `trellis-mac` reports ~800K triangles against a
60,000 per-asset ceiling **with simplification disabled**; thin elements (casters, IV poles, rails,
bezels) are where this model class fails; and a generated medical device risks invented controls that
look authoritative and are wrong. Our parametric ECG cart is 288 triangles and reads correctly.

Licence-clear is necessary and not sufficient. The bake-off decides.

## Update 2026-08-08 — #225 Metal backend gate: `inconclusive_blocked`

**Verdict:** `inconclusive_blocked` — the `trellis2-apple` MLX inference backbone loads on this Apple
Silicon machine (torch 2.13.0 MPS, mlx 0.32.0, all MLX backend modules import cleanly), but three
independent blockers prevent a full end-to-end shape→mesh→textured-export run.

### What was tested

| layer | outcome |
|---|---|
| `trellis2-apple` venv creation | installed at `~/.openclinxr-tools/trellis2-apple/venv` with torch 2.13.0, mlx 0.32.0, transformers 5.14.1 |
| MLX backend import | runs — `mlx_backend`, all transformer blocks, attention, sparse conv |
| `trellis2.pipelines` import | runs (after installing `easydict`) |
| `postprocess_cpu.to_glb` import | runs — pure Python, no C++ deps; fast_simplification + xatlas UV + MPS rasterization + OpenCV inpainting → PBR GLB path is independently viable |
| Backend resolution | `HAS_MPS=True, HAS_CUDA=False, BACKEND=cpu, HAS_DR=False, HAS_MESH=False, HAS_TRIMESH=True, HAS_FAST_SIMPLIFICATION=True, HAS_FLEX_GEMM=False` |
| Stock ComfyUI `Trellis2ImageToShape` | **throws** — `No module named 'cumesh_vb'` at runtime (confirmed live on 8188, matching #164's finding) |

### Blockers (all three are environment, not architecture)

1. **Metal Toolchain not installed.** `xcrun metal` refuses with "missing Metal Toolchain; use:
   `xcodebuild -downloadComponent MetalToolchain`". Without it, the four Metal GPU kernel packages
   (`mtlmesh`/`mtlgemm`/`mtldiffrast`/`mtlbvh`, all MIT) cannot be compiled from source. All four
   `pip install --no-build-isolation` attempts failed identically.

2. **`o_voxel` C++ extension fails to build.** `flexible_dual_grid.cpp` torch extension compilation
   fails (`c++` exits non-zero). The pure-Python `postprocess_cpu.py` fallback is independently
   viable but the pipeline's default export path imports from the C++ layer.

3. **DINOv3 is a gated HuggingFace model.** `DINOv3ViTModel.from_pretrained("facebook/dinov3-vitl16-
   pretrain-lvd1689m")` requires HF authentication. No HF token is configured. The stock
   ComfyUI-TRELLIS2 custom node ships its own `dinov3.py` that avoids this download, but
   `trellis2-apple` does not reuse it.

### What would unblock

1. `sudo xcodebuild -downloadComponent MetalToolchain` (requires operator credentials)
2. Re-run `pip install --no-build-isolation` for the four Metal packages
3. Point `trellis2-apple` at the local DINOv3 implementation from ComfyUI-TRELLIS2
4. Bypass `o_voxel` C++ build; wire `postprocess_cpu.to_glb` into the pipeline export

### What this means for the prop lane

The operator's four parallel prop workers (clock / monitor / cart / room shell via TRELLIS.2) cannot
be dispatched today. The MLX inference backbone is viable, but three environment blockers stand
between here and a measurable exported mesh. The stock ComfyUI-TRELLIS2 path is `blocked_cuda`
(matching #164). The pure-Python CPU/MPS PBR export path exists but is not yet wired.

**This does not weaken** the licence findings recorded above. All four Metal GPU packages and the
`trellis2-apple` fork remain MIT-licensed. The 15 GB `microsoft/TRELLIS.2-4B` weights remain on
disk and reusable.

Evidence: `.openclinxr/evidence/issue-225/backend-measure.json`.
Implementation: `tools/openclinxr/evidence/trellis-metal-backend-gate.ts`.
