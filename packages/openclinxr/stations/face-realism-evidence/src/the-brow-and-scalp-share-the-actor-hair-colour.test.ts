import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const MATERIALIZER = join(
  ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const HAIR_HELPER = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/embed_library_hair.py",
);
const AUTOMATE_BLENDER = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/anny/automate_blender.py",
);
const POST_EXPORT_STAGE = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py",
);

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  expect(startAt, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing end marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt + end.length);
}

describe("the fitted brow and scalp share one actor hair-colour contract", () => {
  const materializer = readFileSync(MATERIALIZER, "utf8");

  it("recolours authored scalp diffuse and gives the brow the same target", () => {
    const scalp = between(
      materializer,
      "_hair_textures = _source_hair_textures(",
      "_hair.data.materials.append(_hair_mat)",
    );
    const brow = between(
      materializer,
      'if _eyebrow_style and getattr(args, "brow_form", None) != "texture":',
      "_brow.data.materials.append(_brow_mat)",
    );
    expect(scalp).toContain("_hair_color_token = phenotype_hair_color(args.reference)");
    expect(scalp).toContain("diffuse_target_rgb=_hair_target_rgb");
    expect(scalp).toContain("# Unauthored phenotype: retain the r2 material call");
    expect(scalp).toContain("_hair_textures,");
    expect(brow.match(/_texture_mean_linear\(_hair_diffuse\)/g)).toHaveLength(1);
    expect(brow.match(/_hair_color\(args\.actor_role\)/g)).toHaveLength(1);
    expect(brow).toContain("(*_hair_target_rgb, 1.0)");
    expect(brow).toContain("_brow_color,");
  });

  it("has one shared authored token table and keeps the Anny scalp on its resolver", () => {
    const helper = readFileSync(HAIR_HELPER, "utf8");
    const automate = readFileSync(AUTOMATE_BLENDER, "utf8");
    const allSources = materializer + helper + automate;

    expect(allSources.match(/\(0\.035, 0\.028, 0\.022\)/g)).toHaveLength(1);
    expect(helper).toContain("HAIR_COLOR_RGB = {");
    expect(automate).toContain("from embed_library_hair import authored_hair_color_rgba");
    expect(automate).toContain(
      'base_color = authored_hair_color_rgba(phenotype.get("hair_color", "brown"))',
    );
  });

  it("makes the GLB stage call the shared resolver instead of carrying a colour literal", () => {
    const stage = readFileSync(POST_EXPORT_STAGE, "utf8");

    expect(stage).toContain("from embed_library_hair import authored_hair_color_rgba");
    expect(stage.match(/authored_hair_color_rgba\(hair_color\)/g)).toHaveLength(1);
    expect(stage).not.toContain("HAIR_COLOR_RGB");
    expect(stage).not.toContain("0.035");
    expect(stage).toContain('HAIR_PREFIX = "openclinxr_fitted_hair_"');
    expect(stage).toContain('EYEBROW_PREFIX = "openclinxr_fitted_eyebrow_"');
  });

  it("limits the post-export edit to material factors and passes the BIN chunk through", () => {
    const stage = readFileSync(POST_EXPORT_STAGE, "utf8");
    const recolour = between(stage, "def recolour_materials(", "    return changed");
    const encoderCall = between(
      stage,
      "    output_raw = encode_glb(doc, binary)",
      "    output.write_bytes(output_raw)",
    );

    expect(recolour).toContain('pbr["baseColorFactor"] = replacement');
    expect(recolour).not.toMatch(/images|bufferViews|accessors|meshes|animations/);
    expect(encoderCall).toContain("encode_glb(doc, binary)");
  });

  it("keeps the brow colour free of literals and material-socket inheritance", () => {
    const browRail = between(
      materializer,
      "# #542 — fitted eyebrows BEFORE",
      "_brow.data.materials.append(_brow_mat)",
    );
    const browMaterial = between(
      browRail,
      "_brow_mat = _brow_create_material(",
      ")\n        _brow.data.materials.append(_brow_mat)",
    );

    expect(browMaterial).not.toMatch(/\(\s*0?\.\d+\s*,\s*0?\.\d+\s*,\s*0?\.\d+/);
    expect(browRail).not.toContain('inputs["Base Color"].default_value');
  });

  it("alpha-weights visible texels after sRGB decoding and excludes transparent texels", () => {
    const probe = String.raw`
import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

namespace = {}
source = Path(sys.argv[1]).read_text(encoding="utf-8")
start = source.index("def texture_mean_linear(")
end = source.index("\ndef create_material(", start)
exec("from typing import Tuple\n" + source[start:end], namespace)

pixels = [(255, 0, 0, 255), (0, 128, 0, 255)] + [(0, 0, 255, 0)] * 14
with tempfile.NamedTemporaryFile(suffix=".png") as handle:
    image = Image.new("RGBA", (4, 4))
    image.putdata(pixels)
    image.save(handle.name)
    print(json.dumps(namespace["texture_mean_linear"](handle.name)))
`;
    const measured = JSON.parse(
      execFileSync("mise", ["exec", "--", "python3", "-c", probe, HAIR_HELPER], {
        encoding: "utf8",
      }),
    ) as number[];
    const greenLinear = ((128 / 255 + 0.055) / 1.055) ** 2.4;

    expect(measured).toHaveLength(4);
    expect(measured[0]).toBeCloseTo(0.5, 3);
    expect(measured[1]).toBeCloseTo(greenLinear / 2, 3);
    expect(measured[2]).toBeCloseTo(0, 3);
    expect(measured[3]).toBe(1);
  });

  it("recolours linear RGBA to the target mean while preserving detail and alpha", () => {
    const probe = String.raw`
import json
import sys
from pathlib import Path

import numpy as np

namespace = {}
source = Path(sys.argv[1]).read_text(encoding="utf-8")
start = source.index("def recolour_to_mean_linear(")
end = source.index("\ndef recoloured_blender_image(", start)
exec(source[start:end], namespace)

rgba = np.array([[[0.4, 0.2, 0.1, 1.0], [0.2, 0.1, 0.05, 1.0],
                  [0.9, 0.8, 0.7, 0.0], [0.7, 0.6, 0.5, 0.0]]], dtype=np.float64)
target = np.array([0.04, 0.03, 0.02], dtype=np.float64)
out = namespace["recolour_to_mean_linear"](rgba, target)
weights = out[..., 3]
mean = np.sum(out[..., :3] * weights[..., None], axis=(0, 1)) / weights.sum()
ratios = out[0, 0, :3] / out[0, 1, :3]
print(json.dumps({
    "mean": mean.tolist(),
    "ratios": ratios.tolist(),
    "alpha": out[..., 3].tolist(),
}))
`;
    const measured = JSON.parse(
      execFileSync("mise", ["exec", "--", "python3", "-c", probe, HAIR_HELPER], {
        encoding: "utf8",
      }),
    ) as { mean: number[]; ratios: number[]; alpha: number[][] };

    expect(measured.mean[0]).toBeCloseTo(0.04, 3);
    expect(measured.mean[1]).toBeCloseTo(0.03, 3);
    expect(measured.mean[2]).toBeCloseTo(0.02, 3);
    expect(measured.ratios).toEqual([2, 2, 2]);
    expect(measured.alpha).toEqual([[1, 1, 0, 0]]);
  });
});
