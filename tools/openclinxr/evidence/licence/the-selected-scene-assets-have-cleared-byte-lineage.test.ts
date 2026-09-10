import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENE_CLOSURE_SELECTED_ASSET_MANIFEST } from "../../factory/scene-closure-case-source.js";
import {
  assessClipSource,
  assessSubcomponent,
  auditSelectedSceneAssetLineage,
  type ClipClearance,
  classifyRedistributionRights,
  clearanceFor,
  SELECTED_CASE_CLIP_CLEARANCE,
  SUBCOMPONENT_CLEARANCE,
} from "./selected-scene-asset-lineage.js";

/**
 * SC-04 / A06: the assets this encounter actually selects must have auditable byte lineage and
 * rights compatible with a product that REDISTRIBUTES its raw GLB files.
 *
 * THE BASELINE THIS FAILED ON, measured 2026-09-09 against the unchanged tree at 1da9ce04, before
 * any asset, ledger or case-source edit:
 *
 *   recorded-hash-does-not-match-bytes  daughter_lena_ellis_v1   981e7ac4… recorded / 8f7ad8ac… on disk
 *   recorded-bytes-do-not-match-bytes   daughter_lena_ellis_v1   8 618 824 recorded / 8 411 080 on disk
 *   provenance-record-absent            patient_margaret_ellis_v1  mpfb-gown-adult-patient.provenance.json
 *   clip-rights-refuse-redistribution   senior_resident_ward_v1   openclinxr_retarget_cmu_02_01_walk
 *   recorded-hash-does-not-match-bytes  ward_nurse_patel_v1      8c8547ff… recorded / bc5b9009… on disk
 *   recorded-bytes-do-not-match-bytes   ward_nurse_patel_v1      21 563 000 recorded / 11 112 092 on disk
 *
 * Six findings across all four selected actors. The physician's own sidecar MATCHED its bytes — the
 * card's known-good says so and it is true — which is exactly why a RED that fails on the physician
 * alone would be measuring the wrong thing. What the physician fails is the RIGHTS half: it ships a
 * clip derived from CMU Graphics Lab mocap, whose ledger row is CONDITIONAL and says the data "may
 * not be resold ... even in converted form", inside a file any browser can download.
 *
 * The two hash mismatches have one cause, found by reading the history rather than the bytes:
 * `separate_chest_anchor_joints.mjs` rewrote twelve shipped rigs at 91b12607 and 3d019031 and its
 * per-actor reports under `tools/openclinxr/evidence/chest-anchor-joints/` record the operation but
 * no output hash, so every sidecar it touched still names the pre-stage bytes. The physician's
 * sidecar matches only because a LATER tool — `graft-bound-clip.ts --publish` — rewrote
 * `outputSha256` from the bytes it had just produced.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");

/** The exact CMU wording, from `row-08-cmu-graphics-lab-mocap.json`. Both halves are present. */
const CMU_RECORD_TEXT =
  "**CONDITIONAL — not CC0/CC-BY.** Free for research and commercial products, but the data "
  + "**may not be resold even converted**; NSF EIA-0196217 acknowledgement requested.";

/** The Mesh2Motion wording, from `row-05-mesh2motion-clip-library-ledger-correction.json`. */
const MESH2MOTION_RECORD_TEXT =
  "**CC0 — VERIFIED.** The local clone at `~/.openclinxr-tools/mesh2motion-app` carries BOTH "
  + "`LICENSE-MIT.MD` (code) and `LICENSE-CC0.MD` (\"All 3d models, blend files, rigs, animations\").";

describe("the selected scene assets have cleared byte lineage", () => {
  it("SC-04-required-behavior", async () => {
    const audit = await auditSelectedSceneAssetLineage({ repoRoot: REPO });

    // The set under audit is RESOLVED by the production cast owner. If this ever reads as an empty
    // or single-entry list the assertion below would be green about almost nothing.
    expect(audit.selected.map((entry) => entry.actorId).sort()).toEqual([
      "daughter_lena_ellis_v1",
      "patient_margaret_ellis_v1",
      "senior_resident_ward_v1",
      "ward_nurse_patel_v1",
    ]);

    // Every selected asset's shipped bytes are pinned by a record that names THOSE bytes.
    for (const entry of audit.selected) {
      expect(entry.recordedSha256, `${entry.actorId} provenance hash`).toBe(entry.sha256);
      expect(entry.recordedBytes, `${entry.actorId} provenance byte count`).toBe(entry.bytes);
    }

    // Every retargeted clip inside those bytes clears for redistribution.
    const retargeted = audit.selected.flatMap((entry) =>
      entry.clips.filter((clip) => clip.clipName.startsWith("openclinxr_retarget_")).map((clip) => ({ actorId: entry.actorId, ...clip })),
    );
    expect(retargeted.length, "the encounter ships at least one retargeted clip").toBeGreaterThan(0);
    for (const clip of retargeted) {
      expect(clip.verdict, `${clip.actorId} ${clip.clipName} redistribution rights`).toBe("clears");
    }
    // The CMU-derived walk is gone from the shipped bytes, by name.
    expect(retargeted.map((clip) => clip.clipName)).not.toContain("openclinxr_retarget_cmu_02_01_walk");

    // Every mesh inside those bytes resolves to a recorded grant, and nothing is unmatched.
    for (const entry of audit.selected) {
      expect(entry.subcomponents.length, `${entry.actorId} subcomponent count`).toBeGreaterThan(5);
      for (const subcomponent of entry.subcomponents) {
        expect(subcomponent.rights, `${entry.actorId} ${subcomponent.meshName} rights`).not.toBeNull();
      }
    }

    expect(
      audit.findings.map((finding) => `${finding.kind}: ${finding.actorId}: ${finding.detail}`),
      "unresolved lineage or rights findings",
    ).toEqual([]);
  });

  it("COUNTERWEIGHT: a mesh whose rights nobody recorded is refused, not shrugged at", () => {
    const unknown = assessSubcomponent({
      meshName: "makeclothes_library_mystery_poncho_mpfb_someone_mesh",
      recordText: null,
      declaredPublicRenderBlocks: [],
    });
    expect(unknown.clearance).toBeNull();
    expect(unknown.problems.map((problem) => problem.kind)).toEqual(["subcomponent-rights-unrecorded"]);
  });

  it("COUNTERWEIGHT: an operator override with no authority named is refused", () => {
    const unsigned = assessSubcomponent({
      meshName: "vendor_override_mesh",
      recordText: "CC0 on the page.",
      declaredPublicRenderBlocks: ["docs/openclinxr/asset-licence-records/row-99.json"],
      clearances: [
        {
          meshMatch: "vendor_override_mesh",
          component: "fixture",
          licenceRecordPath: "docs/openclinxr/asset-licence-records/row-99.json",
          requiredRecordPhrases: [],
          rights: "operator_override",
          redistributable: true,
          publicRenderCleared: false,
        },
      ],
    });
    expect(unsigned.problems.map((problem) => problem.kind)).toContain(
      "subcomponent-override-without-named-authority",
    );

    // Every override actually in the shipped table names its authority, so the rule is live.
    for (const clearance of SUBCOMPONENT_CLEARANCE) {
      if (clearance.rights !== "operator_override") continue;
      expect(clearance.overrideAuthority?.trim(), `${clearance.component} override authority`).toBeTruthy();
    }
  });

  it("COUNTERWEIGHT: a subcomponent not cleared for public render must be DECLARED, not silently carried", () => {
    // Undeclared: a finding. This is the clause that caught the cargo pants index-override, which
    // was shipping on the selected family member with no entry in the manifest at all.
    // DERIVED, NOT NAMED. This fixture was pinned to a component twice and went green about nothing
    // both times, because the operator cleared the component it named — first hm08, then mhair02 on
    // 2026-09-10. Naming a component makes the clause decay every time the licence position improves.
    // It now takes whatever is STILL blocked, and refuses to pass silently when nothing is.
    const stillBlocked = SUBCOMPONENT_CLEARANCE.filter((entry) => !entry.publicRenderCleared);
    expect(
      stillBlocked.length,
      "no subcomponent is blocked for public render, so this counterweight has nothing to exercise. "
        + "That may be good news, but it must not read as a pass: replace this clause with an inverted "
        + "guard recording that every selected subcomponent is render-cleared, and say who cleared the last one.",
    ).toBeGreaterThan(0);
    const subject = stillBlocked[0]!;

    const undeclared = assessSubcomponent({
      meshName: `${subject.meshMatch}_fixture_mesh`,
      recordText: subject.requiredRecordPhrases.join(" "),
      declaredPublicRenderBlocks: [],
    });
    expect(undeclared.problems.map((problem) => problem.kind)).toContain("public-render-block-not-declared");

    // Declared: no finding. Same component, same unresolved rights — only the declaration differs.
    const declared = assessSubcomponent({
      meshName: `${subject.meshMatch}_fixture_mesh`,
      recordText: subject.requiredRecordPhrases.join(" "),
      declaredPublicRenderBlocks: [subject.licenceRecordPath],
    });
    expect(declared.problems).toEqual([]);

    // And the manifest's public-render decision is BLOCKED with named reasons, so no downstream gate
    // can read a publication permission out of the fact that these assets ship.
    expect(SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.decision).toBe(
      "blocked_pending_named_upstream_resolution",
    );
    // 3 -> 2 on 2026-09-10: hm08 was RESOLVED, not waived. The guard that matters is the one below —
    // every remaining block carries a real reason and a real unblock path — not the count itself.
    expect(SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.blockedBy.length).toBe(stillBlocked.length);
    for (const block of SCENE_CLOSURE_SELECTED_ASSET_MANIFEST.publicRender.blockedBy) {
      expect(block.why.length, `${block.subcomponent} reason`).toBeGreaterThan(40);
      expect(block.unblockedBy.length, `${block.subcomponent} unblock path`).toBeGreaterThan(20);
    }
  });

  it("COUNTERWEIGHT: a commercial-use permission carrying a resale restriction does not become a permissive label", () => {
    // Both halves are in the same sentence and refusal wins. Reading the permissive half first is
    // exactly how a conditional grant gets relabelled.
    expect(classifyRedistributionRights(CMU_RECORD_TEXT)).toBe("refuses");
    expect(classifyRedistributionRights(MESH2MOTION_RECORD_TEXT)).toBe("clears");
    // Silence is not consent. The ledger's standing rule is that unspecified is a refusal.
    expect(classifyRedistributionRights("Hospital bed model, 3,988 tris, downloaded 2026-08-24.")).toBe("unknown");
    // And a permissive word inside an otherwise refusing record still refuses.
    expect(classifyRedistributionRights("CC0 on the pack page; the file header says AGPL3.")).toBe("refuses");
  });

  it("COUNTERWEIGHT: an MIT/CC0 repository grants no blanket clearance to a subtree it did not author", async () => {
    const mesh2motion = SELECTED_CASE_CLIP_CLEARANCE.find((entry) =>
      entry.sourcePrefix.includes("mesh2motion-app"),
    );
    expect(mesh2motion, "the Mesh2Motion clearance entry").toBeDefined();
    expect(mesh2motion!.excludedSubtrees).toContain(
      "~/.openclinxr-tools/mesh2motion-app/static/animations/CarnegieMellonAnimations/",
    );

    // A clip taken from that directory is refused THROUGH THE SHIPPED DECISION PATH, even though its
    // parent repository's own LICENSE-CC0.MD reads as a blanket dedication and the record text below
    // is the permissive one.
    const laundered = assessClipSource({
      clipName: "openclinxr_retarget_91_48_cc0",
      sourceClip: "~/.openclinxr-tools/mesh2motion-app/static/animations/CarnegieMellonAnimations/91_48.fbx",
      recordText: MESH2MOTION_RECORD_TEXT,
    });
    expect(laundered.problems.map((problem) => problem.kind)).toContain("clip-source-inside-excluded-subtree");

    // The control that proves the exclusion is doing the work: the SAME record clears a clip from
    // the covered part of the same repository.
    const covered = assessClipSource({
      clipName: "openclinxr_retarget_walk_formal_cc0",
      sourceClip: "~/.openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb#Walk_Formal",
      recordText: MESH2MOTION_RECORD_TEXT,
    });
    expect(covered.problems).toEqual([]);
    expect(covered.verdict).toBe("clears");
  });

  it("COUNTERWEIGHT: provenance that was only rewritten stops matching its own citation", async () => {
    const mesh2motion = clearanceFor(
      "~/.openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb#Walk_Formal",
    );
    expect(mesh2motion).toBeDefined();
    // A record edited to read permissively while dropping the phrase the clearance cites.
    const rewritten = assessClipSource({
      clipName: "openclinxr_retarget_walk_formal_cc0",
      sourceClip: "~/.openclinxr-tools/mesh2motion-app/static/animations/human-base-animations.glb#Walk_Formal",
      recordText: "CC0, obviously. Trust me.",
    });
    expect(rewritten.problems.map((problem) => problem.kind)).toContain(
      "licence-record-text-does-not-match-citation",
    );

    // And the cited phrases are actually present in the records on disk, so the citation is live
    // rather than a comment.
    for (const clearance of SELECTED_CASE_CLIP_CLEARANCE) {
      const text = await readFile(path.join(REPO, clearance.licenceRecordPath), "utf8");
      for (const phrase of clearance.requiredRecordPhrases) {
        expect(text, `${clearance.licenceRecordPath} must contain ${phrase}`).toContain(phrase);
      }
    }
  });

  it("COUNTERWEIGHT: a substituted source is refused rather than inheriting the neighbouring clearance", () => {
    // Another demo's cleared source path does not transfer: the prefix must match, and an unknown
    // source is a refusal with no verdict at all rather than a silent pass.
    const substituted = assessClipSource({
      clipName: "openclinxr_retarget_mixamo_walk",
      sourceClip: "~/Downloads/mixamo/Walking.fbx",
      recordText: MESH2MOTION_RECORD_TEXT,
    });
    expect(substituted.verdict).toBeNull();
    expect(substituted.problems.map((problem) => problem.kind)).toEqual([
      "clip-source-not-covered-by-any-clearance",
    ]);
  });

  it("KNOWN GOOD: an exact cleared, unchanged asset passes without being rewritten", () => {
    // A rule that fails everything is not a gate. A clip from a covered source, whose record carries
    // the cited phrases and whose clearance records it as shippable, produces no problem at all —
    // and nothing about it had to be regenerated to get there.
    const clearances: readonly ClipClearance[] = [
      {
        sourcePrefix: "vendor/cleared/",
        licenceRecordPath: "docs/openclinxr/asset-licence-records/row-05-mesh2motion-clip-library-ledger-correction.json",
        requiredRecordPhrases: ["CC0"],
        excludedSubtrees: [],
        decisions: { adoptedForBuild: true, shippedInRedistributedBytes: true, renderedInPublicMedia: true },
        notes: "fixture",
      },
    ];
    const unchanged = assessClipSource({
      clipName: "openclinxr_retarget_unchanged",
      sourceClip: "vendor/cleared/clip.glb",
      recordText: MESH2MOTION_RECORD_TEXT,
      clearances,
    });
    expect(unchanged.problems).toEqual([]);
    expect(unchanged.verdict).toBe("clears");
  });

  it("COUNTERWEIGHT: adopted, shipped and publicly rendered are three decisions, not one", () => {
    // The CMU entry is adopted for build-time retarget and refused for the other two. Collapsing
    // them is how "we may use this" becomes "we may publish this".
    const cmu = SELECTED_CASE_CLIP_CLEARANCE.find((entry) => entry.sourcePrefix.includes("cmu_"));
    expect(cmu, "the CMU clearance entry is kept rather than deleted, so a rebuild is refused by name").toBeDefined();
    expect(cmu!.decisions).toEqual({
      adoptedForBuild: true,
      shippedInRedistributedBytes: false,
      renderedInPublicMedia: false,
    });

    // A source whose record reads permissively but whose SHIPPED decision is false is still refused.
    const buildTimeOnly = assessClipSource({
      clipName: "openclinxr_retarget_build_time_only",
      sourceClip: "vendor/buildtime/clip.glb",
      recordText: MESH2MOTION_RECORD_TEXT,
      clearances: [
        {
          sourcePrefix: "vendor/buildtime/",
          licenceRecordPath: "docs/openclinxr/asset-licence-records/row-05-mesh2motion-clip-library-ledger-correction.json",
          requiredRecordPhrases: ["CC0"],
          excludedSubtrees: [],
          decisions: { adoptedForBuild: true, shippedInRedistributedBytes: false, renderedInPublicMedia: false },
          notes: "fixture",
        },
      ],
    });
    expect(buildTimeOnly.problems.map((problem) => problem.kind)).toContain("clip-rights-refuse-redistribution");
  });
});
