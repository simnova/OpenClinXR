import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ClaimsFile = {
  schemaVersion?: string;
  segments?: { id: string; text: string; claims?: string[] }[];
  composites?: Record<string, string[]>;
  claims?: { id: string; text: string; [key: string]: unknown }[];
};

type PhraseFamily = {
  family: string;
  phrases: string[];
};

const phraseFamilies: PhraseFamily[] = [
  {
    family: "F1",
    phrases: ["automated scoring", "automatically scores", "scores the learner", "AI scoring", "AI-graded"],
  },
  {
    family: "F2",
    phrases: ["validated", "clinically valid", "proven valid", "evidence-based assessment"],
  },
  {
    family: "F3",
    phrases: ["exam-equivalent", "replaces Step 2 CS", "licensure exam", "high-stakes"],
  },
  {
    family: "F4",
    phrases: ["in the Quest 3 browser", "Quest-ready", "runs on Quest 3"],
  },
  {
    family: "F5",
    phrases: ["nothing leaves your network", "fully offline", "no cloud"],
  },
  {
    family: "F6",
    phrases: ["physical examination", "physical exam"],
  },
];

const negations = new Set(["not", "no", "never", "without", "nor"]);

const websitePages = [
  "docs/index.html",
  "docs/blueprints.html",
  "docs/reference-run.html",
  "docs/evidence.html",
  "docs/progress.html",
  "docs/engineering.html",
];

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((word) => word.length > 0);
}

function sentencesOf(scopeText: string): { text: string; start: number }[] {
  const found: { text: string; start: number }[] = [];
  const sentencePattern = /[^.!?;]+/g;
  let sentence: RegExpExecArray | null = sentencePattern.exec(scopeText);
  while (sentence !== null) {
    found.push({ text: sentence[0], start: sentence.index });
    sentence = sentencePattern.exec(scopeText);
  }
  return found;
}

function isNegated(scopeText: string, matchIndex: number): boolean {
  for (const sentence of sentencesOf(scopeText)) {
    const end = sentence.start + sentence.text.length;
    if (matchIndex >= sentence.start && matchIndex < end) {
      const before = sentence.text.slice(0, matchIndex - sentence.start);
      const words = tokenizeWords(before).slice(-3);
      return words.some((word) => negations.has(word));
    }
  }
  return false;
}

function phraseBlockers(scopeText: string, page: string): string[] {
  const blockers: string[] = [];
  const covered: { start: number; end: number }[] = [];
  const lowered = scopeText.toLowerCase();
  for (const { family, phrases } of phraseFamilies) {
    const longestFirst = [...phrases].sort((a, b) => b.length - a.length);
    for (const phrase of longestFirst) {
      const needle = phrase.toLowerCase();
      let from = 0;
      let found = false;
      while (true) {
        const index = lowered.indexOf(needle, from);
        if (index < 0) {
          break;
        }
        from = index + needle.length;
        if (covered.some((range) => index >= range.start && index + needle.length <= range.end)) {
          continue;
        }
        if (!isNegated(scopeText, index)) {
          found = true;
          covered.push({ start: index, end: index + needle.length });
          break;
        }
      }
      if (found) {
        blockers.push(`claims_phrase_affirmed:${page}:${family}:${phrase}`);
      }
    }
  }
  return blockers;
}

function getAttribute(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`);
  const match = pattern.exec(openTag);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].slice(1, -1);
}

function hasClass(openTag: string, token: string): boolean {
  const value = getAttribute(openTag, "class");
  if (value === undefined) {
    return false;
  }
  return value.split(/\s+/).includes(token);
}

export function checkClaimsHtml(html: string, claims: ClaimsFile, page: string): string[] {
  const blockers: string[] = [];
  const segments = new Map((claims.segments ?? []).map((segment) => [segment.id, segment.text]));
  const knownClaims = new Set((claims.claims ?? []).map((claim) => claim.id));

  const claimCopyScopes: string[] = [];
  const paragraphPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  for (const paragraph of html.match(paragraphPattern) ?? []) {
    const openTag = (/<p\b[^>]*>/i.exec(paragraph) ?? [])[0] ?? "";
    if (!hasClass(openTag, "claim-copy")) {
      continue;
    }
    const inner = paragraph.replace(/^<p\b[^>]*>/i, "").replace(/<\/p>\s*$/i, "");
    claimCopyScopes.push(textContent(inner));
    const dataClaim = getAttribute(openTag, "data-claim");
    if (dataClaim === undefined || dataClaim.trim() === "") {
      blockers.push(`claims_copy_without_claim:${page}`);
    } else {
      for (const claimId of dataClaim.split(/\s+/).filter((id) => id.length > 0)) {
        if (!knownClaims.has(claimId)) {
          blockers.push(`claims_unknown_claim:${page}:${claimId}`);
        }
      }
    }
  }

  const segmentScopes: string[] = [];
  // Walk opening tags, not whole <span>...</span> matches: a whole-span match that starts at an
  // enclosing <span data-composite> swallows the first segment, which then goes unchecked.
  const spanOpenPattern = /<span\b[^>]*>/gi;
  for (const open of html.matchAll(spanOpenPattern)) {
    const openTag = open[0];
    const segmentId = getAttribute(openTag, "data-segment");
    if (segmentId === undefined) {
      continue;
    }
    const innerStart = (open.index ?? 0) + openTag.length;
    const closeAt = html.toLowerCase().indexOf("</span>", innerStart);
    const inner = html.slice(innerStart, closeAt < 0 ? html.length : closeAt);
    const actual = textContent(inner);
    segmentScopes.push(actual);
    const expected = segments.get(segmentId);
    if (expected === undefined) {
      blockers.push(`claims_segment_unknown:${page}:${segmentId}`);
    } else if (normalize(actual) !== normalize(expected)) {
      blockers.push(`claims_segment_text_mismatch:${page}:${segmentId}`);
    }
  }

  const compositeScopes: string[] = [];
  const compositePattern = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bdata-composite\s*=\s*("[^"]*"|'[^']*')[^>]*>[\s\S]*?<\/\1>/gi;
  for (const element of html.match(compositePattern) ?? []) {
    const openTag = (/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/i.exec(element) ?? [])[0] ?? "";
    const compositeId = getAttribute(openTag, "data-composite");
    if (compositeId === undefined) {
      continue;
    }
    const inner = element
      .replace(/^<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/i, "")
      .replace(/<\/[a-zA-Z][a-zA-Z0-9]*\s*>$/i, "");
    compositeScopes.push(textContent(inner));
    const expected = claims.composites?.[compositeId];
    const actualIds: string[] = [];
    const childPattern = /data-segment\s*=\s*("[^"]*"|'[^']*')/gi;
    let child: RegExpExecArray | null = childPattern.exec(inner);
    while (child !== null) {
      actualIds.push((child[1] ?? "").slice(1, -1));
      child = childPattern.exec(inner);
    }
    const ordered =
      expected !== undefined &&
      expected.length === actualIds.length &&
      expected.every((id, index) => actualIds[index] === id);
    if (!ordered) {
      blockers.push(`claims_composite_order:${page}:${compositeId}`);
    }
  }

  for (const scope of [...claimCopyScopes, ...segmentScopes, ...compositeScopes]) {
    blockers.push(...phraseBlockers(scope, page));
  }
  return blockers;
}

export async function checkClaims(rootDir: string, pages: string[]): Promise<string[]> {
  const blockers: string[] = [];
  const claimsText = await readFile(path.join(rootDir, "docs", "site", "data", "claims.json"), "utf8");
  const claims = JSON.parse(claimsText) as ClaimsFile;
  for (const page of pages) {
    const html = await readFile(path.join(rootDir, page), "utf8").catch(() => undefined);
    if (html === undefined) {
      continue;
    }
    blockers.push(...checkClaimsHtml(html, claims, page));
  }
  return blockers;
}

async function main(): Promise<void> {
  const existing: string[] = [];
  for (const page of websitePages) {
    const html = await readFile(page, "utf8").catch(() => undefined);
    if (html !== undefined) {
      existing.push(page);
    }
  }
  const blockers = await checkClaims(process.cwd(), existing);
  if (blockers.length === 0) {
    console.log(`Validated claims markup on ${existing.length} pages (${existing.join(", ") || "none"}).`);
    return;
  }
  for (const blocker of blockers) {
    console.error(blocker);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
