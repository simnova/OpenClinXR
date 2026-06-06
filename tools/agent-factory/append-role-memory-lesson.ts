import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRepoRoleHarnessPolicy } from "../../packages/openclinxr/agent-loop/src/role-harness-policy.js";

type CliOptions = {
  roleId: string;
  topic: string;
  lesson: string;
  confidence?: number;
  rebuildIndex: boolean;
  skipIfExists: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm agent:memory:append -- --role <role-id> --topic <topic> --lesson <text> [--confidence 0.8] [--no-index] [--skip-if-exists]",
    "",
    "Appends a durable lesson to agents/<group>/<role>/memory.md and optionally rebuilds the memory index.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    rebuildIndex: true,
    skipIfExists: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--role") {
      options.roleId = argv[++index];
      continue;
    }
    if (arg === "--topic") {
      options.topic = argv[++index];
      continue;
    }
    if (arg === "--lesson") {
      options.lesson = argv[++index];
      continue;
    }
    if (arg === "--confidence") {
      options.confidence = Number(argv[++index]);
      continue;
    }
    if (arg === "--no-index") {
      options.rebuildIndex = false;
      continue;
    }
    if (arg === "--skip-if-exists") {
      options.skipIfExists = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!options.roleId || !options.topic || !options.lesson) {
    throw new Error(`Missing required arguments.\n\n${usage()}`);
  }

  return options as CliOptions;
}

async function findRoleMemoryPath(roleId: string): Promise<string> {
  const groups = ["coordinator", "core", "physicians", "adversarial", "leadership", "legal"];
  for (const group of groups) {
    const memoryPath = path.join("agents", group, roleId, "memory.md");
    try {
      await readFile(memoryPath, "utf8");
      return memoryPath;
    } catch {
      continue;
    }
  }
  throw new Error(`Could not find memory.md for role '${roleId}'.`);
}

async function runIndexRebuild(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["agent:index"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pnpm agent:index exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const policy = getRepoRoleHarnessPolicy(options.roleId);
  const memoryPath = await findRoleMemoryPath(options.roleId);
  const existing = await readFile(memoryPath, "utf8");
  if (options.skipIfExists && existing.includes(`— ${options.topic}`)) {
    console.log(`Skipped append; topic '${options.topic}' already present in ${memoryPath}`);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const confidence = options.confidence ?? 0.8;
  const entry = [
    "",
    `## Lesson ${today} — ${options.topic}`,
    "",
    `- Summary: ${options.lesson}`,
    `- Confidence: ${confidence}`,
    `- Recorded by: agent:memory:append`,
    policy ? `- Policy tier: ${policy.policyTier}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  await appendFile(memoryPath, entry);
  console.log(`Appended lesson to ${memoryPath}`);

  if (options.rebuildIndex) {
    await runIndexRebuild();
    console.log("Rebuilt .agent-factory/memory-index.json");
  }
}

await main();