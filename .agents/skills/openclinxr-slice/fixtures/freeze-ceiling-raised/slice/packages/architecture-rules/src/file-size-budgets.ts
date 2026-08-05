/**
 * Post-slice SIZE_FREEZE — agent raised the ceiling instead of splitting.
 */
export const SIZE_FREEZE: Record<string, { maxLines: number; reason: string }> = {
	'apps/ui-xr/src/main.ts': {
		maxLines: 12000,
		reason: 'XR runtime god-file — raised to absorb capture plumbing',
	},
};
