/**
 * R1 neck-stage pin (physician ONLY).
 *
 * Owning gate: packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-physician-collar-shows-no-skin-notch.test.ts.
 * This pin moves only on a new neck stage (a new unhide-neckline run changes the split).
 *
 * Source: shipped GLB sha256 8c3ab05cf2da84c5af223bc16219bc6ac14c2701acc3e50eb674b9a4e26c878f
 * (h6 unhide-neckline-opening.py output, installed by the neck card); partition + accessor
 * inventory in land/r4 RP1 (8 appended bufferViews 52-59, +8 INDICES accessors 3694-3701)
 * and re-measured in land/r6 (r1-shas.ts: each split pair's sorted index multiset union
 * equals the baseline prim's indices exactly; all attribute accessors shared with baseline).
 *
 * The 8 hashes below are the full sha256 of the 8 new INDICES accessor byte buffers
 * (accessors 3694-3701: 4 moved hidden_* prims + 4 new mpfb_skin_* split prims).
 * A neck-stage prim may differ from BASELINE_REF only while its indices bytes hash
 * to exactly this set; every other non-lash accessor still compares to BASELINE_REF.
 */
export const NECK_STAGE_PHYSICIAN = "mpfb-clinical-physician-adult.glb";
export const NECK_STAGE_SOURCE_GLB_SHA256 =
  "8c3ab05cf2da84c5af223bc16219bc6ac14c2701acc3e50eb674b9a4e26c878f";
export const NECK_STAGE_INDICES_SHA256: readonly string[] = [
  "99ebff2f68bfceebb3dd393068d54f76acef77aba9a4ee53f57afcdadb2fa651", // 3694 moved hidden_upper (5505; was 6096)
  "7900579cb886e553c7ce2c2917e689147476a815c961719d96a98d20bea3878a", // 3695 new skin split (591 = 6096-5505)
  "fd7dcbb8bb601c25191ed946cf796e34d56f56e925faad53809c8382e5ac1fa8", // 3696 moved hidden_upper.001 (108; was 150)
  "f32e960b24467f7b7009e5481bca5534c387da2936d9a6b2c7709ed7fc1ef1b4", // 3697 new skin split (42 = 150-108)
  "98e83dec8d9ed9400e287a1e77bdac8a32d20ae37bcd07ce531d6cb4ba7cef2c", // 3698 moved hidden_lower.001 (177; was 186)
  "32dce85224c7520cdf3e3f2d813b608fe96d851f8af6144128f601ed5654e3ad", // 3699 new skin split (9 = 186-177)
  "04e35bd5ad42e48b3f2e76f2381f75c06595f48a9a824f8d105b68d9e6ba3738", // 3700 moved hidden_orphan (270; was 291)
  "70a52341015bebe95dc0bd77cc02b88819c46f0c52444f1ce95085f035777af0", // 3701 new skin split (21 = 291-270)
];
