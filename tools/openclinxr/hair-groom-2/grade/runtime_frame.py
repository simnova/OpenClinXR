"""runtime_frame.py: runtime crop -> target pixel frame, per view (DESIGN-realism.md P1, common px/mm).

The runtime harness camera (camera-fit-to-bounds, --body-frame 1.5) differs from the target's scorer-v3 camera. Both
images are rendered in the target scene (Cycles bald source = target geometry and framing; harness hideHair crop under
the ported environment), so their luminance is comparable. Per view a similarity without rotation
(col_t = s*col + dx, row_t = s*row + dy) is found by scanning s, taking the FFT overlap peak of the skin masks for
(dx, dy), and keeping the s with the best skin IoU above row 620 (face, neck, shoulders; background excluded). Check: an edge overlay per view
(source edges red, mapped runtime edges green) is written beside the output and read before use; skin IoU is reported.

fit-head (P3): for the same body under both cameras (P3 bald Cycles render vs harness hideHair crop) the skin fit
fails (s at the scan edge); per s the runtime mask (saturation > .06) is placed, aligned to the source's head top
(dy) and head-region column centroid (dx, +-3 px refine), and scored by IoU over the 380 rows below the head top.

Usage: runtime_frame.py fit <cycles source dir> <harness nohair prefix> <out.json>
       runtime_frame.py fit-head <cycles source dir> <harness nohair prefix> <out.json>
       runtime_frame.py warp <frames.json> <view> <in.png> <out.png>          (runtime -> target frame)
       runtime_frame.py to-runtime <frames.json> <view> <in.png> <out.png>    (target -> runtime frame)
"""
import json
import sys

import numpy as np
from PIL import Image

W = np.array([0.2126, 0.7152, 0.0722])
SRC = {'front': 'front', 'three_quarter_left': 'three_quarter', 'side': 'profile_90', 'back': 'back'}
N = 1024


def lum(img):
    return (np.asarray(img.convert('RGB'), float) / 255.) @ W


def scaled(img, s):
    w = max(int(round(img.width * s)), 8)
    return img.resize((w, w), Image.BILINEAR)


def place(img, s, dx, dy):
    """Runtime image -> 1024x1024 target frame."""
    return img.transform((N, N), Image.AFFINE, (1 / s, 0, -dx / s, 0, 1 / s, -dy / s), resample=Image.BILINEAR,
                         fillcolor=(0, 0, 0))


def skin(img):
    a = np.asarray(img.convert('RGB'), float) / 255.
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    return (R > G + 0.03) & (G > B + 0.02) & (R - B > 0.12) & (a @ W > 0.30)


def fit_view(src_img, rt_img):
    """Scan s; per s the FFT overlap-count peak gives (dx, dy); pick the s with the best skin IoU above row 620."""
    A = skin(src_img).astype(float)
    A[620:] = 0
    FA = np.fft.fft2(A, s=(2 * N, 2 * N))
    best = None
    for s in np.arange(0.50, 1.80, 0.01):
        B = skin(scaled(rt_img.convert('RGB'), s)).astype(float)
        h = min(B.shape[0], 2 * N)
        Bp = np.zeros((2 * N, 2 * N))
        Bp[:h, :h] = B[:h, :h]
        cc = np.real(np.fft.ifft2(FA * np.conj(np.fft.fft2(Bp))))
        dy, dx = np.unravel_index(int(np.argmax(cc)), cc.shape)
        dy = dy - 2 * N if dy >= N else dy
        dx = dx - 2 * N if dx >= N else dx
        P = skin(place(rt_img.convert('RGB'), s, dx, dy))
        P[620:] = False
        inter = float((P & (A > 0)).sum())
        iou = inter / float((P | (A > 0)).sum() + 1e-9)
        if best is None or iou > best[0]:
            best = (iou, float(round(s, 3)), int(dx), int(dy))
    return best


def edges(l):
    g = np.hypot(np.diff(l, axis=0, append=l[-1:]), np.diff(l, axis=1, append=l[:, -1:]))
    return (np.clip(g / 0.08, 0, 1) * 255).astype(np.uint8)


def fit(src_dir, nohair_prefix, out):
    res = {}
    for v, sv in SRC.items():
        src = Image.open('%s/source-%s.png' % (src_dir, sv))
        rt = Image.open('%s-%s.png' % (nohair_prefix, v))
        iou, s, dx, dy = fit_view(src, rt)
        res[v] = dict(s=s, dx=dx, dy=dy, skinIoU=round(iou, 4), rtSize=rt.width,
                      note='col_t = s*col + dx, row_t = s*row + dy (runtime crop px -> target px)')
        print(v, res[v], flush=True)
        e1 = edges(lum(src)); e2 = edges(lum(place(rt.convert('RGB'), s, dx, dy)))
        ov = np.zeros((N, N, 3), np.uint8); ov[..., 0] = e1; ov[..., 1] = e2
        Image.fromarray(ov).save(out.replace('.json', '-overlay-%s.png' % v))
    json.dump(res, open(out, 'w'), indent=1)


def sat(img):
    a = np.asarray(img.convert('RGB'), float) / 255.
    return (a.max(2) - a.min(2)) > 0.06


def fit_head_view(src_img, rt_img, H=380):
    A = sat(src_img)
    ta = int(np.where(A.sum(1) > 3)[0].min())
    Ar = np.zeros_like(A)
    Ar[ta:ta + H] = A[ta:ta + H]
    ca = np.nonzero(Ar)[1].mean()
    best = None
    for s in np.arange(1.3, 2.4, 0.005):
        P = sat(place(rt_img.convert('RGB'), s, 0, 0))
        rows = np.where(P.sum(1) > 3)[0]
        if not len(rows):
            continue
        dy = ta - int(rows.min())
        P = np.roll(P, dy, 0)
        Pr = np.zeros_like(P)
        Pr[ta:ta + H] = P[ta:ta + H]
        dx = int(round(ca - np.nonzero(Pr)[1].mean()))
        Pr = np.roll(Pr, dx, 1)
        for ddx in range(-3, 4):
            Q = np.roll(Pr, ddx, 1)
            iou = float((Q & Ar).sum()) / float((Q | Ar).sum())
            if best is None or iou > best[0]:
                best = (iou, float(round(s, 3)), dx + ddx, dy)
    return best


def fit_head(src_dir, nohair_prefix, out):
    res = {}
    for v, sv in SRC.items():
        iou, s, dx, dy = fit_head_view(Image.open('%s/source-%s.png' % (src_dir, sv)),
                                       Image.open('%s-%s.png' % (nohair_prefix, v)))
        res[v] = dict(s=s, dx=dx, dy=dy, headIoU=round(iou, 4), rtSize=N,
                      note='col_t = s*col + dx, row_t = s*row + dy (runtime crop px -> Cycles px); fit-head, same body')
        print(v, res[v], flush=True)
    json.dump(res, open(out, 'w'), indent=1)


def to_runtime(frames, v, src, dst):
    """Target image -> runtime crop frame (downsample with LANCZOS, then shift): the fair direction for streak."""
    f = json.load(open(frames))[v]
    im = Image.open(src).convert('RGB')
    w = int(round(im.width / f['s']))
    small = im.resize((w, w), Image.LANCZOS)
    out = Image.new('RGB', (N, N), im.getpixel((2, 2)))
    out.paste(small, (int(round(-f['dx'] / f['s'])), int(round(-f['dy'] / f['s']))))  # runtime x = (X - dx) / s
    out.save(dst)


def warp(frames, v, src, dst):
    f = json.load(open(frames))[v]
    place(Image.open(src).convert('RGB'), f['s'], f['dx'], f['dy']).save(dst)


if __name__ == '__main__':
    if sys.argv[1] == 'fit':
        fit(*sys.argv[2:5])
    elif sys.argv[1] == 'fit-head':
        fit_head(*sys.argv[2:5])
    elif sys.argv[1] == 'to-runtime':
        to_runtime(*sys.argv[2:6])
    elif sys.argv[1] == 'warp':
        warp(*sys.argv[2:6])
