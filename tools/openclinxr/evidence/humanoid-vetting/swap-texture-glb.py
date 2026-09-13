#!/usr/bin/env python3
"""
Swap a garment texture (e.g. tightjeans PNG → JPEG) in GLB files.

Reads the GLB JSON chunk to find the target image, replaces its
buffer data with the new texture, updates mimeType to match the new
format, and writes the modified GLB. Triangle counts, mesh data, and
all other textures are untouched.

This is a programmatic texture swap through the glTF spec — it replaces
exactly one buffer view's data and updates the bufferView.byteLength.
No mesh data, materials, or other images are modified.

Usage: python swap-texture-glb.py <input.glb> <new-texture.jpg> <output.glb>
"""
import json
import struct
import sys
from pathlib import Path

GLB_MAGIC = 0x46546C67  # "glTF"
JSON_CHUNK_TYPE = 0x4E4F534A
BIN_CHUNK_TYPE = 0x004E4942


def find_tightjeans_image(gltf: dict) -> int | None:
    """Find the image index for tightjeans in the GLB images array."""
    if "images" not in gltf:
        return None
    for i, img in enumerate(gltf["images"]):
        name = img.get("name", "")
        if "tightjeans" in name.lower() or "tight_jeans" in name.lower():
            return i
    return None


def _mime_for_texture(path: Path) -> str:
    """Detect MIME type from file extension or magic bytes."""
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    # Fall back to magic bytes
    header = path.read_bytes()[:8]
    if header[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if header[:4] == b"\x89PNG":
        return "image/png"
    raise ValueError(f"Cannot detect MIME type for {path}")


def swap_texture(input_glb: Path, new_tex: Path, output_glb: Path) -> None:
    data = input_glb.read_bytes()
    magic = struct.unpack_from("<I", data, 0)[0]
    if magic != GLB_MAGIC:
        raise ValueError(f"Not a GLB file: {input_glb}")

    # Parse GLB structure
    # Header: 12 bytes (magic, version, total_length)
    # Chunk 0 (JSON): 8-byte header (length, type) + JSON data
    # Chunk 1 (BIN): 8-byte header (length, type) + binary data
    total_len = struct.unpack_from("<I", data, 8)[0]
    chunk0_len = struct.unpack_from("<I", data, 12)[0]

    json_start = 20  # after 12-byte header + 8-byte chunk header
    json_data = data[json_start : json_start + chunk0_len]
    gltf = json.loads(json_data)

    # Find the tightjeans image
    img_idx = find_tightjeans_image(gltf)
    if img_idx is None:
        raise ValueError("Could not find tightjeans image in GLB")

    img = gltf["images"][img_idx]
    bv_idx = img.get("bufferView")
    if bv_idx is None:
        raise ValueError(f"Image {img_idx} has no bufferView")

    bv = gltf["bufferViews"][bv_idx]
    old_offset = bv.get("byteOffset", 0)
    old_length = bv["byteLength"]

    # Binary chunk starts after JSON chunk header (20) + JSON data (chunk0_len) + bin chunk header (8)
    bin_data_start = 20 + chunk0_len + 8

    # Texture location in the file
    tex_file_start = bin_data_start + old_offset
    tex_file_end = tex_file_start + old_length

    # Read new texture
    new_data = new_tex.read_bytes()
    new_length = len(new_data)

    print(f"Image {img_idx} ('{img.get('name', '?')}'):")
    print(f"  bufferView {bv_idx}: offset={old_offset}, length={old_length}")
    print(f"  new texture: {new_tex.name} ({new_length} bytes)")

    # Extract the binary chunk data (everything after the bin chunk header)
    bin_chunk_data = data[bin_data_start:]

    # Build new binary data: before the texture + new texture + after the texture
    new_bin_data = (
        bin_chunk_data[:old_offset]
        + new_data
        + bin_chunk_data[old_offset + old_length :]
    )

    # Pad binary data to 4-byte alignment
    bin_pad = (4 - len(new_bin_data) % 4) % 4
    new_bin_data += b"\x00" * bin_pad

    # Update the bufferView byteLength for the replaced image
    bv["byteLength"] = new_length

    # Update mimeType to match the new texture format (Defect 1 fix)
    new_mime = _mime_for_texture(new_tex)
    old_mime = img.get("mimeType", "?")
    if old_mime != new_mime:
        print(f"  mimeType: {old_mime} -> {new_mime}")
        img["mimeType"] = new_mime

    # Shift all bufferView byteOffsets that come AFTER the replaced texture
    # (the binary data after old_offset shifts by new_length - old_length)
    offset_delta = new_length - old_length
    for other_bv in gltf.get("bufferViews", []):
        other_offset = other_bv.get("byteOffset", 0)
        if other_offset > old_offset:
            other_bv["byteOffset"] = other_offset + offset_delta

    # Update the buffer byteLength (the only buffer)
    if "buffers" in gltf and gltf["buffers"]:
        gltf["buffers"][0]["byteLength"] = len(new_bin_data)

    # Re-encode JSON
    new_json = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    # Pad JSON to 4-byte alignment
    json_pad = (4 - len(new_json) % 4) % 4
    new_json += b"\x20" * json_pad

    # Rebuild GLB
    # Header: magic(4) + version(4) + total_length(4)
    # JSON chunk: chunk_length(4) + chunk_type(4) + json_data
    # BIN chunk: chunk_length(4) + chunk_type(4) + bin_data
    header = struct.pack("<III", GLB_MAGIC, 2, 0)  # version=2, total placeholder
    json_chunk_header = struct.pack("<II", len(new_json), JSON_CHUNK_TYPE)
    bin_chunk_header = struct.pack("<II", len(new_bin_data), BIN_CHUNK_TYPE)
    new_glb = header + json_chunk_header + new_json + bin_chunk_header + new_bin_data
    # Set total length (bytes 8-11)
    new_glb = new_glb[:8] + struct.pack("<I", len(new_glb)) + new_glb[12:]

    output_glb.parent.mkdir(parents=True, exist_ok=True)
    output_glb.write_bytes(new_glb)
    print(f"  wrote: {output_glb} ({len(new_glb)} bytes)")

    # Verify triangle count
    total_tris = 0
    if "meshes" in gltf:
        for mesh in gltf["meshes"]:
            for prim in mesh["primitives"]:
                if "indices" in prim:
                    acc = gltf["accessors"][prim["indices"]]
                    total_tris += acc["count"] // 3
    print(f"  triangles: {total_tris}")

    # Verify texture count
    n_images = len(gltf.get("images", []))
    print(f"  images: {n_images}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python swap-texture-glb.py <input.glb> <new-texture.jpg> <output.glb>")
        sys.exit(1)
    swap_texture(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
