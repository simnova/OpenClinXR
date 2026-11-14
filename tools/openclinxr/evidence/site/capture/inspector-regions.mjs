/**
 * Inspector regions instrument (card W4a-0): pure helpers, no browser, no fs.
 *
 * validateRegions checks one inspector doc (canvasRect, viewport, regions)
 * against the blueprint actor ids and returns blocker ids. blueprintActorLines
 * maps every actorId occurrence in the ed-chest-pain-mod.ts source text to
 * its 1-based line numbers.
 */

export const PATIENT_ACTOR_ID = "patient_robert_hayes_v1";

export const MIN_PATIENT_HEIGHT_FRACTION = 0.1;

/**
 * Silhouette-vs-bbox ratios (card W4a-1a): width, height, and area of the
 * mask rect relative to the projectActorBbox region. Returns null when the
 * mask is missing or the bbox has no positive area.
 */
export function ratiosOf(bbox, maskRect) {
  const bw = Number(bbox?.width);
  const bh = Number(bbox?.height);
  const mw = Number(maskRect?.width);
  const mh = Number(maskRect?.height);
  if (
    Number.isFinite(bw) === false ||
    Number.isFinite(bh) === false ||
    bw <= 0 ||
    bh <= 0 ||
    Number.isFinite(mw) === false ||
    Number.isFinite(mh) === false
  ) {
    return null;
  }
  return {
    width: mw / bw,
    height: mh / bh,
    area: (mw * mh) / (bw * bh),
  };
}

export function validateRegions(doc, blueprintActorIds) {
  const blockers = [];
  const canvas = doc?.canvasRect ?? null;
  const viewport = doc?.viewport ?? null;
  const regions = Array.isArray(doc?.regions) ? doc.regions : [];
  const known = new Set(Array.isArray(blueprintActorIds) ? blueprintActorIds : []);

  for (const region of regions) {
    const actorId = region?.actorId;
    const bbox = region?.bbox ?? null;
    const width = Number(bbox?.width);
    const height = Number(bbox?.height);
    if (typeof actorId !== "string" || known.has(actorId) === false) {
      blockers.push(`region_actor_unknown:${String(actorId)}`);
    }
    if (bbox === null || Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0) {
      blockers.push(`region_bbox_zero_area:${String(actorId)}`);
      continue;
    }
    if (canvas !== null && Number.isFinite(canvas.x) && Number.isFinite(canvas.y) && Number.isFinite(canvas.width) && Number.isFinite(canvas.height)) {
      const inside =
        bbox.x >= canvas.x &&
        bbox.y >= canvas.y &&
        bbox.x + bbox.width <= canvas.x + canvas.width &&
        bbox.y + bbox.height <= canvas.y + canvas.height;
      if (inside === false) {
        blockers.push(`region_bbox_outside_canvas:${String(actorId)}`);
      }
    }
  }

  const patient = regions.find((region) => region?.actorId === PATIENT_ACTOR_ID) ?? null;
  if (patient === null) {
    blockers.push("region_patient_missing");
  } else {
    const viewportHeight = Number(viewport?.height);
    const patientHeight = Number(patient?.bbox?.height);
    if (Number.isFinite(viewportHeight) === false || viewportHeight <= 0 || Number.isFinite(patientHeight) === false || patientHeight / viewportHeight < MIN_PATIENT_HEIGHT_FRACTION) {
      blockers.push("region_patient_too_small");
    }
  }

  return blockers;
}

const ACTOR_ID_PATTERN = /actorId:\s*"([^"]+)"/g;

function indentOf(line) {
  const match = /^(\s*)/.exec(line ?? "");
  return match === null ? 0 : match[1].length;
}

function countChar(text, char) {
  let count = 0;
  for (const current of text) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}

/**
 * Mask string literals, template literals and comments (card W4a-1b round 3):
 * every character inside '...', "...", `...`, // ... and /* ... *\/ is
 * replaced with a space (newlines preserved, so line numbers are stable)
 * before brace-depth counting, so "{" and "}" in prose never move the
 * scan. Escaped quotes (\\" \\' \\`) never end a literal. Template
 * ${...} contents are treated as code (stated choice): they are real
 * balanced expressions, so they cannot falsely close an outer depth.
 */
export function maskLiterals(sourceText) {
  return scanLiterals(sourceText).masked;
}

const HIDDEN_FACT_PLACEHOLDER = "hidden fact, elicited in the encounter";

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * Redact hidden case facts (card W4a-1b round 7): inside any hiddenFacts: [...]
 * or hiddenFactCanaries: [...] array literal within a block, replace each
 * string literal's contents (quotes kept) with one fixed placeholder.
 * Line count and line numbers are unchanged; only those literals change.
 * Arrays are found on the lexer's masked text (strings/comments are spaces
 * there, so only real code matches) — no second scanner, no regex over raw
 * text. Each block gains redactions: [{ line, field }]; line and field only,
 * never the original text.
 */
export function redactHiddenFacts(blocks) {
  const out = new Map();
  for (const [actorId, list] of blocks) {
    out.set(actorId, (Array.isArray(list) ? list : []).map((block) => redactBlock(block)));
  }
  return out;
}

function redactBlock(block) {
  const text = String(block?.text ?? "");
  const base = (block?.startLine ?? 1) - 1;
  const { masked, strings } = scanLiterals(text);
  const edits = [];
  const redactions = [];
  const arrayPattern = /\b(hiddenFacts|hiddenFactCanaries)\b[ \t\r\n]*:[ \t\r\n]*\[/g;
  let found = arrayPattern.exec(masked);
  while (found !== null) {
    const field = found[1];
    let depth = 1;
    let close = -1;
    for (let j = found.index + found[0].length; j < masked.length; j += 1) {
      if (masked[j] === "[") {
        depth += 1;
      } else if (masked[j] === "]") {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close >= 0) {
      const open = found.index + found[0].length - 1;
      for (const token of strings) {
        if (token.start >= open && token.end <= close + 1) {
          edits.push({ start: token.start + 1, end: token.end - 1 });
          redactions.push({ line: base + lineOf(text, token.start), field });
        }
      }
    }
    found = arrayPattern.exec(masked);
  }
  edits.sort((a, b) => b.start - a.start);
  let redacted = text;
  for (const edit of edits) {
    redacted = redacted.slice(0, edit.start) + HIDDEN_FACT_PLACEHOLDER + redacted.slice(edit.end);
  }
  return { ...block, text: redacted, redactions };
}

const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";"]);

function prevNonSpaceChar(text, index) {
  let j = index - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
    j -= 1;
  }
  return j < 0 ? "" : text[j];
}

/** Masked output for a backslash escape: newline-preserving, length-preserving. */
function maskedPair(text, i) {
  if (i + 1 >= text.length) {
    return { out: " ", next: i + 1 };
  }
  return { out: text[i + 1] === "\n" ? " \n" : "  ", next: i + 2 };
}

function scanLiterals(sourceText) {
  const text = String(sourceText);
  const regexLines = [];
  const openStack = [];
  const strings = [];
  let out = "";
  const state = ["code"];
  const exprDepth = [];
  const top = () => state[state.length - 1];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    const st = top();
    if (st === "code" || st === "expr") {
      if (c === "/" && next === "/") {
        out += "  ";
        state.push("line");
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        out += "  ";
        state.push("block");
        i += 2;
        continue;
      }
      if (c === "'") {
        out += " ";
        state.push("sq");
        openStack.push(i);
        i += 1;
        continue;
      }
      if (c === '"') {
        out += " ";
        state.push("dq");
        openStack.push(i);
        i += 1;
        continue;
      }
      if (c === "`") {
        out += " ";
        state.push("tpl");
        openStack.push(i);
        i += 1;
        continue;
      }
      if (c === "/") {
        const prev = prevNonSpaceChar(text, i);
        if (prev === "" || REGEX_PRECEDERS.has(prev)) {
          regexLines.push(text.slice(0, i).split("\n").length);
          out += " ";
          state.push("rx");
          i += 1;
          continue;
        }
      }
      if (st === "expr") {
        if (c === "{") {
          exprDepth[exprDepth.length - 1] += 1;
          out += c;
          i += 1;
          continue;
        }
        if (c === "}") {
          exprDepth[exprDepth.length - 1] -= 1;
          if (exprDepth[exprDepth.length - 1] === 0) {
            exprDepth.pop();
            state.pop();
            out += " ";
            i += 1;
            continue;
          }
          out += c;
          i += 1;
          continue;
        }
      }
      out += c;
      i += 1;
      continue;
    }
    if (st === "line") {
      if (c === "\n") {
        state.pop();
        out += "\n";
      } else {
        out += " ";
      }
      i += 1;
      continue;
    }
    if (st === "block") {
      if (c === "*" && next === "/") {
        state.pop();
        out += "  ";
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (st === "sq" || st === "dq") {
      const quote = st === "sq" ? "'" : '"';
      if (c === "\\") {
        const pair = maskedPair(text, i);
        out += pair.out;
        i = pair.next;
        continue;
      }
      if (c === quote) {
        state.pop();
        strings.push({ start: openStack.pop() ?? -1, end: i + 1 });
        out += " ";
        i += 1;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (st === "tpl") {
      if (c === "\\") {
        const pair = maskedPair(text, i);
        out += pair.out;
        i = pair.next;
        continue;
      }
      if (c === "`") {
        state.pop();
        strings.push({ start: openStack.pop() ?? -1, end: i + 1 });
        out += " ";
        i += 1;
        continue;
      }
      if (c === "$" && next === "{") {
        out += "  ";
        state.push("expr");
        exprDepth.push(1);
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (st === "rx") {
      if (c === "\\") {
        const pair = maskedPair(text, i);
        out += pair.out;
        i = pair.next;
        continue;
      }
      if (c === "[") {
        out += " ";
        state.push("rxclass");
        i += 1;
        continue;
      }
      if (c === "/") {
        state.pop();
        out += " ";
        i += 1;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (st === "rxclass") {
      if (c === "\\") {
        const pair = maskedPair(text, i);
        out += pair.out;
        i = pair.next;
        continue;
      }
      if (c === "]") {
        state.pop();
        out += " ";
        i += 1;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return { masked: out, regexLines, strings };
}

/**
 * Enclosing object literal for one 1-based actorId line: startLine is the
 * nearest line above whose trimmed text is "{" at indent (actorId indent - 2);
 * endLine is the matching "}," or "}" at that indent found by brace depth
 * over the literal-masked lines (Z1: braces in strings/comments ignored),
 * not the first "}". Returns null when no enclosing literal is found.
 */
function enclosingBlock(sourceLines, maskedLines, lineNumber) {
  const index = lineNumber - 1;
  const anchor = sourceLines[index] ?? "";
  const wantIndent = indentOf(anchor) - 2;
  let start = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if ((maskedLines[i] ?? "").trim() === "{" && indentOf(maskedLines[i]) === wantIndent) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < maskedLines.length; i += 1) {
    const text = maskedLines[i] ?? "";
    depth += countChar(text, "{") - countChar(text, "}");
    if (depth < 0) {
      return null;
    }
    if (depth === 0) {
      const trimmed = text.trim();
      if (trimmed === "}," || trimmed === "}") {
        return { startLine: start + 1, endLine: i + 1 };
      }
      return null;
    }
  }
  return null;
}

/**
 * Blueprint text that drives each actor (card W4a-1b, cap27 one-source rule):
 * for every line from blueprintActorLines, the enclosing object literal.
 * Returns Map actorId -> blocks[] { fixturePath, startLine, endLine, text }
 * with text verbatim (source lines startLine..endLine joined with "\n").
 */
export function blueprintActorBlocks(sourceText, fixturePath) {
  const lines = String(sourceText).split("\n");
  const masked = maskLiterals(sourceText).split("\n");
  const byLine = blueprintActorLines(sourceText);
  const blocksByActor = new Map();
  for (const [actorId, numbers] of byLine) {
    const blocks = [];
    const seen = new Set();
    for (const lineNumber of numbers) {
      const range = enclosingBlock(lines, masked, lineNumber);
      if (range === null) {
        continue;
      }
      const key = `${range.startLine}-${range.endLine}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blocks.push({
        fixturePath,
        startLine: range.startLine,
        endLine: range.endLine,
        text: lines.slice(range.startLine - 1, range.endLine).join("\n"),
      });
    }
    blocksByActor.set(actorId, blocks);
  }
  return blocksByActor;
}

/**
 * Named blockers for regex literals in blueprint source (card W4a-1b round 6):
 * the masker has no regex lexer of its own shape to count, so an unreported
 * regex would silently drop the actor block. Fail closed with "regex literal
 * in blueprint source at line N" instead.
 */
export function blueprintBlockers(sourceText) {
  return scanLiterals(String(sourceText)).regexLines.map(
    (line) => `regex literal in blueprint source at line ${line}`,
  );
}

/**
 * RED unless every block text equals the fixture slice startLine..endLine
 * and the slice is the enclosing literal (opens with "{" alone, closes with
 * "}," or "}" alone). Returns blocker strings, [] when every slice matches.
 */
export function blockSliceBlockers(blocks, sourceText) {
  const blockers = [];
  const lines = String(sourceText).split("\n");
  const list = Array.isArray(blocks) ? blocks : [...(blocks?.values() ?? [])].flat();
  for (const block of list) {
    const key = `${block?.startLine ?? "?"}-${block?.endLine ?? "?"}`;
    const slice = lines.slice((block?.startLine ?? 0) - 1, block?.endLine ?? 0);
    const first = (slice[0] ?? "").trim();
    const last = (slice[slice.length - 1] ?? "").trim();
    const literal = slice.length > 0 && first === "{" && (last === "}," || last === "}");
    if (literal === false || block?.text !== slice.join("\n")) {
      blockers.push(`block_slice_mismatch:${key}`);
    }
  }
  return blockers;
}

export function blueprintActorLines(sourceText) {
  const linesByActor = new Map();
  const lines = String(sourceText).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    ACTOR_ID_PATTERN.lastIndex = 0;
    let match = ACTOR_ID_PATTERN.exec(text);
    while (match !== null) {
      const actorId = match[1];
      if (linesByActor.has(actorId) === false) {
        linesByActor.set(actorId, []);
      }
      linesByActor.get(actorId).push(index + 1);
      match = ACTOR_ID_PATTERN.exec(text);
    }
  }
  return linesByActor;
}
