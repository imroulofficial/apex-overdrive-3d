"""Hyperion, remastered from its original hyper3d model (batch 3): the source body as it is
(tools/cars/remaster), with the scripted Hyperion's wheels, brakes, cabin, driver, steering wheel,
hands and hypercar cockpit. FILE / ID / dimensions are the game's rpx_hyperion."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('rpx_hyperion', globals())
import remaster_kit as rk  # noqa: E402

REAR_SEAT = False          # two-seater
DASH_HALF = 0.76
rk.setup(globals(), 'rpx_hyperion')
EXHAUST = [(0.40, -0.09, 0.045), (0.40, 0.09, 0.045)]   # centre-exit pipes over the diffuser


def build(q):
    return rk.build(globals(), q)


def cockpit(q=1.0):
    return rk.cockpit(globals(), q)


META = rk.meta(globals())
