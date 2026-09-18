import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Served lip-sync cue JSON must not point at gitignored absolute wavs.
 *
 * MEASURED 2026-09-18: 16 of 16 `*.mouth-cues.json` under
 * `apps/ui-xr/public/lip-sync-cues` carried `metadata.soundFile` of the form
 * `/Volumes/…/.openclinxr/evidence/issue-288/…/stage-lip-sync/*.wav`. Zero wavs
 * are tracked under `public/`. `loadBakedMouthCuesForUtterance` fetches the JSON
 * only and ignores `soundFile`.
 *
 * claimScope: every tracked served cue file either omits `soundFile` or names a
 *   relative URL to a committed file in that public tree.
 * notEvidenceFor: audible TTS in the learner; viseme pixels; headset.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const CUES_ROOT = join(REPO_ROOT, "apps/ui-xr/public/lip-sync-cues");

function listMouthCueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listMouthCueFiles(full));
    else if (name.endsWith(".mouth-cues.json")) out.push(full);
  }
  return out;
}

describe("served lip-sync cues have no gitignored soundFile", () => {
  it("(1) every served cue JSON either omits soundFile or points at a tracked public relative file", () => {
    const files = listMouthCueFiles(CUES_ROOT);
    expect(files.length, `served *.mouth-cues.json under ${CUES_ROOT}`).toBeGreaterThanOrEqual(1);

    const offenders: string[] = [];
    for (const file of files) {
      const doc = JSON.parse(readFileSync(file, "utf8")) as {
        metadata?: { soundFile?: unknown };
      };
      const soundFile = doc.metadata?.soundFile;
      if (soundFile === undefined || soundFile === null) continue;
      if (typeof soundFile !== "string" || soundFile.length === 0) {
        offenders.push(`${relative(REPO_ROOT, file)}: soundFile is not a non-empty string`);
        continue;
      }
      const absolute =
        soundFile.startsWith("/") ||
        soundFile.includes(".openclinxr/evidence") ||
        /^[A-Za-z]:[\\/]/.test(soundFile);
      if (absolute) {
        offenders.push(`${relative(REPO_ROOT, file)}: absolute/gitignored soundFile ${soundFile}`);
        continue;
      }
      const resolved = pathResolve(dirname(file), soundFile);
      if (!resolved.startsWith(CUES_ROOT)) {
        offenders.push(`${relative(REPO_ROOT, file)}: soundFile escapes the public cue tree (${soundFile})`);
        continue;
      }
      if (!existsSync(resolved)) {
        offenders.push(`${relative(REPO_ROOT, file)}: relative soundFile ${soundFile} is not on disk`);
      }
    }
    expect(offenders, "served cues with absolute gitignored soundFile").toEqual([]);
  });
});
