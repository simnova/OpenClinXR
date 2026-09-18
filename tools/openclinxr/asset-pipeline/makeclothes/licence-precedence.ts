/**
 * Licence precedence for the MakeHuman bake gates (OPERATOR RULING 2026-09-17,
 * REFINED by the operator the same day).
 *
 * New operator line (verbatim): "Review the assets with their listing page - is the
 * listing page more permissive? If so record that as the license instead of the license
 * embedded into the asset as many just leave the default license." Earlier the same day:
 * "go with what site links say (CC0 over AGPLv3)".
 *
 * So the catalogue listing no longer wins ALWAYS: the MORE PERMISSIVE of the catalogue
 * listing and the asset's own file line governs (ranks in licencePermissivenessRank).
 * This is the skins01 case: catalogue CC0 (rank 3) beats file AGPLv3 (rank 1). A listed
 * CC-BY catalogue over a file CC0 keeps the file CC0; equal ranks keep the file; a
 * garbled/unrecognised token (rank 0) never beats anything, including a copyleft file line.
 *
 * claimScope: precedence decision only; file-token parsing stays in the callers.
 * notEvidenceFor: per-asset grants outside the catalogue, user-contributed licences.
 */

import { catalogueEntryForPack, type CatalogueEntry } from "./makehuman-catalogue.js";

export type FileLicenceVerdict = {
  /** Raw licence line from the asset's own file, or null when silent. */
  declared: string | null;
  /** The file side's own verdict: permitted only when the header clears on its own. */
  permitted: boolean;
  /** True when the header declared a CC-BY family licence needing attribution. */
  attributionRequired: boolean;
  /** File-side refusal reason, or null when the file side permits. */
  refusalReason: string | null;
};

export type LicencePrecedenceResult = {
  permitted: boolean;
  via: "catalogue" | "file" | "none";
  licence: string | null;
  attributionRequired: boolean;
  refusalReason: string | null;
  /** The file's declared line when the catalogue governed and the file declared something. */
  overriddenFileLicence: string | null;
  catalogueEntry: CatalogueEntry | null;
};

export type LicencePrecedenceInput = {
  packSlug: string | null;
  file: FileLicenceVerdict;
  packs?: Record<string, CatalogueEntry>;
};

/**
 * One precedence decision for every bake gate.
 *
 * (a) Catalogue listing exists and is unambiguous -> compare permissiveness: the more
 *     permissive side governs (catalogue rank > file rank -> catalogue, with the file's
 *     declared line recorded as overridden; catalogue rank <= file rank -> the file's
 *     own verdict decides, via "file"). A silent file is never a "declared" side, so a
 *     listed catalogue always governs it.
 * (b) Catalogue silent for that pack -> the file's own verdict decides.
 * (c) Catalogue silent AND file silent -> refused.
 * (d) Catalogue lists conflicting licences for the same pack -> refused, naming
 *     the conflicting values; the file never rescues a conflict.
 *
 * Attribution: when the catalogue governs, attributionRequired = (catalogue
 * licence is CC-BY) OR (the file itself declared a CC-BY family licence).
 */
export function resolveLicencePrecedence(input: LicencePrecedenceInput): LicencePrecedenceResult {
  const { packSlug, file } = input;
  const entry =
    input.packs !== undefined
      ? ((packSlug ? input.packs[packSlug] : undefined) ?? null)
      : catalogueEntryForPack(packSlug);
  if (entry) {
    const candidates = [entry.licence, ...(entry.licences ?? [])];
    const distinct = [...new Set(candidates.map(normaliseLicenceToken))];
    if (distinct.length > 1) {
      const names = [...new Set(candidates.map((c) => String(c).trim()).filter(Boolean))].sort();
      return {
        permitted: false,
        via: "none",
        licence: null,
        attributionRequired: false,
        refusalReason:
          `catalogue lists conflicting licences for pack ${packSlug ?? "(none)"}: ` +
          `${names.join(" vs ")} — refused without consulting the file`,
        overriddenFileLicence: null,
        catalogueEntry: entry,
      };
    }
    const catalogueLicence = entry.licence;
    const catalogueIsBy = /cc[\s_-]*by/i.test(catalogueLicence);
    const catalogueRank = licencePermissivenessRank(catalogueLicence);
    const fileRank = file.declared ? licencePermissivenessRank(file.declared) : null;
    if (fileRank === null || catalogueRank > fileRank) {
      // A catalogue listing is a grant we may rely on only when the grant itself
      // clears the CC0/CC-BY bar (rank >= 2); otherwise refuse without consulting the file.
      if (catalogueRank < 2) {
        return {
          permitted: false,
          via: "none",
          licence: null,
          attributionRequired: false,
          refusalReason:
            `catalogue licence for pack ${packSlug ?? "(none)"} is not CC0/CC-BY: ` +
            `${catalogueLicence} — refused`,
          overriddenFileLicence: null,
          catalogueEntry: entry,
        };
      }
      return {
        permitted: true,
        via: "catalogue",
        licence: catalogueLicence,
        attributionRequired: catalogueIsBy || file.attributionRequired,
        refusalReason: null,
        overriddenFileLicence: file.declared,
        catalogueEntry: entry,
      };
    }
    // Tie below the CC0/CC-BY bar (e.g. garbled catalogue + garbled file): neither
    // side is a grant we may rely on — refuse without letting the file decide.
    // A file that clears the bar on its own (rank >= 2) still governs.
    if (catalogueRank === fileRank && catalogueRank < 2) {
      return {
        permitted: false,
        via: "none",
        licence: null,
        attributionRequired: false,
        refusalReason:
          `catalogue licence for pack ${packSlug ?? "(none)"} is not CC0/CC-BY: ` +
          `${catalogueLicence} — refused`,
        overriddenFileLicence: null,
        catalogueEntry: entry,
      };
    }
    return {
      permitted: file.permitted,
      via: "file",
      licence: file.declared,
      attributionRequired: file.attributionRequired,
      refusalReason: file.refusalReason,
      overriddenFileLicence: null,
      catalogueEntry: entry,
    };
  }
  if (file.declared) {
    return {
      permitted: file.permitted,
      via: "file",
      licence: file.declared,
      attributionRequired: file.attributionRequired,
      refusalReason: file.refusalReason,
      overriddenFileLicence: null,
      catalogueEntry: null,
    };
  }
  return {
    permitted: false,
    via: "none",
    licence: null,
    attributionRequired: false,
    refusalReason: file.refusalReason ?? "no licence in the file and no catalogue listing — unspecified is a refusal",
    overriddenFileLicence: null,
    catalogueEntry: null,
  };
}

/** Normalise for conflict comparison so "CC0"/"CC-0" spellings are the same value. */
export function normaliseLicenceToken(token: string): string {
  return token.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Permissiveness rank for the more-permissive-wins comparison (redistribution
 * freedom: CC0 imposes no conditions; CC-BY imposes attribution only; copyleft
 * imposes source obligations; an unrecognised token imposes unknown obligations).
 * CC0 / public domain 3, CC-BY family 2, AGPL/GPL copyleft 1, unrecognised 0.
 * Silence has no rank — the callers treat it as "not a candidate", never a winner.
 */
export function licencePermissivenessRank(token: string): number {
  const t = token.trim();
  if (/cc\s*[-_ ]?0\b/i.test(t) || /public\s+domain/i.test(t)) return 3;
  if (/cc[\s_-]*by/i.test(t)) return 2;
  if (/agpl|gpl|copyleft/i.test(t)) return 1;
  return 0;
}
