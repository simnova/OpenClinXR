/**
 * HB-02 shared-image safety (v2 linear producer).
 * Pure JSON helper: no fs, no GLB parsing, no side effects on import.
 *
 * textureFailReason: fail-closed gate for texture/image pairs the PNG baker
 * cannot fold. Returns a reason string (bake must skip, factor retained) or
 * null (safe to bake). Never throws: missing texture/source image, external
 * uri images (no bufferView), non-PNG mimeTypes, and KHR_texture_basisu
 * compressed refs are all reported, not dereferenced.
 *
 * DELIBERATE NON-GOAL — orphan pruning: after clone-for-all-transformed, the
 * original (pristine) image/bufferView is intentionally RETAINED even when no
 * material references it anymore. A hand-rolled JSON pruner cannot prove it
 * sees every schema reference (metallicRoughnessTexture, KHR material slots,
 * sparse accessor indices/values, meshopt/draco/other extension views, and it
 * must remap accessors.bufferView or corrupt geometry). No deletion happens
 * here. A dedicated, schema-aware pruner stage may reclaim the retained bytes
 * later; until then output GLBs stay valid but carry the pristine originals.
 */
type JsonObj = Record<string, unknown>;

export function textureFailReason(tex: JsonObj | undefined, img: JsonObj | undefined): string | null {
  if (!tex) return "missing texture entry";
  if (!img) return "missing source image";
  if (typeof img["bufferView"] !== "number") return "external uri image without bufferView";
  const mime = img["mimeType"] as string | undefined;
  if (mime !== undefined && mime !== "image/png") return `unsupported mimeType ${String(mime)}`;
  const ext = tex["extensions"] as JsonObj | undefined;
  if (ext !== undefined && ext["KHR_texture_basisu"] !== undefined) return "KHR_texture_basisu compressed ref";
  return null;
}
