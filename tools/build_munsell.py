#!/usr/bin/env python3
"""
Builds data/munsell-renotation.js: the Munsell renotation data, in a compact
form the app loads like any script (so it also works from a local file).

The data is the "real" table of Newhall, Nickerson & Judd, "Final report of
the O.S.A. subcommittee on the spacing of the Munsell colors", JOSA 33(7),
1943: the CIE x, y (Illuminant C, 2 degree observer) of each Munsell hue,
value and chroma that lies inside the MacAdam limits. The data file
(real.dat) was published by RIT's Munsell Color Science Laboratory; this
script reads a copy of it.

Only x and y are kept. The file's Y is the 1943 value function scaled by
1 / 0.975; the app gets value from Y with the ASTM D1535 function instead.

Usage:
    python3 tools/build_munsell.py              # download a copy and build
    python3 tools/build_munsell.py real.dat     # use a local copy

Output: VST.munsellData = { values, hues, loci }, where loci[v][h] lists
x, y (times 10000) for chroma 2, 4, 6, ... at values[v] and hue index h.
Hue index h is the Munsell hue number / 2.5: 0 = 10RP, 1 = 2.5R, 2 = 5R,
... 4 = 10R, 5 = 2.5YR, ... 39 = 7.5RP.
"""
import json
import os
import sys
import urllib.request

SOURCE = 'https://raw.githubusercontent.com/cwickham/munsell/master/inst/raw/real.dat'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'munsell-renotation.js')
FAMILIES = ['R', 'YR', 'Y', 'GY', 'G', 'BG', 'B', 'PB', 'P', 'RP']


def hue_index(hue):
    step = float(hue.rstrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
    family = FAMILIES.index(hue[len(hue.rstrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ')):])
    return round((family * 10 + step) / 2.5) % 40


def main():
    if len(sys.argv) > 1:
        text = open(sys.argv[1]).read()
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as r:
            text = r.read().decode('ascii')
    rows = [line.split() for line in text.splitlines()[1:] if line.strip()]
    values = sorted({int(r[1]) for r in rows})
    loci = {(v, h): {} for v in values for h in range(40)}
    for hue, v, c, x, y, _Y in rows:
        loci[(int(v), hue_index(hue))][int(c)] = (round(float(x) * 10000), round(float(y) * 10000))
    out = []
    for v in values:
        plane = []
        for h in range(40):
            chromas = sorted(loci[(v, h)])
            assert chromas == list(range(2, 2 * len(chromas) + 1, 2)), (v, h, chromas)
            plane.append([n for c in chromas for n in loci[(v, h)][c]])
        out.append(plane)
    data = {'values': values, 'hues': 40, 'loci': out}
    with open(OUT, 'w') as f:
        f.write('/*\n')
        f.write(' * Munsell renotation data: Newhall, Nickerson & Judd (1943), JOSA 33(7);\n')
        f.write(" * data file (real.dat) from RIT's Munsell Color Science Laboratory.\n")
        f.write(' * CIE x, y (Illuminant C) times 10000 for chroma 2, 4, 6, ... at each value\n')
        f.write(' * and hue. Built by tools/build_munsell.py; see there for the layout.\n')
        f.write(' */\n')
        f.write('(function (root) {\n  (root.VST = root.VST || {}).munsellData = ')
        f.write(json.dumps(data, separators=(',', ':')))
        f.write(';\n})(typeof window !== \'undefined\' ? window : globalThis);\n')
    print(f'{len(rows)} colors, values {values[0]}-{values[-1]}, {os.path.getsize(OUT)} bytes -> {OUT}')


if __name__ == '__main__':
    main()
