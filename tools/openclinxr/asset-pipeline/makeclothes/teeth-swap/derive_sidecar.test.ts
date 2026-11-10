import { describe, expect, it } from "vitest";
import { serializeWithTeethSwapBlock } from "./derive_sidecar.js";

describe("teeth swap sidecar serialization", () => {
  it("appends teethSwapB1 after a formerly-final outputBytes field without invalid JSON", () => {
    const source = '{\n "outputSha256": "abc",\n "outputBytes": 123\n}\n';
    const serialized = serializeWithTeethSwapBlock(JSON.parse(source), {
      output: { sha256: "def", bytes: 456 },
    });
    expect(JSON.parse(serialized)).toEqual({
      outputSha256: "abc",
      outputBytes: 123,
      teethSwapB1: { output: { sha256: "def", bytes: 456 } },
    });
  });
});

describe("teeth swap post-step chain", () => {
  it("orders retreat, tongue, couple and quotes every path", async () => {
    const { postSteps, chainedDerivationArgv } = await import("./derive_sidecar.js");
    const steps = postSteps(["--couple", "--tongue-delta", "-0.004", "--retreat-delta", "0.0102"]);
    expect(steps.map((s) => s.tool.split("/").pop())).toEqual([
      "teeth-rest-clearance.ts",
      "tongue-forward-place.ts",
      "couple-fitted-teeth-to-lip-viseme.ts",
    ]);
    const argv = chainedDerivationArgv("tools/x/swap_teeth.py", "/tmp/it's/s.glb", steps);
    expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(argv.slice(3)).toEqual(["x", "{pre}", "{out}", "{report}"]);
    expect(argv[2]).toBe(
      "mise exec -- python3 'tools/x/swap_teeth.py' --input \"$1\" --scratch '/tmp/it'\\''s/s.glb' --output \"$2\" --report \"$3\""
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts' \"$2\" '--delta' '0.0102' '--in-place-bytes'"
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts' \"$2\" '--delta' '-0.004' '--in-place-bytes'"
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts' \"$2\"",
    );
  });

  it("adds no chain when no post-step flag is given", async () => {
    const { postSteps } = await import("./derive_sidecar.js");
    expect(postSteps(["--input", "a"])).toEqual([]);
  });
});
