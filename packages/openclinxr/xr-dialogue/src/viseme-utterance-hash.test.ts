import { describe, expect, it } from "vitest";
import {
  normalizeUtteranceTextForCueLookup,
  sha1Hex,
  utteranceIdForText,
} from "./viseme-utterance-hash.js";

describe("viseme utterance hash (#722) — deterministic link to the baked cue names", () => {
  it("matches node:crypto sha1 (the bake's own hasher) on representative lines", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("The quick brown fox jumps over the lazy dog")).toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12");
    expect(
      sha1Hex("My right arm feels weak, and I cannot get the words out clearly.").slice(0, 10),
    ).toBe("6539634edf");
  });

  it("strips a leading actor prefix so runtime text hashes like the bake's bare utterance", () => {
    const prefixed = "Samuel Brooks: My right arm feels weak, and I cannot get the words out clearly.";
    expect(normalizeUtteranceTextForCueLookup(prefixed)).toBe(
      "My right arm feels weak, and I cannot get the words out clearly.",
    );
    // The prefixed text hashes to a different id; the bake named the file from the bare text.
    expect(utteranceIdForText(prefixed)).toBe("6539634edf");
    expect(utteranceIdForText("My right arm feels weak, and I cannot get the words out clearly.")).toBe(
      "6539634edf",
    );
  });

  it("is a pure function of the text — same line, same id, every time", () => {
    expect(utteranceIdForText("My chest feels tight and it is hard to breathe.")).toBe("41a6922ade");
    expect(utteranceIdForText("My chest feels tight and it is hard to breathe.")).toBe("41a6922ade");
  });
});
