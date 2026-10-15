import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CARD tsk_11a2bf179792f4e2 (board slug open-defects): the open-defect table
 * carries exactly one row per defect id, each row located with coordinates,
 * staged, and closed with a verdict from the fixed enum plus free text.
 *
 * EXPECTED IDS mirror the card objective: (1) temple/hairline notch (B4),
 * (2) stray dark tick below the right eye in eyeshell1 renders (A6),
 * (3) upper-lid iris coverage vs goal (A6), (4) seven extra morph keys
 * confirmed against b558025ac (C2). A row with no location, or a verdict
 * outside the four names, fails this contract by definition.
 *
 * COUNTERWEIGHT: the cheapest false pass is four rows of hand-waving with no
 * coordinates and no cited source. Every row must therefore name concrete
 * coordinates AND the falsifier pair (motivating instance + one control) it
 * was checked against; `cause_unknown` is the allowed escape, not a blank.
 */

const DIR = import.meta.dirname;
const FINDINGS = join(DIR, "findings.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";

const EXPECTED_IDS = ["temple-notch", "eye-tick", "upper-lid-iris", "extra-morph-keys"] as const;
const VERDICTS = ["fixed_here", "card_filed", "not_a_defect", "cause_unknown"] as const;

type Row = {
  id: string;
  located: { region: string; coordinates: unknown };
  stage: string;
  verdict: string;
  card?: string;
  note: string;
  falsifier: { motivating: string; control: string; outcome: string };
};

const OWN_CARD = "tsk_11a2bf179792f4e2";

function load(): { rows: Row[]; sheet: { store?: string; sizeBytes?: number } } {
  return JSON.parse(readFileSync(FINDINGS, "utf8")) as {
    rows: Row[];
    sheet: { store?: string; sizeBytes?: number };
  };
}

describe("the open defect table has one row each", () => {
  it("findings.json exists with exactly one row per expected defect id", () => {
    expect(existsSync(FINDINGS)).toBe(true);
    const { rows } = load();
    expect(rows.map((r) => r.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it.each(EXPECTED_IDS)("row %s is located, staged, and verdict-closed with free text", (id) => {
    const { rows } = load();
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.located.region.trim().length).toBeGreaterThan(0);
    expect(JSON.stringify(row!.located.coordinates).length).toBeGreaterThan(20);
    expect(row!.stage.trim().length).toBeGreaterThan(0);
    expect(VERDICTS).toContain(row!.verdict);
    expect(row!.note.trim().length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_IDS)("row %s records its falsifier pair and outcome", (id) => {
    const { rows } = load();
    const row = rows.find((r) => r.id === id)!;
    expect(row.falsifier.motivating.trim().length).toBeGreaterThan(0);
    expect(row.falsifier.control.trim().length).toBeGreaterThan(0);
    expect(row.falsifier.outcome.trim().length).toBeGreaterThan(0);
  });

  it("every card_filed row names a real filed card, never this card itself", () => {
    const { rows } = load();
    const filed = rows.filter((r) => r.verdict === "card_filed");
    expect(filed.length).toBeGreaterThan(0);
    for (const row of filed) {
      expect(row.card).toMatch(/^tsk_[0-9a-f]{16}$/);
      expect(row.card).not.toBe(OWN_CARD);
    }
  });

  it("the defect sheet exists (repo copy, or store copy when over 150 KB)", () => {
    const repoCopy = join(DIR, "defect-sheet.png");
    if (existsSync(repoCopy)) {
      expect(statSync(repoCopy).size).toBeLessThanOrEqual(150 * 1024);
      return;
    }
    const { sheet } = load();
    expect(sheet.store).toBeDefined();
    expect(existsSync(sheet.store!)).toBe(true);
    expect(statSync(sheet.store!).size).toBeGreaterThan(0);
  });

  it("the portrait captures backing the sheet exist at RENDER_SIZE 1280", () => {
    // The two 1280 captures exceed 150 KB, so they live in the local asset
    // store (assets:<path> + sha256 in the record); the small eye crop stays here.
    expect(existsSync(join(DIR, "eyes-crop.png"))).toBe(true);
    const record = JSON.parse(readFileSync(join(DIR, "facedefects-sheet.json"), "utf8")) as {
      viewport: { width: number; height: number };
      views: { png: string; sha256: string }[];
    };
    expect(record.viewport.width).toBe(1280);
    expect(record.viewport.height).toBe(1280);
    for (const view of record.views) {
      expect(view.png).toMatch(/^assets:face-defects\//);
      expect(view.sha256).toMatch(/^[0-9a-f]{64}$/);
      const stored = join(STORE_ROOT, view.png.slice("assets:".length));
      if (!existsSync(STORE_ROOT)) continue; // store absent on this machine
      expect(createHash("sha256").update(readFileSync(stored)).digest("hex")).toBe(view.sha256);
    }
  });
});
