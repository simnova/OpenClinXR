import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIwsdkSourceRecordIdContract } from "../../packages/openclinxr/iwsdk-spike/src/index.js";
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

  it("reports malformed source JSON with the offending file path and continues checking", async () => {
    await withTempSourceFiles(["{ \"source_id\": ", JSON.stringify(validSourceRecord())], async ([malformedFile, validFile]) => {
      const result = await checkSourceLedger({ files: [malformedFile, validFile], schemaPath });

      expect(result.checkedCount).toBe(2);
      expect(result.failures).toEqual([
        expect.stringContaining(malformedFile),
      ]);
      expect(result.failures[0]).toContain("could not read source record");
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

  it("reports required source IDs that are missing from the provided ledger files", async () => {
    await withTempSourceRecord(validSourceRecord({ source_id: "src-present" }), async (file) => {
      const result = await checkSourceLedger({
        files: [file],
        schemaPath,
        requiredSourceIds: ["src-present", "src-missing"],
      });

      expect(result).toEqual({
        checkedCount: 1,
        failures: ["missing required source record src-missing"],
      });
    });
  });

  it("resolves every IWSDK planning source ID through the committed source ledger", async () => {
    await expect(checkSourceLedger({
      requiredSourceIds: buildIwsdkSourceRecordIdContract().sourceRecordIds,
    })).resolves.toMatchObject({
      failures: [],
    });
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
  await withTempSourceFiles([JSON.stringify(record, null, 2)], async ([file]) => callback(file));
}

async function withTempSourceFiles(contents: string[], callback: (files: string[]) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openclinxr-source-ledger-"));
  const files = contents.map((_, index) => join(root, `source-${index + 1}.json`));

  try {
    await Promise.all(contents.map((content, index) => writeFile(files[index], `${content}\n`, "utf8")));
    await callback(files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
