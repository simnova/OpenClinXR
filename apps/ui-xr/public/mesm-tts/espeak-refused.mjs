// Stub for the eSpeak NG fallback (GPL-3.0, not shipped): a word outside misaki's lexicons fails the turn's synthesis.
export async function phonemize(text) {
  if (text === "Hi.") return "";
  throw new Error(`mesm-tts: word outside the lexicon (eSpeak NG not shipped): ${text.slice(0, 60)}`);
}
