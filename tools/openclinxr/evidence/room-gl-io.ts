import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

/**
 * Room GLBs carry KHR_texture_transform on their baked materials. The bare
 * NodeIO reader rejects those files with `Missing required extension,
 * "KHR_texture_transform"`, so every room-evidence read goes through here.
 */
export function roomNodeIO(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

/** Read one shipped room GLB with the extension-registered reader. */
export function readRoomGlb(path: string) {
  return roomNodeIO().read(path);
}
