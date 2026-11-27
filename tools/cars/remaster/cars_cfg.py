"""Per-car rules for the remaster pipeline (game frame metres: x forward, y up, z right).

Boxes: x/y/z ranges, az = |z| range, nx/ny/nz face-normal ranges, anz = |normal z| range.
Rules: hue/hueTol, minSat/maxSat, minVal/maxVal on the source texture (sRGB 0..1).
Regions picked from the orthographic maps (projmap.py) of the welded sources.
"""

NOT_RED = {'maxSat': 0.35}

CFG = {
    'rp1_vanta': {
        'src': 'New Car 3.glb',
        'paint': {'maxSat': 0.12, 'minVal': 0.70},
        'belt': 1.07,
        'door': [-0.40, 0.72],
        'glass': [
            # side glass, windscreen, panoramic roof and the hatch glass: the grey (not white, not
            # black) texels above the belt
            {'box': {'x': [-1.80, 1.16], 'y': [1.06, 1.62], 'az': [0.0, 0.96]},
             'rule': {'minVal': 0.10, 'maxVal': 0.69}},
            # the blacked-out canopy (windscreen, glass roof, hatch glass) is glass whatever the
            # texture says: the AI painted white reflections onto it
            {'box': {'x': [-1.74, 1.13], 'y': [1.30, 1.65], 'az': [0.0, 0.60]}},
            {'box': {'x': [-2.30, -1.55], 'y': [1.12, 1.45], 'az': [0.0, 0.60], 'nx': [-1.0, -0.25]}},
            {'box': {'x': [0.50, 1.15], 'y': [1.06, 1.45], 'az': [0.0, 0.60], 'ny': [0.3, 1.0]}},
        ],
        # the roof spoiler (black) sits over the end of the glass roof
        'glass_not': [{'box': {'x': [-2.20, -1.76], 'y': [1.36, 1.70]}}],
        # the panoramic roof stays the source's black roof (lods.gloss_black)
        'roof_black': [{'x': [-2.25, 0.70], 'y': 1.40, 'ny': 0.55}],
        'head': [{'box': {'x': [1.55, 2.32], 'y': [0.70, 0.96], 'az': [0.25, 0.98], 'nx': [-0.2, 1.0]},
                  'rule': {'maxVal': 0.69}}],
        'tail': [{'box': {'x': [-2.33, -1.68], 'y': [0.92, 1.13], 'nx': [-1.0, 0.3]},
                  'rule': {'hue': 0, 'hueTol': 30, 'minSat': 0.30}}],
    },
    'mz_monza': {
        'src': 'New Car 7.glb',
        'paint': {'hue': 0, 'hueTol': 15, 'minSat': 0.5, 'minVal': 0.3},
        'belt': 0.90,
        'door': [-0.72, 0.56],
        'glass': [
            {'box': {'x': [-0.93, 0.52], 'y': [0.88, 1.31], 'az': [0.50, 1.0], 'anz': [0.30, 1.0]}, 'rule': NOT_RED},
            {'box': {'x': [0.16, 1.12], 'y': [0.93, 1.33], 'az': [0.0, 0.66], 'ny': [0.25, 1.0]}, 'rule': NOT_RED},
        ],
        'head': [{'box': {'x': [1.55, 2.33], 'y': [0.58, 0.82], 'az': [0.35, 0.98]}, 'rule': {'minVal': 0.45, 'maxSat': 0.35}}],
        'tail': [{'box': {'x': [-2.36, -1.95], 'y': [0.62, 0.88], 'az': [0.25, 1.0], 'nx': [-1.0, 0.2]},
                  'rule': {'hue': 0, 'hueTol': 25, 'minSat': 0.5, 'maxVal': 0.75}}],
    },
    'rpx_hyperion': {
        'src': 'New Car 2.glb',
        'paint': {'hue': 50, 'hueTol': 15, 'minSat': 0.4, 'minVal': 0.3},
        'belt': 0.76,
        'door': [-0.66, 0.52],
        'glass': [
            {'box': {'x': [-0.66, 0.50], 'y': [0.74, 1.13], 'az': [0.32, 0.80], 'anz': [0.30, 1.0]},
             'rule': {'maxSat': 0.30, 'minVal': 0.06}},
            {'box': {'x': [0.30, 1.06], 'y': [0.78, 1.12], 'az': [0.0, 0.56], 'ny': [0.25, 1.0]},
             'rule': {'maxSat': 0.30, 'minVal': 0.06}},
        ],
        'head': [{'box': {'x': [1.58, 2.34], 'y': [0.48, 0.72], 'az': [0.35, 0.98]}, 'rule': {'minVal': 0.45, 'maxSat': 0.35}}],
        'tail': [{'box': {'x': [-2.37, -1.72], 'y': [0.60, 0.80], 'nx': [-1.0, 0.35]},
                  'rule': {'hue': 0, 'hueTol': 30, 'minSat': 0.30}}],
    },
    'rb_ridgeback': {
        'src': 'New Car 8.glb',
        'paint': {'maxSat': 0.15, 'minVal': 0.09, 'maxVal': 0.45},
        # roof rack, tailgate spare wheel, bull bar and the black lower cladding are trim
        'paint_not': [{'y': [1.93, 3.0]}, {'x': [-3.0, -2.27], 'az': [0.0, 0.56], 'y': [0.80, 1.80]}, {'x': [2.28, 3.0]},
                      {'y': [0.0, 0.70]}],
        'belt': 1.30,
        # roof rack, bull bar and spare wheel: many thin parts, many vertices per triangle; a
        # smaller showroom shell keeps the file in its 1.76 MB budget
        'body_tris': 22000,
        'door': [0.0, 0.84],
        'glass': [
            # side windows (front door, rear door, rear quarter), windscreen, tailgate glass
            {'box': {'x': [-1.84, -1.16], 'y': [1.36, 1.79], 'az': [0.70, 1.0], 'anz': [0.6, 1.0]}},
            {'box': {'x': [-1.02, -0.18], 'y': [1.31, 1.78], 'az': [0.70, 1.0], 'anz': [0.6, 1.0]}},
            {'box': {'x': [0.02, 0.80], 'y': [1.30, 1.79], 'az': [0.70, 1.0], 'anz': [0.6, 1.0]}},
            {'box': {'x': [0.45, 1.08], 'y': [1.42, 1.86], 'az': [0.0, 0.74], 'nx': [0.25, 1.0], 'ny': [0.2, 1.0]}},
            {'box': {'x': [-2.42, -1.95], 'y': [1.42, 1.86], 'az': [0.0, 0.72], 'nx': [-1.0, -0.6]}},
        ],
        'head': [{'box': {'x': [1.88, 2.42], 'y': [0.88, 1.22], 'az': [0.30, 0.90], 'nx': [0.2, 1.0]},
                  'rule': {'minVal': 0.40}}],
        'tail': [{'box': {'x': [-2.42, -1.90], 'y': [0.86, 1.36], 'az': [0.55, 1.0]},
                  'rule': {'hue': 0, 'hueTol': 30, 'minSat': 0.30}}],
    },
}
