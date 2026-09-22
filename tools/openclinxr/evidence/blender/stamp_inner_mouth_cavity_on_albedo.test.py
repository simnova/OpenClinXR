"""Test for stamp_inner_mouth_cavity_on_albedo_pixels (pure numpy, no bpy)."""

import numpy as np
from numpy.typing import NDArray


def stamp_inner_mouth_cavity_on_albedo_pixels(
    albedo_rgba: NDArray[np.float32],
    mask_rgba: NDArray[np.float32],
    rgb: tuple[float, float, float] = (0.72, 0.28, 0.32),
) -> NDArray[np.float32]:
    """Stamp the inner mouth cavity color onto albedo where mask is present.

    Pure numpy helper — no bpy dependency. Albedo and mask may differ in H×W;
    bilinear resize mask to albedo shape. Where mask R (or luminance) > 0.5,
    set albedo RGB to rgb, keep alpha. Returns a copy. Counterweight: all-zero
    mask leaves albedo unchanged.
    """
    if albedo_rgba.ndim != 3 or albedo_rgba.shape[2] != 4:
        raise ValueError("albedo_rgba must be HxWx4")
    if mask_rgba.ndim != 3 or mask_rgba.shape[2] != 4:
        raise ValueError("mask_rgba must be HxWx4")

    h_a, w_a = albedo_rgba.shape[:2]
    h_m, w_m = mask_rgba.shape[:2]

    # Resize mask to albedo shape using nearest-neighbor (simple, fast)
    if h_m != h_a or w_m != w_a:
        # Build sampling indices
        y_idx = np.clip((np.arange(h_a) + 0.5) * h_m / h_a, 0, h_m - 1).astype(int)
        x_idx = np.clip((np.arange(w_a) + 0.5) * w_m / w_a, 0, w_m - 1).astype(int)
        mask_resized = mask_rgba[y_idx[:, None], x_idx[None, :]]
    else:
        mask_resized = mask_rgba

    # Use mask R channel (or luminance) as coverage
    mask_cov = mask_resized[..., 0]
    # Also accept luminance if R is zero but other channels have data
    if not np.any(mask_cov > 0.5):
        lum = mask_resized[..., :3].mean(axis=-1)
        mask_cov = np.maximum(mask_cov, lum)

    out = albedo_rgba.copy()
    hit = mask_cov > 0.5
    if np.any(hit):
        out[hit, 0] = rgb[0]
        out[hit, 1] = rgb[1]
        out[hit, 2] = rgb[2]
        # alpha unchanged
        n = int(hit.sum())
        print(f"INNER_MOUTH_STAMP texels={n}")
    else:
        print("INNER_MOUTH_STAMP texels=0")
    return out


def test_basic_stamp():
    """4x4 black albedo + mask with one texel 1.0 stamps that texel to cavity color."""
    albedo = np.zeros((4, 4, 4), dtype=np.float32)
    albedo[..., 3] = 1.0  # opaque alpha

    mask = np.zeros((4, 4, 4), dtype=np.float32)
    mask[1, 2, 0] = 1.0  # R channel = 1 at (1, 2)

    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask)

    # Check the stamped texel
    assert out[1, 2, 0] == 0.72, f"Expected R=0.72, got {out[1, 2, 0]}"
    assert out[1, 2, 1] == 0.28, f"Expected G=0.28, got {out[1, 2, 1]}"
    assert out[1, 2, 2] == 0.32, f"Expected B=0.32, got {out[1, 2, 2]}"
    assert out[1, 2, 3] == 1.0, f"Expected A=1.0, got {out[1, 2, 3]}"

    # Check other texels unchanged
    assert out[0, 0, 0] == 0.0
    assert out[3, 3, 0] == 0.0
    print("test_basic_stamp PASSED")


def test_all_zero_mask_identity():
    """All-zero mask leaves albedo unchanged."""
    albedo = np.ones((4, 4, 4), dtype=np.float32) * 0.5
    albedo[..., 3] = 1.0

    mask = np.zeros((4, 4, 4), dtype=np.float32)

    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask)

    assert np.allclose(out, albedo), "All-zero mask should not modify albedo"
    print("test_all_zero_mask_identity PASSED")


def test_mask_resize():
    """Mask at different resolution resizes to albedo shape."""
    albedo = np.zeros((8, 8, 4), dtype=np.float32)
    albedo[..., 3] = 1.0

    # 4x4 mask with one texel set
    mask = np.zeros((4, 4, 4), dtype=np.float32)
    mask[1, 1, 0] = 1.0

    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask)

    # The mask texel at (1,1) in 4x4 maps to ~center of 8x8
    # With nearest neighbor: (1+0.5)*8/4 = 3, so indices 3,3
    assert out[3, 3, 0] == 0.72
    assert out[3, 3, 1] == 0.28
    assert out[3, 3, 2] == 0.32
    print("test_mask_resize PASSED")


def test_luminance_fallback():
    """If R channel is zero but luminance > 0.5, it still stamps."""
    albedo = np.zeros((4, 4, 4), dtype=np.float32)
    albedo[..., 3] = 1.0

    # Mask with G=1, R=0 (luminance = 0.33, not > 0.5)
    mask = np.zeros((4, 4, 4), dtype=np.float32)
    mask[1, 2, 1] = 1.0  # G channel only

    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask)
    # Luminance = (0+1+0)/3 = 0.33 < 0.5, so no stamp
    assert out[1, 2, 0] == 0.0

    # Now with all three channels = 1 (luminance = 1.0 > 0.5)
    mask[2, 2, :3] = 1.0
    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask)
    assert out[2, 2, 0] == 0.72
    print("test_luminance_fallback PASSED")


def test_custom_rgb():
    """Custom RGB color is used when provided."""
    albedo = np.zeros((4, 4, 4), dtype=np.float32)
    albedo[..., 3] = 1.0

    mask = np.zeros((4, 4, 4), dtype=np.float32)
    mask[1, 2, 0] = 1.0

    out = stamp_inner_mouth_cavity_on_albedo_pixels(albedo, mask, rgb=(0.1, 0.2, 0.3))

    assert out[1, 2, 0] == 0.1
    assert out[1, 2, 1] == 0.2
    assert out[1, 2, 2] == 0.3
    print("test_custom_rgb PASSED")


if __name__ == "__main__":
    test_basic_stamp()
    test_all_zero_mask_identity()
    test_mask_resize()
    test_luminance_fallback()
    test_custom_rgb()
    print("\nALL TESTS PASSED")