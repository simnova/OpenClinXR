/** Montreal Forced Aligner cue source for the mouth-dynamics capture.
 *
 * MFA aligns the KNOWN dialog transcript against the clip wav, so phone
 * labels come from words, not from acoustic guesses. The phones tier of the
 * long_textgrid output maps onto the EXISTING mapArpabetTrack table
 * (ARPABET_TO_OVR in viseme-cue-track.ts); nothing in xr-dialogue changes.
 *
 * One label-driven closure rule applies at the MFA->ArpabetCue boundary:
 * a silence interval immediately PRECEDING a bilabial stop or nasal
 * (P/B/M) is the acoustic closure, during which the lips are shut by
 * definition, so it relabels to PP with unchanged bounds. The stop phone
 * itself already maps to PP via ARPABET_TO_OVR, yielding one continuous PP
 * span over closure+release. Silences before fricatives or vowels, and the
 * trailing silence, stay SIL. This replaces the Rhubarb-path RMS/ZCR
 * heuristics (bilabial closure correction + weak-frication carve) with no
 * acoustic thresholds: F/V labels arrive from the transcript directly.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type ArpabetCue = { startS: number; endS: number; phone: string };

export const MFA_ENV_PREFIX = path.join(process.env.HOME ?? "", ".openclinxr-tools/mfa");
export const MFA_MICROMAMBA = path.join(process.env.HOME ?? "", ".openclinxr-tools/bin/micromamba");
export const MFA_ACOUSTIC_MODEL = process.env.MFA_ACOUSTIC_MODEL ?? "english_us_arpa";
export const MFA_DICTIONARY = process.env.MFA_DICTIONARY ?? "english_us_arpa";

const BILABIAL_STOPS = new Set(["P", "B", "M"]);

function stressless(phone: string): string {
  return phone.trim().toUpperCase().replace(/[0-2]$/u, "");
}

/** Parse the phones tier of an MFA long_textgrid into ArpabetCues. Empty text -> SIL. */
export function parseMfaPhonesTier(textgrid: string): ArpabetCue[] {
  const tier = textgrid.split('name = "phones"')[1];
  if (tier === undefined) throw new Error("mfa-textgrid-missing-phones-tier");
  const cues: ArpabetCue[] = [];
  const pattern = /xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "(.*?)"/gu;
  for (const match of tier.matchAll(pattern)) {
    const startS = Number(match[1]);
    const endS = Number(match[2]);
    const phone = match[3] === "" ? "SIL" : (match[3] ?? "SIL");
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS) continue;
    cues.push({ startS, endS, phone });
  }
  if (cues.length === 0) throw new Error("mfa-textgrid-no-phone-intervals");
  return cues;
}

/**
 * Label-driven closure rule: SIL/SP immediately before P/B/M -> PP.
 * Bounds unchanged; adjacent PP cues (silence + stop phone) merge downstream
 * by time lookup. Pure relabel, no acoustic thresholds.
 */
export function applyMfaClosureRule(cues: readonly ArpabetCue[]): ArpabetCue[] {
  return cues.map((cue, index) => {
    const key = stressless(cue.phone);
    if ((key === "SIL" || key === "SP" || key === "SPN") && index + 1 < cues.length) {
      const next = stressless(cues[index + 1]?.phone ?? "");
      if (BILABIAL_STOPS.has(next)) return { ...cue, phone: "P" };
    }
    return { ...cue };
  });
}

/** Align one wav+transcript pair with the pinned MFA env. Returns raw TextGrid text. */
export function runMfaAlign(wavPath: string, transcript: string, basename = "clip"): string {
  const jobDir = mkdtempSync(path.join(tmpdir(), `mfa-align-${process.pid}-`));
  const corpusDir = path.join(jobDir, "corpus");
  const outDir = path.join(jobDir, "out");
  const wav = path.join(corpusDir, `${basename}.wav`);
  const lab = path.join(corpusDir, `${basename}.lab`);
  execFileSync("mkdir", ["-p", corpusDir, outDir]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wavPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  writeFileSync(lab, `${transcript.trim()}\n`);
  const dict = path.join(process.env.HOME ?? "", "Documents/MFA/pretrained_models/dictionary", `${MFA_DICTIONARY}.dict`);
  const acoustic = path.join(process.env.HOME ?? "", "Documents/MFA/pretrained_models/acoustic", `${MFA_ACOUSTIC_MODEL}.zip`);
  execFileSync(MFA_MICROMAMBA, ["run", "-p", MFA_ENV_PREFIX, "mfa", "align",
    corpusDir, dict, acoustic, outDir,
    "--output_format", "long_textgrid", "--clean", "--quiet"], {
    stdio: "pipe",
    env: { ...process.env, MAMBA_ROOT_PREFIX: MFA_ENV_PREFIX },
  });
  return readFileSync(path.join(outDir, `${basename}.TextGrid`), "utf8");
}

/** Full cue source: align -> parse -> closure rule. Deterministic for fixed inputs. */
export function mfaArpabetCues(wavPath: string, transcript: string, basename = "clip"): ArpabetCue[] {
  return applyMfaClosureRule(parseMfaPhonesTier(runMfaAlign(wavPath, transcript, basename)));
}
