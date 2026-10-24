import { describe, expect, it } from "vitest";
import { makeRun, type CapacityRun } from "@openclinxr/xr-capacity";
import { checkCampaignBuildIdentity, parseServedAppIdentity } from "./secure-build-identity.js";
const identity = { revision: "abcdef123456", buildHash: `sha256:${"a".repeat(64)}` };
function run(id = "identity-fixture"): CapacityRun {
  return makeRun({ id, environment: { runtime: "chromium", device: "test-host", os: "test-os", browser: "test-browser", ...identity }, configuration: { workloadHash: "fixed-fixture", capabilityHash: "fixed-capabilities", seed: 1729, axes: {} } });
}
describe("secure campaign independently expected build identity", () => {
  it("accepts every known run and a same-source package comparison", () => {
    const result = checkCampaignBuildIdentity([run("one"), run("two")], identity, identity);
    expect(result.ok).toBe(true); expect(result.runs.every((value) => value.sameSourceComparison.outcome === "comparable")).toBe(true);
  });
  it("rejects unknown identity even when all imported runs claim the same unknown value", () => {
    const unknown = run(); unknown.environment.revision = "unavailable"; unknown.environment.buildHash = "unknown";
    expect(checkCampaignBuildIdentity([unknown], identity, identity).ok).toBe(false);
    expect(() => parseServedAppIdentity({ gitCommit: "unavailable", capacitySourceHash: "unknown" })).toThrow();
  });
  it("rejects a single mixed-source run among valid observations", () => {
    const mixed = run("different-source"); mixed.environment.buildHash = `sha256:${"b".repeat(64)}`;
    const result = checkCampaignBuildIdentity([run(), mixed], identity, identity);
    expect(result.ok).toBe(false); expect(result.runs[0]!.ok).toBe(true); expect(result.runs[1]!.reasons).toContain("Run identity differs from served app metadata");
  });
  it("rejects self-consistent reports and tag when independent source fingerprint differs", () => {
    const expected = { ...identity, buildHash: `sha256:${"b".repeat(64)}` };
    const result = checkCampaignBuildIdentity([run()], identity, expected);
    expect(result.ok).toBe(false); expect(result.declarationMatchesSource).toBe(false);
  });
  it("rejects absent, malformed or truncated served metadata and empty campaigns", () => {
    for (const value of [null, [], {}, { gitCommit: identity.revision, capacitySourceHash: "sha256:abc" }]) expect(() => parseServedAppIdentity(value)).toThrow();
    expect(checkCampaignBuildIdentity([], identity, identity).ok).toBe(false);
    expect(parseServedAppIdentity({ gitCommit: identity.revision, capacitySourceHash: identity.buildHash })).toEqual(identity);
  });
});
