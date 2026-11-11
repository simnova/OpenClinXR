import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { checkMedia, deriveDisplayState } from "./check-media.js";
import { validateSiteData } from "./site-data-schemas.js";

const section7Ids = [
  "hero-poster",
  "K1",
  "P1.2",
  "K2",
  "K3",
  "K4",
  "K6",
  "K7",
  "K5",
  "K9",
  "KD",
  "K12",
  "K13",
  "E2",
  "E3",
  "data",
  "TT",
  "text",
];

const dataIds = new Set(["K13", "data", "TT", "text"]);

const ceilings: Record<string, number> = {
  "hero-poster": 300000,
  K1: 2500000,
  "P1.2": 1000000,
  K2: 3500000,
  K3: 3000000,
  K4: 3000000,
  K6: 500000,
  K7: 500000,
  K5: 400000,
  K9: 1200000,
  KD: 600000,
  K12: 100000,
  K13: 500000,
  E2: 2000000,
  E3: 2000000,
  data: 200000,
  TT: 200000,
  text: 1000000,
};

function slotEntry(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: dataIds.has(id) ? "data" : "visual",
    state: dataIds.has(id) ? "TEXT_ONLY" : "PLACEHOLDER",
    ceilingBytes: ceilings[id],
    audio: false,
    voice: "none",
    releaseTag: null,
    files: [],
    ...overrides,
  };
}

function fullMedia(overridesById: Record<string, Record<string, unknown>> = {}): {
  slots: Record<string, unknown>[];
} {
  return { slots: section7Ids.map((id) => slotEntry(id, overridesById[id] ?? {})) };
}

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-media-"));
  mkdirSync(path.join(root, "docs", "site", "data"), { recursive: true });
  mkdirSync(path.join(root, "docs", "site", "media"), { recursive: true });
  return root;
}

function writeMedia(root: string, media: unknown): void {
  writeFileSync(path.join(root, "docs", "site", "data", "media.json"), JSON.stringify(media));
}

function writeClaims(root: string, claims: unknown[]): void {
  writeFileSync(
    path.join(root, "docs", "site", "data", "claims.json"),
    JSON.stringify({ claims }),
  );
}

it("negative: TEXT_ONLY slot whose claim is hand-marked SHOWN gives media_shown_text_only", async () => {
  const root = makeRoot();
  writeMedia(root, fullMedia());
  writeClaims(root, [
    { id: "CLX", text: "x", state: "SHOWN", slots: [{ slot: "TT", demonstrates: "trace table" }] },
  ]);
  const blockers = await checkMedia(root, { strict: false });
  expect(blockers).toContain("media_shown_text_only:CLX:TT");
});

it("negative: SHOWN claim whose listed slot is absent gives media_shown_slot_absent", async () => {
  const root = makeRoot();
  writeMedia(root, fullMedia());
  writeClaims(root, [
    { id: "CLX", text: "x", state: "SHOWN", slots: [{ slot: "NOPE", demonstrates: "missing" }] },
  ]);
  const blockers = await checkMedia(root, { strict: false });
  expect(blockers).toContain("media_shown_slot_absent:CLX:NOPE");
});

it("negative: a slot file larger than ceilingBytes gives media_over_ceiling", async () => {
  const root = makeRoot();
  // Fixture ceilings are illustrative: a tiny ceiling keeps the over-size file small.
  writeMedia(root, fullMedia({ K1: { ceilingBytes: 10, files: ["site/media/big.bin"] } }));
  writeClaims(root, []);
  writeFileSync(path.join(root, "docs", "site", "media", "big.bin"), Buffer.alloc(11, 1));
  const blockers = await checkMedia(root, { strict: false });
  expect(blockers).toContain("media_over_ceiling:K1:11");
});

it("negative: PLACEHOLDER under strict gives media_placeholder_strict", async () => {
  const root = makeRoot();
  writeMedia(root, fullMedia());
  writeClaims(root, []);
  const blockers = await checkMedia(root, { strict: true });
  expect(blockers).toContain("media_placeholder_strict:K1");
});

it("known-good: CODE with TEXT_ONLY derives BUILT_PENDING and PLACEHOLDER passes outside strict", async () => {
  expect(deriveDisplayState("CODE", ["TEXT_ONLY"])).toBe("BUILT_PENDING");
  const root = makeRoot();
  writeMedia(root, fullMedia());
  writeClaims(root, []);
  const blockers = await checkMedia(root, { strict: false });
  expect(blockers).toEqual([]);
});

it("known-good: the real worktree checkMedia gives [] and validateSiteData gives []", async () => {
  expect(await checkMedia(process.cwd(), { strict: false })).toEqual([]);
  expect(await validateSiteData(process.cwd())).toEqual([]);
});

it("counterweight: a media.json missing any one section 7 id gives media_slot_missing for that id", async () => {
  for (const missing of section7Ids) {
    const root = makeRoot();
    const media = fullMedia();
    media.slots = media.slots.filter((slot) => slot["id"] !== missing);
    writeMedia(root, media);
    writeClaims(root, []);
    const blockers = await checkMedia(root, { strict: false });
    expect(blockers).toContain(`media_slot_missing:${missing}`);
  }
});

it("negative: a slot listing a file that does not exist gives media_file_missing", async () => {
  const root = makeRoot();
  writeMedia(root, fullMedia({ K5: { files: ["site/media/k5-absent.png"] } }));
  writeClaims(root, []);
  expect(await checkMedia(root, { strict: false })).toContain("media_file_missing:K5:site/media/k5-absent.png");
});
