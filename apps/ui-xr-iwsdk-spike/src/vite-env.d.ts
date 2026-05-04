/// <reference types="vite/client" />

declare module "three/addons/webxr/XRHandModelFactory.js" {
  import type { Group, Object3D } from "three";

  export class XRHandModelFactory {
    createHandModel(controller: Group, profile?: "spheres" | "boxes" | "mesh"): Object3D;
  }
}
