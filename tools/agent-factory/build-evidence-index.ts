import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type ArtifactEntry = {
  path: string;
  authority: string;
  tracked: boolean;
  action: string;
  rationale: string;
};

type ArtifactRegistry = {
  entries: ArtifactEntry[];
};

type EvidenceLane = {
  id: string;
  title: string;
  matchers: RegExp[];
  maxItems: number;
  description: string;
};

const root = process.cwd();
const registryPath = "docs/openclinxr/generated-artifact-registry-2026-05-27.json";
const outputMd = "docs/openclinxr/evidence-index-2026-05-27.md";
const outputJson = "docs/openclinxr/evidence-index-2026-05-27.json";

const lanes: EvidenceLane[] = [
  {
    id: "full-app-smoke",
    title: "Full application smoke evidence",
    description: "Representative app-level smoke/resmoke artifacts for UI-admin and UI-XR behavior.",
    matchers: [/full-app-.*2026-05-26/u, /ui-admin-route-smoke-2026-05-26/u],
    maxItems: 8,
  },
  {
    id: "ui-xr-visual-realism",
    title: "UI-XR visual and realism evidence",
    description: "Recent screenshots and JSON evidence for encounter visual realism, actor cues, and WebXR-only cleanup.",
    matchers: [/ui-xr-.*2026-05-26/u, /screenshots\/ui-xr-.*2026-05-26/u],
    maxItems: 20,
  },
  {
    id: "encounter-factory",
    title: "Encounter factory manifests and runtime packets",
    description: "Factory operation manifests, handoff preflight, launch selection, publication payload, runtime bundle, and environment/equipment artifacts.",
    matchers: [/encounter-.*2026-05-2[356]/u, /generated-.*runtime-bundle-2026-05-2[356]/u, /environment-artifacts-2026-05-2[356]/u, /medical-equipment-artifacts-2026-05-2[356]/u],
    maxItems: 24,
  },
  {
    id: "garment-humanoid",
    title: "Humanoid and garment pipeline evidence",
    description: "Garment allowlist, fit, provider gate, humanoid source, body measurement, and Blender refinement artifacts.",
    matchers: [/garment-.*2026-05-27/u, /humanoid-.*2026-05-27/u, /body-measurements-.*2026-05-27/u, /blender-normal-refine-.*2026-05-27/u],
    maxItems: 28,
  },
  {
    id: "quest-webxr",
    title: "Quest and WebXR evidence",
    description: "Retained Quest/WebXR evidence templates and current checks; stale early Quest evidence is pruned separately by artifact registry policy.",
    matchers: [/quest.*2026-05-2[156]/u, /webxr.*2026-05-2[156]/u, /xr-.*quest/u],
    maxItems: 16,
  },
  {
    id: "provider-asset-gates",
    title: "Provider and asset gate evidence",
    description: "Local provider, asset generation, asset readiness, production ladder, GLTF, and Blender bake evidence.",
    matchers: [/provider.*2026-05-2[1567]/u, /asset-.*2026-05-2[1567]/u, /gltf-.*2026-05-21/u, /blender-asset-bake-.*2026-05-21/u],
    maxItems: 20,
  },
];

function isEvidence(entry: ArtifactEntry): boolean {
  return entry.authority === "keep-evidence" || entry.authority === "keep-template";
}

function sortMostRecentFirst(a: string, b: string): number {
  const dateA = a.match(/2026-05-\d{2}/u)?.[0] ?? "";
  const dateB = b.match(/2026-05-\d{2}/u)?.[0] ?? "";
  if (dateA !== dateB) return dateB.localeCompare(dateA);
  return a.localeCompare(b);
}

const artifactRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as ArtifactRegistry;
const evidenceEntries = artifactRegistry.entries.filter(isEvidence);
const laneSummaries = lanes.map((lane) => {
  const matches = evidenceEntries
    .filter((entry) => lane.matchers.some((matcher) => matcher.test(entry.path)))
    .map((entry) => entry.path)
    .sort(sortMostRecentFirst);
  return {
    id: lane.id,
    title: lane.title,
    description: lane.description,
    totalMatches: matches.length,
    representativeArtifacts: matches.slice(0, lane.maxItems),
  };
});
const indexedPaths = new Set(laneSummaries.flatMap((lane) => lane.representativeArtifacts));
const evidenceIndex = {
  schemaVersion: "2026-05-27",
  claimBoundary: "evidence navigation index only; not product, clinical, Quest, scoring, or production readiness evidence",
  sourceRegistry: registryPath,
  usageRule: "Use this index to find representative evidence quickly; use the generated artifact registry for deletion/ignore/commit decisions.",
  laneSummaries,
  unindexedEvidenceCount: evidenceEntries.filter((entry) => !indexedPaths.has(entry.path)).length,
};

mkdirSync(path.dirname(path.resolve(root, outputMd)), { recursive: true });
writeFileSync(path.resolve(root, outputJson), `${JSON.stringify(evidenceIndex, null, 2)}\n`);
const md = `# Evidence Index\n\nDate: 2026-05-27\n\nThis generated index points agents to representative evidence without requiring a scan of every retained JSON or screenshot. It is a navigation aid only, not product, clinical, Quest, scoring, or production-readiness evidence.\n\nSource registry: \`${registryPath}\`\n\n## Usage Rule\n\nUse this index to find representative evidence quickly. Use \`generated-artifact-registry-2026-05-27.md\` for deletion, ignore, or commit decisions.\n\n${laneSummaries.map((lane) => `## ${lane.title}\n\n${lane.description}\n\nTotal matching retained artifacts: ${lane.totalMatches}\n\n${lane.representativeArtifacts.map((artifact) => `- \`${artifact}\``).join("\n") || "- No retained representative artifacts found."}`).join("\n\n")}\n\n## Unindexed Retained Evidence\n\nRetained evidence artifacts not shown as representatives above: ${evidenceIndex.unindexedEvidenceCount}\n`;
writeFileSync(path.resolve(root, outputMd), md);
console.log(JSON.stringify({ outputMd, outputJson, lanes: laneSummaries.length, unindexedEvidenceCount: evidenceIndex.unindexedEvidenceCount }, null, 2));
