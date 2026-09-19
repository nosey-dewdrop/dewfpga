#!/usr/bin/env python3
"""XDC ile kodun port isimlerini karşılaştırır; derlemeden ÖNCE anlaşılır hata verir.
Kullanım: check_xdc.py <top.json> <top.xdc>"""
import json, re, sys

if len(sys.argv) != 3:
    sys.exit("kullanim: check_xdc.py <json> <xdc>")

jf, xf = sys.argv[1], sys.argv[2]

# 1) tasarımdaki portlar (yosys json'undan)
design = json.load(open(jf))
top = None
for name, mod in design["modules"].items():
    if mod.get("attributes", {}).get("top"):
        top = (name, mod); break
if top is None:
    name = list(design["modules"])[0]; top = (name, design["modules"][name])
tname, tmod = top

ports = set()
for p, info in tmod.get("ports", {}).items():
    n = len(info.get("bits", []))
    if n == 1: ports.add(p)
    else: ports.update(f"{p}[{i}]" for i in range(n))

# 2) XDC'de geçen portlar
xdc_ports = set()
for line in open(xf):
    line = line.split("#")[0]
    for m in re.finditer(r"get_ports\s*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", line):
        xdc_ports.add(m.group(1))

missing = sorted(ports - xdc_ports)   # kodda var, XDC'de yok
extra   = sorted(xdc_ports - ports)   # XDC'de var, kodda yok

if missing:
    print(f"HATA: bu portlarin XDC'de pin atamasi YOK ({tname}):")
    for p in missing: print(f"   - {p}")
    print("   -> Basys3_Master.xdc'den ilgili satirlari kopyala.")
if extra:
    print("HATA: XDC'de olup kodda OLMAYAN port (yazim hatasi olabilir):")
    for p in extra: print(f"   - {p}")
    print("   -> XDC'deki ismi modulundeki port ismiyle ayni yaz.")

if missing or extra:
    sys.exit(1)
print(f"XDC kontrolu OK: {len(ports)} port, hepsi eslendi.")
