// Blueprint inspector page test (card W4a-1b). Fixture regions are the
// committed run-21 derive (run-20 bytes + blocks[]); synthetic fixtures
// exercise the mask/blocker paths without standing in for capture output.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import {
  blockerNotice,
  buildInspectorModel,
  excerptControlBlockers,
  highlightsEnabled,
  initInspector,
  isExcerptButton,
  outlineBox,
  overlayRectForActor,
  validateCanaryLabels,
  validatePageBlocks,
  verifyStillSha,
} from "../../../../docs/site/scripts/inspector.js";

const SOURCE_SHA = "c1da76fb45ea04b3875e4a748211b679b447355c";
const BLUEPRINT_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";

function readPage(): string {
  return readFileSync(path.join(process.cwd(), "docs", "blueprints.html"), "utf8");
}

function readCommittedRegions(): {
  regions: {
    actorId: string;
    lines: number[];
    blocks: { fixturePath: string; startLine: number; endLine: number; text: string }[];
    bbox: { x: number; y: number; width: number; height: number };
    mask: { rect: { x: number; y: number; width: number; height: number } };
  }[];
  cameraMode: string;
  blockers: string[];
  still: { sha256: string };
} {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "docs", "site", "data", "inspector-regions.json"), "utf8"),
  ) as never;
}

function blueprintLines(): string[] {
  return execFileSync("git", ["show", `${SOURCE_SHA}:${BLUEPRINT_PATH}`], {
    encoding: "utf8",
  }).split("\n");
}

function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function renderedRows(page: string): { start: number; end: number; lines: { line: number; gutter: string; text: string }[] }[] {
  const found: { start: number; end: number; lines: { line: number; gutter: string; text: string }[] }[] = [];
  const pattern = /<(figure|details)\b([^>]*\sdata-block(?=[\s>])[^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null = pattern.exec(page);
  while (match !== null) {
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const start = Number((/\bdata-block-start="(\d+)"/.exec(attrs) ?? [])[1]);
    const end = Number((/\bdata-block-end="(\d+)"/.exec(attrs) ?? [])[1]);
    const lines: { line: number; gutter: string; text: string }[] = [];
    const rowPattern = /<li\b([^>]*\sdata-code-line="(\d+)"(?=[\s>])[^>]*)>([\s\S]*?)<\/li>/gi;
    let row: RegExpExecArray | null = rowPattern.exec(inner);
    while (row !== null) {
      const rowInner = row[3] ?? "";
      const gutter = (/<span\b[^>]*\bgutter\b[^>]*>([\s\S]*?)<\/span>/i.exec(rowInner) ?? [])[1];
      const cell = (/<code\b[^>]*\bcodeline-text\b[^>]*>([\s\S]*?)<\/code>/i.exec(rowInner) ?? [])[1];
      if (gutter === undefined || cell === undefined) {
        throw new Error(`block ${start}-${end} row ${row[2] ?? "?"} lacks gutter or code cell`);
      }
      lines.push({ line: Number(row[2]), gutter: unescapeEntities(gutter), text: unescapeEntities(cell) });
      row = rowPattern.exec(inner);
    }
    found.push({ start, end, lines });
    match = pattern.exec(page);
  }
  return found;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

it("KNOWN-GOOD (page) every row's code cell equals the matching blocks[].text, gutters show startLine..endLine, no extra and none missing", () => {
  const committed = readCommittedRegions();
  const expected = new Map<string, string>();
  for (const region of committed.regions) {
    for (const block of region.blocks) {
      expected.set(`${block.startLine}-${block.endLine}`, block.text);
    }
  }
  const rendered = renderedRows(readPage());
  expect(rendered.length).toEqual(expected.size);
  const seen = new Set<string>();
  for (const block of rendered) {
    const key = `${block.start}-${block.end}`;
    seen.add(key);
    const want = expected.get(key);
    if (want === undefined) {
      throw new Error(`extra rendered block ${key}`);
    }
    expect(block.lines.map((row) => row.text).join("\n")).toEqual(want);
    expect(block.lines.map((row) => row.line)).toEqual(
      want.split("\n").map((_, index) => block.start + index),
    );
    expect(block.lines.map((row) => row.gutter)).toEqual(
      want.split("\n").map((_, index) => String(block.start + index)),
    );
  }
  expect(seen).toEqual(new Set(expected.keys()));
  expect(validatePageBlocks(readPage(), committed)).toEqual([]);
});

it("COUNTERWEIGHT (page) a block whose code cells carry the fixture slice shifted by 1 line fails the page check", () => {
  const committed = readCommittedRegions();
  const source = blueprintLines();
  const first = committed.regions[0]?.blocks[0];
  if (!first) {
    throw new Error("committed regions carry no blocks");
  }
  const shifted = source.slice(first.startLine, first.endLine);
  const page = readPage();
  const containerPattern = /<ol\b[^>]*\sdata-block-lines(?=[\s>])[^>]*>([\s\S]*?)<\/ol>/i;
  const container = containerPattern.exec(page);
  if (!container) {
    throw new Error("page carries no code-cell list");
  }
  const rebuilt = shifted
    .map((line, index) => {
      const number = first.startLine + index;
      return (
        `    <li class="codeline" data-code-line="${number}">` +
        `<span class="gutter" aria-hidden="true">${number}</span>` +
        `<code class="codeline-text">${escapeHtml(line)}</code></li>`
      );
    })
    .join("\n");
  const mutated = page.replace(container[1] ?? "", `\n${rebuilt}\n  `);
  expect(validatePageBlocks(mutated, committed)).not.toEqual([]);
  expect(validatePageBlocks(page, committed)).toEqual([]);
});

it("NEGATIVE (page) every line containing hiddenFactCanaries has the guardrail canary label", () => {
  const committed = readCommittedRegions();
  expect(validateCanaryLabels(readPage(), committed)).toEqual([]);
  const page = readPage();
  const labelPattern = /<span\b[^>]*\sdata-canary-line="(\d+)"(?=[\s>])[^>]*>[\s\S]*?<\/span>/i;
  const match = labelPattern.exec(page);
  if (!match) {
    throw new Error("page carries no canary label to remove");
  }
  const mutated = page.replace(match[0], "");
  expect(validateCanaryLabels(mutated, committed)).not.toEqual([]);
});

it("NEGATIVE (page) a canary badge moved outside its line's row fails the label check", () => {
  const committed = readCommittedRegions();
  const page = readPage();
  const badgePattern = /<span\b[^>]*\sdata-canary-line="(\d+)"(?=[\s>])[^>]*>[\s\S]*?<\/span>/i;
  const badge = badgePattern.exec(page);
  if (!badge) {
    throw new Error("page carries no canary badge to move");
  }
  const badgeLine = badge[1] ?? "";
  const badgeHtml = badge[0];
  const withoutBadge = page.replace(badgeHtml, "");
  const hostPattern = /<li\b[^>]*\sdata-code-line="(\d+)"(?=[\s>])[^>]*>([\s\S]*?)<\/li>/gi;
  let host = null;
  let row = hostPattern.exec(withoutBadge);
  while (row !== null) {
    if ((row[1] ?? "") !== badgeLine && !/data-canary-line/.test(row[0] ?? "")) {
      host = row;
      break;
    }
    row = hostPattern.exec(withoutBadge);
  }
  if (!host) {
    throw new Error("page carries no non-canary row to host the moved badge");
  }
  const moved = withoutBadge.replace(host[0] ?? "", (host[0] ?? "").replace(/<\/li>$/, `${badgeHtml}</li>`));
  expect(validateCanaryLabels(moved, committed)).not.toEqual([]);
  expect(validateCanaryLabels(page, committed)).toEqual([]);
});

it("stylesheet in blueprints.html has no min-width:1100px side-by-side rule and grids the cards with auto-fit", () => {
  const page = readPage();
  const style = (/<style>([\s\S]*?)<\/style>/i.exec(page) ?? [])[1] ?? "";
  if (style === "") {
    throw new Error("blueprints.html carries no style block");
  }
  expect(style.includes("min-width: 1100px") || style.includes("min-width:1100px")).toEqual(false);
  expect(style).toContain("repeat(auto-fit");
  expect(style).toContain(".inspector-excerpts");
});

it("canary badge wraps under the code cell: not flex none, full-width basis, row wraps", () => {
  const page = readPage();
  const style = (/<style>([\s\S]*?)<\/style>/i.exec(page) ?? [])[1] ?? "";
  const badge = (/\.canary-badge\s*\{([^}]*)\}/.exec(style) ?? [])[1] ?? "";
  const row = (/\.codeline\s*\{([^}]*)\}/.exec(style) ?? [])[1] ?? "";
  if (badge === "" || row === "") {
    throw new Error("style block lacks .canary-badge or .codeline rules");
  }
  expect(badge.includes("flex: none") || badge.includes("flex:none")).toEqual(false);
  expect(badge.includes("flex: 1 1 100%") || badge.includes("flex-basis: 100%") || badge.includes("flex-basis:100%")).toEqual(true);
  expect(row.includes("flex-wrap: wrap") || row.includes("flex-wrap:wrap")).toEqual(true);
});


it("COUNTERWEIGHT the overlay rect for each actor equals its mask.rect, not its bbox", () => {
  const committed = readCommittedRegions();
  for (const region of committed.regions) {
    const rect = overlayRectForActor(committed, region.actorId);
    expect(rect).toEqual(region.mask.rect);
    expect(rect).not.toEqual(region.bbox);
  }
  const synthetic = {
    cameraMode: "full-cast",
    blockers: [],
    regions: [
      {
        actorId: "nurse_maria_alvarez_v1",
        lines: [225],
        bbox: { x: 285, y: 170, width: 159, height: 250 },
        mask: { rect: { x: 324, y: 179, width: 61, height: 230 } },
      },
    ],
  };
  expect(overlayRectForActor(synthetic, "nurse_maria_alvarez_v1")).toEqual({
    x: 324,
    y: 179,
    width: 61,
    height: 230,
  });
});

it("NEGATIVE a regions fixture with blockers renders no highlight and shows the notice", () => {
  const blocked = {
    cameraMode: "full-cast",
    blockers: ["x"],
    regions: [
      {
        actorId: "patient_robert_hayes_v1",
        lines: [45],
        bbox: { x: 95, y: 267, width: 201, height: 140 },
        mask: { rect: { x: 130, y: 257, width: 104, height: 136 } },
      },
    ],
  };
  expect(highlightsEnabled(blocked)).toEqual(false);
  const notice = blockerNotice(blocked);
  expect(notice ?? "").toContain("x");
  const model = buildInspectorModel(blocked);
  expect(model.notice).toContain("x");
  for (const item of model.items) {
    expect(item.rect).toEqual(null);
  }
});

it("NEGATIVE a non-full-cast camera mode renders no highlight and shows the notice", () => {
  const partial = {
    cameraMode: "partial-cast",
    blockers: [],
    regions: [
      {
        actorId: "patient_robert_hayes_v1",
        lines: [45],
        bbox: { x: 95, y: 267, width: 201, height: 140 },
        mask: { rect: { x: 130, y: 257, width: 104, height: 136 } },
      },
    ],
  };
  expect(highlightsEnabled(partial)).toEqual(false);
  expect(blockerNotice(partial) ?? "").toContain("partial-cast");
  expect(buildInspectorModel(partial).items.map((item) => item.rect)).toEqual([null]);
});

it("NEGATIVE an excerpt control that is not a <button> is refused", () => {
  expect(isExcerptButton("BUTTON")).toEqual(true);
  expect(isExcerptButton("div")).toEqual(false);
  expect(
    excerptControlBlockers([{ tagName: "DIV", actorId: "nurse_maria_alvarez_v1" }]),
  ).toEqual(["inspector_excerpt_not_button:nurse_maria_alvarez_v1:DIV"]);
  const page = readPage();
  const controls: { tagName: string; actorId: string }[] = [];
  const pattern = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*\sdata-excerpt(?=[\s>])[^>]*)>/gi;
  let match: RegExpExecArray | null = pattern.exec(page);
  while (match !== null) {
    const attrs = match[2] ?? "";
    controls.push({
      tagName: (match[1] ?? "").toUpperCase(),
      actorId: (/data-actor="([^"]*)"/.exec(attrs) ?? [])[1] ?? "unknown",
    });
    match = pattern.exec(page);
  }
  if (controls.length !== 3) {
    throw new Error(`expected 3 excerpt controls, got ${controls.length}`);
  }
  expect(excerptControlBlockers(controls)).toEqual([]);
});

it("NEGATIVE a still whose sha256 differs from regions.still.sha256 is refused", () => {
  const committed = readCommittedRegions();
  const expected = committed.still.sha256;
  if (!expected) {
    throw new Error("committed regions carry no still.sha256");
  }
  expect(verifyStillSha(expected, expected)).toEqual(true);
  const wrong = `${expected.slice(0, -1)}${expected.endsWith("0") ? "1" : "0"}`;
  expect(verifyStillSha(expected, wrong)).toEqual(false);
  expect(verifyStillSha(expected, "")).toEqual(false);
});

it("outlineBox scales the nurse mask rect from natural 960 to rendered 390 on every field", () => {
  const box = outlineBox({ x: 324, y: 179, width: 61, height: 230 }, 960, 390);
  expect(box).toEqual({
    left: (324 * 390) / 960,
    top: (179 * 390) / 960,
    width: (61 * 390) / 960,
    height: (230 * 390) / 960,
  });
  expect(box.left).toEqual(131.625);
  expect(box.top).toEqual(72.71875);
  expect(box.width).toEqual(24.78125);
  expect(box.height).toEqual(93.4375);
});

it("COUNTERWEIGHT a rect whose bbox differs yields mask numbers through the path showOutline uses", () => {
  const synthetic = {
    cameraMode: "full-cast",
    blockers: [],
    regions: [
      {
        actorId: "nurse_maria_alvarez_v1",
        lines: [225],
        bbox: { x: 285, y: 170, width: 159, height: 250 },
        mask: { rect: { x: 324, y: 179, width: 61, height: 230 } },
      },
    ],
  };
  const rect = overlayRectForActor(synthetic, "nurse_maria_alvarez_v1");
  if (!rect) {
    throw new Error("expected a mask rect");
  }
  const box = outlineBox(rect, 960, 390);
  const scale = 390 / 960;
  expect(box).toEqual({
    left: 324 * scale,
    top: 179 * scale,
    width: 61 * scale,
    height: 230 * scale,
  });
  expect(box).not.toEqual({
    left: 285 * scale,
    top: 170 * scale,
    width: 159 * scale,
    height: 250 * scale,
  });
});

type FakeButton = {
  tagName: string;
  listeners: { type: string; fn: (...args: unknown[]) => void }[];
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, fn: (...args: unknown[]) => void) => void;
};

function fakeButton(actorId: string): FakeButton {
  const listeners: FakeButton["listeners"] = [];
  const attrs: Record<string, string> = { "data-actor": actorId, "aria-pressed": "false" };
  return {
    tagName: "BUTTON",
    listeners,
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    addEventListener: (type, fn) => {
      listeners.push({ type, fn });
    },
  };
}

function fakeWorld(doc: unknown, digestHex: string): {
  root: {
    querySelector: (sel: string) => unknown;
    querySelectorAll: (sel: string) => FakeButton[];
  };
  buttons: FakeButton[];
  noticeNode: { textContent: string; hidden: boolean };
  fetchImpl: (url: string) => Promise<{ ok: boolean; json?: () => Promise<unknown>; arrayBuffer?: () => Promise<ArrayBuffer> }>;
  digestImpl: () => Promise<string>;
} {
  const buttons = [
    fakeButton("patient_robert_hayes_v1"),
    fakeButton("spouse_anna_hayes_v1"),
    fakeButton("nurse_maria_alvarez_v1"),
  ];
  const stage = {
    querySelectorAll: () => [] as unknown[],
    appendChild: () => undefined,
  };
  const still = {
    getAttribute: (name: string) => (name === "src" ? "site/media/inspector-still-2026-11-13.png" : null),
    clientWidth: 390,
    naturalWidth: 960,
  };
  const noticeNode = { textContent: "", hidden: true };
  const root = {
    querySelector: (sel: string): unknown => {
      if (sel === "[data-inspector-stage]") return stage;
      if (sel === "[data-inspector-still]") return still;
      if (sel === "[data-inspector-notice]") return noticeNode;
      return null;
    },
    querySelectorAll: (sel: string): FakeButton[] => (sel === "[data-excerpt]" ? buttons : []),
  };
  const fetchImpl = async (url: string) => {
    if (url.endsWith(".json")) {
      return { ok: true, json: async () => doc };
    }
    return { ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer };
  };
  const digestImpl = async () => digestHex;
  return { root, buttons, noticeNode, fetchImpl, digestImpl };
}

function listenerCount(buttons: FakeButton[]): number {
  return buttons.reduce((total, button) => total + button.listeners.length, 0);
}

const COMMITTED_SHA = "86ec1928758cf190c8a6c6b9449a163c96c6944461dfac6a97bfab5d402785db";

function wiredRegionsDoc(overrides: { blockers?: string[]; cameraMode?: string } = {}): unknown {
  return {
    cameraMode: overrides.cameraMode ?? "full-cast",
    blockers: overrides.blockers ?? [],
    still: { sha256: COMMITTED_SHA },
    regions: [
      {
        actorId: "patient_robert_hayes_v1",
        lines: [45, 384, 451],
        mask: { rect: { x: 130, y: 257, width: 104, height: 136 } },
      },
      {
        actorId: "spouse_anna_hayes_v1",
        lines: [172, 430],
        mask: { rect: { x: 294, y: 193, width: 51, height: 188 } },
      },
      {
        actorId: "nurse_maria_alvarez_v1",
        lines: [225, 269, 407],
        mask: { rect: { x: 324, y: 179, width: 61, height: 230 } },
      },
    ],
  };
}

it("init (a) regions with blockers [x] wires nothing, names x, attaches zero listeners", async () => {
  const world = fakeWorld(wiredRegionsDoc({ blockers: ["x"] }), COMMITTED_SHA);
  const status = await initInspector({
    root: world.root,
    fetchImpl: world.fetchImpl,
    digestImpl: world.digestImpl,
  });
  expect(status.wired).toEqual(false);
  expect(status.notice ?? "").toContain("x");
  expect(world.noticeNode.hidden).toEqual(false);
  expect(listenerCount(world.buttons)).toEqual(0);
});

it("init (b) a non-full-cast camera mode wires nothing and shows the notice", async () => {
  const world = fakeWorld(wiredRegionsDoc({ cameraMode: "partial-cast" }), COMMITTED_SHA);
  const status = await initInspector({
    root: world.root,
    fetchImpl: world.fetchImpl,
    digestImpl: world.digestImpl,
  });
  expect(status.wired).toEqual(false);
  expect(status.notice ?? "").toContain("partial-cast");
  expect(world.noticeNode.hidden).toEqual(false);
  expect(listenerCount(world.buttons)).toEqual(0);
});

it("init (c) a digest that differs from regions.still.sha256 wires nothing and shows the notice", async () => {
  const world = fakeWorld(wiredRegionsDoc(), `${COMMITTED_SHA.slice(0, -1)}0`);
  const status = await initInspector({
    root: world.root,
    fetchImpl: world.fetchImpl,
    digestImpl: world.digestImpl,
  });
  expect(status.wired).toEqual(false);
  expect(status.notice ?? "").not.toEqual("");
  expect(world.noticeNode.textContent).not.toEqual("");
  expect(world.noticeNode.hidden).toEqual(false);
  expect(listenerCount(world.buttons)).toEqual(0);
});

it("init (d) KNOWN-GOOD matching sha with no blockers wires 3 listeners and no notice", async () => {
  const world = fakeWorld(wiredRegionsDoc(), COMMITTED_SHA);
  const status = await initInspector({
    root: world.root,
    fetchImpl: world.fetchImpl,
    digestImpl: world.digestImpl,
  });
  expect(status).toEqual({ wired: true, notice: null });
  expect(world.noticeNode.hidden).toEqual(true);
  expect(world.noticeNode.textContent).toEqual("");
  expect(listenerCount(world.buttons)).toEqual(3);
  for (const button of world.buttons) {
    expect(button.listeners.map((entry) => entry.type)).toEqual(["click"]);
  }
});
