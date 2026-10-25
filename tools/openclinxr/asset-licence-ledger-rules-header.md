# Third-party asset licence ledger

**What this is.** One row per third-party asset source acquired into this repo or its provider cache,
with the licence, where it came from, what consumes it, and whether we intend to replace it.

**Why it exists.** #193 records that CC-BY garments are allowed but "the compliance surface they are
conditional on does not exist". This is that surface. Operator direction 2026-08-11, approving hair
acquisition: *"keep track of these as we'll eventually look for replacements where possible."* So every
row carries a **replacement posture**, not just a licence.

**Rules.**
- **CC0 and CC-BY only** unless the operator approves otherwise in writing. No AGPL/copyleft, no paid,
  no unspecified.
- **An unspecified licence is a refusal, not a maybe.** If the source page does not state a licence, it
  does not get acquired — record it in the REFUSED table instead so nobody re-litigates it.
- CC-BY sources require attribution to survive into anything shipped. Record the attribution string
  here at acquisition time, not later.
- A row is added when the asset is acquired, not when it is first used.
- **OPERATOR RULING 2026-08-24, AMENDED 2026-09-10 — a publisher's more-permissive PAGE or INDEX
  overrides a per-file header, with one class carved out.** The 2026-08-24 ruling named the MakeHuman
  asset-pack index versus the `.mhclo` header only. That scope was wrong in its own terms: it claimed to
  sanction `skins01/02`, whose conflict is in `.mhmat` headers the scope line excluded, and
  `laying-on-bed`, a `.bvh` it never mentioned. The 2026-09-10 amendment fixes the scope and adds the
  carve-out.

  **SCOPE.** Any publisher-controlled licence statement — an asset page, a pack index, a pack manifest —
  versus **any per-file licence surface** — `.mhclo`, `.mhmat`, `.obj`, `.bvh`, embedded metadata, or the
  absence of one. Not an enumerated three.

  **THE THREE SHAPES, and they are not equally exposed.**
  1. **The file is SILENT.** The page grants, the file says nothing. There is no contradiction — a
     positive grant against an omission. **The page wins by default.** This supersedes "unspecified is a
     refusal" *for the case where the publisher's own page states a licence*; an asset whose page is ALSO
     silent is still a refusal, unchanged.
  2. **The file carries EXPORTER TEMPLATE BOILERPLATE.** A tool wrote the notice, not the author — the
     ledger already calls `cargo_pants.obj:3` "the MakeHuman template boilerplate, which is not the grant
     either way." **The page wins by default.**
  3. **The file carries EXPLICIT PER-FILE COPYLEFT.** A licence notice on a specific file, in a pack whose
     page claims something more permissive. **The page does NOT win by default.** Each such file needs a
     dated, named per-asset override, scoped to that asset — the same mechanism `mhair02` uses, recorded
     with who decided, when, and the reversal condition. A community index is not a per-author grant, and
     thirteen files are in this class today (2 in `skins01`, 1 in `skins02`, 10 `hair01` styles). None has
     an override, so all thirteen remain refused. **SUPERSEDED 2026-09-17:** the operator ruling below is that override for all thirteen; they are permitted via the catalogue.
     - Several of the thirteen carry MakeHuman's OWN copyright line rather than the asset author's, which
       is a fact pointing at shape 2. That reclassification is exactly what a named override decides. It
       is not assumed here, because assuming it would widen the grant without anyone deciding to.

  **WHAT THIS RULING NEVER REACHES**, in either direction:
  - **Third-party restrictions.** CMU's no-resale-even-converted term and Mixamo's no-redistribution-of-
    raw-files term come from someone other than the page's publisher. No page statement overrides them and
    both rows stay refused on their own grounds.
  - **A DIFFERENT licence, rather than a less permissive one.** CC BY-SA and CC BY-NC are not weaker
    spellings of CC0; they are other terms with their own obligations. This ruling resolves *which of two
    conflicting claims by the same publisher governs*, not whether a restrictive licence is acceptable.

  **THE BAKE GATE IS DELIBERATELY STRICTER THAN THIS RULING, and that divergence is named rather than
  discovered.** `read_hair_mhclo_licence` (`materialize_mpfb_humanoid_candidate.py:742`) and
  `hair-licence-classify.ts` both treat an absent licence line as a refusal, which shape 1 above no
  longer requires. They are not being loosened.
  - They agree with the ruling where it matters most: AGPL is a hard refusal in both, and both consult a
    named uuid allowlist for overrides — which is precisely the shape-3 mechanism.
  - They disagree on silence, and the stricter side is the right default for the LAST gate before shipped
    bytes. This ruling governs acquisition and clearance; the baker governs what reaches a `.glb` a
    browser can fetch. Nothing newly sanctioned here is consumed today, so loosening the baker would
    remove a defence for a benefit nobody needs yet.
  - **Consequence a reader must not miss:** an asset can be SANCTIONED by this ruling and still refused
    at bake time. That is intended. If a sanctioned asset is later needed in shipped bytes, the baker is
    changed in its own slice, with its own two-sided probe, not by reading this paragraph as permission.

  **CORRECTED 2026-09-17 — the bake gate now matches shapes 1 and 2.** The paragraph above was true
  until 2026-09-17 and is kept as history, not erased. `classifyHairLicence`
  (`hair-licence-classify.ts`), `resolveGarmentLicense` (`fit-cli.ts`), and `read_hair_mhclo_licence`
  (`materialize_mpfb_humanoid_candidate.py`) now consult the committed publisher catalogue
  (`tools/openclinxr/asset-pipeline/makeclothes/makehuman-catalogue-snapshot.json`, fetched 2026-09-17
  from the asset-pack index) when the asset's own descriptor is completely silent — catalogue-derived
  verdicts carry a distinct `catalogue_cc0`/`catalogue_cc_by` family (TS) or `catalogue:<slug>=<licence>`
  token (Python) so the provenance stays visible. Shape 3 (explicit per-file copyleft) stays a hard
  bake refusal, matching this ruling — that half of the paragraph above is still true and unchanged. **SUPERSEDED the same day by the OPERATOR RULING 2026-09-17 below: the catalogue governs shape 3 too.**

  **DIRECTION AND PRECEDENCE, unchanged from 2026-08-24.** It is an override, not a tiebreak: a file that
  already clears stands on its own header and no override is invoked. It runs one direction only — a page
  that is silent, or less permissive than the file, does not soften the file.

- **OPERATOR RULING 2026-09-17, REFINED the same day — take the MORE PERMISSIVE of the catalogue listing and the asset's own declaration.** Verbatim, typed by the operator on 2026-09-17:
  - *"Review the assets with their listing page - is the listing page more permissive? If so record that as the license instead of the license embedded into the asset as many just leave the default license."*
  - asked about packs the catalogue lists as CC0 while the asset's own file declares AGPLv3 (skins01/skins02):
    *"go with what site links say (CC0 over AGPLv3)"*
  - earlier the same day, before the refinement: *"remember that unclassified should default to the asset catalog page's listing of licensing not the asset itself"* — kept as history; the refinement narrows it to the more-permissive comparison below.
  - catalogue URLs: *"https://static.makehumancommunity.org/assets/assetpacks/index.html"* and
    *"http://makehumancommunity.org/content/user_contributed_assets.html"*

  **SUPERSEDED the same day:** the earlier-today reading that the catalogue listing governs unconditionally,
  including over an explicit per-file copyleft declaration, is narrowed to the comparison below.
  This is the named, dated operator decision the 2026-09-10 amendment required before shape 3 (explicit
  per-file copyleft) could be overridden. For MakeHuman catalogue packs it SUPERSEDES shape 3 **where the
  catalogue is strictly more permissive**. The catalogue listing governs **only when it is MORE PERMISSIVE
  than the asset's own declaration** — the operator's reason: "many just leave the default license".
  When the catalogue is equal or stricter (e.g. catalogue CC-BY, file CC0) the FILE's more permissive
  licence governs.
  **Permissiveness comparison, enforced in code** (`tools/openclinxr/asset-pipeline/makeclothes/licence-precedence.ts`
  and `tools/openclinxr/asset-pipeline/makeclothes/licence_precedence.py`, called by `classifyHairLicence`,
  `resolveGarmentLicense` and `read_hair_mhclo_licence`) — rank CC0 > CC-BY > copyleft > unrecognised:
  1. compare the catalogue listing for the asset's pack (`makehuman-catalogue-snapshot.json`, index fetched
     2026-09-17) against the asset's own `.mhclo`/`.mhmat` declaration and take the MORE permissive; the
     verdict records `via` (catalogue or file), the licence it overrode, and the catalogue URL;
  2. catalogue silent -> the file governs;
  3. catalogue silent AND file silent still refuses;
  4. a catalogue listing conflicting licences for the same pack still refuses, and the file does not
     rescue it;
  5. an unrecognised or garbled token is the LEAST permissive and never wins.
  A CC-BY attribution declared on either side is kept, whichever side governs. The
  user-contributed index is recorded as a named source; it has no per-asset licence table today, so no
  pack is resolved from it. Community pages outside the catalogue (`mhair02`, scrub kit) are unchanged
  and keep their own recorded overrides.
  **Verdicts that flip under this ruling:** skins01 `blindsaypatten_uniform_skin_texture` and
  `callharvey3d_midtoned_female`, skins02 `rehmanpolanski_skin_viking_tattoos`, and ten hair01 styles
  (learning_anime_hair, culturalibre_hair_01/02, elvs_double_mh_braid, elvs_french_braid_variation,
  elvs_unkempt_french_braid, littleright_bobcut_hair, rehmanpolanski_hair_bun_brown,
  sonntag78_junglebook_hair, sonntag78_blond_with_headband): refused -> permitted via catalogue CC0.
  Topology exclusions (helper-vertex refs) are unaffected.

- **DELIVERY MODEL: this product REDISTRIBUTES raw asset files. It does not embed them.**
  Assets live in `apps/ui-xr/public/xr-assets/**` — Vite's public directory, served at the site root —
  so every `.glb` is a URL any browser can fetch and save. That is materially different from a
  compiled game binary, and it is the reason this ledger's bar is stricter than a game studio's.
  - **A licence permitting "use in your project" but forbidding redistribution of the raw file does
    not clear here, at any price.** The Mixamo row below already refuses on exactly that ground
    (*"no redistribution of raw animation files... free commercial use only when embedded"*), and the
    CMU row notes *"you may not resell this data directly, even in converted form"*. Those are not
    edge cases; they are the common shape of marketplace EULAs.
  - This is why CC0 and CC-BY are the bar rather than a preference: both explicitly permit
    redistribution. Most marketplace licences (Epic/Fab Standard, Sketchfab Standard, Unity/Unreal
    store terms) permit *use* while restricting *redistribution*, which this delivery model performs
    by construction.
  - **Ask of any candidate: may a stranger download this file from our site and keep it?** If the
    licence does not permit that, the asset cannot ship here however the page describes its price.
- **OPERATOR APPROVAL 2026-08-24 — CC-BY 3D assets are approved for PRODUCT use, with attribution
  served from a licences page.** Verbatim: *"yes allow CC-BY for 3d assets - and we'll incorporate into
  product - as the product starts from a webpage in VR (webxr) we can likely make linkable from that
  intial webpage to be compliant (a licenses page on that website)."*
  - This is the **compliance surface #193 said did not exist**. CC-BY 4.0 §3(a)(2) permits satisfying
    attribution *"by providing a URI or hyperlink to a resource that includes the required
    information"*, so a licences page reachable from the WebXR entry page is the licence's own named
    mechanism, not a workaround.
  - **The approval is conditional on the page actually existing.** Shipping a CC-BY asset before the
    page is live recreates #193 exactly — allowed in principle, uncompliant in fact. Until it lands,
    CC-BY 3D assets may be ACQUIRED and STAGED but not shipped to a learner.
  - Each row carries a ready-to-publish attribution string: title, author, licence. Recorded at
    acquisition, per the rule above.
- **The index page is a standing RESOURCE, not only a licence check.** Operator, 2026-08-24: revisit
  <https://static.makehumancommunity.org/assets/assetpacks/index.html> whenever MakeHuman work is
  undertaken, to see what can be leveraged. It is the first place to look before hand-authoring or
  acquiring elsewhere (D1: wire the proven asset). Record what it offers even when nothing is taken, so
  the next cycle does not re-search the same ground.
- **The `.mhclo` is the asset's licence surface; a contradicting `.obj` is BOILERPLATE, not evidence.**
  Measured 2026-08-24 (#540): `male_boots.obj:3` and `cargo_pants.obj:3` both carry
  `# license AGPL3 (see also .../external_tools_license.html)` — the MakeHuman *template* header this
  ledger already identifies as template text in the skins01/skins02 rows. Meanwhile
  `culturalibre_male_boots.mhclo` declares `CC-0` and `cargo_pants.mhclo` declares **nothing at all**.
  **Read the `.mhclo` first and judge on it.** Note an `.obj` disagreement in the row so nobody
  re-discovers it, but do not treat it as the grant.
