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
const ENTRY_128 = "entry-2026-11-14T2224";
const NEW_TAIL_MARKER = `<section class="band" id="${ENTRY_128}">`;
const NEW_TAIL_SHA256 = "dce70976523f85c1bec6c4cc89f087bc12e1ec9908eec8e97e897d6340bef7be";
const NEW_TAIL_RESTORE_MESSAGE =
  "an older progress entry changed; restore docs/progress.html below the newest entry from origin/main 0f27340f8d421030445b048f4e165f7a997f37f2; do not update this hash to make the test pass";

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

type Rows = Array<Record<string, unknown>>;

function slotById(id: string): Record<string, unknown> {
  const media = readJson(MEDIA_PATH) as { slots: Rows };
  const slot = media.slots.find((candidate) => candidate["id"] === id);
  expect(slot, `media.json lacks the ${id} slot`).toBeDefined();
  return slot as Record<string, unknown>;
}

const EXPECTED_E2_FILES = [
  "site/media/e2-station-label-before.png",
  "site/media/e2-station-label-after.png",
  "site/media/e2-rr1-station1.webm",
];

const EXPECTED_KC_FILES = [
  "site/media/kc-kevin-head-before.png",
  "site/media/kc-kevin-head-after.png",
  "site/media/kc-kevin-head-turntable.webm",
];

const STILL_GRADE_ID = "super-ceo-cap39/kce-r3-2026-11-18";
const TURN_GRADE_ID = "super-ceo-cap39/kce-r4-crf30-2026-11-18";

function kcGradeId(file: string): string {
  return file.endsWith(".webm") ? TURN_GRADE_ID : STILL_GRADE_ID;
}

type EntryCase = {
  locator: string;
  slot: string;
  files: string[];
  cap: number;
  grade: ((file: string) => string) | null;
  marker: string;
  sha: string;
  msg: string;
  exactMediaOrder: boolean;
};

const E2: EntryCase = { locator: ENTRY_128, slot: "E2", files: EXPECTED_E2_FILES, cap: 2000000, grade: null, marker: ENTRY_127_MARKER, sha: TAIL_SHA256, msg: TAIL_RESTORE_MESSAGE, exactMediaOrder: true };

const KC: EntryCase = { locator: "first", slot: "KC", files: EXPECTED_KC_FILES, cap: 3500000, grade: kcGradeId, marker: NEW_TAIL_MARKER, sha: NEW_TAIL_SHA256, msg: NEW_TAIL_RESTORE_MESSAGE, exactMediaOrder: true };

function locate(key: "first" | string): string {
  const raw = readFileSync(PROGRESS_PATH, "utf8");
  if (key === "first") {
    expect(raw).toContain("<!-- ENTRIES");
  }
  const html = raw.replace(/<!--[\s\S]*?-->/g, "");
  const open = key === "first" ? '<section class="band" id="entry-' : `<section class="band" id="${key}">`;
  const at = html.indexOf(open);
  expect(at, `progress.html lacks section ${key}`).toBeGreaterThanOrEqual(0);
  const next = html.indexOf('<section class="band" id="entry-', at + 1);
  return next === -1 ? html.slice(at) : html.slice(at, next);
}

function imgSrcs(section: string): string[] {
  const r: string[] = [];
  for (const match of section.matchAll(/<img[^>]*src="([^"]+)"/g)) {
    r.push(match[1] as string);
  }
  return r;
}

function videoSrcs(section: string): string[] {
  const r: string[] = [];
  for (const match of section.matchAll(/<source[^>]*src="([^"]+)"/g)) {
    r.push(match[1] as string);
  }
  return r;
}

function graded(c: EntryCase): string[] {
  const ps: string[] = [];
  const slot = slotById(c.slot);
  if (JSON.stringify(slot.files) !== JSON.stringify(c.files)) {
    ps.push(`${c.slot} files changed`);
  }
  if (new Set(c.files).size !== c.files.length) {
    ps.push(`${c.slot} files not distinct`);
  }
  if (slot.ceilingBytes !== c.cap) {
    ps.push(`${c.slot} ceiling changed`);
  }
  const grades = readJson(GRADES_PATH) as { entries: Rows };
  const seen: string[] = [];
  let total = 0;
  for (const file of c.files) {
    const bytes = readFileSync(path.join(ROOT, "docs", file));
    total += bytes.length;
    if (bytes.length > c.cap) {
      ps.push(`${file} over ceiling`);
    }
    const entry = grades.entries.find(
      (row) => row.path === file && row.sha256 === sha256Hex(bytes),
    );
    if (!entry) {
      ps.push(`no grade for ${file}`);
      continue;
    }
    if (grades.entries.filter((row) => row.path === file).length > 1) ps.push(`dup ${file}`);
    if (entry.slot !== c.slot) {
      ps.push(`${file} slot wrong`);
    }
    if (entry.grader !== "super-ceo") {
      ps.push(`${file} grader wrong`);
    }
    if (entry.verdict !== "pass") {
      ps.push(`${file} verdict wrong`);
    }
    const gid = entry.gradeMessageId;
    if (typeof gid !== "string" || gid.length === 0) {
      ps.push(`${file} grade id empty`);
    } else if (c.grade && gid !== c.grade(file)) {
      ps.push(`${file} grade id wrong`);
    }
    seen.push(JSON.stringify(entry));
  }
  if (new Set(seen).size !== c.files.length) {
    ps.push(`${c.slot} grades not distinct`);
  }
  if (total > c.cap) {
    ps.push(`${c.slot} total over ceiling`);
  }
  return ps;
}

function etext(section: string): string {
  return section.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sents(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function browProblems(text: string): string[] {
  const r: string[] = [];
  const ss = sents(text);
  for (const s of ss) {
    if (/\bbrows?\b/i.test(s) && !/same/i.test(s)) {
      r.push(`brow without same: ${s}`);
    }
    if (/\bbrows?\b[^.]*(changed|darken|recolou?r|now)/i.test(s)) {
      r.push(`brow change: ${s}`);
    }
  }
  if (!ss.some((s) => /\bbrows?\b/i.test(s) && /look the same/i.test(s))) {
    r.push("no brow look-same sentence");
  }
  return r;
}

function earProblems(text: string): string[] {
  const r: string[] = [];
  if (!text.includes("low-poly")) {
    r.push("no low-poly");
  }
  if (!text.includes("cap mesh")) {
    r.push("no cap mesh");
  }
  for (const need of ["jagged side edges", "not individual strands"]) {
    if (!text.includes(need)) {
      r.push(`no ${need}`);
    }
  }
  const ss = sents(text);
  for (const s of ss) {
    if (/\bears?\b/i.test(s) && !/holes/i.test(s)) {
      r.push(`ear without holes: ${s}`);
    }
  }
  const es = ss.filter((s) => /\bears?\b/i.test(s));
  if (es.length !== 1) {
    r.push(`ear sentences: ${es.length}`);
  } else {
    for (const need of ["holes behind the ears", "scalp skin", "both versions"]) {      if (!es[0].includes(need)) {
        r.push(`ear sent no ${need}`);
      }
    }
  }
  return r;
}

function checkMedia(c: EntryCase): void {
  const section = locate(c.locator);
  const listed = slotById(c.slot).files as string[];
  expect(listed).toEqual(c.files);
  expect(new Set(listed).size).toBe(c.files.length);
  const imgs = imgSrcs(section);
  const vids = videoSrcs(section);
  expect(imgs).toHaveLength(2);
  expect((section.match(/<video[\s>]/g) ?? []).length).toBe(1);
  expect(vids).toHaveLength(1);
  expect(new Set([...imgs, ...vids])).toEqual(new Set(c.files));
  if (c.exactMediaOrder) {
    expect(imgs).toEqual([c.files[0], c.files[1]]);
    expect(vids).toEqual([c.files[2]]);
  }
}

function tail(c: EntryCase): void {
  const at = readFileSync(PROGRESS_PATH).indexOf(c.marker);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(sha256Hex(readFileSync(PROGRESS_PATH).subarray(at)), c.msg).toBe(c.sha);
}

it("T1 KNOWN-GOOD: the newest entry carries exactly 2 img and 1 video matching the E2 slot files", () => {
  checkMedia(E2);
});

it("T2 GRADED: every E2 file hash matches a super-ceo pass entry with a grade message", () => {
  expect(graded(E2)).toEqual([]);
});

it("T3 COUNTERWEIGHT: entries at and below Entry 127 are byte-identical to origin/main", () => {
  tail(E2);
});

it("T6 CONDITION: the clip caption names the compressed phase clock with its 4 s and 12 s phases", () => {
  const section = locate(E2.locator);
  const videoAt = section.indexOf("<video");
  expect(videoAt).toBeGreaterThanOrEqual(0);
  const pAt = section.indexOf('<p class="status-copy">', videoAt);
  expect(pAt).toBeGreaterThanOrEqual(0);
  const endAt = section.indexOf("</p>", pAt);
  expect(endAt).toBeGreaterThan(pAt);
  const caption = section.slice(pAt, endAt);
  expect(caption).toMatch(/compressed phase clock/);
  expect(caption).toMatch(/doorway lasted 4 s\b/);
  expect(caption).toMatch(/about 12 s\b/);
  for (const banned of ["cap28", "serverMs", "chapters.json", "gradeMessageId"]) {
    expect(section).not.toContain(banned);
  }
});

it("T4 COUNTERWEIGHT: E3 stays PLACEHOLDER with no files and the entry carries one reference-run pointer", () => {
  const slot = slotById("E3");
  expect(slot.state).toBe("PLACEHOLDER");
  expect(slot.files).toEqual([]);
  const section = locate(E2.locator);
  const pointers = section.match(/<a href="reference-run.html(#[\w-]+)?"/g) ?? [];
  expect(pointers).toHaveLength(1);
  const e3Media = [...imgSrcs(section), ...videoSrcs(section)].filter((src) =>
    src.toLowerCase().includes("e3"),
  );
  expect(e3Media).toEqual([]);
});

it("K1 KNOWN-GOOD: the first section under the ENTRIES comment has exactly 2 img and 1 video matching the KC slot files", () => {
  checkMedia(KC);
});

it("K2 GRADED: every KC file hash matches a super-ceo pass entry with the cap39 grade id, each file and the slot total fit the ceiling", () => {
  expect(graded(KC)).toEqual([]);
});

it("K3 COUNTERWEIGHT: entries at and below Entry 128 are byte-identical to origin/main", () => {
  tail(KC);
});

it("K4 CONDITION C1: every brow sentence in the new entry also says same, and no brow sentence claims a change", () => {
  expect(browProblems(etext(locate(KC.locator)))).toEqual([]);
});

it("K5 CONDITION C2+C3: the new entry names the low-poly cap mesh and never names ears", () => {
  expect(earProblems(etext(locate(KC.locator)))).toEqual([]);
});
