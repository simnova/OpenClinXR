/** MFA reference cue dump for the viseme audio-clock bake-off. Arena-only. */
import { writeFileSync } from "node:fs";
import { mfaArpabetCues } from "../../../../../tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts";

const [wavPath, transcript, basename, outPath] = process.argv.slice(2);
if (!wavPath || !transcript || !basename || !outPath) {
  console.error("usage: mfa-cues.ts <wav> <transcript> <basename> <outJson>");
  process.exit(1);
}
const cues = mfaArpabetCues(wavPath, transcript, basename);
writeFileSync(outPath, JSON.stringify({ wavPath, transcript, basename, cues }, null, 2));
console.log(`wrote ${cues.length} cues to ${outPath}`);
