import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeGeneratedRuntimeAssetWithManifest } from "../../packages/openclinxr/asset-registry/src/asset-writer.js";
import { buildAzuriteConnectionSummary, createAzuriteAssetObjectStore } from "../../packages/openclinxr/asset-registry/src/object-store.js";
import { buildGeneratedHumanRiggingRuntimeAssetReference, defaultGeneratedHumanRiggingReportPath, type GeneratedHumanRiggingReport } from "./generated-human-rigging-artifacts.js";

export type AzuriteAssetUploadSmokeReport = {
  schemaVersion: "openclinxr.azurite-asset-upload-smoke.v1";
  generatedAt: string;
  mode: "validate" | "attempt_upload";
  emulator: ReturnType<typeof buildAzuriteConnectionSummary>;
  status: "uploaded" | "not_configured" | "failed";
  productionCloudCall: false;
  asset?: {
    assetId: string;
    blobName: string;
    url: string;
    manifestBlobName?: string | undefined;
    contentType: string | null;
  } | undefined;
  blocker: string | null;
  nextOperatorAction: string | null;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

type CliOptions = {
  reportPath: string;
  outputPath: string;
  validateLatest: boolean;
  attemptUpload: boolean;
  help: boolean;
};

const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export function defaultAzuriteAssetUploadSmokeReportPath(date = new Date()): string {
  return path.join("docs/openclinxr", `azurite-asset-upload-smoke-${date.toISOString().slice(0, 10)}.json`);
}

export async function runAzuriteAssetUploadSmokeCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args);
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (options.validateLatest) {
    const reportPath = options.outputPath;
    const report = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    const validation = validateAzuriteAssetUploadSmokeReport(report);
    if (!validation.ok) {
      process.stderr.write(`Azurite asset upload smoke validation failed:\n${validation.errors.join("\n")}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const report = options.attemptUpload
    ? await attemptGeneratedHumanoidUpload(options.reportPath)
    : buildNotConfiguredReport("validate", "upload_not_requested", "Run with --attempt-upload while Azurite is running to upload the generated humanoid GLB.");

  await mkdir(path.dirname(path.resolve(options.outputPath)), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const validation = validateAzuriteAssetUploadSmokeReport(report);
  if (!validation.ok) {
    process.stderr.write(`Azurite asset upload smoke validation failed:\n${validation.errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Azurite asset upload smoke status: ${report.status}\n`);
}

export async function attemptGeneratedHumanoidUpload(reportPath: string): Promise<AzuriteAssetUploadSmokeReport> {
  if (!existsSync(path.resolve(reportPath))) {
    return buildNotConfiguredReport(
      "attempt_upload",
      "generated_human_rigging_report_missing",
      `Generate or validate human rigging artifacts first: ${reportPath}`,
    );
  }

  const sourceReport = JSON.parse(await readFile(reportPath, "utf8")) as GeneratedHumanRiggingReport;
  const runtimeAsset = buildGeneratedHumanRiggingRuntimeAssetReference(sourceReport);
  const glbPath = path.resolve(sourceReport.artifacts.glbPath);
  if (!existsSync(glbPath)) {
    return buildNotConfiguredReport(
      "attempt_upload",
      "generated_humanoid_glb_missing",
      `Generate the humanoid GLB first: ${sourceReport.artifacts.glbPath}`,
    );
  }

  const accountKey = process.env.AZURITE_ACCOUNT_KEY || process.env.OPENCLINXR_AZURITE_ACCOUNT_KEY;
  if (!accountKey) {
    return buildNotConfiguredReport(
      "attempt_upload",
      "azurite_account_key_missing",
      "Set AZURITE_ACCOUNT_KEY for the local emulator before attempting upload.",
    );
  }

  try {
    const store = createAzuriteAssetObjectStore({ accountKey });
    const writeResult = await writeGeneratedRuntimeAssetWithManifest({
      store,
      asset: runtimeAsset,
      body: await readFile(glbPath),
      storedAt: new Date().toISOString(),
    });
    return {
      schemaVersion: "openclinxr.azurite-asset-upload-smoke.v1",
      generatedAt: new Date().toISOString(),
      mode: "attempt_upload",
      emulator: buildAzuriteConnectionSummary(),
      status: "uploaded",
      productionCloudCall: false,
      asset: {
        assetId: runtimeAsset.assetId,
        blobName: writeResult.assetPut.blobName,
        url: writeResult.assetPut.url,
        manifestBlobName: writeResult.manifestBlobName,
        contentType: runtimeAsset.blob.contentType ?? null,
      },
      blocker: null,
      nextOperatorAction: null,
      notEvidenceFor: [...NOT_EVIDENCE_FOR],
    };
  } catch (error) {
    return buildNotConfiguredReport(
      "attempt_upload",
      `azurite_upload_failed:${formatUnknownError(error)}`,
      "Start Azurite, create the openclinxr-assets container if needed, and retry the smoke upload.",
    );
  }
}

export function validateAzuriteAssetUploadSmokeReport(report: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(report)) return { ok: false, errors: ["/ must be an object"] };
  if (report.schemaVersion !== "openclinxr.azurite-asset-upload-smoke.v1") errors.push("/schemaVersion invalid");
  if (report.productionCloudCall !== false) errors.push("/productionCloudCall must be false");
  if (!["uploaded", "not_configured", "failed"].includes(String(report.status))) errors.push("/status invalid");
  if (!["validate", "attempt_upload"].includes(String(report.mode))) errors.push("/mode invalid");
  const emulator = isRecord(report.emulator) ? report.emulator : {};
  if (emulator.storeKind !== "azurite_blob") errors.push("/emulator/storeKind must be azurite_blob");
  if (emulator.productionCloudCall !== false) errors.push("/emulator/productionCloudCall must be false");
  const notEvidenceFor = Array.isArray(report.notEvidenceFor) ? report.notEvidenceFor : [];
  for (const required of NOT_EVIDENCE_FOR) {
    if (!notEvidenceFor.includes(required)) errors.push(`/notEvidenceFor must include ${required}`);
  }
  if (report.status === "uploaded") {
    const asset = isRecord(report.asset) ? report.asset : {};
    if (typeof asset.assetId !== "string" || asset.assetId.length === 0) errors.push("/asset/assetId required when uploaded");
    if (typeof asset.url !== "string" || !asset.url.startsWith("http://127.0.0.1:10000/")) {
      errors.push("/asset/url must be local Azurite URL when uploaded");
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildNotConfiguredReport(
  mode: AzuriteAssetUploadSmokeReport["mode"],
  blocker: string,
  nextOperatorAction: string,
): AzuriteAssetUploadSmokeReport {
  return {
    schemaVersion: "openclinxr.azurite-asset-upload-smoke.v1",
    generatedAt: new Date().toISOString(),
    mode,
    emulator: buildAzuriteConnectionSummary(),
    status: "not_configured",
    productionCloudCall: false,
    blocker,
    nextOperatorAction,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    reportPath: defaultGeneratedHumanRiggingReportPath(),
    outputPath: defaultAzuriteAssetUploadSmokeReportPath(),
    validateLatest: false,
    attemptUpload: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--attempt-upload") options.attemptUpload = true;
    else if (arg === "--report") options.reportPath = requireNext(args, ++index, arg);
    else if (arg === "--output") options.outputPath = requireNext(args, ++index, arg);
  }
  return options;
}

function requireNext(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function helpText(): string {
  return [
    "Usage: tsx tools/openclinxr/azurite-asset-upload-smoke.ts [options]",
    "  --attempt-upload        Upload generated humanoid GLB to local Azurite if configured",
    "  --report <path>         Generated human rigging report path",
    "  --output <path>         Smoke report output path",
    "  --validate-latest       Validate the smoke report output path",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return `${error.name}:${error.message}`;
  return String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runAzuriteAssetUploadSmokeCli();
}
