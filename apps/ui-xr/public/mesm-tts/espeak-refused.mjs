// Stub for the eSpeak NG fallback (GPL-3.0, not shipped): a word outside misaki's lexicons fails the turn's synthesis.
// The message never carries the text being phonemised (it is the learner-facing caption).
export async function phonemize(text) {
  if (text === "Hi.") return "";
  throw new Error("mesm-tts: a word is outside the lexicon (eSpeak NG is not shipped)");
}
