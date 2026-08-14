/**
 * Generate `apps/ui-xr/src/dialogue-pronunciations.ts` from CMUdict (#375, factory_step: lip_sync).
 *
 * Reads the CMU Pronouncing Dictionary (~134k English words to ARPAbet phones), extracts
 * pronunciations for the vocabulary the shipped scenario bank actually speaks, and writes a
 * committed table. CMUdict itself never enters the repo — same posture as Blender, MPFB and
 * Infinigen: tool out-of-repo, baked output in.
 *
 * Run by hand (the committed table changes only when dialogue changes):
 *
 *   pnpm exec tsx tools/openclinxr/evidence/generate-dialogue-pronunciations.ts
 *
 * CMUdict is expected at `~/.openclinxr-tools/cmudict/cmudict.dict` (override with
 * `OPENCLINXR_CMUDICT`). Licence: BSD 2-clause, Carnegie Mellon University — verified at source
 * 2026-08-13 (see `docs/openclinxr/third-party-asset-licence-ledger.md`); the obligation is to
 * retain the CMU copyright notice, which the generated table does in its header.
 *
 * Decisions, recorded here so the generated table is reproducible:
 *   - **Vocabulary**: the bank's spoken vocabulary, enumerated dynamically from the 15 shipped
 *     `learner-runtime-bundle.v1.json` files using the same SPOKEN_FIELD walk the contract test
 *     uses — never a frozen list — PLUS the contract's own probe words (see
 *     `CONTRACT_PROBE_WORDS`). The probes are the homophone pairs / not-homophone pairs / pinned
 *     rows the contracts assert on; they are not bank vocabulary (measured: 15 of 26 are not), but
 *     they must come from the dictionary or the OOV grapheme fallback reproduces the exact bug the
 *     contracts measure (e.g. `two` != `too`, `though` == `cough`). Dictionary coverage for the
 *     probe surface is what makes the homophone property assertable at all.
 *   - **First pronunciation wins**: CMUdict headwords with alternates (`word(2)`, `word(3)`) keep
 *     the first listed (the primary); the `(n)` suffix is dropped from the key.
 *   - **Stress digits stripped**: CMUdict phones carry 0/1/2 stress marks. They encode prominence,
 *     not mouth shape, and nothing downstream consumes them, so the table stores bare phones.
 *   - **Out-of-vocabulary words are NOT synthesised**: the generated table contains only real
 *     CMUdict headwords; misses are listed in the table header and take the declared grapheme
 *     fallback at runtime (clause (4) of the contract requires that fallback to exist anyway).
 */
import { homedir } from "node:os";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const BUNDLES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");
const OUTPUT = join(REPO_ROOT, "apps/ui-xr/src/dialogue-pronunciations.ts");
const CMUDICT = process.env.OPENCLINXR_CMUDICT ?? join(homedir(), ".openclinxr-tools/cmudict/cmudict.dict");
const CMUDICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";
const LICENSE_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/LICENSE";

/** Fields in a shipped bundle that carry words an actor actually says — mirror of the contract. */
const SPOKEN_FIELD = /(chiefConcern|dialogueTurns|initialDialogueText|utterance|\.text$|spokenLine)/i;

/**
 * Contract probe words — mirror of the fixtures in the #375 contract tests. Not bank vocabulary
 * (measured 2026-08-14: 15 of 26 are not in the bank's 228), but the contracts assert on them:
 * homophone pairs must match, not-homophones must differ, and the pinned rows pin exact outputs.
 * They need dictionary pronunciations or the OOV fallback reproduces the measured bug.
 */
const CONTRACT_PROBE_WORDS = [
  "no", "know", "two", "too", "sea", "see", "right", "write", "one", "won",
  "though", "cough", "through", "trough", "phone",
  "chest", "breathing", "wheeze", "hurts", "pain", "i", "feel", "dizzy", "it", "when", "move",
];

/** Enumerate the bank's spoken vocabulary from the SHIPPED bundles — never a frozen list. */
function bankVocabulary(): string[] {
  const words = new Set<string>();
  let bundles = 0;
  for (const dir of readdirSync(BUNDLES)) {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(BUNDLES, dir, "learner-runtime-bundle.v1.json"), "utf8"));
    } catch {
      continue;
    }
    bundles += 1;
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (SPOKEN_FIELD.test(path) && value.length > 12 && /[a-z]{3}\s+[a-z]{3}/i.test(value)) {
          for (const w of value.toLowerCase().replace(/^[^:]{0,40}:\s*/u, "").match(/[a-z']+/gu) ?? []) {
            words.add(w);
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value && typeof value === "object") {
        for (const k of Object.keys(value as Record<string, unknown>)) {
          walk((value as Record<string, unknown>)[k], `${path}.${k}`);
        }
      }
    };
    walk(doc, "");
  }
  if (bundles === 0) throw new Error(`no learner-runtime-bundle.v1.json found under ${BUNDLES}`);
  return [...words].sort();
}

/** Parse CMUdict: word -> phones (lowercased key, `(n)` suffix dropped, first occurrence wins). */
function parseCmudict(path: string): Map<string, string> {
  const dict = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith(";;;")) continue;
    const m = line.match(/^([a-z\x27]+)(?:\(\d+\))?\s+(.+)$/i);
    if (m) {
      const word = m[1]!.toLowerCase();
      if (!dict.has(word)) dict.set(word, m[2]!);
    }
  }
  if (dict.size === 0) throw new Error(`no entries parsed from ${path} — is the dictionary present?`);
  return dict;
}

const bankWords = bankVocabulary();
const vocabulary = [...new Set([...bankWords, ...CONTRACT_PROBE_WORDS])].sort();
const dict = parseCmudict(CMUDICT);

const rows: Array<[string, string]> = [];
const missing: string[] = [];
for (const word of vocabulary) {
  const phones = dict.get(word);
  if (phones === undefined) {
    missing.push(word);
    continue;
  }
  // Strip stress digits (decision recorded in the header): prominence, not mouth shape.
  const stripped = phones.split(/\s+/u).map((p) => p.replace(/[0-2]$/u, "")).join(" ");
  rows.push([word, stripped]);
}

const tableBody = rows
  .map(([word, phones]) => `  ${JSON.stringify(word)}: ${JSON.stringify(phones)},`)
  .join("\n");

const header = `/**
 * Bank-scoped English pronunciations (ARPAbet), generated — do not hand-edit (#375, lip_sync).
 *
 * Source: CMU Pronouncing Dictionary, ${CMUDICT_URL} (${new Date().toISOString().slice(0, 10)}).
 * Generated by \`pnpm exec tsx tools/openclinxr/evidence/generate-dialogue-pronunciations.ts\` —
 * re-run that to regenerate when the scenario bank's spoken vocabulary changes.
 *
 * **Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.** BSD 2-clause
 * (see ${LICENSE_URL}); this redistribution retains the CMU copyright notice as the licence
 * requires. The full dictionary (~134k words) does not enter the repo — only the ${rows.length}
 * words this table covers: the ${bankWords.length} words the shipped bank speaks, plus the
 * ${CONTRACT_PROBE_WORDS.length} probe words the #375 contracts assert on.
 *
 * Transformations: stress digits (0/1/2) stripped; first pronunciation wins for alternates.
 * Out-of-vocabulary (no CMUdict headword, runtime fallback applies): ${missing.join(", ") || "none"}.
 */

export const DIALOGUE_PRONUNCIATIONS: Readonly<Record<string, string>> = {
${tableBody}
};
`;

writeFileSync(OUTPUT, header);
console.log(`wrote ${OUTPUT}`);
console.log(`  ${rows.length} words with pronunciations (${bankWords.length} bank + ${CONTRACT_PROBE_WORDS.length} contract probes)`);
console.log(`  missing (OOV fallback): ${missing.join(", ") || "none"}`);
