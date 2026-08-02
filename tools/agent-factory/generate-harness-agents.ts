import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildGrokRepoAgentSpawnSpec,
  formatGrokRepoAgentSpawnBrief,
} from "../../packages/openclinxr/agent-loop/src/grok-repo-agent-spawn.js";
import {
  disallowedToolsForRole,
  getRepoRoleHarnessPolicy,
  getRolePathScope,
  PREFERRED_CLI_SOFT_WARN,
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

function defaultPolicy(roleId: string) {
  return (
    getRepoRoleHarnessPolicy(roleId) ?? {
      roleId,
      policyTier: "fast_bounded" as const,
      taskType: "bounded_scout" as const,
      sandboxMode: "read-only" as const,
      recommendedSkills: ["openclinxr-openclaw" as const],
      moonbridgeAssistOnCodex: true,
      writeScopeNote:
        "Read-only repo-agent consultation unless explicitly assigned a non-overlapping write scope.",
      pathScope: getRolePathScope(roleId),
    }
  );
}

/** Cross-harness lightweight pointer (no multi-KB spawn seed). */
function pointerMarkdown(role: RoleEntry): string {
  const spawn = buildGrokRepoAgentSpawnSpec({
    roleId: role.role,
    roleDir: role.roleDir,
    group: role.group,
  });
  const spawnLines = spawn.spawnSubagentCall
    ? [
        "",
        "## Grok spawn spec (from role-harness-policy)",
        "",
        `- ${formatGrokRepoAgentSpawnBrief(spawn)}`,
        `- CLI: \`pnpm grok:agent:spawn-spec -- --role ${role.role}\``,
        `- subagent_type: \`${spawn.spawnSubagentCall.subagent_type}\``,
        `- capability_mode: \`${spawn.spawnSubagentCall.capability_mode}\``,
        `- model: \`${spawn.model}\` (${spawn.policyTier})`,
        "",
        "Build full spawn prompts at runtime via spawn-spec — do not embed fat seeds here.",
        "",
      ].join("\n")
    : [
        "",
        "## Grok spawn spec (from role-harness-policy)",
        "",
        `- ${formatGrokRepoAgentSpawnBrief(spawn)}`,
        `- CLI: Composer / grok-build — \`pnpm grok:agent:spawn-spec -- --role ${role.role}\``,
        "",
      ].join("\n");

  return `# ${role.role} (repo role pointer)

Canonical: \`${role.roleDir}/charter.md\`, \`${role.roleDir}/memory.md\`, and \`${role.roleDir}/index.json\`.

Group: \`${role.group}\`.

Use for: role-mapped repo-agent consultation or a live subagent when this role reduces drift/review/implementation risk.

OpenClaw-style file-backed workflow (not an external OpenClaw runtime). Target: \`/Volumes/files/src/openclinxr\`.

**CLI-first barriers:** \`docs/TOOLING.md\` — prefer \`gh\`, \`pnpm playwright:*\`, \`pnpm browser:agent\`, \`pnpm env:doctor\` over disabled MCPs.
${spawnLines}
Read charter ## Persona first. Follow \`agents/rules/agent-consult.md\` + LEX_AGENTIC.
`;
}

/**
 * Grok-native agent definition (user-guide 16-subagents): YAML frontmatter + short body.
 * Avoids legacy multi-KB spawn seeds; CLI-first MCP policy.
 */
function grokNativeAgentMarkdown(role: RoleEntry): string {
  const policy = defaultPolicy(role.role);
  const modelSpec = resolveHarnessModelSpec(policy.policyTier, "grok");
  const spawn = buildGrokRepoAgentSpawnSpec({
    roleId: role.role,
    roleDir: role.roleDir,
    group: role.group,
  });
  const readOnly = policy.sandboxMode === "read-only";
  const permissionMode = readOnly ? "plan" : "default";
  // Wave B1: per-role tool surface (image tools for non-visual; workflow/spawn bans)
  const disallowed = disallowedToolsForRole(role.role, policy);
  const description = [
    `OpenClinXR role ${role.role} (${role.group}).`,
    policy.writeScopeNote,
    "CLI-first tools; see docs/TOOLING.md.",
  ].join(" ");

  const yaml = [
    "---",
    `name: ${role.role}`,
    "description: >",
    `  ${description}`,
    "prompt_mode: full",
    `model: ${modelSpec.model}`,
    `permission_mode: ${permissionMode}`,
    // Specialists: false so role agents do not auto-inject full AGENTS.md (orchestrator.md is hand-written, agents_md: true).
    "agents_md: false",
    "disallowedTools:",
    ...disallowed.map((t) => `  - ${t}`),
    "mcpInheritance: none",
    "---",
    "",
  ].join("\n");

  const body = [
    `ROLE: **${role.role}** (group \`${role.group}\`).`,
    "",
    "## Canonical OpenClaw sources",
    "",
    `- Charter: \`${role.roleDir}/charter.md\` (read ## Persona first)`,
    `- Memory: \`${role.roleDir}/memory.md\``,
    `- Index: \`${role.roleDir}/index.json\``,
    "",
    "## Tool policy (Grok 4.5+)",
    "",
    "| Prefer | Avoid |",
    "|--------|-------|",
    "| Shell CLIs: `gh`, `pnpm playwright:*`, `pnpm browser:agent`, `pnpm env:doctor` | Disabled MCPs: playwright, chrome-devtools, agent-browser, grok_com_github |",
    "| `pnpm grok:agent:spawn-spec` for full prompts | Fat spawn seeds in this file |",
    "| Optional MCP: drawio / mongodb when no CLI | Always-on browser/GitHub MCP |",
    "",
    "## Scope",
    "",
    policy.writeScopeNote,
    "",
    `Policy tier: \`${policy.policyTier}\` · model: \`${modelSpec.model}\` · effort: \`${modelSpec.reasoningEffort}\` · sandbox: \`${policy.sandboxMode}\`.`,
    spawn.spawnSubagentCall
      ? `Spawn: subagent_type=\`${spawn.spawnSubagentCall.subagent_type}\` capability_mode=\`${spawn.spawnSubagentCall.capability_mode}\`.`
      : "Spawn: Composer / frontier surface (not a cheap subagent).",
    "",
    "## Path scope (ATL-style)",
    "",
    "### Write roots",
    "| Path |",
    "|------|",
    ...policy.pathScope.writeRoots.map((p) => `| \`${p}\` |`),
    "",
    "### Forbidden",
    "| Path |",
    "|------|",
    ...policy.pathScope.forbidden.map((p) => `| \`${p}\` |`),
    "",
    "### Read preference",
    ...policy.pathScope.readRoots.slice(0, 10).map((p) => `- \`${p}\``),
    ...(policy.pathScope.readRoots.length > 10 ? [`- ... +${policy.pathScope.readRoots.length - 10} more`] : []),
    "",
    "### Output roots",
    ...policy.pathScope.outputRoots.map((p) => `- \`${p}\``),
    ...(policy.pathScope.preferredCli && policy.pathScope.preferredCli.length > 0
      ? [
          "",
          "### Preferred CLI",
          ...policy.pathScope.preferredCli.map((c) => `- \`${c}\``),
          "",
          PREFERRED_CLI_SOFT_WARN,
        ]
      : []),
    "",
    "## Contract",
    "",
    "- Obey `.grok/prompts/agentic-io-contract.md` for FINAL when reporting to parent.",
    "- Q1/Q4/Q5 + visibility mandate when product-facing.",
    "- Escalate with `UNABLE:` when below tier capability.",
    "",
  ].join("\n");

  return yaml + body;
}

async function main(): Promise<void> {
  const roles = await discoverRoles();
  const list = roles.map(({ role }) => `- ${role}`).join("\n");
  const readme = `# Repo-defined agent roles (multi-harness)

Canonical mission/memory: root \`agents/**\` (\`charter.md\`, \`memory.md\`, \`index.json\`).

| Harness | Generated form |
|---------|----------------|
| **\`.grok/agents/*.md\`** | **Grok-native** YAML frontmatter (\`name\`, \`description\`, \`disallowedTools\`, \`mcpInheritance: none\`) per user-guide 16-subagents — not fat spawn seeds |
| **\`.claude\` / \`.cursor\`** | Lightweight pointers |
| **\`.codex\`** | Pointers + native \`.toml\` from \`role-harness-policy.ts\` |

**CLI-first MCP policy:** \`docs/TOOLING.md\` + \`pnpm env:doctor\`. Roster governance: **hrbp** + \`docs/agent-ops/\`.

Roles:
${list}

Use \`agents/rules/agent-consult.md\`, \`PROTO_SUBAGENT\`, \`LEX_AGENTIC\`. Regenerate: \`pnpm agent:harness:sync\`.
`;

  for (const harness of harnesses) {
    const dir = path.join(repoRoot, harness, "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "README.md"), readme);
    for (const role of roles) {
      const body = harness === ".grok" ? grokNativeAgentMarkdown(role) : pointerMarkdown(role);
      await writeFile(path.join(dir, `${role.role}.md`), body);
      if (harness === ".codex") {
        await writeFile(path.join(dir, `${role.role}.toml`), codexTomlForRole(role));
      }
    }
  }

  console.log(
    `Generated ${roles.length} agents for ${harnesses.join(", ")} (.grok = native frontmatter; others = pointers; Codex + TOML).`,
  );
}

await main();