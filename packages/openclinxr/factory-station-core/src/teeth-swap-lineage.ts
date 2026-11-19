/**
 * Shared teeth-swap byte-lineage continuity rule (kevin-collar s10h4 B2).
 *
 * Extracted verbatim from validateT3LineageChain in
 * packages/openclinxr/stations/humanoid-bake-evidence/src/humanoid-bake/the-shipped-teeth-carry-their-texture.test.ts
 * so the trellis face-preserving check enforces the SAME rule without importing
 * from a .test.ts file (refused). Behaviour-identical by construction: the T3
 * test keeps its argvWords/argvHasExactTool/SWAP_TOOL_INVOCATION/
 * TONGUE_TOOL_INVOCATION/isCombinedSwapPostLevel locals (FU8 owns those) and
 * passes its predicate in; the trellis mouth-swap check passes its own mirror.
 * No maps-level peel lives here (FU8 owns that).
 */

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

/** Walk sidecar.byteLineage -> recordedBefore.byteLineage -> ... oldest-first. */
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
export const P2E_CHAIN_SCRIPT = "nurse-vneck-chain.py";
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
    if ((level.derivationArgv ?? []).join(" ").includes(P2E_CHAIN_SCRIPT)) {
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
 * teeth-swap record (swap_teeth.py in argv) with the #741 record (fix(#741) in why
 * or tongue-forward-place.ts in argv) either nested older still, or carried by the
 * swap level itself: a single level that ran both the swap and the #741 post-step
 * (the kevin combined derivation) satisfies the ordering by its contents, at any
 * depth. The combined case is contents-identified by the EXACT tool invocations
 * in derivationArgv (full swap + tongue-forward paths): free-form why text never
 * suffices, so a forged fix(#741) note on a swap level whose argv lacks the
 * tongue-forward invocation still refuses. Otherwise the #741 search is scoped
 * to levels older than the swap level, so a newer-only #741 still refuses
 * instead of passing.
 *
 * The combined-swap predicate is injected by the caller (the T3 test owns the
 * exact-word argvWords/argvHasExactTool helpers; FU8 owns that surface), so this
 * module never matches tool paths itself.
 */
export function validateT3LineageChain(
  actor: string,
  live: string,
  sidecar: Record<string, unknown>,
  block: TeethSwapBlock,
  isCombinedSwapPostLevel: (level: ByteLineageLevel) => boolean,
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
  const argvText = (level: ByteLineageLevel): string => (level.derivationArgv ?? []).join(" ");
  const matchesSwap = (level: ByteLineageLevel): boolean => argvText(level).includes("swap_teeth.py");
  const matches741 = (level: ByteLineageLevel): boolean =>
    (level.why ?? "").includes("fix(#741)") || argvText(level).includes("tongue-forward-place.ts");
  const swapIndex = levels.findIndex(matchesSwap);
  if (swapIndex < 0) {
    throw new Error(`T3 chain ${actor}: no teeth-swap derivation record (swap_teeth.py) in the byteLineage chain`);
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
  if (!isCombinedSwapPostLevel(at(swapIndex))) {
    const older741 = levels.findIndex((level, index) => index > swapIndex && matches741(level));
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
}
