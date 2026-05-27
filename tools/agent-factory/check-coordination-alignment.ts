import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type CoordinationAlignmentInput = {
  files: Record<string, string | undefined>;
  packageJson?: {
    scripts?: Record<string, string>;
  };
};

export type CoordinationAlignmentFailure = {
  file: string;
  message: string;
};

export type CoordinationAlignmentReport = {
  ok: boolean;
  checkedFiles: string[];
  failures: CoordinationAlignmentFailure[];
};

const requiredFiles = [
  "AGENTS.md",
  "PROJECT_COORDINATION_INDEX.md",
  "AUTONOMOUS_WORK_PLAN.md",
  "docs/openclinxr/worker-backlog-and-validation-matrix.md",
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.md",
  "docs/openclinxr/doc-authority-registry-2026-05-27.json",
  "docs/agent-factory/README.md",
  "iterations/iteration-0009/07-final-synthesis.md",
] as const;

const requiredMarkers: Record<string, string[]> = {
  "AGENTS.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Instruction Source-Of-Truth Order",
    "Anti-Toil Product Advancement Gate",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
    "Conversation tooling is first-class",
  ],
  "PROJECT_COORDINATION_INDEX.md": [
    "Commit-History Drift Analysis",
    "Active Product Advancement Queue",
    "Evidence-Toil Stop Rule",
    "Sub-Agent Work Order Template",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Protected Blueprint-Factory Guardrails",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
  ],
  "AUTONOMOUS_WORK_PLAN.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Queue",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not run another local voice/model/source-currentness refresh unless a concrete Worker 10 implementation slice needs it.",
    "Protected Blueprint-Factory Guardrails",
    "blueprint-factory-drift-guardrails-2026-05-27.md",
    "doc-authority-registry-2026-05-27.md",
  ],
  "docs/openclinxr/worker-backlog-and-validation-matrix.md": [
    "PROJECT_COORDINATION_INDEX.md",
    "Active Product Advancement Order",
    "Worker 7 plus Worker 8 completed-station faculty review path",
    "Do not toil on evidence refreshes.",
  ],
  "docs/openclinxr/blueprint-factory-drift-guardrails-2026-05-27.md": [
    "Protected Status",
    "must not delete, weaken, bypass, rename, or reinterpret",
    "OpenClinXR is not a collection of handcrafted XR scenes",
    "blueprint-driven encounter factory",
    "Conversation Tooling Is First-Class",
    "Required Slice Gate",
  ],
  "docs/openclinxr/doc-authority-registry-2026-05-27.md": [
    "Doc Authority Registry",
    "Protected Rule",
    "Highest-Value Current Navigation",
    "Cleanup Candidates",
  ],
  "docs/openclinxr/doc-authority-registry-2026-05-27.json": [
    "\"schemaVersion\": \"2026-05-27\"",
    "\"protectedRule\"",
    "\"usageRule\"",
    "\"protected-policy\"",
  ],
  "docs/agent-factory/README.md": [
    "Implementation-Time Steering Rule",
    "PROJECT_COORDINATION_INDEX.md",
    "focus memory",
  ],
  "iterations/iteration-0009/07-final-synthesis.md": [
    "do not let evidence closure become the product",
    "learner, faculty, admin, XR runtime, scenario bank, persistence, provider, or asset pipeline",
  ],
};

const staleAutonomousBreadcrumbPatterns = [
  /^Next Task C\b/mu,
  /^Next Worker \d+\b/mu,
  /^Current continuation default after the 2026-05-21 validation-hardening pass\b/mu,
];

export function buildCoordinationAlignmentReport(input: CoordinationAlignmentInput): CoordinationAlignmentReport {
  const failures: CoordinationAlignmentFailure[] = [];

  for (const file of requiredFiles) {
    const text = input.files[file];
    if (typeof text !== "string") {
      failures.push({ file, message: "required coordination file is missing" });
      continue;
    }

    for (const marker of requiredMarkers[file] ?? []) {
      if (!text.includes(marker)) {
        failures.push({ file, message: `missing alignment marker: ${marker}` });
      }
    }
  }

  const autonomousPlan = input.files["AUTONOMOUS_WORK_PLAN.md"] ?? "";
  for (const pattern of staleAutonomousBreadcrumbPatterns) {
    if (pattern.test(autonomousPlan)) {
      failures.push({
        file: "AUTONOMOUS_WORK_PLAN.md",
        message: `stale historical breadcrumb remains: ${pattern.source}`,
      });
    }
  }

  const scripts = input.packageJson?.scripts ?? {};
  if (scripts["agent:alignment"] !== "tsx tools/agent-factory/check-coordination-alignment.ts") {
    failures.push({
      file: "package.json",
      message: "agent:alignment script must run the coordination alignment hook",
    });
  }
  if (scripts["docs:authority"] !== "tsx tools/agent-factory/build-doc-authority-registry.ts") {
    failures.push({
      file: "package.json",
      message: "docs:authority script must regenerate the Markdown authority registry",
    });
  }
  if (!scripts["agent:verify"]?.startsWith("pnpm agent:alignment && ")) {
    failures.push({
      file: "package.json",
      message: "agent:verify must run agent:alignment before broader agent checks",
    });
  }

  return {
    ok: failures.length === 0,
    checkedFiles: [...requiredFiles, "package.json"],
    failures,
  };
}

function loadInputFromWorkspace(): CoordinationAlignmentInput {
  const files: Record<string, string | undefined> = {};
  for (const file of requiredFiles) {
    files[file] = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  }

  return {
    files,
    packageJson: JSON.parse(readFileSync("package.json", "utf8")) as CoordinationAlignmentInput["packageJson"],
  };
}

async function main(): Promise<void> {
  const report = buildCoordinationAlignmentReport(loadInputFromWorkspace());

  if (report.ok) {
    console.log(`Checked coordination alignment across ${report.checkedFiles.length} files.`);
    return;
  }

  for (const failure of report.failures) {
    console.error(`${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
