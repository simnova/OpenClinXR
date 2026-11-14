#!/usr/bin/env node
/**
 * MN2 DOM caption extract (card WN2, re-scope C).
 *
 * Reads a capture-harness DOM log ([{ atMs, innerText }, ...]) and extracts
 * the learner-visible dialogue captions ("DisplayName: line") the client's
 * Mock Dialogue panel displayed, with first-seen sample/atMs and the
 * attribution flag.
 *
 * Attribution (owner probe, measured on run-15): the opening line is present
 * in sample 0 (doorway, before any turn) because the Mock Dialogue panel
 * pre-seeds it, so it cannot show that a turn was displayed
 * (attributable false). A caption absent from sample 0 but present in a
 * later sample was displayed by its turn (attributable true).
 *
 * Usage:
 *   node tools/openclinxr/evidence/site/capture/mn2-extract.mjs \
 *     --dom /Volumes/files/openclinxr-assets/store/site-reimagine/rr1/run-15/dom-text-log.json \
 *     --out tools/openclinxr/evidence/site/fixtures/mn2/mn2-dom-captions.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Dialogue speakers for the run-15 cast. The Mock Dialogue panel renders
// "<displayName>: <line>"; other "X: y" innerText lines (EHR headers,
// countdowns, rubric tallies) are harness UI, not dialogue.
const DIALOGUE_SPEAKERS = new Set(["Robert Hayes", "Anna Hayes", "Maria Alvarez"]);

/**
 * Extract dialogue captions from DOM-log samples.
 * Returns captions in first-seen order:
 * [{ speaker, text, firstSample, firstAtMs, attributable }].
 */
export function extractCaptions(samples) {
  const firstSeen = new Map();
  const inSampleZero = new Set();
  samples.forEach((sample, index) => {
    const text = typeof sample?.innerText === "string" ? sample.innerText : "";
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      const cut = line.indexOf(": ");
      if (cut < 0) continue;
      const speaker = line.slice(0, cut);
      const caption = line.slice(cut + 2).trim();
      if (!DIALOGUE_SPEAKERS.has(speaker) || caption === "") continue;
      const key = `${speaker}\0${caption}`;
      if (index === 0) inSampleZero.add(key);
      if (!firstSeen.has(key)) {
        firstSeen.set(key, {
          speaker,
          text: caption,
          firstSample: index,
          firstAtMs: typeof sample?.atMs === "number" ? sample.atMs : null,
        });
      }
    }
  });
  return [...firstSeen.entries()].map(([key, entry]) => ({
    ...entry,
    attributable: !inSampleZero.has(key) && entry.firstSample > 0,
  }));
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) {
    throw new Error(`mn2-extract: missing ${name} <path>`);
  }
  return argv[index + 1];
}

function runExtractCli() {
  const argv = process.argv.slice(2);
  const domPath = argValue(argv, "--dom");
  const outPath = argValue(argv, "--out");
  const bytes = readFileSync(domPath);
  const samples = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(samples)) {
    throw new Error("mn2-extract: DOM log must be an array of samples");
  }
  const doc = {
    sourcePath: domPath,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    derivationCommand: `tools/openclinxr/evidence/site/capture/mn2-extract.mjs --dom ${domPath} --out ${outPath}`,
    speakers: [...DIALOGUE_SPEAKERS],
    sampleCount: samples.length,
    captions: extractCaptions(samples),
  };
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  const attributable = doc.captions.filter((caption) => caption.attributable).length;
  console.log(`mn2-extract: ${doc.captions.length} captions (${attributable} attributable) from ${samples.length} samples -> ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runExtractCli();
}
