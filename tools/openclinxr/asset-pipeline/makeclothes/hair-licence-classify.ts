/**
 * #330 — hair is PAINTED, never geometry; 25 real MakeHuman hairstyles staged and
 * unconsumed, 10 of them AGPL3. This module is the licence GATE that decides which
 * of the 25 may ever reach a body: it parses each staged `.mhclo`'s OWN header and
 * helper-vertex references, classifies, and refuses copyleft / unlicensed / helper-
 * bearing styles. It is a real parse (D1 — read the asset, never invent), and it is
 * the machine-checkable basis the evidence contract `hair-is-a-real-fitted-asset`
 * reads (`hair-licence-classification.json`).
 *
 * MEASURED 2026-08-11 (the strings are NOT uniform — a naive `grep -i cc0` misses
 * `CC-0` and `CC_by`; a directory glob pulls in ten AGPL3 assets):
 *
 *   usable (CC0/CC-BY AND zero helper refs)         6   the six `toigo_*` bobs
 *   AGPL3 — HARD REFUSAL (copyleft)                10   learning_anime_hair, culturalibre_hair_01/02,
 *                                                       elvs_double_mh_braid, elvs_french_braid_variation,
 *                                                       elvs_unkempt_french_braid, littleright_bobcut_hair,
 *                                                       rehmanpolanski_hair_bun_brown, sonntag78_junglebook_hair,
 *                                                       sonntag78_blond_with_headband
 *   no licence line — refusal (unspecified)         4   the four `cortu_*`
 *   CC-BY family — allowed, needs attribution       2   o4saken_long01 (CC BY 4.0), elvs_reverse_french_braid_bun (CC_by)
 *   CC-0 variant spelling                           2   culturalibre_hair_06 (0 helpers), _05 (4 helpers)
 *   CC0 but helper refs — excluded on topology      1   faydaen_hair_1 (12 helpers)
 *
 * helper-vertex references are counted against the #318 helper-stripped basemesh
 * (13,380 verts — MADR 0052; refs >= 13380 index helper geometry that no longer
 * exists after the strip and cannot fit). Counted per OCCURRENCE in the `.mhclo`
 * `verts`/`delete_verts`/`seams` sections (the delete_verts seam-pair lines are the
 * ones that carry e.g. culturalibre_hair_05's four helper refs — a parser that stops
 * at the first section keyword misses them).
 *
 * claimScope: licence classification of the staged makehuman-hair01 pack only.
 * notEvidenceFor: clinical hair realism, quest readiness, that a usable style fits
 * ANY basemesh (the fit is proven per-style by the embed stage, not here).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");

/** #318 helper-stripped basemesh vertex count (MADR 0052: 19,158 -> 13,380). */
export const HAIR_HELPER_STRIP_THRESHOLD = 13_380;

export const HAIR_SOURCE_ID = "makehuman-hair01";
/** Repo-relative staged pack root — the `hair01_cc0.zip` extraction. */
export const HAIR_PACK_DIR = join(
  ".openclinxr-local/provider-cache/hair/sources/makehuman-hair01/extracted/hair",
);
export const HAIR_CLASSIFICATION_ARTIFACT = join(
  REPO_ROOT,
  ".openclinxr/evidence/issue-330/hair-licence-classification.json",
);

export type HairLicenceFamily =
  | "cc0"
  | "cc_by"
  | "cc-0"
  | "agpl3"
  | "none"
  | "unknown";

export type HairStyleClassification = {
  /** Style directory name (the `.mhclo` basename without extension). */
  asset: string;
  /** Raw licence token read from the `.mhclo` header (or null when absent). */
  licence: string | null;
  licenceFamily: HairLicenceFamily;
  /** Whether the style may reach a body (licence permitted AND no helper refs). */
  usable: boolean;
  /** Why not usable, or null when usable. Copyleft/unspecified are HARD refusals. */
  refusedReason: string | null;
  /** Helper-vertex reference count (occurrences of a ref >= 13380). */
  helperVertexRefs: number;
  /** Largest vertex index referenced anywhere in the `.mhclo`. */
  maxVertexRef: number;
  attributionRequired: boolean;
};

export type HairClassificationArtifact = {
  schemaVersion: "openclinxr.hair-licence-classification.v1";
  sourceId: string;
  packDir: string;
  generatedAt: string;
  producedByCommand: string;
  assets: HairStyleClassification[];
  summary: {
    total: number;
    usable: number;
    refusedCopyleft: number;
    refusedUnlicensed: number;
    refusedTopology: number;
    attributionRequired: number;
  };
};

/** Licence line variants seen in the pack (the measured non-uniformity). */
const LICENCE_LINE = /^#\s*license:?\s*(.+)$/iu;
/** `.mhclo` sections that reference basemesh vertices by index. */
const REF_SECTIONS = new Set(["verts", "delete_verts", "seams"]);

export function readHairLicenceLine(mhcloPath: string): { raw: string | null } {
  const header = readFileSync(mhcloPath, "utf8").slice(0, 4_000);
  for (const line of header.split(/\r?\n/u)) {
    const m = LICENCE_LINE.exec(line.trim());
    if (m) return { raw: m[1]!.trim() };
  }
  return { raw: null };
}

/**
 * Count helper-vertex references in a `.mhclo`.
 *
 * A face line (`v0 v1 v2 [v3] f0 f1 f2 f3 f4 f5`) carries floats after the vertex
 * indices, so only the first four integers count. A seam/delete_verts line
 * (`a - b c - d ...`) is pure integers — EVERY integer on it is a vertex reference
 * (this is where culturalibre_hair_05's four helper refs live). A line with any
 * `.` is treated as a face line; a line with no `.` as an index-only line.
 */
export function measureHairHelperRefs(mhcloPath: string): {
  maxVertexRef: number;
  helperVertexRefs: number;
  helperRefDistinct: number[];
} {
  const text = readFileSync(mhcloPath, "utf8");
  let maxVertexRef = 0;
  let helperVertexRefs = 0;
  const helperRefSet = new Set<number>();
  let inRefs = false;

  for (const line of text.split(/\r?\n/u)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const kw = /^[a-zA-Z_]+/u.exec(s)?.[0] ?? "";
    if (REF_SECTIONS.has(kw)) {
      inRefs = true;
      continue;
    }
    if (kw && !REF_SECTIONS.has(kw)) {
      inRefs = false;
      continue;
    }
    if (!inRefs) continue;
    const hasFloat = s.includes(".");
    const nums = (s.match(/-?\d+/gu) ?? []).map(Number);
    const indices = hasFloat ? nums.slice(0, 4) : nums;
    for (const n of indices) {
      if (n < 0) continue;
      if (n > maxVertexRef) maxVertexRef = n;
      if (n >= HAIR_HELPER_STRIP_THRESHOLD) {
        helperVertexRefs += 1;
        helperRefSet.add(n);
      }
    }
  }
  return {
    maxVertexRef,
    helperVertexRefs,
    helperRefDistinct: [...helperRefSet].sort((a, b) => a - b),
  };
}

/** Classify one raw licence token into a family + permissiveness verdict. */
export function classifyHairLicence(raw: string | null): {
  family: HairLicenceFamily;
  permitted: boolean;
  attributionRequired: boolean;
  refusalReason: string | null;
} {
  if (!raw) {
    return {
      family: "none",
      permitted: false,
      attributionRequired: false,
      refusalReason: "no licence line in the .mhclo header — unspecified is a refusal",
    };
  }
  if (/agpl/i.test(raw)) {
    return {
      family: "agpl3",
      permitted: false,
      attributionRequired: false,
      refusalReason: `AGPL3 (copyleft) in the .mhclo header — hard refusal: ${raw}`,
    };
  }
  if (/cc\s*[-_ ]?0/iu.test(raw)) {
    return {
      family: /cc\s*-0/iu.test(raw) ? "cc-0" : "cc0",
      permitted: true,
      attributionRequired: false,
      refusalReason: null,
    };
  }
  // `CC_by` (underscore), `CC BY 4.0` (space) and `CC-BY` (dash) all appear in the
  // pack — the separator is non-uniform, so accept any of the three.
  if (/cc[\s_-]*by/iu.test(raw)) {
    return {
      family: "cc_by",
      permitted: true,
      attributionRequired: true,
      refusalReason: null,
    };
  }
  return {
    family: "unknown",
    permitted: false,
    attributionRequired: false,
    refusalReason: `unrecognised licence line in the .mhclo header — refused: ${raw}`,
  };
}

export function classifyHairStyle(asset: string, mhcloPath: string): HairStyleClassification {
  const { raw } = readHairLicenceLine(mhcloPath);
  const { family, permitted, attributionRequired, refusalReason: licenceRefusal } =
    classifyHairLicence(raw);
  const { maxVertexRef, helperVertexRefs } = measureHairHelperRefs(mhcloPath);

  let refusedReason = licenceRefusal;
  if (permitted && helperVertexRefs > 0) {
    refusedReason =
      `${helperVertexRefs} helper-vertex refs (>= ${HAIR_HELPER_STRIP_THRESHOLD}) ` +
      "cannot fit the #318 helper-stripped basemesh — excluded on topology";
  }
  return {
    asset,
    licence: raw,
    licenceFamily: family,
    usable: permitted && helperVertexRefs === 0,
    refusedReason,
    helperVertexRefs,
    maxVertexRef,
    attributionRequired,
  };
}

/** Classify every staged style in the pack — a real directory parse, never a list. */
export function classifyHairPack(packDir: string): HairClassificationArtifact {
  const assets: HairStyleClassification[] = [];
  for (const entry of readdirSync(packDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mhclo = join(packDir, entry.name, `${entry.name}.mhclo`);
    if (!existsSync(mhclo)) continue;
    assets.push(classifyHairStyle(entry.name, mhclo));
  }
  assets.sort((a, b) => a.asset.localeCompare(b.asset));

  return {
    schemaVersion: "openclinxr.hair-licence-classification.v1",
    sourceId: HAIR_SOURCE_ID,
    packDir,
    generatedAt: new Date().toISOString(),
    producedByCommand: "pnpm asset:hair:licence-classify -- --write",
    assets,
    summary: {
      total: assets.length,
      usable: assets.filter((a) => a.usable).length,
      refusedCopyleft: assets.filter((a) => /agpl|copyleft/i.test(a.refusedReason ?? "")).length,
      refusedUnlicensed: assets.filter((a) =>
        /unlicen[cs]ed|no licence|unspecified/i.test(a.refusedReason ?? ""),
      ).length,
      refusedTopology: assets.filter((a) => /helper-vertex refs/i.test(a.refusedReason ?? "")).length,
      attributionRequired: assets.filter((a) => a.attributionRequired).length,
    },
  };
}

function parseArgs(argv: string[]): { packDir: string; out: string; write: boolean } {
  const get = (flag: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : "";
  };
  return {
    packDir: get("--pack-dir") || join(REPO_ROOT, HAIR_PACK_DIR),
    out: get("--out") || HAIR_CLASSIFICATION_ARTIFACT,
    write: argv.includes("--write"),
  };
}

async function main(): Promise<void> {
  const { packDir, out, write } = parseArgs(process.argv.slice(2));
  if (!existsSync(packDir)) {
    console.error(
      "[hair-licence] pack dir not found: " +
        packDir +
        " — stage makehuman-hair01 under .openclinxr-local/provider-cache/hair/sources/ first.",
    );
    process.exit(2);
  }
  const artifact = classifyHairPack(packDir);
  if (write) {
    writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        total: artifact.summary.total,
        usable: artifact.assets.filter((a) => a.usable).map((a) => a.asset),
        summary: artifact.summary,
        out: write ? out : "(dry run — pass --write)",
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] != null && pathResolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(`[hair-licence] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
