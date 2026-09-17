"""Probe for a-hair-mhmat-without-textures-keeps-its-flat-colour.test.ts.

Calls the existing embed_library_hair.create_material() on one mhclo path per
argv entry (after `--`) and prints one PROBE_JSON line per path. No fitting,
no GLB write.
"""

import json
import os
import sys
from pathlib import Path


def main() -> None:
    argv = sys.argv
    mhclos = argv[argv.index("--") + 1 :] if "--" in argv else []
    makeclothes = Path(__file__).resolve().parents[4] / "asset-pipeline" / "makeclothes"
    sys.path.insert(0, str(makeclothes))
    from embed_library_hair import create_material, source_hair_textures

    for mhclo in mhclos:
        textures = source_hair_textures(mhclo)
        stem = Path(mhclo).stem
        mat = create_material("probe_" + stem, (0.18, 0.13, 0.10, 1.0), textures)
        nodes = mat.node_tree.nodes
        image_nodes = [n for n in nodes if n.bl_idname == "ShaderNodeTexImage"]
        bsdf = next(n for n in nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
        base_input = bsdf.inputs["Base Color"]
        print(
            "PROBE_JSON "
            + json.dumps(
                {
                    "mhclo": mhclo,
                    "textures": {k: os.path.basename(v) for k, v in textures.items()},
                    "imageNodeCount": len(image_nodes),
                    "baseColorLinked": bool(base_input.is_linked),
                    "baseColorDefault": [round(float(v), 6) for v in base_input.default_value],
                    "wiredMaps": mat.get("openclinxr_wired_texture_maps", ""),
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
