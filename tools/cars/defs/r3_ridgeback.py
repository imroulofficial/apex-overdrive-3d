"""Ridgeback, remastered from its original hyper3d model (batch 3): the source body as it is
(tools/cars/remaster), with the scripted Ridgeback's wheels, brakes, cabin, driver, steering wheel,
hands and modern SUV cockpit. FILE / ID / dimensions are the game's rb_ridgeback."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from inherit import inherit  # noqa: E402

inherit('rb_ridgeback', globals())
import remaster_kit as rk  # noqa: E402

rk.setup(globals(), 'rb_ridgeback')
EXHAUST = [(0.47, -0.60, 0.036)]   # one pipe under the left rear corner


def build(q):
    return rk.build(globals(), q)


def cockpit(q=1.0):
    return rk.cockpit(globals(), q)


META = rk.meta(globals())
