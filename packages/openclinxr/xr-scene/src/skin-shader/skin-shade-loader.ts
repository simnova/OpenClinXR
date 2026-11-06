/**
 * Shared GLTF loader factory that installs the portrait skin-shade hook from
 * GLB-declared bytes (st-vitskin).
 *
 * The tester (`candidate-capture.ts`) and the learner runtime build bare
 * `new GLTFLoader()`s, so the `onBeforeCompile` hook in `skin-shade.ts` never
 * ran there — only the isolated-subject lab's `applyMaterialOverrides` path
 * reached it. This factory registers one `GLTFLoader` plugin,
 * `OPENCLINXR_skin_shade`, that resolves the material extension's textureInfo
 * through `parser.getDependency('texture', index)` and installs
 * `applySkinShade` with that texture as the curvature(R)+cavity(G) map.
 *
 * GLB contract (producer: the materializer's post-export stage): the
 * extension object lives on a material, `{ curvatureTexture: { index } }`,
 * pointing at a dedicated core image (RG PNG, R = curvature bake,
 * G = cavity concave mask, same polarity `skin-shade.ts` expects). The
 * extension is listed in `extensionsUsed`, never `extensionsRequired`, so a
 * stock `new GLTFLoader()` still loads the bytes (hook absent).
 *
 * Fail-closed: a present extension with a missing/non-integer texture index,
 * a null texture, or a non-standard material refuses (throws) instead of
 * rendering unhooked. No shading maths live here; see `skin-shade.ts` (F1:
 * that file is untouched by this card).
 */

import {
  type LoadingManager,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  type Texture,
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  type GLTF,
  GLTFLoader,
  type GLTFLoaderPlugin,
  type GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import { applySkinShade } from "./skin-shade.js";

/** glTF material extension name = the registered plugin name. */
export const SKIN_SHADE_EXTENSION_NAME = "OPENCLINXR_skin_shade";

/** Material extension definition the producer writes into the GLB. */
interface SkinShadeMaterialExtension {
  /** textureInfo pointing at the dedicated RG curvature+cavity image. */
  curvatureTexture: { index: number };
  /** Optional tiled tangent-normal textureInfo; KHR_texture_transform is honoured. */
  detailNormalTexture?: {
    index: number;
    texCoord?: number;
    extensions?: Record<string, unknown>;
  };
  /** Detail-normal XY strength. Omission is the identity value 0. */
  detailNormalStrength?: number;
  /** Optional body-region tiled tangent-normal textureInfo (own KHR_texture_transform). */
  bodyDetailNormalTexture?: {
    index: number;
    texCoord?: number;
    extensions?: Record<string, unknown>;
  };
  /** Body-detail XY strength. Omission is the identity value 0. */
  bodyDetailNormalStrength?: number;
}

type SkinShadeMaterial = MeshStandardMaterial | MeshPhysicalMaterial;

function isSkinShadeMaterial(material: unknown): material is SkinShadeMaterial {
  return (
    material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial
  );
}

/**
 * The registered plugin. Installed per parse via
 * `loader.register((parser) => new SkinShadePlugin(parser))`.
 */
class SkinShadePlugin implements GLTFLoaderPlugin {
  readonly name = SKIN_SHADE_EXTENSION_NAME;
  private readonly parser: GLTFParser;
  private readonly textures = new Map<number, Promise<Texture>>();

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  private extensionOf(materialIndex: number): SkinShadeMaterialExtension | null {
    const materials = this.parser.json?.materials as
      | Array<{ extensions?: Record<string, unknown> }>
      | undefined;
    const extensions = materials?.[materialIndex]?.extensions;
    const extension = extensions?.[this.name];
    if (extension === undefined || extension === null) return null;
    if (typeof extension !== "object" || Array.isArray(extension)) {
      throw new Error(
        `OPENCLINXR_skin_shade: material ${materialIndex} extension must be an object`,
      );
    }
    return extension as SkinShadeMaterialExtension;
  }

  private curvatureTexture(index: number): Promise<Texture> {
    const cached = this.textures.get(index);
    if (cached) return cached;
    const pending = this.parser.getDependency("texture", index).then((texture: unknown) => {
      if (texture === null || texture === undefined) {
        throw new Error(
          `OPENCLINXR_skin_shade: texture dependency ${index} resolved to null — refusing unhooked render`,
        );
      }
      const tex = texture as Texture;
      // The lab path binds the curvature map as data (NoColorSpace,
      // flipY=false; the exporter already writes flipY=false). The RG image
      // is dedicated to this extension, so stamping the shared cache entry
      // cannot recolour another material's color map.
      tex.colorSpace = NoColorSpace;
      return tex;
    });
    this.textures.set(index, pending);
    return pending;
  }

  private async detailNormalTexture(
    textureInfo: NonNullable<SkinShadeMaterialExtension["detailNormalTexture"]>,
  ): Promise<Texture> {
    const params: Record<string, unknown> = {};
    const texture = await this.parser.assignTexture(
      params,
      "detailNormalMap",
      textureInfo,
      NoColorSpace,
    );
    if (texture === null || texture === undefined) {
      throw new Error(
        `OPENCLINXR_skin_shade: detail texture dependency ${textureInfo.index} resolved to null — refusing unhooked render`,
      );
    }
    return texture;
  }

  afterRoot(result: GLTF): Promise<void> {
    const jobs: Promise<void>[] = [];
    const scheduled = new Set<unknown>();
    for (const scene of result.scenes ?? [result.scene]) {
      scene.traverse((object) => {
        const materials = (object as { material?: unknown }).material;
        if (materials === undefined || materials === null) return;
        for (const material of Array.isArray(materials) ? materials : [materials]) {
          if (scheduled.has(material)) continue;
          const reference = this.parser.associations.get(
            material as Parameters<GLTFParser["associations"]["get"]>[0],
          );
          const materialIndex = reference?.materials;
          if (materialIndex === undefined) continue;
          const extension = this.extensionOf(materialIndex);
          if (extension === null) continue;
          scheduled.add(material);
          jobs.push(this.install(material, materialIndex, extension));
        }
      });
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private async install(
    material: unknown,
    materialIndex: number,
    extension: SkinShadeMaterialExtension,
  ): Promise<void> {
    const textureIndex = extension.curvatureTexture?.index;
    if (!Number.isInteger(textureIndex) || (textureIndex as number) < 0) {
      throw new Error(
        `OPENCLINXR_skin_shade: material ${materialIndex} needs curvatureTexture.index (non-negative integer) — refusing unhooked render`,
      );
    }
    if (!isSkinShadeMaterial(material)) {
      throw new Error(
        `OPENCLINXR_skin_shade: material ${materialIndex} is ${(material as { type?: unknown }).type ?? typeof material}, not a standard/physical material — refusing`,
      );
    }
    const curvatureMap = await this.curvatureTexture(textureIndex as number);
    const detailInfo = extension.detailNormalTexture;
    const bodyInfo = extension.bodyDetailNormalTexture;
    let detailNormalMap: Texture | null = null;
    let detailNormalStrength = 0;
    if (detailInfo === undefined) {
      if (extension.detailNormalStrength !== undefined) {
        throw new Error(
          `OPENCLINXR_skin_shade: material ${materialIndex} declares detailNormalStrength without detailNormalTexture — refusing`,
        );
      }
    } else {
      if (!Number.isInteger(detailInfo.index) || detailInfo.index < 0) {
        throw new Error(
          `OPENCLINXR_skin_shade: material ${materialIndex} needs detailNormalTexture.index (non-negative integer) — refusing`,
        );
      }
      detailNormalMap = await this.detailNormalTexture(detailInfo);
      detailNormalStrength = extension.detailNormalStrength ?? 0;
    }
    let bodyDetailNormalMap: Texture | null = null;
    let bodyDetailNormalStrength = 0;
    if (bodyInfo === undefined) {
      if (extension.bodyDetailNormalStrength !== undefined) {
        throw new Error(
          `OPENCLINXR_skin_shade: material ${materialIndex} declares bodyDetailNormalStrength without bodyDetailNormalTexture — refusing`,
        );
      }
    } else {
      if (!Number.isInteger(bodyInfo.index) || bodyInfo.index < 0) {
        throw new Error(
          `OPENCLINXR_skin_shade: material ${materialIndex} needs bodyDetailNormalTexture.index (non-negative integer) — refusing`,
        );
      }
      bodyDetailNormalMap = await this.detailNormalTexture(bodyInfo);
      bodyDetailNormalStrength = extension.bodyDetailNormalStrength ?? 0;
    }
    applySkinShade(material, {
      curvatureMap,
      detailNormalMap,
      detailNormalStrength,
      bodyDetailNormalMap,
      bodyDetailNormalStrength,
    });
  }
}

/**
 * The one loader the tester (and later the learner) builds: stock behaviour
 * plus meshopt plus the skin-shade plugin. A stock `new GLTFLoader()` on the
 * same bytes loads fine and installs nothing (the D5 counterweight).
 */
export function createSkinShadeGLTFLoader(manager?: LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register((parser) => new SkinShadePlugin(parser));
  return loader;
}
