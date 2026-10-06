/** Pins the step3 capture defaults so clip generalization cannot move them. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveClipConfig, STEP3_AUDIO_REL, STEP3_LINE } from "./clip-config.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("clip config", () => {
  it("defaults to the step3 fixture with legacy schema", () => {
    const config = resolveClipConfig(["node", "mouth-dynamics-capture.ts", "--step3"]);
    expect(config.clip).toBe("step3");
    expect(config.line).toBe(STEP3_LINE);
    expect(config.line).toBe("I feel the pain is better now.");
    expect(config.transcript).toBe(STEP3_LINE);
    expect(config.audioFile).toBe(path.join(REPO, STEP3_AUDIO_REL));
    expect(config.outSubdir).toBe("step3");
    expect(config.legacy).toBe(true);
  });

  it("ignores unknown --clip values and stays on step3", () => {
    expect(resolveClipConfig(["node", "x", "--clip", "nope"]).clip).toBe("step3");
    expect(resolveClipConfig(["node", "x"]).clip).toBe("step3");
  });

  it("resolves the pangram clip", () => {
    const config = resolveClipConfig(["node", "x", "--clip", "pangram"]);
    expect(config.clip).toBe("pangram");
    expect(config.outSubdir).toBe("viseme-eval/pangram");
    expect(config.legacy).toBe(false);
    expect(config.transcript).toBe(config.line);
    expect(config.audioFile.endsWith("visemes/pangram.aiff")).toBe(true);
  });

  it("resolves the viseme-words clip with a period-free MFA transcript", () => {
    const config = resolveClipConfig(["node", "x", "--clip", "viseme-words"]);
    expect(config.clip).toBe("viseme-words");
    expect(config.outSubdir).toBe("viseme-eval/viseme-words");
    expect(config.legacy).toBe(false);
    expect(config.transcript).toBe("put fat think tip call chair sir lot red car bed toe book");
    expect(config.transcript).not.toContain(".");
    expect(config.audioFile.endsWith("visemes/viseme-words.aiff")).toBe(true);
  });
});
