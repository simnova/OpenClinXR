import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const ROOT = process.cwd();
const PROGRESS_PATH = path.join(ROOT, "docs", "progress.html");
const MEDIA_PATH = path.join(ROOT, "docs", "site", "data", "media.json");
const GRADES_PATH = path.join(ROOT, "docs", "site", "data", "grades.json");

const ENTRY_127_MARKER = '<section class="band" id="entry-2026-11-14T0630">';
const TAIL_SHA256 = "d4b777d2c556e28fb020a10f2df6d27e0f753131e12cb541503a1378cc7c4cd3";
const TAIL_RESTORE_MESSAGE =
  "an older progress entry changed; restore docs/progress.html below the newest entry from origin/main 0d559df272303f3b24316996f510a9d4a3bdac54; do not update this hash to make the test pass";

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function e2Slot(): Record<string, unknown> {
  const media = readJson(MEDIA_PATH) as { slots: Array<Record<string, unknown>> };
  const slot = media.slots.find((candidate) => candidate["id"] === "E2");
  expect(slot, "media.json lacks the E2 slot").toBeDefined();
  return slot as Record<string, unknown>;
}

const EXPECTED_E2_FILES = [
  "site/media/e2-station-label-before.png",
  "site/media/e2-station-label-after.png",
  "site/media/e2-rr1-station1.webm",
];

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function e3Slot(): Record<string, unknown> {
  const media = readJson(MEDIA_PATH) as { slots: Array<Record<string, unknown>> };
  const slot = media.slots.find((candidate) => candidate["id"] === "E3");
  expect(slot, "media.json lacks the E3 slot").toBeDefined();
  return slot as Record<string, unknown>;
}

function firstEntrySection(): string {
  const raw = readFileSync(PROGRESS_PATH, "utf8");
  expect(raw).toContain("<!-- ENTRIES");
  const html = stripComments(raw);
  const firstAt = html.indexOf('<section class="band" id="entry-');
  expect(firstAt).toBeGreaterThanOrEqual(0);
  const secondAt = html.indexOf('<section class="band" id="entry-', firstAt + 1);
  return secondAt === -1 ? html.slice(firstAt) : html.slice(firstAt, secondAt);
}

function clipCaption(section: string): string {
  const videoAt = section.indexOf("<video");
  expect(videoAt).toBeGreaterThanOrEqual(0);
  const pAt = section.indexOf('<p class="status-copy">', videoAt);
  expect(pAt).toBeGreaterThanOrEqual(0);
  const endAt = section.indexOf("</p>", pAt);
  expect(endAt).toBeGreaterThan(pAt);
  return section.slice(pAt, endAt);
}

function imgSrcs(section: string): string[] {
  const out: string[] = [];
  for (const match of section.matchAll(/<img[^>]*src="([^"]+)"/g)) {
    out.push(match[1] as string);
  }
  return out;
}

function videoSrcs(section: string): string[] {
  const out: string[] = [];
  for (const match of section.matchAll(/<source[^>]*src="([^"]+)"/g)) {
    out.push(match[1] as string);
  }
  return out;
}

function countVideos(section: string): number {
  return (section.match(/<video[\s>]/g) ?? []).length;
}

it("T1 KNOWN-GOOD: the newest entry carries exactly 2 img and 1 video matching the E2 slot files", () => {
  const section = firstEntrySection();
  const slot = e2Slot();
  const files = slot["files"] as string[];
  expect(files).toEqual(EXPECTED_E2_FILES);
  expect(new Set(files).size).toBe(3);
  expect(imgSrcs(section)).toEqual([EXPECTED_E2_FILES[0], EXPECTED_E2_FILES[1]]);
  expect(countVideos(section)).toBe(1);
  expect(videoSrcs(section)).toEqual([EXPECTED_E2_FILES[2]]);
});

it("T2 GRADED: every E2 file hash matches a super-ceo pass entry with a grade message", () => {
  const slot = e2Slot();
  const files = slot["files"] as string[];
  expect(files).toEqual(EXPECTED_E2_FILES);
  expect(new Set(files).size).toBe(3);
  const ceiling = slot["ceilingBytes"] as number;
  expect(ceiling).toBe(2000000);
  const grades = readJson(GRADES_PATH) as { entries: Array<Record<string, unknown>> };
  const matched: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const bytes = readFileSync(path.join(ROOT, "docs", file));
    expect(bytes.length).toBeLessThanOrEqual(ceiling);
    const sha = sha256Hex(bytes);
    const entry = grades.entries.find(
      (candidate) => candidate["path"] === file && candidate["sha256"] === sha,
    );
    expect(entry, `grades.json lacks a matching entry for ${file}`).toBeDefined();
    expect(entry?.["slot"]).toBe("E2");
    expect(entry?.["grader"]).toBe("super-ceo");
    expect(typeof entry?.["gradeMessageId"]).toBe("string");
    expect((entry?.["gradeMessageId"] as string).length).toBeGreaterThan(0);
    expect(entry?.["verdict"]).toBe("pass");
    matched.push(entry as Record<string, unknown>);
  }
  expect(new Set(matched).size).toBe(3);
  expect(new Set(matched.map((entry) => entry["path"])).size).toBe(3);
});

it("T3 COUNTERWEIGHT: entries at and below Entry 127 are byte-identical to origin/main", () => {
  const buf = readFileSync(PROGRESS_PATH);
  const markerBuf = Buffer.from(ENTRY_127_MARKER, "utf8");
  const at = buf.indexOf(markerBuf);
  expect(at).toBeGreaterThanOrEqual(0);
  const tail = buf.subarray(at);
  expect(sha256Hex(tail), TAIL_RESTORE_MESSAGE).toBe(TAIL_SHA256);
});

it("T6 CONDITION: the clip caption names the compressed phase clock with its 4 s and 12 s phases", () => {
  const section = firstEntrySection();
  const caption = clipCaption(section);
  expect(caption).toMatch(/compressed phase clock/);
  expect(caption).toMatch(/doorway lasted 4 s\b/);
  expect(caption).toMatch(/about 12 s\b/);
  for (const banned of ["cap28", "serverMs", "chapters.json", "gradeMessageId"]) {
    expect(section).not.toContain(banned);
  }
});

it("T4 COUNTERWEIGHT: E3 stays PLACEHOLDER with no files and the entry carries one reference-run pointer", () => {
  const slot = e3Slot();
  expect(slot["state"]).toBe("PLACEHOLDER");
  expect(slot["files"]).toEqual([]);
  const section = firstEntrySection();
  const pointers = section.match(/<a href="reference-run\.html(#[\w-]+)?"/g) ?? [];
  expect(pointers).toHaveLength(1);
  const e3Media = [...imgSrcs(section), ...videoSrcs(section)].filter((src) =>
    src.toLowerCase().includes("e3"),
  );
  expect(e3Media).toEqual([]);
});
