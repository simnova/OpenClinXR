/** Public entry: keep-only re-exports. Implementation: ./index-mod.js */


export type {
  AdminControlPlaneClient,
  FacultyCompileLockClient,
} from "./index-mod.js";
export {
  buildAdminGraphqlEndpoint,
  compileEncounterWorld,
  createAdminControlPlaneClient,
  createRouteManifest,
  findRouteByPath,
} from "./index-mod.js";
