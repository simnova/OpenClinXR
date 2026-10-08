import type { Object3D } from "three";

const BROKEN_GOWN_ASSET = /(?:^|\/)mpfb-gown-adult-patient\.glb(?:$|[?#])/iu;
const BROKEN_GOWN_NODE = /^openclinxr_real_garment_from_phenotype_hospital_gown$/iu;

/**
 * The current gown bake contains a paediatric garment fitted to an adult body; its skinned
 * triangles explode into long cyan shards in standing and supine poses. Keep the actor and its
 * underlying clean clothing/body, but suppress that one corrupt garment shell until it is rebaked.
 */
export function suppressBrokenAdultGownShell(root: Object3D, assetPath: string): string[] {
  if (!BROKEN_GOWN_ASSET.test(assetPath)) return [];
  const hidden: string[] = [];
  root.traverse((object) => {
    if (!BROKEN_GOWN_NODE.test(object.name)) return;
    object.visible = false;
    object.userData.openClinXrVisibilityPolicy = "hidden_corrupt_adult_gown_shell_pending_asset_rebake";
    hidden.push(object.name);
  });
  root.userData.openClinXrSuppressedBrokenGarmentNodes = hidden;
  return hidden;
}
