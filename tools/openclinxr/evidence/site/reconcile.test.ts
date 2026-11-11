import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

type MediaSlot = { id: string; state: string };
type MediaManifest = { referenceRun?: string; slots: MediaSlot[] };

type ReconcileInput = {
  fallback: boolean;
  indexHtml: string;
  media: MediaManifest;
  referenceHtml: string;
};

const SHIPPED_CHAPTERS = [
  { pageSection: "ch1", runChapter: "ch1", copy: ["Doorway", "Station 1 of 3"] },
  { pageSection: "ch2", runChapter: "ch2", copy: ["Encounter", "Station 1 of 3"] },
  { pageSection: "ch3", runChapter: "rot-doorway", copy: ["Doorway", "Station 2 of 3"] },
  { pageSection: "ch4", runChapter: "rot-encounter", copy: ["Encounter", "Station 2 of 3"] },
  { pageSection: "ch5", runChapter: "ch5", copy: ["sign-off acknowledged", "finalized sign-off"] },
] as const;

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function section(html: string, id: string): string | undefined {
  return new RegExp(`<section\\b[^>]*\\bid="${escapePattern(id)}"[^>]*>[\\s\\S]*?</section>`, "iu").exec(html)?.[0];
}

function hasPendingCaption(html: string, slotId: string): boolean {
  return new RegExp(
    `<figure\\b(?=[^>]*\\bdata-slot="${escapePattern(slotId)}")[^>]*>[\\s\\S]*?<figcaption>\\s*capture pending\\s*</figcaption>[\\s\\S]*?</figure>`,
    "iu",
  ).test(html);
}

function reconcileBlockers({ fallback, indexHtml, media, referenceHtml }: ReconcileInput): string[] {
  const blockers: string[] = [];
  const combinedHtml = `${indexHtml}\n${referenceHtml}`;

  if (fallback) {
    for (const { runChapter } of SHIPPED_CHAPTERS) {
      if (new RegExp(`\\b${escapePattern(runChapter)}\\b`, "iu").test(combinedHtml)) {
        blockers.push(`fallback_names_chapter_id:${runChapter}`);
      }
    }
    for (const slot of media.slots.filter((candidate) => candidate.state === "TEXT_ONLY")) {
      if (!hasPendingCaption(combinedHtml, slot.id)) blockers.push(`fallback_text_only_without_caption:${slot.id}`);
    }
    return blockers;
  }

  if (media.referenceRun !== "run-7") blockers.push(`reference_run_mismatch:${String(media.referenceRun)}`);
  if (!referenceHtml.includes("media.referenceRun")) blockers.push("reference_run_not_rendered_from_media");
  if (/\brun-\d+\b/iu.test(referenceHtml)) blockers.push("reference_run_literal_in_html");

  for (const chapter of SHIPPED_CHAPTERS) {
    const chapterSection = section(referenceHtml, chapter.pageSection);
    if (chapterSection === undefined) {
      blockers.push(`chapter_section_missing:${chapter.pageSection}`);
      continue;
    }
    if (!chapterSection.includes(`data-run-chapter="${chapter.runChapter}"`)) {
      blockers.push(`chapter_binding_mismatch:${chapter.pageSection}:${chapter.runChapter}`);
    }
    for (const expectedCopy of chapter.copy) {
      if (!chapterSection.includes(expectedCopy)) blockers.push(`chapter_copy_missing:${chapter.runChapter}:${expectedCopy}`);
    }
  }

  const normalizedIndex = indexHtml.replace(/\s+/gu, " ");
  for (const expectedHomeCopy of ["doorway and encounter at Station 1", "doorway and encounter at Station 2", "finalized sign-off"]) {
    if (!normalizedIndex.includes(expectedHomeCopy)) blockers.push(`home_copy_missing:${expectedHomeCopy}`);
  }
  return blockers;
}

function fallbackManifest(media: MediaManifest): MediaManifest {
  const textFallbacks = new Set(["K1", "K2", "K3", "K4"]);
  return {
    ...media,
    slots: media.slots.map((slot) => textFallbacks.has(slot.id) ? { ...slot, state: "TEXT_ONLY" } : slot),
  };
}

function pendingFigure(slotId: string): string {
  return `<figure class="capture-pending" data-slot="${slotId}"><figcaption>capture pending</figcaption></figure>`;
}

function pendingFigures(media: MediaManifest): string {
  return media.slots.filter((slot) => slot.state === "TEXT_ONLY").map((slot) => pendingFigure(slot.id)).join("\n");
}

it("known-good: shipped copy matches media referenceRun and run-7 chapters without fallback", () => {
  const input = {
    fallback: false,
    indexHtml: read("docs/index.html"),
    media: JSON.parse(read("docs/site/data/media.json")) as MediaManifest,
    referenceHtml: read("docs/reference-run.html"),
  };
  const unchanged = { indexHtml: input.indexHtml, referenceHtml: input.referenceHtml };
  expect(reconcileBlockers(input)).toEqual([]);
  expect({ indexHtml: input.indexHtml, referenceHtml: input.referenceHtml }).toEqual(unchanged);
});

it("negative: fallback refuses reference copy that still names a chapter id", () => {
  const media = fallbackManifest(JSON.parse(read("docs/site/data/media.json")) as MediaManifest);
  const fixture = `${pendingFigures(media)}<p>Published chapter ch1</p>`;
  expect(reconcileBlockers({ fallback: true, indexHtml: "", media, referenceHtml: fixture }))
    .toContain("fallback_names_chapter_id:ch1");
});

it("counterweight: fallback gives every TEXT_ONLY slot a capture-pending caption", () => {
  const media = fallbackManifest(JSON.parse(read("docs/site/data/media.json")) as MediaManifest);
  const completeFallback = pendingFigures(media);
  expect(reconcileBlockers({ fallback: true, indexHtml: completeFallback, media, referenceHtml: "" })).toEqual([]);
  const lastTextOnly = media.slots.filter((slot) => slot.state === "TEXT_ONLY").at(-1);
  if (lastTextOnly === undefined) throw new Error("fallback fixture has no TEXT_ONLY slot");
  const missingOne = completeFallback.replace(pendingFigure(lastTextOnly.id), "");
  expect(reconcileBlockers({ fallback: true, indexHtml: missingOne, media, referenceHtml: "" }))
    .toContain(`fallback_text_only_without_caption:${lastTextOnly.id}`);
});
