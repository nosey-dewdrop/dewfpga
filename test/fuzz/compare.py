#!/usr/bin/env python3
"""compare.py <rtl.trace> <net.trace>: the two traces line by line (cycle, then one %b per output).
A bit the RTL knows (0 or 1) must be the same bit in the netlist; an x or z in the RTL matches anything (a
register nobody started); an x or z in the netlist where the RTL knows the bit is a difference. Exit 1 and
the first differing line on a difference."""
import sys
a = open(sys.argv[1]).read().split("\n")
b = open(sys.argv[2]).read().split("\n")
a = [l for l in a if l.strip()]
b = [l for l in b if l.strip()]
if len(a) != len(b):
    print("MISMATCH: %d lines in the RTL trace, %d in the netlist trace" % (len(a), len(b)))
    sys.exit(1)
ndiff = 0
for la, lb in zip(a, b):
    fa, fb = la.split(), lb.split()
    if len(fa) != len(fb) or any(len(x) != len(y) for x, y in zip(fa, fb)):
        print("MISMATCH: shape  rtl: %s  net: %s" % (la, lb)); sys.exit(1)
    for x, y in zip(fa[1:], fb[1:]):
        for cx, cy in zip(x, y):
            if cx in "01" and cx != cy:
                if ndiff == 0:
                    print("MISMATCH: cycle %s  rtl: %s  net: %s" % (fa[0], " ".join(fa[1:]), " ".join(fb[1:])))
                ndiff += 1
                break
if ndiff:
    print("%d of %d cycles differ" % (ndiff, len(a)))
    sys.exit(1)
print("EQUAL: %d cycles" % len(a))
