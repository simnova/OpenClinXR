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
