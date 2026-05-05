import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CliOptions = {
  auditJsonPath?: string;
  outputPath?: string;
};

type PackageJson = {
  scripts?: Record<string, string>;
};

type PnpmAuditAdvisory = {
  id?: number | string;
  severity?: string;
  module_name?: string;
  vulnerable_versions?: string;
  patched_versions?: string;
  url?: string;
};

type PnpmAuditVulnerability = {
  severity?: string;
  name?: string;
  range?: string;
  via?: Array<string | { source?: number | string; url?: string; title?: string }>;
};

type PnpmAuditJson = {
  advisories?: Record<string, PnpmAuditAdvisory>;
  vulnerabilities?: Record<string, PnpmAuditVulnerability>;
};

type SecurityAuditException = {
  advisory: string;
  packageName: string;
  severity: string;
  affected: string;
  fixed: string;
  rationale: string;
  owner: string;
  reviewBy: string;
  removalCondition: string;
};

type ScriptFinding = {
  scriptName: string;
  finding: string;
  expected?: string;
  actual?: string;
};

type ExceptionFinding = {
  advisory: string;
  packageName: string;
  finding: string;
};

type AuditFinding = {
  advisory: string;
  packageName: string;
  severity: string;
  affected?: string;
  fixed?: string;
};

export type SecurityAuditPolicyReport = {
  generatedAt: string;
  auditEvidence: {
    supplied: boolean;
    sourcePath?: string;
    totalFindingCount: number;
    blockingFindingCount: number;
    blockingSeverityThreshold: "high";
  };
  activeExceptions: SecurityAuditException[];
  scriptFindings: ScriptFinding[];
  exceptionFindings: ExceptionFinding[];
  unresolvedAuditFindings: AuditFinding[];
  verdict: {
    passed: boolean;
    scriptFindingCount: number;
    exceptionFindingCount: number;
    unresolvedAuditFindingCount: number;
  };
};

const requiredScripts: Record<string, string> = {
  "security:audit": "pnpm audit --audit-level=high",
  "security:audit:prod": "pnpm audit --prod --audit-level=high",
  "security:audit:dev": "pnpm audit --dev --audit-level=high",
  "security:audit-policy": "tsx tools/openclinxr/check-security-audit-policy.ts",
  "security:licenses": "tsx tools/openclinxr/check-license-policy.ts",
};

const requiredExceptionColumns = [
  "advisory",
  "package",
  "severity",
  "affected",
  "fixed",
  "rationale",
  "owner",
  "review-by",
  "removal condition",
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [rootPackageJson, exceptionsMarkdown, auditJson] = await Promise.all([
    readJsonFile<PackageJson>("package.json"),
    readFile("docs/openclinxr/security-audit-exceptions.md", "utf8"),
    options.auditJsonPath ? readJsonFile<PnpmAuditJson>(options.auditJsonPath) : undefined,
  ]);
  const report = buildSecurityAuditPolicyReport({
    rootPackageJson,
    exceptionsMarkdown,
    auditJson,
    auditJsonSourcePath: options.auditJsonPath,
    now: new Date(),
  });

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote ${options.outputPath}`);
  }

  if (!report.verdict.passed) {
    for (const finding of report.scriptFindings) {
      console.error(`${finding.scriptName}: ${finding.finding}`);
    }
    for (const finding of report.exceptionFindings) {
      console.error(`${finding.advisory} ${finding.packageName}: ${finding.finding}`);
    }
    for (const finding of report.unresolvedAuditFindings) {
      console.error(`${finding.packageName} ${finding.advisory}: unresolved ${finding.severity} audit finding`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Checked security audit policy; ${report.activeExceptions.length} active exception${report.activeExceptions.length === 1 ? "" : "s"}.`,
  );
}

export function buildSecurityAuditPolicyReport(input: {
  rootPackageJson: PackageJson;
  exceptionsMarkdown: string;
  auditJson?: PnpmAuditJson;
  auditJsonSourcePath?: string;
  now?: Date;
}): SecurityAuditPolicyReport {
  const scriptFindings = evaluateScripts(input.rootPackageJson.scripts ?? {});
  const exceptionParse = parseActiveExceptions(input.exceptionsMarkdown);
  const exceptionFindings = [
    ...exceptionParse.findings,
    ...exceptionParse.exceptions.flatMap(validateException),
  ];
  const allAuditFindings = auditFindings(input.auditJson ?? {});
  const blockingAuditFindings = allAuditFindings.filter((finding) => isBlockingSeverity(finding.severity));
  const unresolvedAuditFindings = blockingAuditFindings
    .filter((finding) => !hasMatchingException(finding, exceptionParse.exceptions));

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    auditEvidence: {
      supplied: input.auditJson !== undefined,
      sourcePath: input.auditJsonSourcePath,
      totalFindingCount: allAuditFindings.length,
      blockingFindingCount: blockingAuditFindings.length,
      blockingSeverityThreshold: "high",
    },
    activeExceptions: exceptionParse.exceptions,
    scriptFindings,
    exceptionFindings,
    unresolvedAuditFindings,
    verdict: {
      passed: scriptFindings.length === 0 && exceptionFindings.length === 0 && unresolvedAuditFindings.length === 0,
      scriptFindingCount: scriptFindings.length,
      exceptionFindingCount: exceptionFindings.length,
      unresolvedAuditFindingCount: unresolvedAuditFindings.length,
    },
  };
}

function evaluateScripts(scripts: Record<string, string>): ScriptFinding[] {
  const findings: ScriptFinding[] = [];

  for (const [scriptName, expected] of Object.entries(requiredScripts)) {
    const actual = scripts[scriptName];
    if (actual !== expected) {
      findings.push({
        scriptName,
        finding: `${scriptName.replace(/:/g, "_")}_script_must_run_exact_${scriptName === "security:audit" ? "pnpm_audit_gate" : "command"}`,
        expected,
        actual,
      });
    }
  }

  const verify = scripts.verify ?? "";
  const requiredVerifyOrder = ["pnpm security:audit", "pnpm security:audit-policy", "pnpm security:licenses"];
  let lastIndex = -1;
  for (const command of requiredVerifyOrder) {
    const index = verify.indexOf(command);
    if (index === -1) {
      findings.push({
        scriptName: "verify",
        finding: "verify_script_missing_security_gate",
        expected: command,
        actual: verify,
      });
      continue;
    }
    if (index < lastIndex) {
      findings.push({
        scriptName: "verify",
        finding: "verify_script_security_gates_out_of_order",
        expected: requiredVerifyOrder.join(" before "),
        actual: verify,
      });
    }
    lastIndex = index;
  }

  return findings;
}

function parseActiveExceptions(markdown: string): { exceptions: SecurityAuditException[]; findings: ExceptionFinding[] } {
  const section = activeExceptionsSection(markdown);
  const nonEmptyLines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  if (nonEmptyLines.length === 0 || nonEmptyLines.some((line) => line === "None.")) {
    return { exceptions: [], findings: [] };
  }

  const tableLines = nonEmptyLines.filter((line) => line.startsWith("|"));
  if (tableLines.length < 2) {
    return {
      exceptions: [],
      findings: [{ advisory: "unknown", packageName: "unknown", finding: "active_exceptions_table_missing" }],
    };
  }

  const headers = splitMarkdownRow(tableLines[0]).map(normalizeHeader);
  const missingColumns = requiredExceptionColumns.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    return {
      exceptions: [],
      findings: missingColumns.map((column) => ({
        advisory: "unknown",
        packageName: "unknown",
        finding: `active_exception_missing_column_${column.replace(/\s+/g, "_")}`,
      })),
    };
  }

  const exceptions = tableLines.slice(2).map((line) => {
    const cells = splitMarkdownRow(line);
    const cellFor = (column: string) => cells[headers.indexOf(column)]?.trim() ?? "";
    return {
      advisory: cellFor("advisory"),
      packageName: cellFor("package"),
      severity: cellFor("severity").toLowerCase(),
      affected: cellFor("affected"),
      fixed: cellFor("fixed"),
      rationale: cellFor("rationale"),
      owner: cellFor("owner"),
      reviewBy: cellFor("review-by"),
      removalCondition: cellFor("removal condition"),
    };
  });

  return { exceptions, findings: [] };
}

function activeExceptionsSection(markdown: string): string {
  const start = markdown.search(/^## Active Exceptions\s*$/m);
  if (start === -1) {
    return "";
  }
  const bodyStart = markdown.indexOf("\n", start);
  if (bodyStart === -1) {
    return "";
  }
  const rest = markdown.slice(bodyStart + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function splitMarkdownRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function validateException(exception: SecurityAuditException): ExceptionFinding[] {
  const requiredFields: Array<[keyof SecurityAuditException, string]> = [
    ["advisory", "active_exception_missing_advisory"],
    ["packageName", "active_exception_missing_package"],
    ["severity", "active_exception_missing_severity"],
    ["affected", "active_exception_missing_affected"],
    ["fixed", "active_exception_missing_fixed"],
    ["rationale", "active_exception_missing_rationale"],
    ["owner", "active_exception_missing_owner"],
    ["reviewBy", "active_exception_missing_review_by"],
    ["removalCondition", "active_exception_missing_removal_condition"],
  ];
  return requiredFields
    .filter(([field]) => exception[field].trim().length === 0)
    .map(([, finding]) => ({
      advisory: exception.advisory || "unknown",
      packageName: exception.packageName || "unknown",
      finding,
    }));
}

function auditFindings(auditJson: PnpmAuditJson): AuditFinding[] {
  const advisoryFindings = Object.values(auditJson.advisories ?? {}).map((advisory) => ({
    advisory: advisoryId(advisory.url, advisory.id),
    packageName: advisory.module_name ?? "unknown",
    severity: advisory.severity ?? "unknown",
    affected: advisory.vulnerable_versions,
    fixed: advisory.patched_versions,
  }));

  const vulnerabilityFindings = Object.entries(auditJson.vulnerabilities ?? {}).map(([name, vulnerability]) => ({
    advisory: vulnerabilityAdvisoryId(vulnerability),
    packageName: vulnerability.name ?? name,
    severity: vulnerability.severity ?? "unknown",
    affected: vulnerability.range,
  }));

  return [...advisoryFindings, ...vulnerabilityFindings];
}

function advisoryId(url: string | undefined, fallback: number | string | undefined): string {
  const ghsa = url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
  return ghsa ?? (fallback === undefined ? "unknown" : String(fallback));
}

function vulnerabilityAdvisoryId(vulnerability: PnpmAuditVulnerability): string {
  for (const via of vulnerability.via ?? []) {
    if (typeof via === "string") {
      const ghsa = via.match(/GHSA-[a-z0-9-]+/i)?.[0];
      if (ghsa) {
        return ghsa;
      }
      continue;
    }
    const ghsa = via.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
    if (ghsa) {
      return ghsa;
    }
    if (via.source !== undefined) {
      return String(via.source);
    }
  }
  return "unknown";
}

function isBlockingSeverity(severity: string): boolean {
  return ["high", "critical"].includes(severity.toLowerCase());
}

function hasMatchingException(finding: AuditFinding, exceptions: SecurityAuditException[]): boolean {
  return exceptions.some((exception) =>
    exception.advisory === finding.advisory
    && exception.packageName === finding.packageName
    && exception.severity.toLowerCase() === finding.severity.toLowerCase()
  );
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--audit-json") {
      options.auditJsonPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
