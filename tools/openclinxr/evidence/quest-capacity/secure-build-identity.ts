import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareRuns, type CapacityRun } from "@openclinxr/xr-capacity";

export interface AppBuildIdentity { revision: string; buildHash: string }
const HASH = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{7,64}$/i;

/** The served declaration is read before the trial, independently of exported observations. */
export function parseServedAppIdentity(value: unknown): AppBuildIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Served app build metadata must be an object");
  const metadata = value as Record<string, unknown>;
  if (typeof metadata["gitCommit"] !== "string" || !REVISION.test(metadata["gitCommit"])) throw new Error("Served app revision is unavailable or invalid");
  if (typeof metadata["capacitySourceHash"] !== "string" || !HASH.test(metadata["capacitySourceHash"])) throw new Error("Served app source fingerprint is unavailable or invalid");
  return { revision: metadata["gitCommit"], buildHash: metadata["capacitySourceHash"] };
}

/** Use the application's authoritative build-configuration utility; never derive an expected hash from a report. */
export async function expectedAppIdentity(root: string, externalExpectedHash?: string): Promise<AppBuildIdentity> {
  if (externalExpectedHash !== undefined && !HASH.test(externalExpectedHash)) throw new Error("--expected-build-hash requires sha256:<64 lowercase hex characters>");
  const configuration = await import(pathToFileURL(join(root, "apps/ui-xr/vite.config.ts")).href) as {
    resolveOpenClinXrCapacitySourceHash?: (root: string) => string;
    resolveOpenClinXrXrGitCommit?: () => string;
  };
  if (typeof configuration.resolveOpenClinXrCapacitySourceHash !== "function" || typeof configuration.resolveOpenClinXrXrGitCommit !== "function") throw new Error("Independent application build identity utility is unavailable");
  const expected = parseServedAppIdentity({ gitCommit: configuration.resolveOpenClinXrXrGitCommit(), capacitySourceHash: configuration.resolveOpenClinXrCapacitySourceHash(root) });
  if (externalExpectedHash !== undefined && expected.buildHash !== externalExpectedHash) throw new Error("Explicit expected build hash differs from current application source fingerprint");
  return expected;
}

export function checkCampaignBuildIdentity(runs: readonly CapacityRun[], served: AppBuildIdentity, expected: AppBuildIdentity) {
  const declarationMatchesSource = served.revision === expected.revision && served.buildHash === expected.buildHash;
  const results = runs.map((run) => {
    const reasons: string[] = [];
    if (!REVISION.test(run.environment.revision)) reasons.push("Run revision unavailable or invalid");
    if (!HASH.test(run.environment.buildHash)) reasons.push("Run source fingerprint unavailable or invalid");
    if (run.environment.revision !== served.revision || run.environment.buildHash !== served.buildHash) reasons.push("Run identity differs from served app metadata");
    if (run.environment.revision !== expected.revision || run.environment.buildHash !== expected.buildHash) reasons.push("Run identity differs from independently computed source identity");
    const sameSource = compareRuns(run, run);
    if (sameSource.outcome !== "comparable") reasons.push(...sameSource.differences.map((difference) => `Same-source comparison refused: ${difference}`));
    return { runId: run.id, revision: run.environment.revision, buildHash: run.environment.buildHash, ok: reasons.length === 0, reasons, sameSourceComparison: { outcome: sameSource.outcome, differences: sameSource.differences } };
  });
  return { ok: declarationMatchesSource && runs.length > 0 && results.every((run) => run.ok), declarationMatchesSource, served, expected, runs: results };
}
