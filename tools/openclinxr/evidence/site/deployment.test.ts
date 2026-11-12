import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const pageRel = "docs/evidence.html";
const dataFlowRel = "docs/site/media/k12-data-flow.svg";
const dataFlowNarrowRel = "docs/site/media/k12-data-flow-narrow.svg";
const reviewRel = "docs/site/media/k12-review-workflow.svg";
const reviewNarrowRel = "docs/site/media/k12-review-workflow-narrow.svg";
const mediaRel = "docs/site/data/media.json";

// P1 node set: the components named in the CL19/CL24/CL25 paragraph at
// docs/evidence.html:150-151. Each entry cites its code source. The group
// titles name that paragraph's two zones, so they join the closed list.
const DATA_FLOW_NODES = [
  "browser", // docs/evidence.html:151 (browser zone of the data-flow paragraph)
  "learner interface", // packages/openclinxr/xr-sync-client/src/encounter-room-panel.ts:4 (RoomPanel)
  "synthesized speech", // packages/openclinxr/xr-sync-client/src/actor-voice.test.ts:127 (CL24 probe)
  "LAN host", // docs/evidence.html:151 (LAN host zone of the data-flow paragraph)
  "sync server", // packages/openclinxr/xr-sync-server/src/server.ts:132 (createEncounterServer)
  "STT sidecar", // packages/openclinxr/xr-sync-server/src/sidecar-recognizer.ts:37 (createSidecarRecognizer)
  "trace files", // packages/openclinxr/xr-sync-server/src/conversation-tracer.ts:146 (writeFileSync)
  "note files", // packages/openclinxr/xr-sync-server/src/patient-note.ts:119 (writeFileSync)
  "mark files", // packages/openclinxr/xr-sync-server/src/faculty-score.ts:198 (writeFileSync)
] as const;

// Closed data-flow edge list (M4/G8). Learner audio reaches the sidecar in two
// cited hops: interface>server carries the speech-audio intent up
// (encounter-turns.ts:480), server>STT sidecar feeds PCM to the recognizer
// (speech-audio.ts:64). State flows back through Colyseus schema patches
// (room.ts:243) rendered by the panel (encounter-room-panel.ts:93), so
// interface>server is two-way. Transcript returns via speech-audio.ts:73
// (resolved in sidecar-recognizer.ts:66). An edge without a cited hop is not drawn.
const DATA_FLOW_EDGES = [
  { direction: "one-way", from: "synthesized speech", to: "learner interface" }, // encounter-turns.ts:74 (spokenTextForTts: turn.caption) + actor-voice.test.ts:127 (CL24)
  { direction: "two-way", from: "learner interface", to: "sync server" }, // up: encounter-turns.ts:480 (sendIntent speech-audio); down: room.ts:243 (schema patches) + encounter-room-panel.ts:93 (render)
  { direction: "one-way", from: "sync server", to: "STT sidecar" }, // speech-audio.ts:64 (await recognizer PCM)
  { direction: "one-way", from: "STT sidecar", to: "sync server" }, // speech-audio.ts:73 (transcript ack)
  { direction: "one-way", from: "sync server", to: "trace files" }, // conversation-tracer.ts:146 (writeFileSync)
  { direction: "one-way", from: "sync server", to: "note files" }, // conversation-tracer.ts:119 (writeFileSync)
  { direction: "one-way", from: "sync server", to: "mark files" }, // conversation-tracer.ts:198 (writeFileSync)
] as const;

// Closed review edge list (G12). From/to name the ident (the cited
// identifier), so each edge is traceable to encounter-bundle-promotion.ts.
const REVIEW_EDGES = [
  { direction: "one-way", from: "generated", to: "reviewed" },
  { direction: "one-way", from: "reviewed", to: "blocked" },
  { direction: "one-way", from: "reviewed", to: "approved_for_local_runtime" },
  { direction: "one-way", from: "reviewed", to: "fixture_approved_for_local_runtime" },
  { direction: "one-way", from: "approved_for_local_runtime", to: "promoteReviewedFactoryOutputsToImmutableEncounterBundle" },
  { direction: "one-way", from: "fixture_approved_for_local_runtime", to: "promoteReviewedFactoryOutputsToImmutableEncounterBundle" },
  { direction: "one-way", from: "promoteReviewedFactoryOutputsToImmutableEncounterBundle", to: "promoted_encounter_bundles" },
] as const;

// P3 identifier set: pipeline states and the promoting function verbatim from
// packages/openclinxr/asset-registry/src/encounter-bundle-promotion.ts, plus
// the persistence collection from
// packages/openclinxr/data-mongodb/src/promoted-encounter-bundle-repository.ts:110.
const REVIEW_IDENTS = [
  "generated", // encounter-bundle-promotion.ts:21 (EncounterBundleFactoryMemberPipelineState)
  "reviewed", // encounter-bundle-promotion.ts:21 (EncounterBundleFactoryMemberPipelineState)
  "approved_for_local_runtime", // encounter-bundle-promotion.ts:187 (inspectMember reviewStatus)
  "fixture_approved_for_local_runtime", // encounter-bundle-promotion.ts:192 (inspectMember reviewStatus)
  "blocked", // encounter-bundle-promotion.ts:172 (inspectMember reviewStatus)
  "promoteReviewedFactoryOutputsToImmutableEncounterBundle", // encounter-bundle-promotion.ts:86
  "promoted_encounter_bundles", // promoted-encounter-bundle-repository.ts:110 (Mongo collection; the authoring-side store)
] as const;

// Plain-language primaries (M3). Each is traceable to the promotion code's
// meaning: generated/reviewed default from inferredPipelineState
// (encounter-bundle-promotion.ts:200-211); approved states require both
// REQUIRED_REVIEW_ROLES attestations (:39, :213-230); refused covers
// refuse(blockers) (:142-152); promote covers the frozen learner bundle
// (:130-140); store covers the persisted promoted record (:60-76 of the repository).
const REVIEW_PRIMARIES = [
  "New factory output", // generated: default pipeline state before any review decision
  "Passed review", // reviewed: pipeline state once inspected, before attestation checks
  "Approved for local runtime", // approved_for_local_runtime: both reviewer roles attested
  "Fixture approved for local runtime", // fixture_approved_for_local_runtime: fixture review status
  "Refused at review", // blocked: refuse(blockers), never promoted
  "Promote to immutable bundle", // promoteReviewedFactoryOutputsToImmutableEncounterBundle: freeze the learner bundle
  "Authoring-side store", // promoted_encounter_bundles: persisted promoted record, never runtime data flow
] as const;

// G13 fixture: the r2 narrow review layout (single-column sequence, squeezed
// ident). It must FAIL G12 (no data-edge attributes) or G13 (stacked boxes).
const R2_NARROW_REVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="592" viewBox="0 0 340 592" role="img">
  <title>Reviewed-revision bundle promotion</title>
  <desc>Factory members move from generated to reviewed, gain an approved for local runtime review status, are promoted by promoteReviewedFactoryOutputsToImmutableEncounterBundle, and persist in the authoring-side store. Blocked members refuse promotion.</desc>
  <rect x="0" y="0" width="340" height="592" fill="#f8f7f2"/>
  <rect x="30" y="24" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="50" text-anchor="middle" font-size="16" fill="#17201b">New factory output</text>
  <text class="ident" x="170" y="71" text-anchor="middle" font-size="13" fill="#59645e">generated</text>
  <rect x="30" y="104" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="130" text-anchor="middle" font-size="16" fill="#17201b">Passed review</text>
  <text class="ident" x="170" y="151" text-anchor="middle" font-size="13" fill="#59645e">reviewed</text>
  <rect x="30" y="184" width="280" height="64" rx="8" fill="#ffffff" stroke="#59645e" stroke-width="2"/>
  <text x="170" y="210" text-anchor="middle" font-size="16" fill="#17201b">Refused at review</text>
  <text class="ident" x="170" y="231" text-anchor="middle" font-size="13" fill="#59645e">blocked</text>
  <rect x="30" y="264" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="290" text-anchor="middle" font-size="16" fill="#17201b">Approved for local runtime</text>
  <text class="ident" x="170" y="311" text-anchor="middle" font-size="13" fill="#59645e">approved_for_local_runtime</text>
  <rect x="30" y="344" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="370" text-anchor="middle" font-size="16" fill="#17201b">Fixture approved for local runtime</text>
  <text class="ident" x="170" y="391" text-anchor="middle" font-size="13" fill="#59645e">fixture_approved_for_local_runtime</text>
  <rect x="30" y="424" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="450" text-anchor="middle" font-size="16" fill="#17201b">Promote to immutable bundle</text>
  <text class="ident" x="170" y="471" text-anchor="middle" font-size="13" fill="#59645e">promoteReviewedFactoryOutputsToImmutableEncounterBundle</text>
  <rect x="30" y="504" width="280" height="64" rx="8" fill="#ffffff" stroke="#1f6f56" stroke-width="2"/>
  <text x="170" y="530" text-anchor="middle" font-size="16" fill="#17201b">Authoring-side store</text>
  <text class="ident" x="170" y="551" text-anchor="middle" font-size="13" fill="#59645e">promoted_encounter_bundles</text>
  <line x1="170" y1="88" x2="170" y2="98" stroke="#245f8f" stroke-width="2"/>
  <line x1="170" y1="168" x2="170" y2="178" stroke="#245f8f" stroke-width="2"/>
  <line x1="170" y1="328" x2="170" y2="338" stroke="#245f8f" stroke-width="2"/>
  <line x1="170" y1="408" x2="170" y2="418" stroke="#245f8f" stroke-width="2"/>
  <line x1="170" y1="488" x2="170" y2="498" stroke="#245f8f" stroke-width="2"/>
</svg>`;

type ClaimsFile = {
  claims?: { id?: unknown }[];
};

type MediaFile = {
  slots?: { id?: unknown; ceilingBytes?: unknown; files?: unknown }[];
};

type TextRun = {
  text: string;
  ident: boolean;
  fontSize: number;
  x: number;
  y: number;
};

type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  primaryLines: string[];
  identLines: string[];
};

type Edge = {
  from: string;
  to: string;
  direction: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function readText(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function readClaimIds(): Set<string> {
  const data = JSON.parse(readText("docs/site/data/claims.json")) as ClaimsFile;
  return new Set((data.claims ?? []).map((claim) => String(claim.id ?? "")));
}

// Same check the real page must pass: every paragraph inside #deployment
// carries a data-claim naming a known claims.json id.
function deploymentParagraphBlockers(html: string, known: Set<string>, page: string): string[] {
  const blockers: string[] = [];
  const sectionPattern = /<section\b[^>]*\bid="deployment"[^>]*>([\s\S]*?)<\/section>/i;
  const section = sectionPattern.exec(html)?.[1] ?? "";
  if (section === "") {
    return [`${page}:deployment_section_missing`];
  }
  const paragraphPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  for (const paragraph of section.match(paragraphPattern) ?? []) {
    const openTag = (/<p\b[^>]*>/i.exec(paragraph) ?? [])[0] ?? "";
    const dataClaim = (/\sdata-claim\s*=\s*("[^"]*"|'[^']*')/.exec(openTag) ?? [])[1]
      ?.slice(1, -1)
      .trim();
    if (dataClaim === undefined || dataClaim === "") {
      blockers.push(`${page}:deployment_paragraph_without_claim`);
      continue;
    }
    for (const claimId of dataClaim.split(/\s+/).filter((id) => id.length > 0)) {
      if (!known.has(claimId)) {
        blockers.push(`${page}:deployment_unknown_claim:${claimId}`);
      }
    }
  }
  return blockers;
}

function attrNumber(attrs: string, name: string): number {
  return Number((new RegExp(`\\b${name}\\s*=\\s*"([\\d.]+)"`).exec(attrs) ?? [])[1] ?? "");
}

function svgTextRuns(svg: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const match of svg.matchAll(/<text\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = match[1] ?? "";
    const text = (match[2] ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const classAttr = (/\bclass\s*=\s*"([^"]*)"/.exec(attrs) ?? [])[1] ?? "";
    const sizeAttr = (/\bfont-size\s*=\s*"([\d.]+)"/.exec(attrs) ?? [])[1] ?? "";
    runs.push({
      text,
      ident: classAttr.split(/\s+/).includes("ident"),
      fontSize: sizeAttr === "" ? Number.NaN : Number(sizeAttr),
      x: attrNumber(attrs, "x"),
      y: attrNumber(attrs, "y"),
    });
  }
  return runs;
}

function svgTexts(svg: string): string[] {
  return svgTextRuns(svg).map((run) => run.text);
}

function pathEndpoints(d: string): { x1: number; y1: number; x2: number; y2: number; length: number } {
  const numbers = [...d.matchAll(/-?[\d.]+/g)].map((match) => Number(match[0] ?? ""));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i] ?? 0, y: numbers[i + 1] ?? 0 });
  }
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = (points[i]?.x ?? 0) - (points[i - 1]?.x ?? 0);
    const dy = (points[i]?.y ?? 0) - (points[i - 1]?.y ?? 0);
    length += Math.hypot(dx, dy);
  }
  return {
    x1: points[0]?.x ?? 0,
    y1: points[0]?.y ?? 0,
    x2: points.at(-1)?.x ?? 0,
    y2: points.at(-1)?.y ?? 0,
    length,
  };
}

function svgEdges(svg: string): Edge[] {
  const edges: Edge[] = [];
  for (const match of svg.matchAll(/<(?:path|line)\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>/gi)) {
    const attrs = match[1] ?? "";
    const edge = (/\bdata-edge\s*=\s*"([^"]*)"/.exec(attrs) ?? [])[1];
    if (edge === undefined) {
      continue;
    }
    const direction = (/\bdata-direction\s*=\s*"([^"]*)"/.exec(attrs) ?? [])[1] ?? "";
    const separator = edge.indexOf(">");
    let endpoints = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const d = (/\bd\s*=\s*"([^"]*)"/.exec(attrs) ?? [])[1];
    if (d !== undefined) {
      endpoints = pathEndpoints(d);
    } else {
      endpoints = {
        x1: attrNumber(attrs, "x1"),
        y1: attrNumber(attrs, "y1"),
        x2: attrNumber(attrs, "x2"),
        y2: attrNumber(attrs, "y2"),
      };
    }
    edges.push({
      from: edge.slice(0, separator).trim(),
      to: edge.slice(separator + 1).trim(),
      direction,
      ...endpoints,
      length: d !== undefined
        ? pathEndpoints(d).length
        : Math.hypot(endpoints.x2 - endpoints.x1, endpoints.y2 - endpoints.y1),
    });
  }
  return edges;
}

function edgeKey(edge: Pick<Edge, "from" | "to" | "direction">): string {
  return `${edge.from}>${edge.to}:${edge.direction}`;
}

function edgeBlockers(actual: Edge[], expected: readonly Pick<Edge, "from" | "to" | "direction">[], page: string): string[] {
  const actualKeys = new Set(actual.map(edgeKey));
  const expectedKeys = new Set(expected.map(edgeKey));
  const blockers: string[] = [];
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      blockers.push(`${page}:edge_not_in_closed_list:${key}`);
    }
  }
  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      blockers.push(`${page}:closed_list_edge_missing:${key}`);
    }
  }
  return blockers;
}

function svgBoxes(svg: string): Box[] {
  const boxes: Box[] = [];
  for (const match of svg.matchAll(/<rect\b((?:"[^"]*"|'[^']*'|[^<>"'])*)>/gi)) {
    const attrs = match[1] ?? "";
    const box: Box = {
      x: attrNumber(attrs, "x"),
      y: attrNumber(attrs, "y"),
      w: attrNumber(attrs, "width"),
      h: attrNumber(attrs, "height"),
      primaryLines: [],
      identLines: [],
    };
    if (box.x === 0 && box.y === 0) {
      continue;
    }
    boxes.push(box);
  }
  for (const run of svgTextRuns(svg)) {
    const owner = boxes.find((box) =>
      run.x >= box.x && run.x <= box.x + box.w && run.y >= box.y && run.y <= box.y + box.h
    );
    if (owner === undefined) {
      continue;
    }
    if (run.ident) {
      owner.identLines.push(run.text);
    } else {
      owner.primaryLines.push(run.text);
    }
  }
  return boxes;
}

function primaryBlock(box: Box): string {
  return box.primaryLines.join(" ");
}

function identBlock(box: Box): string {
  return box.identLines.join("");
}

function boxByIdent(boxes: Box[], ident: string): Box {
  const found = boxes.find((box) => identBlock(box) === ident);
  if (found === undefined) {
    throw new Error(`no box with ident ${ident}`);
  }
  return found;
}

function onBorder(px: number, py: number, box: Box): boolean {
  const onVertical = (Math.abs(px - box.x) <= 2 || Math.abs(px - (box.x + box.w)) <= 2)
    && py >= box.y - 2 && py <= box.y + box.h + 2;
  const onHorizontal = (Math.abs(py - box.y) <= 2 || Math.abs(py - (box.y + box.h)) <= 2)
    && px >= box.x - 2 && px <= box.x + box.w + 2;
  return onVertical || onHorizontal;
}

function reviewGeometryBlockers(svg: string, page: string): string[] {
  const blockers = edgeBlockers(svgEdges(svg), REVIEW_EDGES, page);
  const boxes = svgBoxes(svg);
  for (const edge of svgEdges(svg)) {
    let fromBox: Box | undefined;
    let toBox: Box | undefined;
    try {
      fromBox = boxByIdent(boxes, edge.from);
      toBox = boxByIdent(boxes, edge.to);
    } catch {
      blockers.push(`${page}:edge_box_missing:${edgeKey(edge)}`);
      continue;
    }
    const length = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
    if (length < 12) {
      blockers.push(`${page}:edge_too_short:${edgeKey(edge)}:${length}`);
    }
    if (!onBorder(edge.x1, edge.y1, fromBox)) {
      blockers.push(`${page}:edge_start_off_box:${edgeKey(edge)}`);
    }
    if (!onBorder(edge.x2, edge.y2, toBox)) {
      blockers.push(`${page}:edge_end_off_box:${edgeKey(edge)}`);
    }
  }
  return blockers;
}

function stackedWithoutEdgeBlockers(svg: string, page: string): string[] {
  const blockers: string[] = [];
  const boxes = svgBoxes(svg);
  const connected = new Set(
    REVIEW_EDGES.map((edge) => [edge.from, edge.to].sort().join("|")),
  );
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const left = boxes[i];
      const right = boxes[j];
      if (left === undefined || right === undefined) {
        continue;
      }
      const pair = [identBlock(left), identBlock(right)].sort().join("|");
      if (connected.has(pair)) {
        continue;
      }
      const xOverlap = Math.max(left.x, right.x) < Math.min(left.x + left.w, right.x + right.w);
      const top = Math.max(left.y, right.y);
      const bottom = Math.min(left.y + left.h, right.y + right.h);
      const gap = top >= bottom ? top - bottom : 0;
      if (xOverlap && gap < 16) {
        blockers.push(`${page}:stacked_without_edge:${identBlock(left)}:${identBlock(right)}`);
      }
    }
  }
  return blockers;
}

function subsetBlockers(actual: string[], allowed: readonly string[], page: string): string[] {
  const ok = new Set(allowed);
  return actual.filter((label) => !ok.has(label)).map((label) => `${page}:label_not_in_closed_list:${label}`);
}

function missingBlockers(actual: string[], required: readonly string[], page: string): string[] {
  const seen = new Set(actual);
  return [...required].filter((label) => !seen.has(label)).map((label) => `${page}:closed_list_label_missing:${label}`);
}

// Dependency-free XML well-formedness: balanced tags, comments and
// processing instructions skipped, self-closing tags not pushed. Attribute
// values may contain ">" (data-edge uses from>to), so quoted spans are
// consumed before looking for the tag end.
function wellFormedXml(text: string): boolean {
  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Z][^<>]*>|<\/?[A-Za-z_](?:"[^"]*"|'[^']*'|[^<>"'])*>/g;
  const stack: string[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0] ?? "";
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) {
      continue;
    }
    const isClose = token.startsWith("</");
    const isSelfClose = /\/>$/.test(token);
    const name = (/^<\/?([A-Za-z_][\w:.-]*)/.exec(token) ?? [])[1] ?? "";
    if (name === "") {
      return false;
    }
    if (isClose) {
      if (stack.pop() !== name) {
        return false;
      }
    } else if (!isSelfClose) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function svgViewBoxWidth(svg: string): number {
  const match = /viewBox\s*=\s*"0 0 ([\d.]+) [\d.]+"/.exec(svg);
  if (match === null) {
    throw new Error("viewBox not found");
  }
  return Number(match[1] ?? "");
}

function k12CeilingBytes(): number {
  const data = JSON.parse(readText(mediaRel)) as MediaFile;
  for (const slot of data.slots ?? []) {
    if (slot.id === "K12" && typeof slot.ceilingBytes === "number") {
      return slot.ceilingBytes;
    }
  }
  throw new Error("K12 slot with numeric ceilingBytes not found in media.json");
}

function k12Files(): string[] {
  const data = JSON.parse(readText(mediaRel)) as MediaFile;
  for (const slot of data.slots ?? []) {
    if (slot.id === "K12" && Array.isArray(slot.files)) {
      return slot.files.filter((file): file is string => typeof file === "string");
    }
  }
  throw new Error("K12 slot with files not found in media.json");
}

it("known-good: every deployment paragraph carries a claims.json data-claim", () => {
  expect(deploymentParagraphBlockers(readText(pageRel), readClaimIds(), pageRel)).toEqual([]);
});

it("negative: a fixture copy of #deployment with one paragraph lacking data-claim is refused", () => {
  const html = readText(pageRel);
  const stripped = html.replace(
    /(<section\b[^>]*\bid="deployment"[^>]*>[\s\S]*?<p\b[^>]*?)\sdata-claim="[^"]*"/,
    "$1",
  );
  if (stripped === html) {
    throw new Error("fixture rewrite did not remove a deployment data-claim");
  }
  const blockers = deploymentParagraphBlockers(stripped, readClaimIds(), pageRel);
  if (!blockers.some((blocker) => blocker.includes("deployment_paragraph_without_claim"))) {
    throw new Error(`expected deployment_paragraph_without_claim, got ${JSON.stringify(blockers)}`);
  }
});

it("counterweight: every <text> label in wide and narrow k12-data-flow.svg is in the P1 node set", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel]) {
    expect(subsetBlockers(svgTexts(readText(relativePath)), DATA_FLOW_NODES, relativePath)).toEqual([]);
  }
});

it("counterweight converse: every P1 node appears as a <text> label in wide and narrow k12-data-flow.svg", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel]) {
    expect(missingBlockers(svgTexts(readText(relativePath)), DATA_FLOW_NODES, relativePath)).toEqual([]);
  }
});

it("negative: a fixture data-flow SVG adding a MongoDB node fails the closed-list check", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel]) {
    const fixture = `${readText(relativePath)}<text>MongoDB</text>`;
    const blockers = subsetBlockers(svgTexts(fixture), DATA_FLOW_NODES, relativePath);
    if (!blockers.some((blocker) => blocker === `${relativePath}:label_not_in_closed_list:MongoDB`)) {
      throw new Error(`expected label_not_in_closed_list:MongoDB, got ${JSON.stringify(blockers)}`);
    }
  }
});

it("known-good: no K12 SVG names a mongo dependency", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel, reviewRel, reviewNarrowRel]) {
    expect(/mongo/i.test(readText(relativePath)), `${relativePath}:names_mongo`).toBe(false);
  }
});

it("known-good: every review box ident (joined across wrapped lines) is in the P3 identifier set, wide and narrow", () => {
  for (const relativePath of [reviewRel, reviewNarrowRel]) {
    const idents = svgBoxes(readText(relativePath)).map(identBlock);
    expect(subsetBlockers(idents, REVIEW_IDENTS, relativePath)).toEqual([]);
    expect(missingBlockers(idents, REVIEW_IDENTS, relativePath)).toEqual([]);
  }
});

it("known-good: review primaries (joined across wrapped lines) are plain language from the closed primary set, never identifiers", () => {
  for (const relativePath of [reviewRel, reviewNarrowRel]) {
    const primaries = svgBoxes(readText(relativePath)).map(primaryBlock);
    expect(subsetBlockers(primaries, REVIEW_PRIMARIES, relativePath)).toEqual([]);
    expect(missingBlockers(primaries, REVIEW_PRIMARIES, relativePath)).toEqual([]);
    for (const primary of primaries) {
      expect(/[a-z]+_[a-z]+/.test(primary), `${relativePath}:primary_is_snake_case:${primary}`).toBe(false);
      expect(/[a-z][A-Z]/.test(primary), `${relativePath}:primary_is_camel_case:${primary}`).toBe(false);
    }
  }
});

it("known-good: data-flow edges equal the closed EDGE list in both directions, wide and narrow", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel]) {
    expect(edgeBlockers(svgEdges(readText(relativePath)), DATA_FLOW_EDGES, relativePath)).toEqual([]);
  }
});

it("negative: a fixture data-flow SVG with one cited edge deleted and one uncited edge added fails the edge check", () => {
  const svg = readText(dataFlowNarrowRel);
  const deleted = svg.replace(/<(?:path|line)\b[^>]*\bdata-edge="sync server>note files"[^>]*>/, "");
  if (deleted === svg) {
    throw new Error("fixture rewrite did not delete the sync server>note files edge");
  }
  const added = `${deleted}<line x1="0" y1="0" x2="1" y2="1" data-edge="sync server>LAN host" data-direction="one-way"/>`;
  const blockers = edgeBlockers(svgEdges(added), DATA_FLOW_EDGES, dataFlowNarrowRel);
  if (!blockers.some((blocker) => blocker.includes("closed_list_edge_missing:sync server>note files:one-way"))) {
    throw new Error(`expected closed_list_edge_missing for note files, got ${JSON.stringify(blockers)}`);
  }
  if (!blockers.some((blocker) => blocker.includes("edge_not_in_closed_list:sync server>LAN host:one-way"))) {
    throw new Error(`expected edge_not_in_closed_list for LAN host, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: narrow K12 SVGs meet the legibility minimums at 390 px (263 px content width)", () => {
  for (const relativePath of [dataFlowNarrowRel, reviewNarrowRel]) {
    const svg = readText(relativePath);
    const width = svgViewBoxWidth(svg);
    const runs = svgTextRuns(svg);
    const primaryMin = Math.min(...runs.filter((run) => !run.ident).map((run) => run.fontSize));
    const identRuns = runs.filter((run) => run.ident);
    const identMin = identRuns.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.min(...identRuns.map((run) => run.fontSize));
    expect(primaryMin * (263 / width) >= 12, `${relativePath}:primary_min_too_small`).toBe(true);
    if (identRuns.length > 0) {
      expect(identMin * (263 / width) >= 10, `${relativePath}:ident_min_too_small`).toBe(true);
    }
  }
});

it("known-good: review edges equal the closed REVIEW list with on-border geometry, wide and narrow (G12)", () => {
  for (const relativePath of [reviewRel, reviewNarrowRel]) {
    expect(reviewGeometryBlockers(readText(relativePath), relativePath)).toEqual([]);
  }
});

it("counterweight: unconnected boxes are never stacked, and the r2 narrow layout fixture fails (G13)", () => {
  for (const relativePath of [reviewRel, reviewNarrowRel]) {
    expect(stackedWithoutEdgeBlockers(readText(relativePath), relativePath)).toEqual([]);
  }
  const fixtureGeometry = reviewGeometryBlockers(R2_NARROW_REVIEW_SVG, "r2-narrow-fixture");
  const fixtureStacked = stackedWithoutEdgeBlockers(R2_NARROW_REVIEW_SVG, "r2-narrow-fixture");
  if (fixtureGeometry.length === 0 && fixtureStacked.length === 0) {
    throw new Error("expected the r2 narrow layout fixture to fail G12 or G13");
  }
});

it("known-good: narrow review keeps the branching topology (G14)", () => {
  const boxes = svgBoxes(readText(reviewNarrowRel));
  const approved = boxByIdent(boxes, "approved_for_local_runtime");
  const fixture = boxByIdent(boxes, "fixture_approved_for_local_runtime");
  const yOverlap = Math.max(approved.y, fixture.y) < Math.min(approved.y + approved.h, fixture.y + fixture.h);
  expect(yOverlap, "approvals_share_y_band").toBe(true);
  const xOverlap = Math.max(approved.x, fixture.x) < Math.min(approved.x + approved.w, fixture.x + fixture.w);
  expect(xOverlap, "approvals_overlap_in_x").toBe(false);
  const reviewed = boxByIdent(boxes, "reviewed");
  const blocked = boxByIdent(boxes, "blocked");
  const reviewedCenter = reviewed.x + reviewed.w / 2;
  const blockedCenter = blocked.x + blocked.w / 2;
  expect(Math.abs(blockedCenter - reviewedCenter) >= 40, "blocked_not_offset").toBe(true);
});

it("known-good: no textLength or lengthAdjust in any K12 SVG, narrow review idents at 14 or above (G15)", () => {
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel, reviewRel, reviewNarrowRel]) {
    expect(/textLength|lengthAdjust/.test(readText(relativePath)), `${relativePath}:has_text_length`).toBe(false);
  }
  for (const run of svgTextRuns(readText(reviewNarrowRel)).filter((candidate) => candidate.ident)) {
    expect(run.fontSize >= 14, `narrow_ident_too_small:${run.text}`).toBe(true);
  }
});

it("known-good: all 4 K12 SVGs parse as XML with viewBox, title, desc, no image or script, within ceiling", () => {
  const ceiling = k12CeilingBytes();
  for (const relativePath of [dataFlowRel, dataFlowNarrowRel, reviewRel, reviewNarrowRel]) {
    const svg = readText(relativePath);
    expect(wellFormedXml(svg), `${relativePath}:not_well_formed_xml`).toBe(true);
    expect(/<svg\b((?:"[^"]*"|'[^']*'|[^<>"'])*)\bviewBox\s*=\s*"[^"]+"/i.test(svg), `${relativePath}:viewBox_missing`).toBe(true);
    expect(/<title>[\s\S]*?<\/title>/i.test(svg), `${relativePath}:title_missing`).toBe(true);
    expect(/<desc>[\s\S]*?<\/desc>/i.test(svg), `${relativePath}:desc_missing`).toBe(true);
    expect(/<image[\s>]/i.test(svg), `${relativePath}:has_image`).toBe(false);
    expect(/<script[\s>]/i.test(svg), `${relativePath}:has_script`).toBe(false);
    const size = statSync(path.join(process.cwd(), relativePath)).size;
    expect(size <= ceiling, `${relativePath}:over_ceiling:${size}:${ceiling}`).toBe(true);
  }
});

it("known-good: #deployment serves wide and narrow media.json K12 files through picture sources, no capture-pending K12 figure", () => {
  const html = readText(pageRel);
  for (const file of k12Files()) {
    if (!html.includes(`src="${file}"`) && !html.includes(`srcset="${file}"`)) {
      throw new Error(`#deployment does not reference K12 file ${file}`);
    }
    readText(`docs/${file}`);
  }
  const narrowSources = [...html.matchAll(/<source\b[^>]*>/gi)];
  for (const file of k12Files().filter((candidate) => candidate.includes("-narrow"))) {
    if (!narrowSources.some((source) => (source[0] ?? "").includes(`srcset="${file}"`) && (source[0] ?? "").includes("(max-width: 600px)"))) {
      throw new Error(`no (max-width: 600px) picture source for ${file}`);
    }
  }
  const pendingK12 = /<figure\b[^>]*\bclass="[^"]*\bcapture-pending\b[^"]*"[^>]*\bdata-slot="K12"/i.test(html)
    || /<figure\b[^>]*\bdata-slot="K12"[^>]*\bclass="[^"]*\bcapture-pending\b[^"]*"/i.test(html);
  expect(pendingK12, "capture-pending K12 figure still present").toBe(false);
});
