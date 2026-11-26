"""Debug: orthographic colour map of the source (or class) faces with a 0.1 m grid, for picking
regions. python3 projmap.py car side|top|front|rear [cls] -> build/remaster/<car>/map_<view>.png"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
car, view = sys.argv[1], sys.argv[2]
use_cls = len(sys.argv) > 3
B = os.path.join(HERE, '..', 'build', 'remaster', car)
d = np.load(os.path.join(B, f'{car}_cls.npz' if use_cls else f'{car}_src.npz'))
V, F, UV = d['V'], d['F'], d['UV']
tex = np.asarray(Image.open(os.path.join(B, f'{car}_src.png')).convert('RGB')).astype(np.float32) / 255
H, W = tex.shape[:2]
uv = UV.mean(1)
col = tex[np.clip(((1 - uv[:, 1] % 1) * (H - 1)).astype(int), 0, H - 1), np.clip(((uv[:, 0] % 1) * (W - 1)).astype(int), 0, W - 1)]
if use_cls:
    pal = np.array([(0.55, 0.55, 0.55), (0.85, 0.1, 0.1), (0.1, 0.45, 0.95), (1, 0.9, 0.2), (1, 0.2, 0.7), (0.1, 0.8, 0.3)])
    col = pal[d['C']]
cen = V[F].mean(1)
# u, v axes and depth (towards the viewer = larger)
if view == 'side':      # right side: x right->left? show nose to the right
    u, v, dep = cen[:, 0], cen[:, 1], cen[:, 2]
elif view == 'left':
    u, v, dep = cen[:, 0], cen[:, 1], -cen[:, 2]
elif view == 'top':
    u, v, dep = cen[:, 0], -cen[:, 2], cen[:, 1]
elif view == 'front':
    u, v, dep = -cen[:, 2], cen[:, 1], cen[:, 0]
elif view == 'rear':
    u, v, dep = cen[:, 2], cen[:, 1], -cen[:, 0]
S = 300  # px per metre
u0, u1, v0, v1 = u.min() - 0.1, u.max() + 0.1, v.min() - 0.1, v.max() + 0.1
Wp, Hp = int((u1 - u0) * S), int((v1 - v0) * S)
img = np.full((Hp, Wp, 3), 0.12)
zb = np.full((Hp, Wp), -1e9)
px = ((u - u0) * S).astype(int)
py = ((v1 - v) * S).astype(int)
order = np.argsort(dep)
for k in (0, 1, 2):
    for dx in (0, 1, 2):
        x = np.clip(px[order] + dx, 0, Wp - 1)
        y = np.clip(py[order] + k, 0, Hp - 1)
        img[y, x] = col[order]
im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
dr = ImageDraw.Draw(im)
for t in np.arange(np.ceil(u0 * 10) / 10, u1, 0.1):
    x = int((t - u0) * S)
    major = abs(round(t * 10)) % 5 == 0
    dr.line([(x, 0), (x, Hp)], fill=(0, 255, 255) if major else (0, 90, 90), width=1)
    if major:
        dr.text((x + 2, 2), f'{t:.1f}', fill=(0, 255, 255))
for t in np.arange(np.ceil(v0 * 10) / 10, v1, 0.1):
    y = int((v1 - t) * S)
    major = abs(round(t * 10)) % 5 == 0
    dr.line([(0, y), (Wp, y)], fill=(255, 0, 255) if major else (90, 0, 90), width=1)
    if major:
        dr.text((2, y + 2), f'{t:.1f}', fill=(255, 0, 255))
out = os.path.join(B, f'map_{view}{"_cls" if use_cls else ""}.png')
im.save(out)
print(out, im.size)
