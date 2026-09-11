import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { resolveScenarioActorCast } from "../../../../packages/openclinxr/asset-registry/src/runtime-bundles-entry.js";
import {
  SCENE_CLOSURE_CASE_ID,
  SCENE_CLOSURE_SELECTED_ASSET_MANIFEST,
  sceneClosureCaseDocument,
} from "../../factory/scene-closure-case-source.js";

/**
 * Do the assets the scene-closure case ACTUALLY selects have byte lineage and rights that clear?
 *
 * A06's decisive evidence is a "hash/derivation chain and separate adopted/shipped/rendered-public
 * decisions", and its counterexamples are an "unknown rights, substituted asset or rewritten-only
 * hash". This walks that chain from the real cast resolver rather than from a list someone typed.
 *
 * THE SELECTION IS RESOLVED, NOT LISTED. `resolveScenarioActorCast` is the production owner
 * (`packages/openclinxr/asset-registry/src/actor-casting.ts`): for a case the in-repo bank does not
 * carry, it pool-assigns by role from the authored document. A hard-coded list of four filenames
 * here would keep passing after a cast change repointed the encounter at an uncleared body, which is
 * the substituted-asset counterexample wearing a green tick.
 *
 * WHAT COUNTS AS CLEARED IS THE DELIVERY MODEL'S BAR, NOT A GAME STUDIO'S. The ledger's own standing
 * rule (`third-party-asset-licence-ledger.md`, "DELIVERY MODEL"): these GLBs sit in Vite's public
 * directory and are fetchable by any browser, so "a licence permitting use in your project but
 * forbidding redistribution of the raw file does not clear here, at any price". CC0 and CC-BY clear;
 * a commercial-use permission carrying a resale restriction does not, however generous it reads.
 *
 * THE PARENT GRANT IS NOT A BLANKET. A repository-wide dedication covers what that repository's
 * authors made. `SELECTED_CASE_CLIP_CLEARANCE` therefore carries `excludedSubtrees`, and a consumed
 * path under one is refused with the exclusion named — see the Mesh2Motion entry, whose own
 * `static/animations/CarnegieMellonAnimations/readme.txt` says the files are "A small sample of FBX
 * file from a larger library" at an unrelated third-party URL. Those bytes are not the repository's
 * to dedicate, and taking the parent CC0 at face value would launder exactly the CMU terms this card
 * exists to resolve.
 *
 * THE MANIFEST CITES AND THE AUDIT CHECKS THE CITATION. Every entry names the ledger row backing it
 * and the exact phrase that row must contain. A record edited to say something friendlier stops
 * matching and the audit refuses, so provenance cannot be improved by rewriting it — which is the
 * "rewritten-only provenance" counterweight, mechanised.
 *
 * CLAIM SCOPE: byte identity and recorded rights of the humanoid assets one case selects. NOT
 * EVIDENCE FOR the room, equipment or audio (enumerated separately in the SC-04 manifest), for
 * whether the licence texts are legally sufficient, or for anything about motion quality.
 */

export type RedistributionVerdict = "clears" | "refuses" | "unknown";

export type ClipClearance = {
  /** Repo- or tool-relative prefix of the motion source this entry governs. */
  sourcePrefix: string;
  /** Ledger-derived record that carries the grant. */
  licenceRecordPath: string;
  /** Text the record must literally contain, so a rewritten record stops matching. */
  requiredRecordPhrases: string[];
  /** Paths the grant does NOT reach, however the parent repository describes itself. */
  excludedSubtrees: string[];
  /** Separate decisions, per the card: adopting a source is not shipping it is not rendering it publicly. */
  decisions: { adoptedForBuild: boolean; shippedInRedistributedBytes: boolean; renderedInPublicMedia: boolean };
  notes: string;
};

/**
 * The motion sources the scene-closure encounter may consume, and the exact terms of each.
 *
 * CMU is present deliberately. Deleting the row it fails on would make the audit silent about the
 * thing it exists to catch; keeping it means a rebuild that reintroduces the CMU clip is refused by
 * name rather than by absence.
 */
export const SELECTED_CASE_CLIP_CLEARANCE: readonly ClipClearance[] = [
  {
    sourcePrefix: "tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-08-cmu-graphics-lab-mocap.json",
    requiredRecordPhrases: ["CONDITIONAL", "may not be resold"],
    excludedSubtrees: [],
    decisions: { adoptedForBuild: true, shippedInRedistributedBytes: false, renderedInPublicMedia: false },
    notes:
      "CMU Graphics Lab mocap. Free for research and commercial products, with an NSF EIA-0196217 acknowledgement requested and a restriction that the data may not be resold even in converted form. A build-time retarget is inside those terms; shipping the derived clip inside a GLB that any browser can download is redistribution of converted data, so it is refused for the shipped and public-render decisions.",
  },
  {
    // The DIRECTORY, not one library file. The repository's dedication nominally reaches everything
    // under it, so the exclusion below has to carve the laundered subtree out of a matching entry —
    // a narrower prefix would make the CMU sample simply unmatched, and "no entry" is a weaker
    // refusal than "inside a subtree this grant explicitly does not cover".
    sourcePrefix: "~/.openclinxr-tools/mesh2motion-app/static/animations/",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-05-mesh2motion-clip-library-ledger-correction.json",
    requiredRecordPhrases: ["CC0", "LICENSE-CC0.MD"],
    excludedSubtrees: ["~/.openclinxr-tools/mesh2motion-app/static/animations/CarnegieMellonAnimations/"],
    decisions: { adoptedForBuild: true, shippedInRedistributedBytes: true, renderedInPublicMedia: true },
    notes:
      "Mesh2Motion human clip library. LICENSE-CC0.MD in the clone dedicates \"All 3d models, blend files, rigs, animations\" to CC0 1.0; LICENSE-MIT.MD covers the code and is a separate grant that says nothing about assets. The CarnegieMellonAnimations subtree beside those clips is excluded: its own readme.txt points at a third-party pack, so it is not the repository's work to dedicate.",
  },
];

/**
 * Does this licence text permit REDISTRIBUTING the raw file?
 *
 * Refusal is checked first and wins. A record that says both "free for commercial use" and "may not
 * be resold" is a refusal; reading the permissive half first is how a conditional grant becomes a
 * permissive label. Silence is `unknown`, never `clears` — the ledger's standing rule is that
 * unspecified is a refusal.
 */
export function classifyRedistributionRights(recordText: string): RedistributionVerdict {
  const refusals = [
    /may not be resold/i,
    /no redistribution/i,
    /non-?commercial/i,
    /\bCONDITIONAL\b/,
    /\bAGPL/i,
    /\bGPL-?[23]/i,
    /\bREFUSAL\b/,
    /\bREFUSED\b/,
  ];
  if (refusals.some((pattern) => pattern.test(recordText))) return "refuses";
  const permissive = [/\bCC0\b/, /\bCC-?0\b/, /CC[- ]BY/i, /public domain dedication/i];
  if (permissive.some((pattern) => pattern.test(recordText))) return "clears";
  return "unknown";
}


export type SubcomponentRights = "cc0" | "cc-by" | "first_party" | "operator_override" | "contradicted_upstream";

export type SubcomponentClearance = {
  /** Substring of the mesh name inside the shipped GLB. */
  meshMatch: string;
  component: string;
  /** Ledger-derived record, or the literal "first-party" for geometry this repository generates. */
  licenceRecordPath: string;
  requiredRecordPhrases: string[];
  rights: SubcomponentRights;
  /** Required, and non-empty, when `rights` is an operator override. Who decided, and when. */
  overrideAuthority?: string;
  /**
   * The credit the licence obliges us to carry, verbatim from the asset's own header or its ledger
   * row. REQUIRED, and non-empty, when `rights` is `cc-by` — a CC-BY component with no attribution
   * string is an obligation nobody can discharge, and `everyCcByComponentCarriesItsAttribution`
   * fails on it. Do not invent one: if the source names a preferred credit, that is the string.
   */
  attribution?: string;
  redistributable: boolean;
  /** False means a published RENDER of this component needs the block declared in the manifest. */
  publicRenderCleared: boolean;
};

/**
 * Rights for every mesh inside the four bodies this encounter selects.
 *
 * ONE ENTRY PER MESH FAMILY, and a mesh matching none of them is a refusal rather than a shrug —
 * "unknown subcomponent rights refuse" is one of the card's named counterweights and this is where
 * it bites. The table is keyed on the mesh names actually present in the shipped bytes, so adding a
 * garment to an actor without recording where it came from fails the audit rather than shipping.
 *
 * ROW-07 WAS RESOLVED BY THE OPERATOR ON 2026-09-10 and is no longer a contradiction. The upstream
 * tree carries a 2016 README asserting AGPL and a 2020 `LICENSE.md` asserting CC0; the ruling is
 * that the later canonical LICENSE.md supersedes the stale README, so hm08 is CC0 and its three
 * entries now carry `publicRenderCleared: true` with the ruling named in `overrideAuthority`.
 *
 * ROW-14's mhair02 still ships under its 2026-08-14 uuid-scoped override against its own AGPL3
 * header, and that override was EXTENDED TO PUBLIC RENDER on 2026-09-10. The header contradiction is
 * unchanged and is not being called resolved; what changed is the scope of the accepted assumption.
 *
 * ONE ENTRY IS STILL NOT CLEAN. `row-15`'s cargo pants ship under the 2026-08-24 index override
 * against a `.mhclo` carrying no licence line at all. It keeps `redistributable: true` because that
 * is the project's standing position for what ships, and keeps `publicRenderCleared: false` because
 * no ruling has reached it. Deleting that row would silence exactly the thing SC-04 exists to
 * surface, and the counterweight below derives its fixture from whatever is still blocked so it
 * cannot quietly go green as components clear.
 */
export const SUBCOMPONENT_CLEARANCE: readonly SubcomponentClearance[] = [
  {
    meshMatch: "_body",
    component: "hm08 MakeHuman base mesh",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-07-makehuman-base-mesh.json",
    requiredRecordPhrases: ["AGPL", "CC0"],
    rights: "operator_override",
    overrideAuthority:
      "operator ruling 2026-09-10 (patrick@simnova.com): the 2020 LICENSE.md SUPERSEDES the stale 2016 README. The upstream tree carries both; the later, canonical LICENSE.md governs, so hm08 is CC0 and the README assertion is dead text.",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_hm08_teeth",
    component: "hm08 teeth",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-07-makehuman-base-mesh.json",
    requiredRecordPhrases: ["AGPL", "CC0"],
    rights: "operator_override",
    overrideAuthority:
      "operator ruling 2026-09-10 (patrick@simnova.com): the 2020 LICENSE.md SUPERSEDES the stale 2016 README. The upstream tree carries both; the later, canonical LICENSE.md governs, so hm08 is CC0 and the README assertion is dead text.",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_hm08_tongue",
    component: "hm08 tongue",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-07-makehuman-base-mesh.json",
    requiredRecordPhrases: ["AGPL", "CC0"],
    rights: "operator_override",
    overrideAuthority:
      "operator ruling 2026-09-10 (patrick@simnova.com): the 2020 LICENSE.md SUPERSEDES the stale 2016 README. The upstream tree carries both; the later, canonical LICENSE.md governs, so hm08 is CC0 and the README assertion is dead text.",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_eyes_low_poly",
    component: "MakeHuman system-asset eyes",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-27-makehuman-system-asset-eyes-makehumansystemassets-pack-pack-.json",
    requiredRecordPhrases: ["CC0 1.0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_footwear_toigo_mj_cloth_shoes",
    component: "toigo MJ cloth shoes (shoes01)",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-22-makehuman-shoes01-pack-file-shoes01cc0-zip-83-mb-23-shoes-al.json",
    requiredRecordPhrases: ["CC0 1.0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    // FOUND 2026-09-10 by a BOM audit over the mesh names in all 19 shipped GLBs, not by reading the
    // table. It matched NO entry, so `assessSubcomponent` refused it `subcomponent-rights-unrecorded`
    // while the boots shipped on two bodies. The table was written for the four scene-closure cast
    // bodies and quietly did not cover the fleet.
    meshMatch: "makeclothes_library_footwear_culturalibre_male_boots",
    component: "culturalibre male boots (shoes01)",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-22-makehuman-shoes01-pack-file-shoes01cc0-zip-83-mb-23-shoes-al.json",
    requiredRecordPhrases: ["CC0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_hair_toigo",
    component: "toigo bob (hair01 CC0 subset)",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-13-makehuman-hair01-pack-page.json",
    requiredRecordPhrases: ["toigo_"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_hair_mhair02",
    component: "makehuman-community mhair02",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-14-makehuman-community-mhair02-clothes-page-uuid-f81a4e9a-e3d7-.json",
    requiredRecordPhrases: ["operator override this uuid only"],
    rights: "operator_override",
    overrideAuthority:
      "Operator, 2026-08-14, this uuid only: the community clothes page grants CC0 while the downloaded .mhclo header says AGPL3. EXTENDED TO PUBLIC RENDER by operator ruling 2026-09-10 (patrick@simnova.com): the same override now covers a published render, not shipping alone.",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_toigo_t_shirt",
    component: "toigo t-shirt (shirts01 CC0 subset)",
    licenceRecordPath: "docs/openclinxr/asset-licence-records/row-20-makehuman-shirts01-pack-file-shirts01cc0-zip.json",
    requiredRecordPhrases: ["CC0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_cargo_pants",
    component: "cortu cargo pants (pants01)",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-15-makehuman-pants01-pack-page-mirror-https-files2-makehumancom.json",
    requiredRecordPhrases: ["CC0 1.0 by the index"],
    rights: "operator_override",
    overrideAuthority: "Operator ruling, 2026-08-24: the pack index says CC0 while cargo_pants.mhclo carries no licence line; the index is the more permissive of the two and is used, owner contact pending.",
    redistributable: true,
    publicRenderCleared: false,
  },
  {
    meshMatch: "makeclothes_library_lab_coat",
    component: "makehuman-community crude lab coat",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-18-makehuman-community-crude-labcoat-female-clothes-page-uuid-b.json",
    requiredRecordPhrases: ["CC0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_scrub_shirt",
    component: "WojackOWL Scrub_Shirt",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-16-makehuman-community-scrub-shirt-scrubshirt-mhclo-author-woja.json",
    requiredRecordPhrases: ["CC-BY"],
    rights: "cc-by",
    attribution: "WojackOWL, Medical Scrubs Kit, CC-BY",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "makeclothes_library_scrub_pants",
    component: "WojackOWL Scrub_Pants",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-17-makehuman-community-scrub-pants-clothes-page-uuid-c0c024de-6.json",
    requiredRecordPhrases: ["CC-BY"],
    rights: "cc-by",
    attribution: "WojackOWL, Medical Scrubs Kit, CC-BY",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_fitted_eyebrow_mindfront",
    component: "Mindfront eyebrows01",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-09-makehuman-eyebrows01-pack-page-archive-eyebrows01cc0-zip.json",
    requiredRecordPhrases: ["CC0 1.0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_fitted_eyelash_mindfront",
    component: "Mindfront eyelashes01",
    licenceRecordPath:
      "docs/openclinxr/asset-licence-records/row-10-makehuman-eyelashes01-pack-page-archive-eyelashes01cc0-zip.json",
    requiredRecordPhrases: ["CC0 1.0"],
    rights: "cc0",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_declared_upper_layers_",
    component: "first-party procedural gown shell",
    licenceRecordPath: "first-party",
    requiredRecordPhrases: [],
    rights: "first_party",
    redistributable: true,
    publicRenderCleared: true,
  },
  {
    meshMatch: "openclinxr_real_garment_",
    component: "first-party procedural garment",
    licenceRecordPath: "first-party",
    requiredRecordPhrases: [],
    rights: "first_party",
    redistributable: true,
    publicRenderCleared: true,
  },
];

export type SubcomponentAssessment = {
  clearance: SubcomponentClearance | null;
  problems: Array<{ kind: LineageFinding["kind"]; detail: string }>;
};

/**
 * Everything decidable about one mesh inside a shipped body.
 *
 * Pure and exported for the same reason `assessClipSource` is: the counterweights drive the shipped
 * decision path rather than a copy of it. `declaredPublicRenderBlocks` is the set of record paths
 * the case manifest admits are blocking — a component whose render is not cleared and whose block is
 * not declared there is a finding, which is what stops an undeclared restriction going quiet.
 */
export function assessSubcomponent(input: {
  meshName: string;
  recordText: string | null;
  declaredPublicRenderBlocks: readonly string[];
  clearances?: readonly SubcomponentClearance[];
}): SubcomponentAssessment {
  const problems: SubcomponentAssessment["problems"] = [];
  const table = input.clearances ?? SUBCOMPONENT_CLEARANCE;
  const clearance = table.find((entry) => input.meshName.includes(entry.meshMatch));
  if (!clearance) {
    problems.push({
      kind: "subcomponent-rights-unrecorded",
      detail: `mesh ${input.meshName} matches no subcomponent clearance entry, so its rights are unknown. Unspecified is a refusal.`,
    });
    return { clearance: null, problems };
  }
  if (clearance.licenceRecordPath !== "first-party") {
    if (input.recordText === null) {
      problems.push({
        kind: "clip-licence-record-absent",
        detail: `${clearance.licenceRecordPath} does not exist, so ${clearance.component} rests on a citation to nothing.`,
      });
    } else {
      // The enclosing branch has already established that recordText is present; bound to a const
      // so the narrowing survives into the closure rather than being asserted away.
      const recordText = input.recordText ?? "";
      const missing = clearance.requiredRecordPhrases.find((phrase) => !recordText.includes(phrase));
      if (missing !== undefined) {
        problems.push({
          kind: "licence-record-text-does-not-match-citation",
          detail: `${clearance.licenceRecordPath} no longer contains the cited phrase ${JSON.stringify(missing)} for ${clearance.component}.`,
        });
      }
    }
  }
  if (clearance.rights === "operator_override" && !clearance.overrideAuthority?.trim()) {
    problems.push({
      kind: "subcomponent-override-without-named-authority",
      detail: `${clearance.component} ships under an override with no authority named. An override nobody signed is indistinguishable from a guess.`,
    });
  }
  if (clearance.redistributable !== true) {
    problems.push({
      kind: "subcomponent-refuses-redistribution",
      detail: `${clearance.component} is inside bytes any browser can download, and ${clearance.licenceRecordPath} does not permit redistributing the raw file.`,
    });
  }
  if (clearance.publicRenderCleared !== true && !input.declaredPublicRenderBlocks.includes(clearance.licenceRecordPath)) {
    problems.push({
      kind: "public-render-block-not-declared",
      detail: `${clearance.component} is not cleared for public render and its block is not declared in SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.blockedBy. An undeclared restriction is one a website gate will not see.`,
    });
  }
  return { clearance, problems };
}

export type LineageFinding = {
  kind:
    | "provenance-record-absent"
    | "recorded-hash-does-not-match-bytes"
    | "recorded-bytes-do-not-match-bytes"
    | "clip-has-no-provenance-entry"
    | "clip-licence-record-absent"
    | "clip-source-not-covered-by-any-clearance"
    | "clip-source-inside-excluded-subtree"
    | "clip-rights-refuse-redistribution"
    | "clip-rights-unknown"
    | "licence-record-text-does-not-match-citation"
    | "subcomponent-rights-unrecorded"
    | "subcomponent-refuses-redistribution"
    | "subcomponent-override-without-named-authority"
    | "public-render-block-not-declared";
  actorId: string;
  assetPath: string;
  detail: string;
};

export type SelectedAssetLineage = {
  actorId: string;
  role: string;
  assetPath: string;
  runtimeAssetPath: string;
  provenanceManifestPath: string;
  sha256: string;
  bytes: number;
  recordedSha256: string | null;
  recordedBytes: number | null;
  clips: Array<{ clipName: string; sourceClip: string | null; licenceRecordPath: string | null; verdict: RedistributionVerdict | null }>;
  subcomponents: Array<{ meshName: string; component: string | null; licenceRecordPath: string | null; rights: SubcomponentRights | null }>;
};

export type SelectedSceneAssetLineageAudit = {
  schemaVersion: "openclinxr.selected-scene-asset-lineage.v1";
  generatedAt: string;
  caseId: string;
  selected: SelectedAssetLineage[];
  findings: LineageFinding[];
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function clearanceFor(
  sourcePath: string,
  clearances: readonly ClipClearance[] = SELECTED_CASE_CLIP_CLEARANCE,
): ClipClearance | undefined {
  return clearances.find((entry) => sourcePath.startsWith(entry.sourcePrefix));
}

export type ClipSourceAssessment = {
  verdict: RedistributionVerdict | null;
  problems: Array<{ kind: LineageFinding["kind"]; detail: string }>;
};

/**
 * Everything decidable about one shipped clip from its source path and its licence record's TEXT.
 *
 * Pure and exported so the counterweights can drive it with a fabricated record: the audit below
 * calls exactly this, so a test that proves an exclusion or a rewritten citation is refused is
 * proving the shipped decision path, not a parallel copy of it.
 */
export function assessClipSource(input: {
  clipName: string;
  sourceClip: string | null;
  /** The licence record's raw text, or null when the cited record does not exist. */
  recordText: string | null;
  clearances?: readonly ClipClearance[];
}): ClipSourceAssessment {
  const problems: ClipSourceAssessment["problems"] = [];
  const { clipName, sourceClip, recordText } = input;
  const clearance = sourceClip ? clearanceFor(sourceClip, input.clearances) : undefined;
  if (!sourceClip || !clearance) {
    problems.push({
      kind: "clip-source-not-covered-by-any-clearance",
      detail: `clip ${clipName} names source ${String(sourceClip)}, which matches no clearance entry.`,
    });
    return { verdict: null, problems };
  }
  const excluded = clearance.excludedSubtrees.find((prefix) => sourceClip.startsWith(prefix));
  if (excluded) {
    problems.push({
      kind: "clip-source-inside-excluded-subtree",
      detail: `clip ${clipName} comes from ${sourceClip}, inside ${excluded}, which the ${clearance.licenceRecordPath} grant explicitly does not cover.`,
    });
  }
  if (recordText === null) {
    problems.push({
      kind: "clip-licence-record-absent",
      detail: `${clearance.licenceRecordPath} does not exist, so clip ${clipName} rests on a citation to nothing.`,
    });
    return { verdict: null, problems };
  }
  const missingPhrase = clearance.requiredRecordPhrases.find((phrase) => !recordText.includes(phrase));
  if (missingPhrase !== undefined) {
    problems.push({
      kind: "licence-record-text-does-not-match-citation",
      detail: `${clearance.licenceRecordPath} no longer contains the cited phrase ${JSON.stringify(missingPhrase)}; the clearance is citing text that is not there.`,
    });
  }
  const verdict = classifyRedistributionRights(recordText);
  if (verdict === "refuses") {
    problems.push({
      kind: "clip-rights-refuse-redistribution",
      detail: `clip ${clipName} ships inside publicly fetchable bytes, but ${clearance.licenceRecordPath} refuses redistribution of the raw data. ${clearance.notes}`,
    });
  } else if (verdict === "unknown") {
    problems.push({
      kind: "clip-rights-unknown",
      detail: `clip ${clipName} rests on ${clearance.licenceRecordPath}, which states no redistribution grant this audit recognises. Unspecified is a refusal.`,
    });
  } else if (clearance.decisions.shippedInRedistributedBytes !== true) {
    problems.push({
      kind: "clip-rights-refuse-redistribution",
      detail: `clip ${clipName} is shipped, but its clearance entry records shippedInRedistributedBytes: false.`,
    });
  }
  return { verdict, problems };
}

export async function auditSelectedSceneAssetLineage(options?: {
  repoRoot?: string;
}): Promise<SelectedSceneAssetLineageAudit> {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const cast = resolveScenarioActorCast(SCENE_CLOSURE_CASE_ID, sceneClosureCaseDocument() as never);
  const findings: LineageFinding[] = [];
  const selected: SelectedAssetLineage[] = [];
  const io = new NodeIO();

  for (const entry of cast) {
    const assetAbsolute = path.join(repoRoot, entry.assetPath);
    const bytes = await readFile(assetAbsolute);
    const digest = sha256(bytes);
    const provenanceAbsolute = path.join(repoRoot, entry.provenanceManifestPath);

    let recordedSha256: string | null = null;
    let recordedBytes: number | null = null;
    let motionClips: Array<Record<string, unknown>> = [];
    if (!existsSync(provenanceAbsolute)) {
      findings.push({
        kind: "provenance-record-absent",
        actorId: entry.actorId,
        assetPath: entry.assetPath,
        detail: `${entry.provenanceManifestPath} does not exist, so the shipped bytes have no recorded origin, licence chain or claim scope at all.`,
      });
    } else {
      const record = JSON.parse(await readFile(provenanceAbsolute, "utf8")) as Record<string, unknown>;
      recordedSha256 = typeof record["outputSha256"] === "string" ? record["outputSha256"] : null;
      recordedBytes = typeof record["outputBytes"] === "number" ? record["outputBytes"] : null;
      motionClips = Array.isArray(record["motionClips"]) ? (record["motionClips"] as Array<Record<string, unknown>>) : [];
      if (recordedSha256 === null) {
        findings.push({
          kind: "recorded-hash-does-not-match-bytes",
          actorId: entry.actorId,
          assetPath: entry.assetPath,
          detail: `${entry.provenanceManifestPath} records no outputSha256; the shipped bytes are unpinned.`,
        });
      } else if (recordedSha256 !== digest) {
        findings.push({
          kind: "recorded-hash-does-not-match-bytes",
          actorId: entry.actorId,
          assetPath: entry.assetPath,
          detail: `provenance records ${recordedSha256} but the shipped file hashes ${digest}.`,
        });
      }
      if (recordedBytes !== null && recordedBytes !== bytes.byteLength) {
        findings.push({
          kind: "recorded-bytes-do-not-match-bytes",
          actorId: entry.actorId,
          assetPath: entry.assetPath,
          detail: `provenance records ${recordedBytes} bytes but the shipped file is ${bytes.byteLength} bytes.`,
        });
      }
    }

    const document = await io.read(assetAbsolute);
    const clips: SelectedAssetLineage["clips"] = [];
    for (const animation of document.getRoot().listAnimations()) {
      const clipName = animation.getName();
      // Procedurally authored clips carry no third-party source; only RETARGETED clips do, and the
      // provenance record's own naming is what separates them.
      const isRetargeted = clipName.startsWith("openclinxr_retarget_");
      const recorded = motionClips.find((clip) => clip["clipName"] === clipName);
      if (!isRetargeted && !recorded) {
        clips.push({ clipName, sourceClip: null, licenceRecordPath: null, verdict: null });
        continue;
      }
      if (!recorded) {
        findings.push({
          kind: "clip-has-no-provenance-entry",
          actorId: entry.actorId,
          assetPath: entry.assetPath,
          detail: `the shipped GLB carries retargeted clip ${clipName} with no motionClips entry naming where it came from.`,
        });
        clips.push({ clipName, sourceClip: null, licenceRecordPath: null, verdict: null });
        continue;
      }
      const sourceClip = typeof recorded["sourceClip"] === "string" ? recorded["sourceClip"] : null;
      const licenceRecordPath = typeof recorded["licenceRow"] === "string" ? recorded["licenceRow"] : null;
      const clearance = sourceClip ? clearanceFor(sourceClip) : undefined;
      const recordAbsolute = clearance ? path.join(repoRoot, clearance.licenceRecordPath) : null;
      const recordText =
        recordAbsolute && existsSync(recordAbsolute) ? await readFile(recordAbsolute, "utf8") : null;
      const assessment = assessClipSource({ clipName, sourceClip, recordText });
      for (const problem of assessment.problems) {
        findings.push({ kind: problem.kind, actorId: entry.actorId, assetPath: entry.assetPath, detail: problem.detail });
      }
      const verdict = assessment.verdict;

      if (licenceRecordPath !== null && clearance && licenceRecordPath !== clearance.licenceRecordPath) {
        findings.push({
          kind: "clip-licence-record-absent",
          actorId: entry.actorId,
          assetPath: entry.assetPath,
          detail: `clip ${clipName} cites ${licenceRecordPath} but its source resolves to the clearance backed by ${clearance.licenceRecordPath}.`,
        });
      }
      clips.push({ clipName, sourceClip, licenceRecordPath, verdict });
    }

    const declaredBlocks = SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.blockedBy.map(
      (block) => block.record,
    );
    const subcomponents: SelectedAssetLineage["subcomponents"] = [];
    const recordTextCache = new Map<string, string | null>();
    for (const mesh of document.getRoot().listMeshes()) {
      const meshName = mesh.getName();
      const candidate = SUBCOMPONENT_CLEARANCE.find((clearance) => meshName.includes(clearance.meshMatch));
      let recordText: string | null = null;
      if (candidate && candidate.licenceRecordPath !== "first-party") {
        if (!recordTextCache.has(candidate.licenceRecordPath)) {
          const absolute = path.join(repoRoot, candidate.licenceRecordPath);
          recordTextCache.set(
            candidate.licenceRecordPath,
            existsSync(absolute) ? await readFile(absolute, "utf8") : null,
          );
        }
        recordText = recordTextCache.get(candidate.licenceRecordPath) ?? null;
      }
      const assessment = assessSubcomponent({ meshName, recordText, declaredPublicRenderBlocks: declaredBlocks });
      for (const problem of assessment.problems) {
        findings.push({ kind: problem.kind, actorId: entry.actorId, assetPath: entry.assetPath, detail: problem.detail });
      }
      subcomponents.push({
        meshName,
        component: assessment.clearance?.component ?? null,
        licenceRecordPath: assessment.clearance?.licenceRecordPath ?? null,
        rights: assessment.clearance?.rights ?? null,
      });
    }

    selected.push({
      actorId: entry.actorId,
      role: entry.role,
      assetPath: entry.assetPath,
      runtimeAssetPath: entry.runtimeAssetPath,
      provenanceManifestPath: entry.provenanceManifestPath,
      sha256: digest,
      bytes: bytes.byteLength,
      recordedSha256,
      recordedBytes,
      clips,
      subcomponents,
    });
  }

  return {
    schemaVersion: "openclinxr.selected-scene-asset-lineage.v1",
    generatedAt: new Date().toISOString(),
    caseId: SCENE_CLOSURE_CASE_ID,
    selected,
    findings,
  };
}
