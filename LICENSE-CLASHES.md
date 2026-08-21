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

## 3. Measured copyleft — the operator outreach worklist

In-file `# license AGPL3` headers, swept across `.openclinxr-local/provider-cache` on 2026-08-21.
**Shipped rows first — those are the ones on a learner's screen today.**

| asset | author | state | shipped on |
|---|---|---|---|
| **`cortu_cargo_pants`** | Unknown | DECLARED | **5 cast actors** — family-partner, ob-aisha, peds-parent, peds-child, street-male (+ viseme harness) |
| **`culturalibre_male_boots`** | Unknown | DECLARED | **2 cast actors** — peds-nurse-kevin, street-male |
| **`mhair02`** | MHteam | **CLASH** — index says CC0, `mhair02.mhclo:3` says AGPL3 | **2 cast actors** — peds-nurse-kevin, street-male |
| `cortu_shaggy_green_hair`, `cortu_short_messy_hair`, `cortu_straight_bangs`, `cortu_strawberry_cloud_hair` | Unknown | DECLARED | cache only |
| `culturalibre_hair_01`, `_05`, `_06` | Unknown | DECLARED | cache only |
| `culturalibre_hair_02` | MHteam | DECLARED | cache only |
| `elvs_double_mh_braid`, `elvs_french_braid_variation`, `elvs_unkempt_french_braid` | Unknown | DECLARED | cache only |
| `learning_anime_hair`, `male_short_hair` | Unknown | DECLARED | cache only |
| `littleright_bobcut_hair` | littleright | DECLARED | cache only |
| `rehmanpolanski_hair_bun_brown` | Rehman Polanski | DECLARED | cache only |
| `sonntag78_blond_with_headband`, `sonntag78_junglebook_hair` | Unknown | DECLARED | cache only |

**Three shipped, seventeen cache-only.** Named authors — `MHteam`, `littleright`,
`Rehman Polanski` — are the tractable outreach targets; `Unknown` needs the asset's community page.

**Under the operating rule, only `mhair02` is a CLASH and resolves to CC0.** The other nineteen have
a single source that says AGPL3, so there is no conflict for the permissive rule to resolve — they
stay AGPL3 until an author grants otherwise via §2.

---

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
