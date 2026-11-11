import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { checkSize, loadManifest, measureWebsiteBytes } from "./check-size.js";

const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      process.stderr.write(`check-size cleanup skipped:${root}\n`);
    }
  }
});

const planPath = "/Volumes/files/src/openclinxr/.openclinxr/slices/website-reimagine/PLAN-draft.md";
const planExists = existsSync(planPath);

function manifest(): { paths: string[]; budgetBytes: number; websiteBytesAtBase: number; baseSha: string } {
  const text = readFileSync(new URL("./website-paths.json", import.meta.url), "utf8");
  return JSON.parse(text) as {
    paths: string[];
    budgetBytes: number;
    websiteBytesAtBase: number;
    baseSha: string;
  };
}

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function initGitRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-size-"));
  tempRoots.push(root);
  git(root, ["init", "-q"]);
  return root;
}

function commitAll(root: string): void {
  git(root, ["add", "docs"]);
  git(root, [
    "-c",
    "user.email=ws-fixture@test",
    "-c",
    "user.name=ws-fixture",
    "commit",
    "-qm",
    "fixture",
  ]);
}

it("negative: a tracked 30,000,001-byte file under docs/site/ is refused", async () => {
  const root = initGitRepo();
  mkdirSync(path.join(root, "docs", "site", "media"), { recursive: true });
  const big = path.join(root, "docs", "site", "media", "big.bin");
  writeFileSync(big, "");
  truncateSync(big, 30000001);
  commitAll(root);
  const blockers = await checkSize(root);
  expect(blockers.some((blocker) => blocker.startsWith("site_over_budget:"))).toBe(true);
});

it("known-good: bytes under docs/openclinxr/ do not change the measured total", async () => {
  const root = initGitRepo();
  mkdirSync(path.join(root, "docs", "site", "data"), { recursive: true });
  mkdirSync(path.join(root, "docs", "openclinxr"), { recursive: true });
  writeFileSync(path.join(root, "docs", "index.html"), "0123456789");
  commitAll(root);
  const { paths } = manifest();
  const before = await measureWebsiteBytes(root, paths);
  expect(before).toBe(10);
  writeFileSync(path.join(root, "docs", "openclinxr", "notes.bin"), Buffer.alloc(100000, 7));
  commitAll(root);
  const after = await measureWebsiteBytes(root, paths);
  expect(after).toBe(before);
});

it("untracked files under website-written paths are not counted", async () => {
  const root = initGitRepo();
  mkdirSync(path.join(root, "docs", "site", "data"), { recursive: true });
  writeFileSync(path.join(root, "docs", "site", "data", "kept.json"), "{}");
  commitAll(root);
  const { paths } = manifest();
  const before = await measureWebsiteBytes(root, paths);
  expect(before).toBe(2);
  writeFileSync(path.join(root, "docs", "site", "data", "untracked.bin"), Buffer.alloc(100000, 7));
  const after = await measureWebsiteBytes(root, paths);
  expect(after).toBe(before);
});

it("a manifest without budgetBytes makes loadManifest reject with manifest_budget_missing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "check-size-"));
  tempRoots.push(dir);
  const manifestPath = path.join(dir, "website-paths.json");
  writeFileSync(manifestPath, JSON.stringify({ paths: ["docs/index.html"] }));
  await expect(loadManifest(manifestPath)).rejects.toThrow(/manifest_budget_missing/);
});

it.skipIf(!planExists)("counterweight: website-paths.json paths equal the PLAN section 0 website-written list", () => {
  const listed = manifest().paths;
  const text = readFileSync(planPath, "utf8");
  const line = text.split("\n").find((entry) => entry.includes("website-written paths:"));
  expect(line).toBeDefined();
  const cleaned = (line ?? "").split("website-written paths:")[1]?.replace(/\(.*\)/, "") ?? "";
  const planPaths = cleaned
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  expect(listed).toEqual(planPaths);
  expect(listed.length).toBeGreaterThan(0);
});

it("real repo measures under budget and websiteBytesAtBase equals the base commit measurement", async () => {
  const listed = manifest();
  const total = await measureWebsiteBytes(process.cwd(), listed.paths);
  expect(total).toBeLessThanOrEqual(listed.budgetBytes);
  const specs = listed.paths.map((entry) => (entry.endsWith("/**") ? entry.slice(0, -3) : entry));
  const output = execFileSync("git", ["ls-tree", "-r", "-l", listed.baseSha, "--", ...specs], {
    cwd: process.cwd(),
    encoding: "utf8",
  }) as string;
  let sum = 0;
  for (const line of output.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    sum += Number(parts[3]);
  }
  expect(sum).toBe(listed.websiteBytesAtBase);
});
