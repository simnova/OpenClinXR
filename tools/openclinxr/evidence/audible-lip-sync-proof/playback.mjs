/** Owner-planted feature seam. Do not treat this named refusal as playback. */
export function createPlayback({ context, buffer, identity, destination }) {
  if (!context || !buffer || !identity || !destination) throw new Error("invalid-playback-input");
  const missing = () => { throw new Error("audible-playback-not-implemented"); };
  return { start: missing, pause: missing, resume: missing, stop: missing, position: missing, generation: identity.generation };
}
