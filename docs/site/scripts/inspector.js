/**
 * Blueprint inspector (card W4a-1b).
 *
 * Reads docs/site/data/inspector-regions.json and outlines the actor's
 * mask.rect (never bbox) on an overlay positioned in still pixel coordinates,
 * scaled with the rendered still width. No dependencies.
 *
 * Pure helpers are exported so tools/openclinxr/evidence/site/inspector.test.ts
 * can exercise them without a browser. DOM wiring only runs in a browser.
 */

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The overlay rect for an actor: its mask.rect, never its bbox.
 * Returns { x, y, width, height } in still pixels, or null when absent.
 */
export function overlayRectForActor(doc, actorId) {
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const region = regions.find((entry) => isRecord(entry) && entry.actorId === actorId);
  const rect = region?.mask?.rect;
  if (
    !isRecord(rect) ||
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.width) ||
    !isFiniteNumber(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * One-line notice naming why highlights are off, or null when highlights
 * are allowed (blockers empty and cameraMode full-cast).
 */
export function blockerNotice(doc) {
  const blockers = Array.isArray(doc?.blockers)
    ? doc.blockers.filter((entry) => typeof entry === "string" && entry.trim() !== "")
    : [];
  if (blockers.length > 0) {
    return `Inspector highlights off (blocker: ${blockers.join(", ")}). Still and blueprint text shown without outlines.`;
  }
  if (doc?.cameraMode !== "full-cast") {
    return `Inspector highlights off (camera mode ${String(doc?.cameraMode ?? "unknown")} is not full-cast). Still and blueprint text shown without outlines.`;
  }
  return null;
}

/** Highlights render only when blockers are empty and cameraMode is full-cast. */
export function highlightsEnabled(doc) {
  return blockerNotice(doc) === null;
}

/** Excerpt controls must be <button> elements so they stay keyboard reachable. */
export function isExcerptButton(tagName) {
  return String(tagName ?? "").toUpperCase() === "BUTTON";
}

/**
 * Refuse every excerpt control that is not a <button>.
 * Returns blocker strings, [] when all controls are buttons.
 */
export function excerptControlBlockers(controls) {
  const blockers = [];
  for (const control of Array.isArray(controls) ? controls : []) {
    const tag = String(control?.tagName ?? "");
    const actor = String(control?.actorId ?? "unknown");
    if (!isExcerptButton(tag)) {
      blockers.push(`inspector_excerpt_not_button:${actor}:${tag || "missing"}`);
    }
  }
  return blockers;
}

/** True when the fetched still bytes match regions.still.sha256. Refuse otherwise. */
export function verifyStillSha(expectedSha256, actualSha256) {
  if (typeof expectedSha256 !== "string" || typeof actualSha256 !== "string") {
    return false;
  }
  const expected = expectedSha256.trim().toLowerCase();
  const actual = actualSha256.trim().toLowerCase();
  return expected !== "" && expected === actual;
}

/**
 * DOM-free model for the page: notice plus one item per region.
 * rect is null (no highlight) whenever highlights are disabled.
 */
export function buildInspectorModel(doc) {
  const notice = blockerNotice(doc);
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const items = [];
  for (const region of regions) {
    if (!isRecord(region) || typeof region.actorId !== "string") {
      continue;
    }
    const lines = Array.isArray(region.lines)
      ? region.lines.filter((line) => Number.isInteger(line))
      : [];
    items.push({
      actorId: region.actorId,
      lines,
      rect: notice === null ? overlayRectForActor(doc, region.actorId) : null,
    });
  }
  return { notice, items };
}

function clearOutline(stage, buttons) {
  for (const node of stage.querySelectorAll("[data-inspector-outline]")) {
    if (typeof node.remove === "function") {
      node.remove();
    }
  }
  for (const button of buttons) {
    button.setAttribute("aria-pressed", "false");
  }
}

/**
 * Overlay box in rendered px: production scaling path (still pixel
 * coordinates scaled by renderedWidth / naturalWidth). showOutline calls
 * this; the test exercises the same path.
 */
export function outlineBox(rect, naturalWidth, renderedWidth) {
  const scale = renderedWidth / naturalWidth;
  return {
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function defaultCreateOutline(box, actorId) {
  const outline = document.createElement("div");
  outline.setAttribute("data-inspector-outline", actorId);
  outline.setAttribute("role", "presentation");
  outline.style.position = "absolute";
  outline.style.left = `${box.left}px`;
  outline.style.top = `${box.top}px`;
  outline.style.width = `${box.width}px`;
  outline.style.height = `${box.height}px`;
  outline.style.outline = "2px solid currentColor";
  outline.style.pointerEvents = "none";
  return outline;
}

function showOutline(stage, still, buttons, rect, actorId, createOutline) {
  clearOutline(stage, buttons);
  const box = outlineBox(rect, still.naturalWidth, still.clientWidth);
  stage.appendChild(createOutline(box, actorId));
  const active = buttons.find((button) => button.getAttribute("data-actor") === actorId);
  if (active) {
    active.setAttribute("aria-pressed", "true");
  }
}

function unescapeHtmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function pageBlocks(pageHtml) {
  const found = [];
  const pattern = /<(figure|details)\b([^>]*\sdata-block(?=[\s>])[^>]*)>([\s\S]*?)<\/\1>/gi;
  let match = pattern.exec(pageHtml);
  while (match !== null) {
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const start = Number((/\bdata-block-start="(\d+)"/.exec(attrs) ?? [])[1]);
    const end = Number((/\bdata-block-end="(\d+)"/.exec(attrs) ?? [])[1]);
    const rows = [];
    const rowPattern = /<li\b([^>]*\sdata-code-line="(\d+)"(?=[\s>])[^>]*)>([\s\S]*?)<\/li>/gi;
    let row = rowPattern.exec(inner);
    while (row !== null) {
      const rowInner = row[3] ?? "";
      const cell = (/<code\b[^>]*\bcodeline-text\b[^>]*>([\s\S]*?)<\/code>/i.exec(rowInner) ?? [])[1];
      const badge = new RegExp(
        `<[^>]*\\sdata-canary-line="${row ? row[2] : ""}"(?=[\\s>])[^>]*>([\\s\\S]*?)<\\/[a-zA-Z][^>]*>`,
        "i",
      ).exec(rowInner);
      rows.push({
        line: Number(row[2]),
        text: cell === undefined ? null : unescapeHtmlEntities(cell),
        badgeText:
          badge === null ? null : unescapeHtmlEntities(badge[1].replace(/<[^>]*>/g, " ")),
      });
      row = rowPattern.exec(inner);
    }
    found.push({ start, end, rows });
    match = pattern.exec(pageHtml);
  }
  return found;
}

function blockText(block) {
  return (block.rows ?? []).map((row) => row.text).join("\n");
}

/**
 * Page check: every rendered block equals the matching blocks[].text from
 * the regions doc, with no extra and no missing blocks.
 */
export function validatePageBlocks(pageHtml, doc) {
  const blockers = [];
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const expected = new Map();
  for (const region of regions) {
    for (const block of region?.blocks ?? []) {
      expected.set(`${block.startLine}-${block.endLine}`, block.text);
    }
  }
  const seen = new Set();
  for (const block of pageBlocks(pageHtml)) {
    const key = `${block.start}-${block.end}`;
    seen.add(key);
    if (!expected.has(key)) {
      blockers.push(`page_block_extra:${key}`);
    } else if (blockText(block) !== expected.get(key)) {
      blockers.push(`page_block_text_mismatch:${key}`);
    }
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) {
      blockers.push(`page_block_missing:${key}`);
    }
  }
  return blockers;
}

/**
 * Every fixture line containing hiddenFactCanaries needs its guardrail
 * label adjacent to that line's row (inline badge in the row), not
 * elsewhere on the page.
 */
export function validateCanaryLabels(pageHtml, doc) {
  const blockers = [];
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const rendered = new Map(pageBlocks(pageHtml).map((block) => [`${block.start}-${block.end}`, block]));
  for (const region of regions) {
    for (const block of region?.blocks ?? []) {
      const lines = String(block?.text ?? "").split("\n");
      const live = rendered.get(`${block.startLine}-${block.endLine}`);
      for (let i = 0; i < lines.length; i += 1) {
        if (!(lines[i] ?? "").includes("hiddenFactCanaries")) {
          continue;
        }
        const lineNumber = block.startLine + i;
        const row = (live?.rows ?? []).find((entry) => entry.line === lineNumber);
        const badge = row?.badgeText ?? null;
        if (
          badge === null ||
          !badge.includes("guardrail canary") ||
          !badge.includes("a hidden fact the actor must not volunteer")
        ) {
          blockers.push(`page_canary_label_missing:${region.actorId}:${lineNumber}`);
        }
      }
    }
  }
  return blockers;
}

async function defaultDigest(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function refuse(noticeNode, notice) {
  noticeNode.textContent = notice;
  noticeNode.hidden = false;
  return { wired: false, notice };
}

/**
 * Wire the inspector. Dependencies are injectable for tests (no jsdom):
 * root (document-like with querySelector/querySelectorAll), fetchImpl,
 * digestImpl (bytes -> hex sha256), createOutline. Browser defaults apply
 * when arguments are omitted. Returns { wired, notice }.
 */
export async function initInspector(deps = {}) {
  const root = deps.root ?? (typeof document !== "undefined" ? document : undefined);
  const fetchImpl = deps.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const digestImpl = deps.digestImpl ?? defaultDigest;
  const createOutline = deps.createOutline ?? defaultCreateOutline;
  const noticeNode = root?.querySelector("[data-inspector-notice]") ?? null;
  if (!root || !fetchImpl || !noticeNode) {
    return { wired: false, notice: "Inspector unavailable." };
  }
  const stage = root.querySelector("[data-inspector-stage]");
  const still = root.querySelector("[data-inspector-still]");
  if (!stage || !still) {
    return refuse(
      noticeNode,
      "Inspector highlights off (page markup missing). Still and blueprint text shown without outlines.",
    );
  }
  let doc;
  try {
    const response = await fetchImpl("site/data/inspector-regions.json");
    if (!response.ok) {
      throw new Error(`regions fetch failed: ${response.status}`);
    }
    doc = await response.json();
  } catch {
    return refuse(
      noticeNode,
      "Inspector highlights off (regions file unreadable). Still and blueprint text shown without outlines.",
    );
  }
  const notice = blockerNotice(doc);
  if (notice !== null) {
    return refuse(noticeNode, notice);
  }
  let stillBytes = null;
  try {
    const response = await fetchImpl(still.getAttribute("src") ?? "");
    if (response.ok) {
      stillBytes = await response.arrayBuffer();
    }
  } catch {
    stillBytes = null;
  }
  const expectedSha = typeof doc?.still?.sha256 === "string" ? doc.still.sha256 : "";
  let actualSha = "";
  try {
    actualSha = stillBytes === null ? "" : await digestImpl(stillBytes);
  } catch {
    actualSha = "";
  }
  if (stillBytes === null || !verifyStillSha(expectedSha, actualSha)) {
    return refuse(
      noticeNode,
      "Inspector highlights off (still could not be verified against regions.still.sha256). Still and blueprint text shown without outlines.",
    );
  }
  const buttons = [...root.querySelectorAll("[data-excerpt]")];
  const controls = buttons.map((node) => ({
    tagName: node.tagName,
    actorId: node.getAttribute("data-actor") ?? "unknown",
  }));
  if (excerptControlBlockers(controls).length > 0) {
    return refuse(
      noticeNode,
      "Inspector highlights off (an excerpt control is not a button). Still and blueprint text shown without outlines.",
    );
  }
  const model = buildInspectorModel(doc);
  for (const button of buttons) {
    const actorId = button.getAttribute("data-actor") ?? "";
    const item = model.items.find((entry) => entry.actorId === actorId);
    if (!item || !item.rect) {
      continue;
    }
    const rect = item.rect;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      const pressed = button.getAttribute("aria-pressed") === "true";
      if (pressed) {
        clearOutline(stage, buttons);
        return;
      }
      showOutline(stage, still, buttons, rect, actorId, createOutline);
    });
  }
  return { wired: true, notice: null };
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void initInspector();
    });
  } else {
    void initInspector();
  }
}
