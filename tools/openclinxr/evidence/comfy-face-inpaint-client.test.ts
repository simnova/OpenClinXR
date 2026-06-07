import { describe, expect, it } from "vitest";

import {
  REALVISXL_CHECKPOINT,
  buildMaskedInpaintWorkflow,
  buildText2ImgWorkflow,
} from "./comfy-face-inpaint-client.js";

describe("comfy-face-inpaint-client", () => {
  it("builds a RealVisXL masked latent inpaint workflow", () => {
    const workflow = buildMaskedInpaintWorkflow({
      baseImageName: "base.png",
      maskImageName: "face_mask.png",
      outputPrefix: "openclinxr_comfy_masked_face_test",
      positivePrompt: "realistic child face",
      negativePrompt: "blurry",
      seed: 42,
      steps: 12,
      cfg: 5.5,
      denoise: 0.55,
    });

    expect(workflow["1"]).toMatchObject({
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: REALVISXL_CHECKPOINT },
    });
    expect(workflow["8"]).toMatchObject({ class_type: "SetLatentNoiseMask" });
    expect(workflow["11"]).toMatchObject({
      class_type: "SaveImage",
      inputs: { filename_prefix: "openclinxr_comfy_masked_face_test" },
    });
  });

  it("builds a RealVisXL txt2img fallback workflow for UV-mask compositing", () => {
    const workflow = buildText2ImgWorkflow({
      outputPrefix: "openclinxr_comfy_face_tile_test",
      positivePrompt: "realistic child face",
      negativePrompt: "blurry",
      seed: 7,
      steps: 8,
      cfg: 5.5,
      width: 512,
      height: 512,
    });

    expect(workflow["4"]).toMatchObject({ class_type: "EmptyLatentImage" });
    expect(workflow["7"]).toMatchObject({
      class_type: "SaveImage",
      inputs: { filename_prefix: "openclinxr_comfy_face_tile_test" },
    });
  });
});