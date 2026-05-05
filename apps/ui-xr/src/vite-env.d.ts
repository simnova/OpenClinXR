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

  export class XRHandModelFactory {
    createHandModel(controller: Group, profile?: "spheres" | "boxes" | "mesh"): Object3D;
  }
}
