import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type MediaArtifactIntegrity = {
  exists: boolean;
  size?: number;
  pngDimensions?: {
    width: number;
    height: number;
  };
};

const pngSignature = "89504e470d0a1a0a";

export function inspectMediaArtifact(artifact: string | undefined): MediaArtifactIntegrity {
  if (!artifact || !existsSync(artifact)) {
    return { exists: false };
  }

  const size = statSync(artifact).size;
  return {
    exists: true,
    size,
    pngDimensions: readPngDimensions(artifact),
  };
}

export function isAllowedRelativeArtifactPath(artifact: string | undefined, allowedDirectory: string): boolean {
  if (!artifact || path.isAbsolute(artifact)) {
    return false;
  }

  const normalized = path.posix.normalize(artifact.replaceAll("\\", "/"));
  const normalizedAllowedDirectory = path.posix.normalize(allowedDirectory).replace(/\/?$/, "/");
  return normalized.startsWith(normalizedAllowedDirectory);
}

export function readPngDimensions(filePath: string): MediaArtifactIntegrity["pngDimensions"] {
  const bytes = readFileSync(filePath);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    return undefined;
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}
