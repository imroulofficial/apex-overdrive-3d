"""Design inheritance for car files in defs/.

A closed car shares most of its machinery with the Aurelia (subdivision cage body, canopy and
glass panels, sliding windows, ray hits on the shell, cabin, gloved hands, cockpit file, META).
Instead of copying that code, a design runs its parent file in its own namespace and then
redefines what differs:

    from inherit import inherit
    inherit('ag_aurelia', globals())      # every name of the parent, as defaults
    LENGTH = 4.15                         # then the child's own constants, curves and parts
    def grille(q): ...
    META = make_meta()                    # rebuilt from the child's values

The parent's functions look their globals up at call time in the child's namespace, so they use
the child's curves and constants and call the child's versions of any part it redefines. Values
the parent computes at import time (ARCH, TYRE_HW, GLOW_C, HELMET_C, META) must be set again by
the child.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))


def inherit(name, g):
    path = os.path.join(HERE, 'defs', name + '.py')
    with open(path) as f:
        code = compile(f.read(), path, 'exec')
    keep = {k: g[k] for k in ('__name__', '__file__', '__doc__') if k in g}
    exec(code, g)
    g.update(keep)
