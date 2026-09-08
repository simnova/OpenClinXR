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
- **OPERATOR RULING 2026-08-24 — the asset-pack INDEX overrides the `.mhclo`, and ONLY when it is MORE
  PERMISSIVE.** The comparison is [the MakeHuman asset-pack index](https://static.makehumancommunity.org/assets/assetpacks/index.html)
  **versus the asset's `.mhclo` header** — not versus the `.obj`, not versus the `.mhmat`. Where the index
  lists a more permissive licence than the `.mhclo` declares, **use the asset and assume the index is
  correct**; the operator contacts the pack owner to have the header corrected. Record the contradiction
  in the row; do not re-litigate it per slice.
  - It is an **override, not a tiebreak**. If the `.mhclo` already clears (CC0/CC-BY), the index changes
    nothing and no override is invoked — the row stands on its own header.
  - It runs **one direction only**. An index that is silent, or less permissive than the `.mhclo`, does
    not soften the `.mhclo`.
  - It **narrows and does not repeal** the four "page is not the licence" findings below (`mhair02`,
    `hair01`, `skins01/02`, `laying-on-bed`). Those are this same direction — page claiming more than the
    file — and are now sanctioned rather than refused.
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
