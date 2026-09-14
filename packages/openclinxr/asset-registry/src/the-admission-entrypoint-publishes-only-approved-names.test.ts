import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..", "..");

/**
 * This test ensures that the ./encounter-bundle-admission entrypoint
 * only exports symbols that are listed in the reviewed approval group psr-01d.
 */

function loadApprovalSymbols(): Set<string> {
  const approvalPath = join(
    root,
    "docs/openclinxr/package-public-surface-reduction/approvals/psr-01d.json",
  );
  const content = readFileSync(approvalPath, "utf8");
  const approval = JSON.parse(content);
  const symbols = new Set<string>();
  for (const row of approval.rows ?? []) {
    if (
      row.package === "packages/openclinxr/asset-registry" &&
      row.entrypoint === "./encounter-bundle-admission" &&
      row.disposition === "keep"
    ) {
      symbols.add(row.symbol);
    }
  }
  return symbols;
}

function getExportedSymbols(): string[] {
  const entryPath = join(
    root,
    "packages/openclinxr/asset-registry/src/encounter-bundle-admission.ts",
  );
  const content = readFileSync(entryPath, "utf8");
  const symbols: string[] = [];
  const exportMatch = content.match(/export\s+\{([\s\S]*?)\}\s+from/);
  const exportList = exportMatch?.[1] ?? "";
  const lines = exportList.split(",");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("type ")) {
      symbols.push(trimmed);
    } else if (trimmed.startsWith("type ")) {
      symbols.push(trimmed.slice(5).trim());
    }
  }
  return symbols;
}

describe("admission entrypoint publishes only approved names", () => {
  it("approved-entrypoint-surface-required-behavior", () => {
    const approved = loadApprovalSymbols();
    const exported = getExportedSymbols();
    const unapproved = exported.filter((sym) => !approved.has(sym));
    expect(unapproved).toEqual([]);
  });
});