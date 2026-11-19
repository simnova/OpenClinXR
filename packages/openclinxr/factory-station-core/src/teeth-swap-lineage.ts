import { postExportLevelStages } from "./post-export-stage-registry.js";

/** Shared teeth-swap byte-lineage continuity rule for T3 and trellis evidence. */
/** One recorded derivation level in sidecar byteLineage. */
export type ByteLineageLevel = {
  preImageRevision?: string;
  preImageSha256?: string;
  derivationArgv?: string[];
  why?: string;
  inputSha256?: string;
  recordedBefore?: { outputSha256?: string; outputBytes?: number; byteLineage?: ByteLineageLevel };
};

/** The teethSwapB1 block of a shipped-GLB provenance sidecar. */
export type TeethSwapBlock = {
  output?: { sha256?: string };
  protectedAccessorHashes?: Array<{ meshIndex: number; slot: string; accessorIndex: number; sha256: string }>;
};

/** A shipped-GLB provenance sidecar carrying the swap block and byte lineage. */
export type NeckChainSidecar = {
  outputSha256?: string;
  byteLineage?: ByteLineageLevel;
  teethSwapB1?: TeethSwapBlock;
};

/** Walk sidecar.byteLineage -> recordedBefore.byteLineage -> ... newest-first. */
export function lineageLevels(sidecar: Record<string, unknown>): ByteLineageLevel[] {
  const levels: ByteLineageLevel[] = [];
  let cur = (sidecar as NeckChainSidecar).byteLineage;
  while (cur !== null && typeof cur === "object" && !Array.isArray(cur)) {
    levels.push(cur);
    cur = cur.recordedBefore?.byteLineage;
  }
  return levels;
}

/** F1 single-run chain (p2e-c-prod-r2, Codex F1): the inpaint + 6-tri un-hide
 * interim levels collapsed into one tracked chain derivation
 * (nurse-vneck-chain.py) from the c1da76fb4 pre-image straight to the shipped
 * bytes. The chain's recordedBefore is the superseded same-bytes pin, not its
 * derivation input, so per-level junction (pre === recordedBefore.output)
 * cannot hold for the chain level by construction; the chain level instead
 * must name the tracked pre-image revision + sha below. */
const P2E_CHAIN_PREIMAGE_REV =
  "c1da76fb4:apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb";
const P2E_CHAIN_PREIMAGE_SHA256 =
  "8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86";

/**
 * Per-level junction continuity: for every non-chain level L,
 * L.preImageSha256 === L.recordedBefore.outputSha256 (each derivation re-ran
 * on exactly the bytes the pin it supersedes named). The F1 chain level is
 * exempt by construction (one derivation spanning both stages; recordedBefore
 * is the superseded same-bytes pin) and must name the tracked c1da76fb4
 * pre-image instead. Throws on the first breach, naming actor + level index.
 */
export function assertLineageContinuity(actor: string, levels: ByteLineageLevel[]): void {
  for (const [index, level] of levels.entries()) {
    const stages = postExportLevelStages(level.derivationArgv);
    if (stages?.some((stage) =>
      stage.mutates.includes("nurse-neckline-indices") && stage.mutates.includes("skin-image"),
    )) {
      // F1 chain level: the one derivation spans both stages, so junction
      // against recordedBefore cannot hold; require the tracked pre-image.
      if (
        level.preImageSha256 !== P2E_CHAIN_PREIMAGE_SHA256 ||
        level.preImageRevision !== P2E_CHAIN_PREIMAGE_REV
      ) {
        throw new Error(
          `T3 chain ${actor} L${index}: chain level must name the tracked pre-image ${P2E_CHAIN_PREIMAGE_REV} sha ${P2E_CHAIN_PREIMAGE_SHA256}, got ${level.preImageRevision} sha ${level.preImageSha256}`,
        );
      }
      continue;
    }
    if (level.recordedBefore === undefined || level.preImageSha256 !== level.recordedBefore.outputSha256) {
      throw new Error(
        `T3 chain ${actor} L${index}: preImageSha256 ${level.preImageSha256} != recordedBefore.outputSha256 ${level.recordedBefore?.outputSha256}`,
      );
    }
  }
}

/**
 * R2 lineage-chain allowance (e9-r2lineage). When teethSwapB1.output no longer pins the live
 * GLB because a later byte-identical correction moved the top pin, the swap output must still
 * pin the junction: the pin the swap level established, read as the sidecar top pin when the
 * swap level is newest, else as the next-newer level's recordedBefore.outputSha256. Continuity:
 * for every non-chain level L, L.preImageSha256 === L.recordedBefore.outputSha256 (each derivation re-ran
 * on exactly the bytes the pin it supersedes named). The F1 chain level is exempt by construction
 * (one derivation spanning both stages; recordedBefore is the superseded same-bytes pin) and must
 * name the tracked c1da76fb4 pre-image instead. The walked chain must contain the
 * registered mouth-geometry stage with a #741 record nested at an older level,
 * or a combined level that also mutates tongue positions. A historical #741
 * note can identify a separate older level, but combined ordering requires
 * both mutation domains in the registered level.
 */
export function validateT3LineageChain(
  actor: string,
  live: string,
  sidecar: Record<string, unknown>,
  block: TeethSwapBlock,
  isCombinedSwapPostLevel?: (level: ByteLineageLevel) => boolean,
): void {
  const chain = sidecar as NeckChainSidecar;
  if (chain.outputSha256 !== live) {
    throw new Error(`T3 chain ${actor}: sidecar top ${chain.outputSha256} does not pin this GLB ${live}`);
  }
  const levels = lineageLevels(sidecar);
  if (levels.length === 0) {
    throw new Error(`T3 chain ${actor}: teethSwapB1 output does not pin this GLB and no byteLineage chain exists`);
  }
  assertLineageContinuity(actor, levels);
  const stages = levels.map((level) => postExportLevelStages(level.derivationArgv));
  const mutates = (index: number, domain: string): boolean =>
    stages[index]?.some((stage) => stage.mutates.includes(domain)) ?? false;
  const matches741 = (level: ByteLineageLevel, index: number): boolean =>
    (level.why ?? "").includes("fix(#741)") || mutates(index, "tongue-positions");
  const swapIndex = levels.findIndex((_level, index) => mutates(index, "mouth-geometry"));
  if (swapIndex < 0) {
    throw new Error(`T3 chain ${actor}: no teeth-swap derivation record in the byteLineage chain`);
  }
  const fix741Index = levels.findIndex(matches741);
  if (fix741Index < 0) {
    throw new Error(`T3 chain ${actor}: no nested #741 record (missing #741) in the byteLineage chain`);
  }
  // Indexed access without a non-null assertion (biome noNonNullAssertion):
  // every call site below is guarded (swapIndex >= 0 here; swapIndex - 1 only
  // when swapIndex > 0), so the throw is unreachable on valid chains and
  // still REDs like the old TypeError on a malformed one.
  const at = (index: number): ByteLineageLevel => {
    const level = levels[index];
    if (level === undefined) {
      throw new Error(`T3 chain ${actor}: level index ${index} out of range (depth ${levels.length})`);
    }
    return level;
  };
  if (
    !mutates(swapIndex, "tongue-positions") ||
    (isCombinedSwapPostLevel && !isCombinedSwapPostLevel(at(swapIndex)))
  ) {
    const older741 = levels.findIndex((level, index) => index > swapIndex && matches741(level, index));
    if (older741 < 0) {
      throw new Error(`T3 chain ${actor}: the #741 record must nest older than the teeth-swap record`);
    }
  }
  const established = swapIndex === 0 ? chain.outputSha256 : at(swapIndex - 1).recordedBefore?.outputSha256;
  if (block.output?.sha256 !== established) {
    throw new Error(
      `T3 chain ${actor}: teethSwapB1 output ${block.output?.sha256} pins neither the top pin nor the swap junction ${established}`,
    );
  }
  // The level newer than the swap re-ran on exactly the swap output bytes: its pre-image
  // is the next-older level's output at this junction.
  if (swapIndex > 0 && at(swapIndex - 1).preImageSha256 !== block.output?.sha256) {
    throw new Error(
      `T3 chain ${actor}: post-swap level preImageSha256 ${at(swapIndex - 1).preImageSha256} != teethSwapB1 output ${block.output?.sha256}`,
    );
  }
  const unresolved = stages.indexOf(undefined);
  if (unresolved >= 0) {
    throw new Error(`T3 chain ${actor} L${unresolved}: unregistered post-export level`);
  }
}
