/**
 * Mouth executor entry tests (MADR 0061 mouth executor).
 *
 * Fast clauses pin the problem/solution handshake; the slow clause proves the
 * moved seat reproduces the committed seating bytes (the receipt's
 * garmentProvenanceStamp.inputArchiveSha256, historical 5cab) through the new
 * entry, then replays the NORMAL garment stamp CLI on those bytes and proves
 * the output is the current stamped consumer file (receipt outputSha256,
 * 53d6). History is archived, not discarded: the 5cab oracle is asserted
 * against the receipt's own inputArchive field, never blind-reset, and the
 * 53d oracle is produced by the actual normal producer, never fabricated.
 * The stamp repacks the BIN (accessor reindex), so byte-identity is claimed
 * ONLY for the two CLI endpoints, not for intermediate layouts; geometry
 * equivalence (usage-mapped 102 base + 776 morph, all materials/images/
 * skins/anims/nodes/extensions, exactly 3 garment mesh.extras) is proven in
 * the worker lane (proofs/semantic-baseline.json + 3 tamper FAIL controls).
 * Optional mouthPhysicalCorrection post-stage (53d -> 2e256 via the normal
 * Main CLI seat-teeth-ff1-open08.ts): when the receipt carries it, its input
 * must equal the stamp output, the tool file hash must match, and the CLI is
 * re-run on the stamped temp bytes to prove the new output + top receipt
 * outputSha256. Old receipts without the stage still replay the stamp-only
 * path; a 2e256 top without the stage must not replay. Optional albedoRepair
 * post-stage (2e256 -> 86b0 via the normal producer bake-humanoid-albedo.ts
 * bakeGlbAlbedo): when the receipt carries it, its input must equal the
 * previous replay bytes, the producer + helper file hashes must match, and
 * the actual baker CLI is re-run on temp bytes to prove the new output +
 * top receipt outputSha256. The final top-equality checks run only after
 * every recorded post-stage, so old stamp-only/physical-only receipts keep
 * their strict final-top linkage and unrecorded extra finishes still fail.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Solution } from "@openclinxr/station-mouth-objective";
import { apply } from "./apply.js";
import { buildProblem } from "./problem.js";
import { loadProducerPreimage, readProducerReceipt } from "./producer-preimage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const GLB_REL = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb";
const RECEIPT_REL = `${GLB_REL.slice(0, -".glb".length)}.provenance.json`;

// Transitional direct-apply identity: the registry card replaces it with the
// pinned solver id/version. The verifier re-run catches unpinned output (d7).
const DIRECT_SOLVER_ID = "mouth-direct-apply";
const DIRECT_SOLVER_VERSION = "0.0.0";

// Immutable 5cab input archive: 40,345,712 B, sha256 5cab6676... (worker-lane
// proofs/inputs-evidence.txt). Asserted via the receipt's own inputArchive
// field below, never blind-reset.
const HISTORICAL_SEATING_BYTES = 40345712;

// Legitimate lineage rows (receipt garmentProvenanceStamp.changes, verified by
// the stamp worker against the actual cached .mhclo library + ledger).
const LEGITIMATE_ROWS: Array<[string, string]> = [
  ["female_tight_jeans", "punkduck_female_tight_jeans.mhclo"],
  ["footwear_toigo", "toigo_mj_cloth_shoes.mhclo"],
  ["toigo_t_shirt", "toigo_t_shirt.mhclo"],
];

// Exact known Main physical-correction tool path (normal Main CLI). Its hash
// is asserted via the receipt's own mouthPhysicalCorrection.toolSha256 below,
// never blind-reset.
const PHYS_TOOL = "tools/openclinxr/mouth-solver/seat-teeth-ff1-open08.ts";

// Exact known texture-grade tool path (ci-w11 D2 grade-tara-oversize-textures.py)
// + its committed graded-tightjeans input. Hashes asserted via the receipt's
// own textureGrade.toolSha256 / gradedTightjeansSha256 below, never blind-reset.
const GRADE_TOOL = "tools/openclinxr/evidence/humanoid-vetting/grade-tara-oversize-textures.py";

// Exact known chest-anchor tool path (ci-w11 D3 separate_chest_anchor_joints.mjs).
// Hash asserted via the receipt's own chestAnchorReseparation.toolSha256 below.
const CHEST_TOOL = "tools/openclinxr/asset-pipeline/anny/separate_chest_anchor_joints.mjs";

// Exact known orphan-prune tool + version + flags (ci-w11 D1 gltf-transform prune,
// same flags as #555). Version asserted via the receipt's own orphanPrune.toolVersion.
const PRUNE_FLAGS = ["--keep-attributes", "true", "--keep-indices", "true"] as const;
// bake-humanoid-albedo.ts bakeGlbAlbedo). Hashes are asserted via the
// receipt's own albedoRepair.producerSha256 / helperSha256 below, never
// blind-reset.
const ALBEDO_TOOL = "tools/openclinxr/asset-pipeline/trellis/bake-humanoid-albedo.ts";
const ALBEDO_HELPERS = [
  "tools/openclinxr/asset-pipeline/trellis/albedo-linear/colour-transfer.ts",
  "tools/openclinxr/asset-pipeline/trellis/albedo-linear/image-clone.ts",
] as const;

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function directSolution(inputHash: string): Solution {
  return { solverId: DIRECT_SOLVER_ID, solverVersion: DIRECT_SOLVER_VERSION, inputHash, frames: [] };
}

describe("mouth executor", () => {
  it("buildProblem hashes the input bytes and pins the step3 clock", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const problem = buildProblem(bytes, { targetGapMm: 3.743 });
    expect(problem.inputHash).toBe(sha256(bytes));
    expect(problem.trackId).toBe("step3-fixed-capture");
    expect(problem.frameRate).toBe(30);
    expect(problem.frameCount).toBe(124);
  });

  it("buildProblem refuses a non-positive target", () => {
    expect(() => buildProblem(new Uint8Array([1]), { targetGapMm: 0 })).toThrow();
    expect(() => buildProblem(new Uint8Array([1]), { targetGapMm: Number.NaN })).toThrow();
  });

  it("apply refuses a solution hash that does not match the input bytes", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    await expect(
      apply(bytes, directSolution("nope"), {
        targetGapMm: 3.743,
        solverId: DIRECT_SOLVER_ID,
        solverVersion: DIRECT_SOLVER_VERSION,
      }),
    ).rejects.toThrow(/inputHash/);
  });

  it("apply refuses provenance that does not name the solution solver", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const problem = buildProblem(bytes, { targetGapMm: 3.743 });
    await expect(
      apply(bytes, directSolution(problem.inputHash), {
        targetGapMm: 3.743,
        solverId: "other",
        solverVersion: DIRECT_SOLVER_VERSION,
      }),
    ).rejects.toThrow(/provenance/);
  });

  it("apply through the new entry reproduces the seating bytes; normal stamp replay matches the consumer file", async () => {
    const pre = readProducerReceipt(REPO, RECEIPT_REL) as ReturnType<typeof readProducerReceipt> & {
      garmentProvenanceStamp: {
        tool: string;
        toolSha256: string;
        inputArchiveSha256: string;
        outputSha256: string;
        outputBytes: number;
        changes: string[];
      };
      mouthPhysicalCorrection?: {
        tool: string;
        toolSha256: string;
        inputSha256: string;
        inputBytes: number;
        outputSha256: string;
        outputBytes: number;
      };
      albedoRepair?: {
        tool: string;
        producerSha256: string;
        helperSha256: Record<string, string>;
        inputSha256: string;
        inputBytes: number;
        outputSha256: string;
        outputBytes: number;
        bakedBodyRow?: unknown;
      };
      textureGrade?: {
        tool: string;
        toolSha256: string;
        gradedTightjeans: string;
        gradedTightjeansSha256: string;
        gradedTightjeansBytes: number;
        inputSha256: string;
        inputBytes: number;
        outputSha256: string;
        outputBytes: number;
      };
      chestAnchorReseparation?: {
        tool: string;
        toolSha256: string;
        halfSpanM: number;
        inputSha256: string;
        inputBytes: number;
        outputSha256: string;
        outputBytes: number;
      };
      orphanPrune?: {
        tool: string;
        toolVersion: string;
        toolFlags: string;
        inputSha256: string;
        inputBytes: number;
        outputSha256: string;
        outputBytes: number;
      };
    };
    const stamp = pre.garmentProvenanceStamp;
    if (!stamp?.inputArchiveSha256 || !stamp?.outputSha256 || !stamp?.tool || !stamp?.toolSha256 || !Array.isArray(stamp?.changes)) {
      throw new Error("receipt missing garmentProvenanceStamp fields");
    }
    const prePath = loadProducerPreimage(REPO, GLB_REL, pre.preImageSha256, pre.preImageBytes);
    const preBytes = readFileSync(prePath);
    const problem = buildProblem(preBytes, { targetGapMm: 3.743 });
    expect(problem.inputHash).toBe(pre.preImageSha256);
    const { glbBytes, receiptNote } = await apply(
      preBytes,
      directSolution(problem.inputHash),
      { targetGapMm: 3.743, solverId: DIRECT_SOLVER_ID, solverVersion: DIRECT_SOLVER_VERSION },
    );
    // 1. Historical byte-exact oracle: seating reproduces the stamp input archive.
    expect(sha256(glbBytes)).toBe(stamp.inputArchiveSha256);
    expect(glbBytes.length).toBe(HISTORICAL_SEATING_BYTES);
    expect(receiptNote).toContain("mouth-executor apply");
    // 2. Actual normal-producer proof: recompute the stamp tool hash, pin lineage rows.
    expect(sha256(readFileSync(path.join(REPO, stamp.tool)))).toBe(stamp.toolSha256);
    expect(stamp.changes.length).toBe(LEGITIMATE_ROWS.length);
    for (const [frag, mhclo] of LEGITIMATE_ROWS) {
      expect(stamp.changes.some((c) => c.includes(frag) && c.includes(mhclo))).toBe(true);
    }
    // 3. Exact replay through the normal CLI on a temp copy; output is the stamp bytes.
    const dir = mkdtempSync(path.join(tmpdir(), "mouth-executor-replay-"));
    try {
      const tmpGlb = path.join(dir, "seat.glb");
      writeFileSync(tmpGlb, Buffer.from(glbBytes));
      execFileSync("pnpm", ["exec", "tsx", path.join(REPO, stamp.tool), tmpGlb], {
        cwd: REPO,
        stdio: "pipe",
        timeout: 300_000,
      });
      const stamped = readFileSync(tmpGlb);
      expect(sha256(stamped)).toBe(stamp.outputSha256);
      expect(stamped.length).toBe(stamp.outputBytes);
      // 3b. Optional mouthPhysicalCorrection post-stage (53d -> 2e256, normal Main CLI).
      const phys = pre.mouthPhysicalCorrection;
      if (phys) {
        if (!phys.tool || !phys.toolSha256 || !phys.inputSha256 || !phys.outputSha256 || !phys.inputBytes || !phys.outputBytes) {
          throw new Error("receipt mouthPhysicalCorrection missing fields");
        }
        expect(phys.inputSha256).toBe(stamp.outputSha256);
        expect(phys.inputBytes).toBe(stamp.outputBytes);
        expect(phys.tool).toBe(PHYS_TOOL);
        expect(sha256(readFileSync(path.join(REPO, phys.tool)))).toBe(phys.toolSha256);
        const physOut = path.join(dir, "phys.glb");
        execFileSync("pnpm", ["exec", "tsx", path.join(REPO, phys.tool), tmpGlb, physOut], {
          cwd: REPO,
          stdio: "pipe",
          timeout: 300_000,
        });
        const physBytes = readFileSync(physOut);
        expect(sha256(physBytes)).toBe(phys.outputSha256);
        expect(physBytes.length).toBe(phys.outputBytes);
      }
      // 3c. Track the current replay bytes; the final top linkage runs after all stages.
      let replayBytes = phys ? readFileSync(path.join(dir, "phys.glb")) : stamped;
      // 3d. Optional albedoRepair post-stage (2e256 -> 86b0, normal producer baker CLI).
      const albedo = pre.albedoRepair;
      if (albedo) {
        if (
          !albedo.tool || !albedo.producerSha256 || !albedo.helperSha256 ||
          !albedo.inputSha256 || !albedo.outputSha256 || !albedo.inputBytes || !albedo.outputBytes ||
          albedo.bakedBodyRow === undefined
        ) {
          throw new Error("receipt albedoRepair missing fields");
        }
        expect(albedo.tool).toBe(`${ALBEDO_TOOL}: bakeGlbAlbedo`);
        expect(Object.keys(albedo.helperSha256).sort()).toEqual([...ALBEDO_HELPERS].sort());
        expect(sha256(readFileSync(path.join(REPO, ALBEDO_TOOL)))).toBe(albedo.producerSha256);
        for (const helper of ALBEDO_HELPERS) {
          expect(sha256(readFileSync(path.join(REPO, helper)))).toBe(albedo.helperSha256[helper]);
        }
        expect(albedo.inputSha256).toBe(sha256(replayBytes));
        expect(albedo.inputBytes).toBe(replayBytes.length);
        const albedoIn = path.join(dir, path.basename(GLB_REL));
        writeFileSync(albedoIn, Buffer.from(replayBytes));
        const albedoOutDir = path.join(dir, "albedo");
        const reportPath = path.join(albedoOutDir, "report.json");
        execFileSync(
          "pnpm",
          ["exec", "tsx", path.join(REPO, ALBEDO_TOOL), "--inputs", albedoIn, "--outdir", albedoOutDir, "--report", reportPath],
          { cwd: REPO, stdio: "pipe", timeout: 300_000 },
        );
        const bakedBytes = readFileSync(path.join(albedoOutDir, path.basename(albedoIn)));
        expect(sha256(bakedBytes)).toBe(albedo.outputSha256);
        expect(bakedBytes.length).toBe(albedo.outputBytes);
        replayBytes = bakedBytes;
      }
      // 3e. Optional textureGrade post-stage (86b0 -> 2b2f, normal D2 grade CLI).
      const grade = pre.textureGrade;
      if (grade) {
        if (
          !grade.tool || !grade.toolSha256 || !grade.gradedTightjeans || !grade.gradedTightjeansSha256 ||
          !grade.inputSha256 || !grade.outputSha256 || !grade.inputBytes || !grade.outputBytes
        ) {
          throw new Error("receipt textureGrade missing fields");
        }
        expect(grade.tool).toBe(GRADE_TOOL);
        expect(sha256(readFileSync(path.join(REPO, GRADE_TOOL)))).toBe(grade.toolSha256);
        expect(sha256(readFileSync(path.join(REPO, grade.gradedTightjeans)))).toBe(grade.gradedTightjeansSha256);
        expect(grade.inputSha256).toBe(sha256(replayBytes));
        expect(grade.inputBytes).toBe(replayBytes.length);
        const gradeIn = path.join(dir, "grade-in.glb");
        const gradeOut = path.join(dir, "grade-out.glb");
        writeFileSync(gradeIn, Buffer.from(replayBytes));
        execFileSync(
          "mise",
          ["exec", "--", "python3", path.join(REPO, GRADE_TOOL), "--input", gradeIn, "--output", gradeOut, "--report", path.join(dir, "grade-report.json")],
          { cwd: REPO, stdio: "pipe", timeout: 300_000 },
        );
        const gradedBytes = readFileSync(gradeOut);
        expect(sha256(gradedBytes)).toBe(grade.outputSha256);
        expect(gradedBytes.length).toBe(grade.outputBytes);
        replayBytes = gradedBytes;
      }
      // 3f. Optional chestAnchorReseparation post-stage (2b2f -> c197, normal D3 CLI).
      const chest = pre.chestAnchorReseparation;
      if (chest) {
        if (
          !chest.tool || !chest.toolSha256 || !chest.halfSpanM ||
          !chest.inputSha256 || !chest.outputSha256 || !chest.inputBytes || !chest.outputBytes
        ) {
          throw new Error("receipt chestAnchorReseparation missing fields");
        }
        expect(chest.tool).toBe(CHEST_TOOL);
        expect(sha256(readFileSync(path.join(REPO, CHEST_TOOL)))).toBe(chest.toolSha256);
        expect(chest.inputSha256).toBe(sha256(replayBytes));
        expect(chest.inputBytes).toBe(replayBytes.length);
        const chestIn = path.join(dir, "chest-in.glb");
        const chestOut = path.join(dir, "chest-out.glb");
        writeFileSync(chestIn, Buffer.from(replayBytes));
        execFileSync(
          "node",
          [path.join(REPO, CHEST_TOOL), "--input", chestIn, "--output", chestOut, "--report", path.join(dir, "chest-report.json"), "--half-span-m", String(chest.halfSpanM)],
          { cwd: REPO, stdio: "pipe", timeout: 300_000 },
        );
        const chestBytes = readFileSync(chestOut);
        expect(sha256(chestBytes)).toBe(chest.outputSha256);
        expect(chestBytes.length).toBe(chest.outputBytes);
        replayBytes = chestBytes;
      }
      // 3g. Optional orphanPrune post-stage (c197 -> ebbd, gltf-transform prune CLI).
      const prune = pre.orphanPrune;
      if (prune) {
        if (
          !prune.tool || !prune.toolVersion || !prune.inputSha256 ||
          !prune.outputSha256 || !prune.inputBytes || !prune.outputBytes
        ) {
          throw new Error("receipt orphanPrune missing fields");
        }
        expect(prune.tool).toBe("gltf-transform prune");
        const pruneVersion = execFileSync("pnpm", ["exec", "gltf-transform", "--version"], {
          cwd: REPO, encoding: "utf8",
        });
        expect(pruneVersion).toContain(prune.toolVersion);
        expect(prune.inputSha256).toBe(sha256(replayBytes));
        expect(prune.inputBytes).toBe(replayBytes.length);
        const pruneIn = path.join(dir, "prune-in.glb");
        const pruneOut = path.join(dir, "prune-out.glb");
        writeFileSync(pruneIn, Buffer.from(replayBytes));
        execFileSync(
          "pnpm",
          ["exec", "gltf-transform", "prune", pruneIn, pruneOut, ...PRUNE_FLAGS],
          { cwd: REPO, stdio: "pipe", timeout: 300_000 },
        );
        const prunedBytes = readFileSync(pruneOut);
        expect(sha256(prunedBytes)).toBe(prune.outputSha256);
        expect(prunedBytes.length).toBe(prune.outputBytes);
        replayBytes = prunedBytes;
      }
      // Final top linkage: the receipt top must equal the last recorded stage output.
      expect(sha256(replayBytes)).toBe(pre.outputSha256);
      expect(replayBytes.length).toBe(pre.outputBytes);
      if (!albedo && pre.outputSha256 !== (phys ? phys.outputSha256 : stamp.outputSha256)) {
        throw new Error("receipt top outputSha256 does not match the last recorded stage and no albedoRepair stage is present");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // 4. Current consumer file matches the receipt.
    const currentBytes = readFileSync(path.join(REPO, GLB_REL));
    expect(sha256(currentBytes)).toBe(pre.outputSha256);
    expect(currentBytes.length).toBe(pre.outputBytes);
  }, 600_000);
});
