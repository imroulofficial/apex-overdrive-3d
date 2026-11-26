"""Step 2b: the paint's shading layer in the source texture's own UV space (numpy + PIL).

    python3 tools/cars/remaster/paintshade.py rp1_vanta

The hyper3d texture has the paint colour, the panel gaps and the AI's baked lighting (bright
highlights, soft dark blotches) all in one. The game paints the CarPaint material from a
shading layer (luminance / the factory luminance), so a stain in it shows under every paint.
Shade = texel luminance / its local mean over the paint texels only (lighting and blotches wider
than a few texels divide out), then only the clear dark detail is kept (panel gaps, vents,
lettering); highlights and faint mottling go to 1. Out: <car>_shade.png (8-bit grey).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
car = sys.argv[1]
B = os.path.join(HERE, '..', 'build', 'remaster', car)
d = np.load(os.path.join(B, f'{car}_cls.npz'))
F, UV, C = d['F'], d['UV'], d['C']
tex = np.asarray(Image.open(os.path.join(B, f'{car}_src.png')).convert('RGB')).astype(np.float32) / 255
H, W = tex.shape[:2]
lin = np.where(tex <= 0.04045, tex / 12.92, ((tex + 0.055) / 1.055) ** 2.4)
L = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722

# paint texel mask: rasterise the paint faces into UV space
mask_img = Image.new('L', (W, H), 0)
dr = ImageDraw.Draw(mask_img)
for uv in UV[C == 1]:
    pts = [((u % 1.0) * (W - 1), (1 - v % 1.0) * (H - 1)) for u, v in uv]
    dr.polygon(pts, fill=255, outline=255)
M = np.asarray(mask_img).astype(np.float32) / 255


def blur(a, sigma):
    """Separable gaussian (FFT, wraps; the atlas has margins)."""
    n = int(sigma * 3) * 2 + 1
    x = np.arange(n) - n // 2
    k = np.exp(-x ** 2 / (2 * sigma ** 2))
    k /= k.sum()
    out = a
    for ax in (0, 1):
        K = np.zeros(a.shape[ax])
        K[:n] = k
        K = np.roll(K, -(n // 2))
        out = np.real(np.fft.ifft(np.fft.fft(out, axis=ax) * np.fft.fft(K).reshape((-1, 1) if ax == 0 else (1, -1)), axis=ax))
    return out


sig = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
num = blur(L * M, sig)
den = blur(M, sig)
mean = num / np.maximum(den, 1e-4)
ratio = np.where(M > 0.5, L / np.maximum(mean, 1e-4), 1.0)
deficit = np.clip(1 - ratio, 0, 0.75)
# keep the clear dark detail only: deficits under ~5 % (mottling) vanish, 15 % and more pass
keep = np.clip((deficit - 0.05) / 0.10, 0, 1)
keep = keep * keep * (3 - 2 * keep)
shade = 1 - deficit * keep
# a light 3x3 median-ish cleanup: isolated dark texels (noise) lifted
iso = (shade < 0.9) & (blur((shade < 0.9).astype(np.float32), 1.0) < 0.22)
shade = np.where(iso, 1.0, shade)
# grow the paint region a few texels so the bake's UV seams never sample the unpainted gutter
out = np.where(M > 0.5, shade, 1.0)
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(B, f'{car}_shade.png'))
pm = M > 0.5
print(car, f'paint texels {pm.mean() * 100:.1f}%  shade mean {out[pm].mean():.3f}  <0.9: {(out[pm] < 0.9).mean() * 100:.2f}%  <0.6: {(out[pm] < 0.6).mean() * 100:.2f}%')
