/**
 * Types for the app-bundled three.js that evidence tools load by deep path, so the
 * probe measures with the same binary the ui-xr runtime uses (SS6v). The three package
 * ships no adjacent declarations; @types/three mirrors the version the app pins and is
 * reachable from this project via the `three` paths mapping in tsconfig.tools-relaxed.json.
 */
declare module "*/three/build/three.module.js" {
  export * from "three";
}
declare module "*/three/examples/jsm/loaders/GLTFLoader.js" {
  export * from "three/addons/loaders/GLTFLoader.js";
}
