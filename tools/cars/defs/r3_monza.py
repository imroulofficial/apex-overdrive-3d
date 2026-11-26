"""Monza, remastered from its original hyper3d model (batch 3): the source body as it is
(tools/cars/remaster), with the scripted Monza's wheels, brakes, cabin, driver, steering wheel,
hands and supercar cockpit. FILE / ID / dimensions are the game's mz_monza."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('mz_monza', globals())
import remaster_kit as rk  # noqa: E402

REAR_SEAT = False          # two-seater
DASH_HALF = 0.76
rk.setup(globals(), 'mz_monza')
EXHAUST = [(0.33, -0.12, 0.042), (0.33, 0.12, 0.042)]   # twin pipes in the diffuser


def build(q):
    return rk.build(globals(), q)


def cockpit(q=1.0):
    return rk.cockpit(globals(), q)


META = rk.meta(globals())
