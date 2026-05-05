import { describe, expect, it } from "vitest";
import { buildSecurityAuditPolicyReport } from "./check-security-audit-policy.js";

const basePackageJson = {
  scripts: {
    verify: "pnpm agent:verify && pnpm typecheck && pnpm test && pnpm security:audit && pnpm security:audit-policy && pnpm security:licenses",
    "security:audit": "pnpm audit --audit-level=high",
    "security:audit:prod": "pnpm audit --prod --audit-level=high",
    "security:audit:dev": "pnpm audit --dev --audit-level=high",
    "security:audit-policy": "tsx tools/openclinxr/check-security-audit-policy.ts",
    "security:licenses": "tsx tools/openclinxr/check-license-policy.ts",
  },
};

const baseExceptionsMarkdown = `# Security Audit Exceptions

## Active Exceptions

None.
`;

describe("security audit policy", () => {
  it("accepts the hard pnpm audit gate with no active exceptions", () => {
    const report = buildSecurityAuditPolicyReport({
      rootPackageJson: basePackageJson,
      exceptionsMarkdown: baseExceptionsMarkdown,
    });

    expect(report.verdict.passed).toBe(true);
    expect(report.scriptFindings).toEqual([]);
    expect(report.exceptionFindings).toEqual([]);
    expect(report.unresolvedAuditFindings).toEqual([]);
  });

  it("rejects weakened audit scripts that make pnpm audit non-blocking", () => {
    const report = buildSecurityAuditPolicyReport({
      rootPackageJson: {
        scripts: {
          ...basePackageJson.scripts,
          "security:audit": "echo pnpm audit --audit-level=high || true",
        },
      },
      exceptionsMarkdown: baseExceptionsMarkdown,
    });

    expect(report.verdict.passed).toBe(false);
    expect(report.scriptFindings).toEqual([
      expect.objectContaining({
        scriptName: "security:audit",
        finding: "security_audit_script_must_run_exact_pnpm_audit_gate",
      }),
    ]);
  });

  it("rejects high or critical audit findings without a matching active exception", () => {
    const report = buildSecurityAuditPolicyReport({
      rootPackageJson: basePackageJson,
      exceptionsMarkdown: baseExceptionsMarkdown,
      auditJson: {
        advisories: {
          "123": {
            id: 123,
            severity: "high",
            module_name: "risky-package",
            vulnerable_versions: "<2.0.0",
            patched_versions: ">=2.0.0",
            url: "https://github.com/advisories/GHSA-test-1234",
          },
        },
      },
    });

    expect(report.verdict.passed).toBe(false);
    expect(report.unresolvedAuditFindings).toEqual([
      expect.objectContaining({
        advisory: "GHSA-test-1234",
        packageName: "risky-package",
        severity: "high",
      }),
    ]);
  });

  it("rejects active exceptions missing owner and review metadata", () => {
    const report = buildSecurityAuditPolicyReport({
      rootPackageJson: basePackageJson,
      exceptionsMarkdown: `# Security Audit Exceptions

## Active Exceptions

| Advisory | Package | Severity | Affected | Fixed | Rationale | Owner | Review-by | Removal condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GHSA-test-1234 | risky-package | high | <2.0.0 | >=2.0.0 | Waiting for upstream. |  |  | Remove after upgrade. |
`,
    });

    expect(report.verdict.passed).toBe(false);
    expect(report.exceptionFindings).toEqual([
      expect.objectContaining({
        advisory: "GHSA-test-1234",
        finding: "active_exception_missing_owner",
      }),
      expect.objectContaining({
        advisory: "GHSA-test-1234",
        finding: "active_exception_missing_review_by",
      }),
    ]);
  });

  it("accepts a matching high advisory only when a complete active exception is recorded", () => {
    const report = buildSecurityAuditPolicyReport({
      rootPackageJson: basePackageJson,
      exceptionsMarkdown: `# Security Audit Exceptions

## Active Exceptions

| Advisory | Package | Severity | Affected | Fixed | Rationale | Owner | Review-by | Removal condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GHSA-test-1234 | risky-package | high | <2.0.0 | >=2.0.0 | Waiting for upstream release in a dev-only path. | security-privacy-lead | 2026-06-04 | Remove after risky-package reaches 2.0.0. |
`,
      auditJson: {
        advisories: {
          "123": {
            id: 123,
            severity: "high",
            module_name: "risky-package",
            vulnerable_versions: "<2.0.0",
            patched_versions: ">=2.0.0",
            url: "https://github.com/advisories/GHSA-test-1234",
          },
        },
      },
    });

    expect(report.verdict.passed).toBe(true);
    expect(report.unresolvedAuditFindings).toEqual([]);
  });
});
