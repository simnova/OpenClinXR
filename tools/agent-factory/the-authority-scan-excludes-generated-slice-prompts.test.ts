import { describe, expect, it } from "vitest";
import { classify, isExcludedPath } from "./build-doc-authority-registry.ts";

/**
 * Pins two decisions that together made `pnpm docs:authority` runnable again.
 *
 * MEASURED 2026-08-29. The generator had been unrunnable: it wanted to drop five paths, two of which
 * still existed, so the shrink guard refused — correctly — and every new Markdown file had to be
 * hand-registered. Twice in one afternoon an unregistered skill file blocked EVERY agent's commit at
 * pre-commit step 2.
 *
 * Removing the two misfiled JSON rows fixed the refusal and exposed the real defect: the scan walked
 * `.openclinxr/slices/**` and found 262 generated worker prompts. The unclassified fallback stamps
 * `archive-candidate`, which check-openclaw-drift.ts:133-137 then REFUSES, so registering them moved
 * 262 files from failing one rule to failing another and added 2,851 lines of ephemera to a PROTECTED
 * registry. Confirmed as generated-not-document by the grok orchestrator, which owns that generator.
 */
describe("doc authority scan scope", () => {
  it("excludes generated per-slice worker prompts", () => {
    expect(isExcludedPath(".openclinxr/slices/issue-700/prompt-issue-700.md")).toBe(true);
    expect(isExcludedPath(".openclinxr/slices/bothy-tsk_05ab6b88238cf1a7/prompt-bothy-tsk_05ab6b88238cf1a7.md")).toBe(true);
  });

  /**
   * COUNTERWEIGHT, and it is not hypothetical. The first version of this exclusion was a blanket
   * `.openclinxr/slices/` prefix. The shrink guard caught it before it landed, because
   * `dispatch-chokepoint/EVIDENCE.md` is a real registered evidence document living in that tree and
   * a directory-wide rule would have silently dropped it. Without this clause a prefix match passes
   * the clause above and quietly deregisters five genuine documents.
   */
  it("COUNTERWEIGHT: does NOT exclude real documents that live under slices", () => {
    for (const real of [
      ".openclinxr/slices/dispatch-chokepoint/EVIDENCE.md",
      ".openclinxr/slices/trellis-imagine-black/PLAN.md",
      ".openclinxr/slices/dark-factory-multi-case/STATE.md",
      ".openclinxr/slices/trellis-escape-hatch/log.md",
      ".openclinxr/slices/trellis-escape-hatch/LOOP.md",
    ]) {
      expect(isExcludedPath(real), `${real} is a document, not a generated prompt`).toBe(false);
    }
  });

  it("does not exclude prompt-shaped names outside a slice directory", () => {
    expect(isExcludedPath("docs/openclinxr/prompt-library.md")).toBe(false);
    expect(isExcludedPath(".openclinxr/slices/prompt-loose.md")).toBe(false);
  });
});

describe("architect cadence log classification", () => {
  /**
   * `-notes.md` matches the one-off pattern at check-openclaw-drift.ts:92, and that rule fails any
   * such file whose authority is `archive-candidate` — which is exactly what the unclassified
   * fallback assigns. The file is a durable engineering log carrying file:line findings, linked from
   * equipment-factory-15m-loop.md, and its own header says "Not SSOT; catalogue + MADRs win on
   * conflict." So: evidence, low weight, never instruction.
   */
  it("classifies an architect cadence log as evidence, not an archive candidate", () => {
    const entry = classify("docs/openclinxr/equipment-factory-architect-notes.md");
    expect(entry.authority).toBe("evidence");
    expect(entry.agentInstructionWeight).toBe("low");
    expect(entry.action).toBe("treat-as-evidence");
  });

  it("COUNTERWEIGHT: an ordinary unclassified doc still falls back to archive-candidate", () => {
    // Without this, a rule broad enough to catch everything would satisfy the clause above while
    // destroying the fallback that makes unclassified Markdown visible.
    expect(classify("docs/openclinxr/some-unclassified-file.md").authority).toBe("archive-candidate");
  });
});
