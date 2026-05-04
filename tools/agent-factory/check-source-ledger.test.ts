import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkSourceLedger } from "./check-source-ledger.js";

const schemaPath = join(process.cwd(), "schemas/source-record.schema.json");

describe("source ledger checker", () => {
  it("accepts valid source records and reports checked count", async () => {
    await withTempSourceRecord(validSourceRecord(), async (file) => {
      await expect(checkSourceLedger({ files: [file], schemaPath })).resolves.toEqual({
        checkedCount: 1,
        failures: [],
      });
    });
  });

  it("reports schema failures with the offending file path", async () => {
    await withTempSourceRecord({
      ...validSourceRecord(),
      accessed_at: "May 4, 2026",
    }, async (file) => {
      const result = await checkSourceLedger({ files: [file], schemaPath });

      expect(result.checkedCount).toBe(1);
      expect(result.failures).toEqual([
        expect.stringContaining(file),
      ]);
      expect(result.failures[0]).toContain("must match pattern");
    });
  });

  it("blocks restricted source types from supporting overclaim phrases", async () => {
    await withTempSourceRecord(
      validSourceRecord({
        source_type: "vendor",
        permitted_uses: ["Use only for feature discovery; do not claim regulatory approval."],
      }),
      async (file) => {
        const result = await checkSourceLedger({ files: [file], schemaPath });

        expect(result.failures).toEqual([
          `${file}: restricted source type cannot support "regulatory approval"`,
        ]);
      },
    );
  });

  it("allows authoritative source types to carry regulatory context without restricted-source overclaim failure", async () => {
    await withTempSourceRecord(
      validSourceRecord({
        source_type: "regulator",
        permitted_uses: ["Use for regulatory approval context when the claim is directly supported."],
      }),
      async (file) => {
        await expect(checkSourceLedger({ files: [file], schemaPath })).resolves.toMatchObject({
          failures: [],
        });
      },
    );
  });
});

function validSourceRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_id: "src-test-source",
    title: "Test Source",
    url: "https://example.test/source",
    source_type: "peer-reviewed",
    citation: "Test citation.",
    accessed_at: "2026-05-04",
    permitted_uses: ["Use for unit-test evidence discipline."],
    claims_supported: ["The checker can validate a source record fixture."],
    claims_not_supported: ["That external claims are true."],
    confidence: 0.9,
    ...overrides,
  };
}

async function withTempSourceRecord(record: Record<string, unknown>, callback: (file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openclinxr-source-ledger-"));
  const file = join(root, "source.json");

  try {
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await callback(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
