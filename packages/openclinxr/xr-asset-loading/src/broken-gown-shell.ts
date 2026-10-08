import type { Object3D } from "three";

const BROKEN_GOWN_ASSET = /(?:^|\/)mpfb-gown-adult-patient\.glb(?:$|[?#])/iu;
const BROKEN_GOWN_NODE = /^openclinxr_real_garment_from_phenotype_hospital_gown$/iu;

/** Hide only the known corrupt garment shell while preserving the actor and clean underlayer. */
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
