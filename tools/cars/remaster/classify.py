"""Step 2: one class per source face (numpy only).

    python3 tools/cars/remaster/classify.py rp1_vanta [--stats]

Classes: 0 trim (black/grey/chrome parts, keeps the source texture), 1 paint (CarPaint, flat
factory colour), 2 glass, 3 headlamp, 4 taillamp, 5 arch cap (dark liner).
Paint by the texture's HSV (rules from tools/models/manifest.json, tuned here); glass and lamps
by the texture inside per-car regions (game frame), then a majority filter over the face
neighbours so the classes do not speckle.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cars_cfg import CFG  # noqa: E402

car = sys.argv[1]
B = os.path.join(HERE, '..', 'build', 'remaster', car)
d = np.load(os.path.join(B, f'{car}_src.npz'))
V, F, UV, CAP = d['V'], d['F'], d['UV'], d['CAP']
cfg = CFG[car]
tex = np.asarray(Image.open(os.path.join(B, f'{car}_src.png')).convert('RGB')).astype(np.float32) / 255
H, W = tex.shape[:2]


def sample(uv):
    x = np.clip((uv[..., 0] % 1.0) * (W - 1), 0, W - 1).astype(int)
    y = np.clip((1 - uv[..., 1] % 1.0) * (H - 1), 0, H - 1).astype(int)
    return tex[y, x]


# colour per face: mean of the three corners and the centroid
c = (sample(UV[:, 0]) + sample(UV[:, 1]) + sample(UV[:, 2]) + sample(UV.mean(1))) / 4
mx, mn = c.max(1), c.min(1)
val = mx
sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
r, g, b = c[:, 0], c[:, 1], c[:, 2]
hue = np.zeros(len(c))
dlt = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / dlt) % 6, np.where(mx == g, (b - r) / dlt + 2, (r - g) / dlt + 4)) * 60

P = V[F]
cen = P.mean(1)
nrm = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
area = np.linalg.norm(nrm, axis=1) * 0.5
nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)


def in_box(box):
    m = np.ones(len(cen), bool)
    for ax, key in enumerate('xyz'):
        if key in box:
            lo, hi = box[key]
            m &= (cen[:, ax] >= lo) & (cen[:, ax] <= hi)
    if 'az' in box:  # |z|
        lo, hi = box['az']
        m &= (np.abs(cen[:, 2]) >= lo) & (np.abs(cen[:, 2]) <= hi)
    for ax, key in enumerate(('nx', 'ny', 'nz')):
        if key in box:
            lo, hi = box[key]
            m &= (nrm[:, ax] >= lo) & (nrm[:, ax] <= hi)
    if 'anz' in box:
        lo, hi = box['anz']
        m &= (np.abs(nrm[:, 2]) >= lo) & (np.abs(nrm[:, 2]) <= hi)
    return m


def colour_rule(rule):
    m = np.ones(len(c), bool)
    if 'hue' in rule:
        dh = np.abs((hue - rule['hue'] + 180) % 360 - 180)
        m &= dh <= rule.get('hueTol', 15)
    for k, arr in (('minSat', sat), ('minVal', val)):
        if k in rule:
            m &= arr >= rule[k]
    for k, arr in (('maxSat', sat), ('maxVal', val)):
        if k in rule:
            m &= arr <= rule[k]
    return m


C = np.zeros(len(F), np.int8)
paint = colour_rule(cfg['paint'])
for box in cfg.get('paint_not', []):
    paint &= ~in_box(box)
C[paint] = 1
for cls, key in ((2, 'glass'), (3, 'head'), (4, 'tail')):
    for item in cfg.get(key, []):
        m = in_box(item['box'])
        if 'rule' in item:
            m &= colour_rule(item['rule'])
        C[m] = cls
for box in cfg.get('glass_not', []):
    C[in_box(box.get('box', box)) & (C == 2)] = 0

# majority filter over edge neighbours (caps are fixed)
E = {}
for i, (a, b_, c_) in enumerate(F):
    for u, v in ((a, b_), (b_, c_), (c_, a)):
        E.setdefault((min(u, v), max(u, v)), []).append(i)
nb = [[] for _ in range(len(F))]
for fs in E.values():
    if len(fs) == 2:
        nb[fs[0]].append(fs[1])
        nb[fs[1]].append(fs[0])
for _ in range(cfg.get('smooth', 6)):
    C2 = C.copy()
    for i in range(len(F)):
        ns = nb[i]
        if len(ns) >= 2:
            vals = C[ns]
            if (vals != C[i]).all() and (vals == vals[0]).all():
                C2[i] = vals[0]
            elif len(ns) == 3 and (vals != C[i]).sum() >= 2:
                # two of three neighbours agree on another class: take it (smooths edges)
                v, cnt = np.unique(vals[vals != C[i]], return_counts=True)
                if cnt.max() >= 2:
                    C2[i] = v[np.argmax(cnt)]
    C = C2
C[CAP.astype(bool)] = 5


def components(C):
    lab = -np.ones(len(C), np.int64)
    comps = []
    for i in range(len(C)):
        if lab[i] >= 0:
            continue
        stack, comp = [i], []
        lab[i] = len(comps)
        while stack:
            x = stack.pop()
            comp.append(x)
            for y in nb[x]:
                if lab[y] < 0 and C[y] == C[i]:
                    lab[y] = len(comps)
                    stack.append(y)
        comps.append(comp)
    return comps


# Small islands of a class (speckles, jagged bits along a window edge) take the class their
# neighbours have most of; glass, which is cut out of the body, gets a bigger threshold so the
# window openings come out as clean shapes.
MIN_AREA = {0: 0.0015, 1: 0.0015, 2: 0.010, 3: 0.0004, 4: 0.0004}
for it in range(3):
    changed = 0
    for comp in components(C):
        k = int(C[comp[0]])
        if k == 5 or area[comp].sum() >= MIN_AREA.get(k, 0.001):
            continue
        cs = set(comp)
        around = [int(C[y]) for x in comp for y in nb[x] if y not in cs]
        if not around:
            continue
        vals, cnt = np.unique(around, return_counts=True)
        C[comp] = vals[np.argmax(cnt)]
        changed += 1
    print(f'  cleanup pass {it}: {changed} islands reassigned', flush=True)
    if not changed:
        break

names = ['trim', 'paint', 'glass', 'head', 'tail', 'cap']
tot = area.sum()
print(car, ' '.join(f'{n} {area[C == k].sum() / tot * 100:.1f}%' for k, n in enumerate(names)))
# factory colour: median of the paint texels
fac = np.median(c[C == 1], axis=0) if (C == 1).any() else np.array([0.5, 0.5, 0.5])
print('factory paint (sRGB)', np.round(fac, 3))
np.savez_compressed(os.path.join(B, f'{car}_cls.npz'), V=V, F=F, UV=UV, C=C, CAP=CAP, factory=fac)
if '--stats' in sys.argv:
    # colour histogram of the faces above the belt for tuning the glass rules
    up = cen[:, 1] > cfg.get('belt', 1.0)
    for k in range(6):
        m = up & (C == k)
        if m.any():
            print(names[k], 'above belt: hue', np.percentile(hue[m], [10, 50, 90]).round(0), 'sat',
                  np.percentile(sat[m], [10, 50, 90]).round(2), 'val', np.percentile(val[m], [10, 50, 90]).round(2))
