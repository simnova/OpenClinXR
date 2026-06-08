import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGrokRepoAgentSpawnSpec,
  formatGrokRepoAgentSpawnBrief,
} from "../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
import {
  getRepoRoleHarnessPolicy,
  resolveHarnessModelSpec,
  shouldRecommendMoonbridgeAssist,
  type RepoWorkflowSkillId,
} from "../../packages/openclinxr/agent-loop/src/role-harness-policy.js";

const skillPaths: Record<RepoWorkflowSkillId, string> = {
  "openclinxr-openclaw": ".agents/skills/openclinxr-openclaw/SKILL.md",
  "anny-asset-pipeline": ".agents/skills/anny-asset-pipeline/SKILL.md",
  "provider-boundary": ".agents/skills/provider-boundary/SKILL.md",
  "turborepo-skill": ".agents/skills/turborepo/SKILL.md",
  "ant-design-cli-skill": ".agents/skills/antd/SKILL.md",
};

type RoleEntry = {
  group: string;
  role: string;
  roleDir: string;
};

const harnesses = [".grok", ".claude", ".cursor", ".codex"] as const;
const repoRoot = process.cwd();

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function multilineToml(value: string): string {
  return `"""\n${value.replaceAll('"""', '\\"\\"\\"')}\n"""`;
}

async function discoverRoles(): Promise<RoleEntry[]> {
  const roles: RoleEntry[] = [];
  const groups = await readdir(path.join(repoRoot, "agents"), { withFileTypes: true });
  for (const group of groups.filter((entry) => entry.isDirectory())) {
    const groupDir = path.join(repoRoot, "agents", group.name);
    const roleDirs = await readdir(groupDir, { withFileTypes: true });
    for (const role of roleDirs.filter((entry) => entry.isDirectory())) {
      const roleDir = path.join("agents", group.name, role.name);
      const required = ["charter.md", "memory.md", "index.json"].map((file) => path.join(repoRoot, roleDir, file));
      const exists = await Promise.all(
        required.map(async (filePath) => {
          try {
            await access(filePath);
            return true;
          } catch {
            return false;
          }
        }),
      );
      if (exists.every(Boolean)) {
        roles.push({ group: group.name, role: role.name, roleDir });
      }
    }
  }
  return roles.sort((left, right) => left.role.localeCompare(right.role));
}

function codexTomlForRole(role: RoleEntry): string {
  const policy =
    getRepoRoleHarnessPolicy(role.role) ??
    ({
      roleId: role.role,
      policyTier: "fast_bounded",
      taskType: "bounded_scout",
      sandboxMode: "read-only",
      recommendedSkills: ["openclinxr-openclaw"],
      moonbridgeAssistOnCodex: true,
      writeScopeNote: "Read-only repo-agent consultation unless explicitly assigned a non-overlapping write scope.",
    } as const);
  const modelSpec = resolveHarnessModelSpec(policy.policyTier, "codex");
  const moonbridgeNote = shouldRecommendMoonbridgeAssist("codex", policy)
    ? " Codex Desktop cannot select DeepSeek in the model picker; optional Moonbridge (`pnpm local:moonbridge:probe`) is allowed only for bounded first-pass review, not implementation or readiness judgment."
    : "";
  const skillNote =
    policy.recommendedSkills.length > 0
      ? ` Recommended skills: ${policy.recommendedSkills.map((skill) => skillPaths[skill]).join(", ")}.`
      : "";
  const description = `Repo role ${role.role} for OpenClinXR OpenClaw-style / OpenClaw-inspired consultation. Use when this role materially reduces drift, review cost, or implementation risk.`;
  const instructions = [
    `TERSE PERSONA CONTRACT (all): Read your charter ## Persona first. ≤100 words. Bullets path:line only. End with 'Recommended next: <name> (Q#)'. You are the ${role.role} repo-defined role for /Volumes/files/src/openclinxr.`,
    "This is an OpenClaw-style / OpenClaw-inspired file-backed workflow, not an external OpenClaw runtime.",
    "First confirm AGENTS.md, PROJECT_STATUS.md, docs/agent-factory/**, agents/**, and tools/agent-factory/** exist before drawing repo-native conclusions.",
    `Read ${role.roleDir}/charter.md and ${role.roleDir}/memory.md with a tight limit, plus agents/rules/agent-consult.md and agents/rules/subagent-protocol.md.`,
    "Follow the source-of-truth order in AGENTS.md. Preserve protected blueprint-factory guardrails.",
    policy.writeScopeNote,
    skillNote,
    moonbridgeNote,
    "Return concise findings, blockers, and recommended next slice.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `name = ${tomlString(role.role)}`,
    `description = ${tomlString(description)}`,
    `model = ${tomlString(modelSpec.model)}`,
    `model_reasoning_effort = ${tomlString(modelSpec.reasoningEffort)}`,
    `sandbox_mode = ${tomlString(policy.sandboxMode)}`,
    `developer_instructions = ${multilineToml(instructions)}`,
    "",
  ].join("\n");
}

function pointerMarkdown(role: RoleEntry): string {
  const spawn = buildGrokRepoAgentSpawnSpec({
    roleId: role.role,
    roleDir: role.roleDir,
    group: role.group,
  });
  const spawnLines = spawn.spawnSubagentCall
    ? [
        "",
        "## Grok spawn spec (generated from role-harness-policy)",
        "",
        `- ${formatGrokRepoAgentSpawnBrief(spawn)}`,
        `- CLI: \`pnpm grok:agent:spawn-spec -- --role ${role.role}\``,
        `- subagent_type: \`${spawn.spawnSubagentCall.subagent_type}\``,
        `- capability_mode: \`${spawn.spawnSubagentCall.capability_mode}\``,
        `- model: \`${spawn.model}\` (${spawn.policyTier})`,
        "",
      ].join("\n")
    : [
        "",
        "## Grok spawn spec (generated from role-harness-policy)",
        "",
        `- ${formatGrokRepoAgentSpawnBrief(spawn)}`,
        `- CLI: use Composer / grok-build — \`pnpm grok:agent:spawn-spec -- --role ${role.role}\``,
        "",
      ].join("\n");

  return `# ${role.role} (repo role pointer)

Canonical: \`${role.roleDir}/charter.md\`, \`${role.roleDir}/memory.md\`, and \`${role.roleDir}/index.json\`.

Group: \`${role.group}\`.

Use for: role-mapped repo-agent consultation or a live subagent prompt when the current harness supports subagents and the task materially reduces drift, review cost, or implementation risk.

This is an OpenClaw-style / OpenClaw-inspired workflow pointer, not an external OpenClaw runtime.

Target repo /Volumes/files/src/openclinxr.
${spawnLines}
Spawn/local-consult prompt seed: "${spawn.spawnPrompt}"
`;
}

async function main(): Promise<void> {
  const roles = await discoverRoles();
  const list = roles.map(({ role }) => `- ${role}`).join("\n");
  const readme = `# Repo-defined agent role pointers

Canonical role definitions live under root \`agents/**\` with \`charter.md\`, \`memory.md\`, and \`index.json\`.

These files are safe harness-local pointers only. They do not duplicate role memory or replace the source-of-truth order in \`AGENTS.md\`.

This repo uses an OpenClaw-style / OpenClaw-inspired file-backed workflow, not an external OpenClaw runtime.

Roles:
${list}

Use \`agents/rules/agent-consult.md\` and \`agents/rules/subagent-protocol.md\` before mapping a live subagent or local role consultation.

For Codex, sibling \`.toml\` files are native project custom-agent definitions generated from \`packages/openclinxr/agent-loop/src/role-harness-policy.ts\`; the Markdown files remain lightweight human/cross-harness pointers.
`;

  for (const harness of harnesses) {
    const dir = path.join(repoRoot, harness, "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "README.md"), readme);
    for (const role of roles) {
      await writeFile(path.join(dir, `${role.role}.md`), pointerMarkdown(role));
      if (harness === ".codex") {
        await writeFile(path.join(dir, `${role.role}.toml`), codexTomlForRole(role));
      }
    }
  }

  console.log(
    `Generated ${roles.length} role pointer files for ${harnesses.join(", ")} plus Codex TOML custom agents from role-harness-policy.`,
  );
}

await main();