#!/usr/bin/env python3
"""Scan a release AAB for the APIs behind Google Play's edge-to-edge and large-screen warnings.

Usage: scan_bundle.py <app-release.aab> [merged AndroidManifest.xml]

Disassembles every dex in the bundle with dexdump (Android build-tools) and lists each class
that calls an API Android 15 deprecated for edge-to-edge / window display, grouped by library.
Exits 1 when any of them is called from our own code (com.redpenstudio) or a Capacitor plugin
(com.getcapacitor), or when the merged manifest locks orientation / resizability on our
activity. Calls inside androidx (version-gated back-compat paths, EdgeToEdge itself) and
Google Play services are reported but cannot be removed from here.
"""
import glob
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

DEPRECATED = {
    'Landroid/view/Window;.setStatusBarColor': 'Window.setStatusBarColor',
    'Landroid/view/Window;.setNavigationBarColor': 'Window.setNavigationBarColor',
    'Landroid/view/Window;.setNavigationBarDividerColor': 'Window.setNavigationBarDividerColor',
    'Landroid/view/Window;.setDecorFitsSystemWindows': 'Window.setDecorFitsSystemWindows',
    'Landroid/view/View;.setSystemUiVisibility': 'View.setSystemUiVisibility',
    'Landroid/view/View;.setOnSystemUiVisibilityChangeListener': 'View.setOnSystemUiVisibilityChangeListener',
    'Landroid/view/WindowManager$LayoutParams;.layoutInDisplayCutoutMode': 'LayoutParams.layoutInDisplayCutoutMode =',
}
OURS = ('Lcom/redpenstudio/', 'Lcom/getcapacitor/')
CUTOUT_MODES = {'0': 'DEFAULT', '1': 'SHORT_EDGES', '2': 'NEVER', '3': 'ALWAYS'}
ANDROID_NS = '{http://schemas.android.com/apk/res/android}'


def dexdump_path():
    home = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or ''
    found = sorted(glob.glob(os.path.join(home, 'build-tools', '*', 'dexdump')))
    if not found:
        sys.exit('dexdump not found under $ANDROID_HOME/build-tools')
    return found[-1]


def scan_dex(dexdump, path, hits):
    out = subprocess.run([dexdump, '-d', path], capture_output=True, text=True, check=True).stdout
    cls = None
    consts = {}
    for line in out.splitlines():
        m = re.match(r"\s*Class descriptor\s*:\s*'(.+)'", line)
        if m:
            cls = m.group(1)
            continue
        if '|[' in line:  # method boundary: forget register constants
            consts = {}
        m = re.search(r'\|\s*[0-9a-f]+: const(?:/4|/16)? (v\d+), #int (-?\d+)', line)
        if m:
            consts[m.group(1)] = m.group(2)
        if 'invoke-' not in line and 'iput' not in line:
            continue
        for sig, label in DEPRECATED.items():
            if sig not in line:
                continue
            if label.endswith('='):
                if 'iput' not in line:
                    continue
                reg = re.search(r'iput \{?(v\d+)', line)
                value = consts.get(reg.group(1)) if reg else None
                label = f'{label} {CUTOUT_MODES.get(value, "computed")}'
            hits.setdefault(cls, set()).add(label)


def library(cls):
    parts = cls[1:].split('/')
    return '.'.join(parts[:3]) if len(parts) > 3 else '.'.join(parts[:-1])


def check_manifest(path):
    problems = []
    root = ET.parse(path).getroot()
    app = root.find('application')
    if app.get(ANDROID_NS + 'resizeableActivity') != 'true':
        problems.append('<application> is missing android:resizeableActivity="true"')
    for act in app.findall('activity'):
        name = act.get(ANDROID_NS + 'name', '')
        ours = name.startswith('com.redpenstudio.') or name.startswith('.')
        orient = act.get(ANDROID_NS + 'screenOrientation')
        resize = act.get(ANDROID_NS + 'resizeableActivity')
        if orient or resize == 'false':
            note = f'{name}: screenOrientation={orient} resizeableActivity={resize}'
            print(('  FAIL ' if ours else '  info ') + note)
            if ours:
                problems.append(note)
    return problems


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    dexdump = dexdump_path()
    hits = {}
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(sys.argv[1]) as aab:
        dexes = [n for n in aab.namelist() if n.endswith('.dex')]
        for name in dexes:
            scan_dex(dexdump, aab.extract(name, tmp), hits)
    print(f'Scanned {len(dexes)} dex files with {dexdump}')

    failures = []
    by_lib = {}
    for cls, labels in hits.items():
        by_lib.setdefault(library(cls), []).append((cls, labels))
        if cls.startswith(OURS):
            failures.append(f'{cls}: {", ".join(sorted(labels))}')
    if not by_lib:
        print('No deprecated edge-to-edge / window-display calls anywhere in the bundle.')
    for lib in sorted(by_lib):
        print(f'{lib}:')
        for cls, labels in sorted(by_lib[lib]):
            print(f'  {cls}  {", ".join(sorted(labels))}')

    if len(sys.argv) > 2:
        print('Merged manifest:')
        failures += check_manifest(sys.argv[2])

    if failures:
        print('FAIL: deprecated edge-to-edge APIs or restrictions in our code:')
        for f in failures:
            print('  ' + f)
        return 1
    print('OK: none in com.redpenstudio or com.getcapacitor (app + Capacitor plugins).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
