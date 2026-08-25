import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type {
  AssetGenerationWorkerAdapter,
  AssetGenerationCapabilityId,
} from "./asset-generation-jobs.js";

/**
 * Deterministic no-spend fixture adapter (#610): materializes the manifest/source files it
 * references so no succeeded job claims artifacts nobody wrote. Split out of
 * asset-generation-jobs.ts to honor its shrink-only size freeze.
 */
export function createDeterministicAssetGenerationAdapter(
  capabilityId: AssetGenerationCapabilityId,
): AssetGenerationWorkerAdapter {
  return {
    capabilityId,
    providerId: `deterministic-${capabilityId}`,
    providerKind: "deterministic-mock",
    implementationLanguage: "typescript",
    transport: "in-process",
    async run(_request, policy, context) {
      const basePath = `${policy.sandboxWorkdir}/${context.jobId}`;
      // #610: the artifacts this adapter references must exist on disk. A succeeded job that
      // hands back paths nobody wrote is the defect this adapter used to ship — write the
      // deterministic fixture files before reporting them.
      const manifestArtifact = {
        kind: "manifest" as const,
        path: `${basePath}/${capabilityId}-manifest.json`,
        mediaType: "application/json",
      };
      const sourceArtifact = {
        kind: "source" as const,
        path: `${basePath}/${capabilityId}-source.asset.json`,
        mediaType: "application/json",
      };
      const manifestContent = JSON.stringify({
        schemaVersion: "asset-generation-manifest.v1",
        capabilityId,
        outputs: [
          `${capabilityId}-manifest.json`,
          `${capabilityId}-source.asset.json`,
        ],
      }, null, 2);
      const sourceContent = JSON.stringify({
        schemaVersion: `openclinxr.deterministic-${capabilityId}-source.v1`,
        capabilityId,
        jobId: context.jobId,
        providerKind: "deterministic-mock",
        claimScope: "deterministic_test_fixture_not_production_asset",
        notEvidenceFor: [
          "production_asset_readiness",
          "quest_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      }, null, 2);
      writeTextArtifact(manifestArtifact.path, manifestContent);
      writeTextArtifact(sourceArtifact.path, sourceContent);
      return {
        artifacts: [manifestArtifact, sourceArtifact],
        manifest: {
          schemaVersion: "asset-generation-manifest.v1",
          capabilityId,
          outputs: [
            `${capabilityId}-manifest.json`,
            `${capabilityId}-source.asset.json`,
          ],
        },
        provenance: {
          generator: `deterministic-${capabilityId}`,
          license: "openclinxr-deterministic-test-fixture",
          spendCents: 0,
          externalNetworkUsed: false,
        },
      };
    },
  };
}

/** Writes a referenced artifact to disk (repo-root relative) so no job claims an unwritten file. */
function writeTextArtifact(relativeArtifactPath: string, content: string): void {
  const absolutePath = resolvePath(REPOSITORY_ROOT, relativeArtifactPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

/** Resolves a repo-root-relative artifact reference to an absolute filesystem path. */
export function resolveRepositoryArtifactPath(relativeArtifactPath: string): string {
  return resolvePath(REPOSITORY_ROOT, relativeArtifactPath);
}

const REPOSITORY_ROOT = resolveRepositoryRoot();

function resolveRepositoryRoot(): string {
  let currentDirectory = process.cwd();
  for (let depth = 0; depth < 32; depth += 1) {
    if (existsSync(resolvePath(currentDirectory, "package.json"))) {
      return currentDirectory;
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
  }
  return process.cwd();
}
