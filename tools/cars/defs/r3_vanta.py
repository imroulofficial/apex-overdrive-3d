"""Vanta EV, remastered from its original hyper3d model (batch 3): the source body as it is
(tools/cars/remaster), with the scripted Vanta's wheels, brakes, cabin, driver, steering wheel,
hands and modern-EV cockpit (screens). FILE / ID / dimensions are the game's rp1_vanta."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('rp1_vanta', globals())
import remaster_kit as rk  # noqa: E402

rk.setup(globals(), 'rp1_vanta')
# the source's wheels: 20-inch, bright turbine blades out to a silver lip (low sidewall)
RIM_R = 0.254
RIM_PAINT = (0.30, 0.31, 0.33)
TYRE_TEXT_R = (0.066, 0.021)
EXHAUST = [(0.30, 0.0, 0.022)]   # electric: one small dark emitter in the diffuser (the nitro flames come out of it)


def build(q):
    return rk.build(globals(), q)


def cockpit(q=1.0):
    return rk.cockpit(globals(), q)


META = rk.meta(globals())
