/** Match actual opaque reference materials, not just chroma or a nonblack clear value. */
export function knownScenePixels(pixels: ArrayLike<number>, colors: readonly number[], tolerance = 12) {
  let matched = 0;
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    if ((pixels[at + 3] ?? 0) < 250) continue;
    for (const color of colors) {
      if (Math.abs((pixels[at] ?? 0) - ((color >> 16) & 255)) <= tolerance && Math.abs((pixels[at + 1] ?? 0) - ((color >> 8) & 255)) <= tolerance && Math.abs((pixels[at + 2] ?? 0) - (color & 255)) <= tolerance) { matched++; break; }
    }
  }
  return matched;
}
