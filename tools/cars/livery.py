"""Livery painting helpers shared by every car design (tools/cars/defs/*.py `livery()`).

build_car.py bakes, per texel of an atlas, the car-frame position P (H, W, 3) and normal N in
game axes (x forward, y up, z right, metres) plus a coverage mask. A design's
`livery(group, P, N, valid)` then paints with these helpers in plain numpy:

    group 'Body'      -> {'layers': [(mask, linear_rgb or None, roughness or None), ...],
                          'shade': optional multiplier}
    group 'CarPaint'  -> {'shade': multiplier}  (the factory paint colour stays the colour; black
                          decals and panel lines go in as shade, so any player paint stays clean)

Everything is resolution independent: the same function paints the 2048 showroom atlas and
the 512 drive one.
"""

import os

import numpy as np

FONT = next((f for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                         '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf') if os.path.exists(f)), None)
FONT_OBL = next((f for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',) if os.path.exists(f)), FONT)
_TEXT = {}


def text_mask(text, oblique=True, px=160):
    """White-on-black text as a float mask (h, w), tight-cropped with a small margin."""
    key = (text, oblique, px)
    if key in _TEXT:
        return _TEXT[key]
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(FONT_OBL if oblique else FONT, px) if FONT else ImageFont.load_default()
    d = ImageDraw.Draw(Image.new('L', (8, 8)))
    bb = d.textbbox((0, 0), text, font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    pad = px // 10
    im = Image.new('L', (w + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(im).text((pad - bb[0], pad - bb[1]), text, fill=255, font=font)
    m = np.asarray(im, dtype=np.float32) / 255.0
    _TEXT[key] = m
    return m


def number_mask(text, px=220):
    """Race number with a thick outline ring (number, outline) masks of the same size."""
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype(FONT, px) if FONT else ImageFont.load_default()
    d = ImageDraw.Draw(Image.new('L', (8, 8)))
    bb = d.textbbox((0, 0), text, font=font, stroke_width=px // 12)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    pad = px // 8
    num = Image.new('L', (w + 2 * pad, h + 2 * pad), 0)
    out = Image.new('L', num.size, 0)
    ImageDraw.Draw(out).text((pad - bb[0], pad - bb[1]), text, fill=255, font=font, stroke_width=px // 12,
                             stroke_fill=255)
    ImageDraw.Draw(num).text((pad - bb[0], pad - bb[1]), text, fill=255, font=font)
    return np.asarray(num, np.float32) / 255.0, np.asarray(out, np.float32) / 255.0


def _sample(img, u, v):
    """Bilinear sample of img (h, w) at u, v in 0..1 (v = 0 at the image's top)."""
    h, w = img.shape
    x = np.clip(u * (w - 1), 0, w - 1)
    y = np.clip(v * (h - 1), 0, h - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = x - x0, y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy
            + img[y1, x1] * fx * fy)


def stamp(P, N, valid, img, origin, u_axis, v_axis, width, facing=None, min_dot=0.25, depth=0.06):
    """Projects img onto the surface: centred at origin, u_axis to the image's right, v_axis to
    its top, `width` metres wide (height from the image's aspect). Only texels within `depth`
    of the image plane and (optionally) facing `facing` are stamped. Returns a 0..1 mask."""
    u_axis = np.asarray(u_axis, float) / np.linalg.norm(u_axis)
    v_axis = np.asarray(v_axis, float) / np.linalg.norm(v_axis)
    w_axis = np.cross(u_axis, v_axis)
    height = width * img.shape[0] / img.shape[1]
    rel = P - np.asarray(origin, float)
    u = rel @ u_axis / width + 0.5
    v = rel @ v_axis / height + 0.5
    ok = valid & (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1) & (np.abs(rel @ w_axis) < depth)
    if facing is not None:
        ok &= (N @ np.asarray(facing, float)) > min_dot
    out = np.zeros(P.shape[:2], np.float32)
    out[ok] = _sample(img, u[ok], 1 - v[ok])
    return out


def band(d, lo, hi, soft):
    """1 where lo <= d <= hi, soft edges of width `soft`."""
    return np.clip((d - lo) / soft + 0.5, 0, 1) * np.clip((hi - d) / soft + 0.5, 0, 1)


def line(d, width, soft=None):
    """A painted line where |d| < width / 2 (d: signed distance in metres)."""
    soft = soft or width * 0.5
    return band(d, -width / 2, width / 2, soft)


def box(P, lo, hi):
    """Texels inside an axis-aligned box (lo, hi in car frame)."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    return np.all((P >= lo) & (P <= hi), axis=-1)


def both_sides(fn):
    """Runs fn(sign) for the right (+1) and left (-1) side and keeps the max."""
    return np.maximum(fn(1), fn(-1))
