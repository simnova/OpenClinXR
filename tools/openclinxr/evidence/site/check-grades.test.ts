import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { checkGrades } from "./check-grades.js";
import { validateSiteData } from "./site-data-schemas.js";

// 1x1 transparent PNG; bytes are real so the sha256 is computed, not stubbed.
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-grades-"));
  mkdirSync(path.join(root, "docs", "site", "media"), { recursive: true });
  mkdirSync(path.join(root, "docs", "site", "data"), { recursive: true });
  return root;
}

function writePng(root: string, name: string): Buffer {
  const bytes = Buffer.from(pngBase64, "base64");
  writeFileSync(path.join(root, "docs", "site", "media", name), bytes);
  return bytes;
}

function writeGrades(root: string, entries: Record<string, unknown>[]): void {
  writeFileSync(
    path.join(root, "docs", "site", "data", "grades.json"),
    JSON.stringify({ entries }),
  );
}

function completeEntry(
  entryPath: string,
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    path: entryPath,
    sha256: sha256Hex(bytes),
    grader: "super-ceo",
    graderSession: "sess_001",
    gradeMessageId: "msg_001",
    demonstrates: "shows the station label from the server",
    ...overrides,
  };
}

it("negative: entry sha256 differs from the file bytes gives grades_sha_mismatch", async () => {
  const root = makeRoot();
  const bytes = writePng(root, "k2-station-label.png");
  const entryPath = "site/media/k2-station-label.png";
  writeGrades(root, [completeEntry(entryPath, bytes)]);
  const flipped = Buffer.from(bytes);
  flipped[0] = flipped[0] === 0 ? 1 : 0;
  writeFileSync(path.join(root, "docs", "site", "media", "k2-station-label.png"), flipped);
  const blockers = await checkGrades(root);
  expect(blockers).toContain(`grades_sha_mismatch:${entryPath}`);
});

it("negative: entry without gradeMessageId gives grades_field_missing gradeMessageId", async () => {
  const root = makeRoot();
  const bytes = writePng(root, "k2-station-label.png");
  const entryPath = "site/media/k2-station-label.png";
  const { gradeMessageId: _dropped, ...withoutMessage } = completeEntry(entryPath, bytes);
  writeGrades(root, [withoutMessage]);
  const blockers = await checkGrades(root);
  expect(blockers).toContain(`grades_field_missing:${entryPath}:gradeMessageId`);
});

it("negative: entry without demonstrates gives grades_field_missing demonstrates", async () => {
  const root = makeRoot();
  const bytes = writePng(root, "k2-station-label.png");
  const entryPath = "site/media/k2-station-label.png";
  const { demonstrates: _dropped, ...withoutDemonstrates } = completeEntry(entryPath, bytes);
  writeGrades(root, [withoutDemonstrates]);
  const blockers = await checkGrades(root);
  expect(blockers).toContain(`grades_field_missing:${entryPath}:demonstrates`);
});

it("negative: entry with grader sonnet-prescreen gives grades_grader_not_super_ceo", async () => {
  const root = makeRoot();
  const bytes = writePng(root, "k2-station-label.png");
  const entryPath = "site/media/k2-station-label.png";
  writeGrades(root, [completeEntry(entryPath, bytes, { grader: "sonnet-prescreen" })]);
  const blockers = await checkGrades(root);
  expect(blockers).toContain(`grades_grader_not_super_ceo:${entryPath}`);
});

it("known-good: a visual file plus a complete entry with the matching sha256 gives []", async () => {
  const root = makeRoot();
  const bytes = writePng(root, "k2-station-label.png");
  const entryPath = "site/media/k2-station-label.png";
  writeGrades(root, [completeEntry(entryPath, bytes)]);
  expect(await checkGrades(root)).toEqual([]);
});

it("known-good: the real worktree gives [] and its grades.json passes validateSiteData", async () => {
  expect(await checkGrades(process.cwd())).toEqual([]);
  expect(await validateSiteData(process.cwd())).toEqual([]);
});

it("counterweight: a visual file with no entry gives grades_visual_without_entry, a .json file gives nothing", async () => {
  const root = makeRoot();
  writePng(root, "orphan.png");
  writeFileSync(
    path.join(root, "docs", "site", "media", "notes.json"),
    JSON.stringify({ note: "not a visual" }),
  );
  writeGrades(root, []);
  const blockers = await checkGrades(root);
  expect(blockers).toContain("grades_visual_without_entry:site/media/orphan.png");
  expect(blockers.some((blocker) => blocker.includes("notes.json"))).toBe(false);
});
