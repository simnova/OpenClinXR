/// <reference types="vite/client" />

declare const __OPENCLINXR_UI_XR_APP_METADATA__: {
  packageName: string;
  version: string;
  gitCommit: string;
  buildTime: string;
  mode: string;
};

declare module "three/addons/webxr/XRHandModelFactory.js" {
  import type { Group, Object3D } from "three";
  import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

  export class XRHandModelFactory {
    constructor(gltfLoader?: GLTFLoader | null, onLoad?: ((object: Object3D) => void) | null);
    setPath(path: string): this;
    createHandModel(controller: Group, profile?: "spheres" | "boxes" | "mesh"): Object3D;
  }
}
