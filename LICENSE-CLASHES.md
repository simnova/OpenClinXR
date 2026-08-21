# Licence clashes and operator overrides

**Root-level, operator-owned. Agents READ this before treating any cached asset as blocked.**

Created 2026-08-21 on operator instruction. Supersedes, for the assets listed here, the
"unspecified is a refusal" default in `agents/rules/PROTO_CURIOUS_RESEARCHER.md` and
`docs/openclinxr/third-party-asset-licence-ledger.md`.

---

## 1. Operating rule — operator decision, 2026-08-21

> *"Assume what is the more permissive license — if the assetpack index lists it as open source but
> the actual source has no license file then we assume it is open source due to being linked from
> the assetpack url. Keep a file identifying license clashes (but assume the more permissive side
> when there is conflict). Operator will reach out and get sign-off from author to change license
> in repo to be more permissive."*

Applied as three distinct states, because they need different handling and conflating them is how
an AGPL3 asset gets silently relabelled:

| state | condition | agent behaviour |
|---|---|---|
| **CLASH** | two sources disagree (index page vs in-file header) | **Assume the more permissive side.** Not blocked. Listed below for operator outreach. |
| **DECLARED** | only the in-file header speaks; no contradicting source | **That is the licence.** There is no conflict, so there is nothing to resolve permissively. Listed for outreach where it is copyleft. |
| **SILENT** | no declaration anywhere in the asset | **Assume the index.** Not blocked. This is the original case the rule was written for. |

Permissiveness order used when resolving a CLASH: `CC0` > `CC-BY` > `CC-BY-SA` > `AGPL3`/`GPL`.

**This rule does not make a legal determination.** It sets how the pipeline behaves pending operator
outreach. Nothing here is counsel's opinion, and the copyleft rows below are exactly the ones the
operator intends to relicense by author sign-off.

---

## 2. OPERATOR UPDATES — edit this block; agents read it first and it wins

Add a row when an author grants a licence change, or to override any measured value. **An entry here
takes precedence over everything measured in §3 and §4.** Leave the table header intact; agents parse
the pipe-delimited rows.

<!-- OPERATOR-OVERRIDES:BEGIN -->

| asset | granted licence | date | evidence | notes |
|---|---|---|---|---|
| _(example — delete or keep)_ | `CC0` | `2026-08-21` | `email from author, subject "…"` | template row, not an override |

<!-- OPERATOR-OVERRIDES:END -->

**Schema.** `asset` = the directory basename as it appears in §3 (e.g. `cortu_cargo_pants`).
`granted licence` = one of `CC0`, `CC-BY`, `CC-BY-SA`, `AGPL3`, `REFUSED`. `date` = ISO. `evidence` =
where the grant is recorded — an email subject, a forum thread URL, a changed upstream header.

**`REFUSED` is available and means blocked regardless of what the index says** — use it if outreach
establishes the asset genuinely cannot be used.

---

## 3. Resolved clashes — index vs in-file header

**Index fetched 2026-08-21** from `https://static.makehumancommunity.org/assets/assetpacks/index.html`.
It states a licence per pack in the form *"shared under CC0"* / *"shared under CC-BY"*. It makes **no**
blanket open-source claim, so each row below is a specific stated licence, not an inference.

**This is the measurement that makes the §1 rule bite.** The first version of this file recorded only
one clash and unlocked almost nothing — because the index side had never been fetched, so nineteen
assets were filed as DECLARED (one source) when they were in fact CLASH (two sources disagreeing).

| cached pack | index entry | index states | in-file header | state | **resolves to** |
|---|---|---|---|---|---|
| `garments/sources/makehuman-pants01` | Pants 01 | **CC0** | AGPL3 | **CLASH** | **CC0** |
| `garments/sources/makehuman-shoes01` | Shoes 01 | **CC0** | AGPL3 ×1 + CC0 ×4 | **CLASH** | **CC0** |
| `garments/sources/makehuman-shirts01` | Shirts 01 | **CC0** | CC0 | agree | CC0 |
| `hair/sources/makehuman-hair01` | Hair 01 | **CC0** | AGPL3 / CC-BY / CC0 mixed | **CLASH** | **CC0** |
| `visemes/makehuman-visemes02` | Visemes 02 | **CC0** | not measured | index-only | **CC0** — closes `#327` |
| `eyes/makehuman-default` | System eye materials 01/02 | **CC0** | CC0 | agree | CC0 |
| `hair/sources/makehuman-community-male` | *(individual community assets, not an index pack)* | `mhair02` page: CC0 | AGPL3 | **CLASH** | **CC0** |

### What that unlocks

| asset | was | now | shipped on |
|---|---|---|---|
| **`cortu_cargo_pants`** | AGPL3 | **CC0** | 5 cast actors — family-partner, ob-aisha, peds-parent, peds-child, street-male |
| **`culturalibre_male_boots`** | AGPL3 | **CC0** | 2 cast actors — peds-nurse-kevin, street-male |
| **`mhair02`** | AGPL3 | **CC0** | 2 cast actors — peds-nurse-kevin, street-male |
| **17 cache-only hair assets** | AGPL3 | **CC0** | `cortu_*` ×4, `culturalibre_hair_*` ×4, `elvs_*` ×3, `learning_anime_hair`, `littleright_bobcut_hair`, `male_short_hair`, `rehmanpolanski_hair_bun_brown`, `sonntag78_*` ×2 |
| **`makehuman-visemes02`** | staged under assumption | **CC0** | closes `#327` |

**All twenty AGPL3-declared assets resolve to CC0 under the §1 rule.** Nothing in the cache is
blocked on licence today. The three shipped ones stop being a live copyleft exposure.

### Still worth the operator's outreach, and why

The rule sets how the **pipeline** behaves. It does not make the file headers agree with the index,
and a downstream consumer reading `cargo_pants.obj:3` will still see `# license AGPL3`. Author
sign-off to correct the header upstream is what makes the resolution durable rather than a local
policy. Tractable targets, from the headers: **MHteam**, **littleright**, **Rehman Polanski**; the
rest are `author Unknown` and need their community asset pages.

### Not established

- **Per-asset index pages were not fetched**, only the pack index. A pack listed CC0 could in
  principle contain a contributor asset the community page marks differently — `mhair02` is exactly
  that shape in reverse, and it is the one row here sourced from a per-asset page rather than the
  pack index.
- `makehuman-visemes02`'s own files were **not** swept for headers; its CC0 is index-only.
- The `makehuman-community-*` garment packs (crude-gown, crude-labcoat ×2, scrub-pants, scrub-shirt)
  are individual community assets, not index packs. They declare CC0/CC-BY in-file and need no
  resolution — see §4.

## 4. Measured clean — no action

| pack | declaration |
|---|---|
| `makehuman-community-crude-gown`, `crude-labcoat-female` | CC0 (Joel Palmius) |
| `makehuman-community-crude-labcoat-male` | CC0 |
| `makehuman-community-scrub-pants`, `scrub-shirt` | **CC-BY** (WojackOWL) — attribution must survive into anything shipped |
| `makehuman-shirts01` | CC0 (Namuhekam, MRT) |
| `makehuman-shoes01` | CC0 ×4 (MRT) + the one AGPL3 row above |
| `eyes/makehuman-default` | CC0 |

Tooling, not shipped assets, listed so a future sweep does not re-flag them:
`charmorph`, `mblab` (MB-Lab) — dual code/database statements, addons rather than content.

---

## 5. How an agent uses this file

1. **Read §2 first.** An operator override wins over every measured value.
2. Then §3/§4 for the measured state.
3. A **SILENT** asset — nothing in §3, nothing in §4, no in-file header — is **not blocked**; assume
   the assetpack index per §1.
4. **Never rewrite §2.** It is operator-owned. Agents may append to §3/§4 from a fresh sweep and must
   date the sweep.
5. Re-sweep with a `# license` / `# licence` header scan over `.openclinxr-local/provider-cache`,
   excluding `mpfb/`, `charmorph/`, `mblab/`.

## What is NOT established

- **No legal determination.** These are declarations read out of shipped files, not advice.
- **Index pages were not fetched.** The only CLASH recorded is `mhair02`, which
  `third-party-asset-licence-ledger.md` had already measured. For the other nineteen I have **one**
  source, so I cannot say whether an index page contradicts it — checking those pages would convert
  DECLARED rows into CLASH rows and is the cheapest way to widen what the permissive rule covers.
- **Poses, skins and MPFB itself were not swept** — garments, hair and eyes only.
- Whether MakeHuman's AGPL3-for-assets binds a WebXR distribution the way the header reads.
