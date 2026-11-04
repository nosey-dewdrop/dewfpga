#!/usr/bin/env python3
"""The home page, in English and Turkish, from one template.

  python3 docs/home/build.py

writes site/index.html and site/tr/index.html from docs/home/page.tmpl.html and the strings
below, site/home.js from the scripts of this folder (the ascii engine, the desk, the flow, the
board, the traces, the page) and site/home.css, then runs docs/nav.py, which fills the nav
and the footer. The drawings are the same in both languages: what the laptop's screen shows
is the real program's output, in English. The output is committed; a second run changes no
byte. site/og.png is the hero, rendered at 1200x630 (scene b, the waveform drawn)."""
import hashlib, html, json, os, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
HERE = os.path.dirname(os.path.abspath(__file__))
JS = ["engine.js", "models.js", "content.js", "b.js", "flow.js", "board.js", "pcb.js", "vis.js", "page.js"]
BASE = "https://nosey-dewdrop.github.io/dewfpga/"

STR = {
    "en": {
        "lang": "en", "locale": "en_US", "url": BASE, "hl": "",
        "title": "dewfpga · systemverilog to basys 3 on apple silicon, no vivado",
        "description": "write systemverilog on an apple silicon mac, simulate it, open the waveform in surfer or the browser and flash a digilent basys 3. no vivado, no virtual machine, no rosetta. free and mit licensed.",
        "og_description": "write systemverilog on an apple silicon mac, simulate it, see the waveform and flash a basys 3. no vivado, no virtual machine. free, mit.",
        "og_alt": "a macbook drawn in ascii runs dewfpga sim --wave and the waveform draws in surfer, a basys 3 waits beside it on its usb cable",
        "pcb_alt": "a pcb trace leaves the basys 3 through its pmod header and runs down the page through small chips named after the lab modules, mux8, mux2, dec3, room_monitor, top_mux, mux4, dec2 and top_decoder, to the coffee cup at the end",
        "scene_alt": "a macbook on a desk runs dewfpga sim --wave in its terminal, surfer draws the waveform of tb_room_monitor, a basys 3 waits on a usb cable beside it",
        "h1": "write systemverilog on an apple silicon mac and flash a basys 3",
        "hero_p": "no vivado, no virtual machine, no rosetta",
        "h_install": "install the toolchain, the same line updates it", "h_sim": "runs the testbench",
        "h_wave": "opens the waveform in surfer", "h_flash": "loads it onto the board",
        "copy": "copy",
        "how_h": "write, simulate, waveform, flash",
        "step0": "write", "step1": "simulate", "step2": "waveform", "step3": "flash",
        "say0": "write it in your own editor", "say1": "run the testbench", "say2": "open the waveform in surfer",
        "say3": "build it and load the board", "note3": "4.1 s from .sv to .bit on an m2 with 8 gb",
        "board_alt": "a digilent basys 3 seen from above: sixteen switches along the front edge with an led over each, the four digit seven segment display, five buttons in a cross, the artix-7 in the middle, the pmod headers on both sides, vga, usb and the prog port with its cable at the back",
        "board_group": "switches, leds, digits and buttons of the basys 3",
        "board_h": "the board",
        "board_line": "a basys 3 running <code>assign led = sw</code>. flip a switch or click an led.",
        "board_comment": "a 0 lights a segment and a digit",
        "board_note": "sw, led, btn, seg, an and clk find their pins on their own, no pin file",
        "board_swipe": "slide the board sideways for every switch",
        "cli_more": "every command",
        "cli_line": "install in one line, about 4 minutes, 0.3 gb on disk. vivado asks for 50 to 100 gb.",
        "g_install": "install",
        "docs_h": "docs", "docs_more": "the whole guide", "paper_link": "the guide as a pdf",
        "paper_alt": "the first page of the guide, how do you run cs223 labs on a mac without vivado, with its nine sections",
        "d0": "before you start", "d0p": "a basys 3, its micro usb cable, a usb-c adapter and homebrew",
        "d1": "install in one line", "d1p": "what the line puts where, and dewfpga check to see every piece",
        "d2": "your own lab", "d2p": "the .sv files and the .xdc in one folder, then dewfpga flash",
        "d3": "vs code", "d3p": "a run on basys3 button in the editor",
        "d4": "if it stops", "d4p": "every error it prints, with the fix",
        "d5": "what can it not do?", "d5p": "no ip catalog, only the basys 3 and apple silicon",
        "thanks_label": "thanks", "cup_alt": "a cup of coffee",
        "thanks": "dewfpga is free and open source. if you want to say thanks,", "coffee": "buy me a coffee",
        "js": {
            "alt": [
                "the laptop up close, the room_monitor module of cs223 lab 2 being typed into cs223_lab2.sv",
                "the terminal runs dewfpga sim tb_room_monitor, 4096 cases, 0 errors",
                "surfer opens tb_room_monitor.vcd and its waveform draws in green, en, room, sensor, alarm",
                "dewfpga flash top_monitor loads the board, the camera follows the cable to the basys 3 and its alarm led lights",
            ],
            "terms": {
                "check": "is every piece in place",
                "new": "blink example with a vs code task", "vscode": "set up the editor integration",
                "waves": "you can open the simulations in the browser, in software that reads waveforms (surfer), or both",
                "tops": "simulator for the tops, opens with surfer", "browser": "or in the browser", "tbs": "opens testbenches",
                "both": "surfer and the browser",
            },
            "copy": ["copy", "done", "copied", "select"], "digit": "digit",
            "note": "the page of the error iverilog-refused, with its fix",
        },
        "ld_description": "A command-line toolchain for macOS on Apple Silicon that simulates SystemVerilog, opens the waveform in Surfer or the browser, builds the bitstream and flashes a Digilent Basys 3, without Vivado.",
    },
    "tr": {
        "lang": "tr", "locale": "tr_TR", "url": BASE + "tr/", "hl": ' hreflang="en"',
        "title": "dewfpga · apple silicon mac'te systemverilog'dan basys 3'e, vivado olmadan",
        "description": "apple silicon bir mac'te systemverilog yaz, simüle et, dalga formunu surfer'da ya da tarayıcıda aç ve digilent basys 3'e yükle. vivado yok, sanal makine yok, rosetta yok. ücretsiz ve mit lisanslı.",
        "og_description": "apple silicon bir mac'te systemverilog yaz, simüle et, dalga formuna bak ve basys 3'e yükle. vivado yok, sanal makine yok. ücretsiz, mit.",
        "og_alt": "ascii çizilmiş bir macbook dewfpga sim --wave çalıştırıyor, surfer dalga formunu çiziyor, yanında usb kablosunun ucunda bir basys 3 bekliyor",
        "pcb_alt": "bir pcb yolu basys 3'ten pmod konnektörüyle çıkıyor ve sayfa boyunca lab modüllerinin adını taşıyan küçük çiplerden, mux8, mux2, dec3, room_monitor, top_mux, mux4, dec2 ve top_decoder'dan geçip sondaki kahve fincanına varıyor",
        "scene_alt": "masadaki bir macbook terminalinde dewfpga sim --wave çalıştırıyor, surfer tb_room_monitor'ün dalga formunu çiziyor, yanında usb kablosunda bir basys 3 bekliyor",
        "h1": "apple silicon bir mac'te systemverilog yaz ve basys 3'e yükle",
        "hero_p": "vivado yok, sanal makine yok, rosetta yok",
        "h_install": "toolchain'i kur, aynı satır günceller de", "h_sim": "testbench'i çalıştırır",
        "h_wave": "dalga formunu surfer'da açar", "h_flash": "karta yükler",
        "copy": "kopya",
        "how_h": "yaz, simüle et, dalga formu, yükle",
        "step0": "yaz", "step1": "simüle et", "step2": "dalga formu", "step3": "yükle",
        "say0": "kendi editöründe yaz", "say1": "testbench'i çalıştır", "say2": "dalga formunu surfer'da aç",
        "say3": "derle ve karta yükle", "note3": "8 gb'lık bir m2'de .sv'den .bit'e 4.1 sn",
        "board_alt": "yukarıdan bakılan bir digilent basys 3: ön kenarda on altı anahtar ve her birinin üstünde bir led, dört haneli yedi segment ekran, artı şeklinde beş düğme, ortada artix-7, iki yanda pmod konnektörleri, arkada vga, usb ve kablosu takılı prog portu",
        "board_group": "basys 3'ün anahtarları, ledleri, haneleri ve düğmeleri",
        "board_h": "kart",
        "board_line": "<code>assign led = sw</code> çalıştıran bir basys 3. bir anahtarı çevir ya da bir lede tıkla.",
        "board_comment": "0 segmenti de haneyi de yakar",
        "board_note": "sw, led, btn, seg, an ve clk pinlerini kendileri bulur, pin dosyası gerekmez",
        "board_swipe": "her anahtar için kartı yana kaydır",
        "cli_more": "her komut",
        "cli_line": "tek satırla kurulum, yaklaşık 4 dakika, diskte 0.3 gb. vivado 50 ile 100 gb ister.",
        "g_install": "kurulum",
        "docs_h": "rehber", "docs_more": "rehberin tamamı", "paper_link": "pdf olarak rehber",
        "paper_alt": "rehberin ilk sayfası, how do you run cs223 labs on a mac without vivado, dokuz bölümüyle",
        "d0": "başlamadan önce", "d0p": "bir basys 3, micro usb kablosu, bir usb-c adaptör ve homebrew",
        "d1": "tek satırla kurulum", "d1p": "satır neyi nereye koyar, her parçayı görmek için dewfpga check",
        "d2": "kendi lab'ın", "d2p": ".sv dosyaları ve .xdc bir klasörde, sonra dewfpga flash",
        "d3": "vs code", "d3p": "editörde bir run on basys3 düğmesi",
        "d4": "durursa", "d4p": "yazdığı her hata, çözümüyle",
        "d5": "ne yapamaz?", "d5p": "ip catalog yok, yalnız basys 3 ve apple silicon",
        "thanks_label": "teşekkür", "cup_alt": "bir fincan kahve",
        "thanks": "dewfpga ücretsiz ve açık kaynak. teşekkür etmek istersen,", "coffee": "bana bir kahve ısmarla",
        "js": {
            "alt": [
                "yakından laptop, cs223 lab 2'nin room_monitor modülü cs223_lab2.sv'ye yazılıyor",
                "terminal dewfpga sim tb_room_monitor çalıştırıyor, 4096 durum, 0 hata",
                "surfer tb_room_monitor.vcd'yi açıyor, dalga formu yeşil çiziliyor, en, room, sensor, alarm",
                "dewfpga flash top_monitor kartı yüklüyor, kamera kabloyu izleyip basys 3'e iniyor ve alarm ledi yanıyor",
            ],
            "terms": {
                "check": "her parça yerinde mi",
                "new": "vs code görevli blink örneği", "vscode": "editör entegrasyonunu kur",
                "waves": "simülasyonları tarayıcıda, dalga formu okuyan bir programda (surfer) ya da ikisinde birden açabilirsin",
                "tops": "top'lar için simülatör, surfer ile açılır", "browser": "ya da tarayıcıda", "tbs": "testbench'leri açar",
                "both": "surfer ve tarayıcı",
            },
            "copy": ["kopya", "tamam", "kopyalandı", "seç"], "digit": "hane",
            "note": "iverilog-refused hatasının sayfası, çözümüyle",
        },
        "ld_description": "Apple Silicon macOS için bir komut satırı araç zinciri: SystemVerilog'u simüle eder, dalga formunu Surfer'da ya da tarayıcıda açar, bitstream'i üretir ve Vivado olmadan bir Digilent Basys 3'e yükler.",
    },
}


def ld(s):
    return json.dumps({
        "@context": "https://schema.org", "@type": "SoftwareApplication", "name": "dewfpga",
        "description": s["ld_description"], "inLanguage": s["lang"],
        "applicationCategory": "DeveloperApplication", "applicationSubCategory": "FPGA toolchain",
        "operatingSystem": "macOS on Apple Silicon (arm64)", "processorRequirements": "arm64",
        "softwareRequirements": "Homebrew; a Digilent Basys 3 (XC7A35T) to flash",
        "featureList": ["SystemVerilog simulation with Icarus Verilog", "waveforms in Surfer or the browser",
                        "synthesis with Yosys", "place and route with nextpnr-xilinx", "bitstream with prjxray",
                        "programming with openFPGALoader"],
        "fileSize": "about 0.3 GB installed",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"}, "isAccessibleForFree": True,
        "license": "https://opensource.org/licenses/MIT", "url": s["url"],
        "downloadUrl": BASE + "install", "installUrl": BASE + "docs/one-line-install/",
        "image": BASE + "og.png", "sameAs": ["https://github.com/nosey-dewdrop/dewfpga"],
        "author": {"@type": "Person", "name": "Damla Su Bilge", "url": "https://noseydewdrop.com"},
    }, ensure_ascii=False, indent=2)


# the hero's cli: the install line and three commands of the flow, each under its comment.
# a command breaks only between its words (and after the host of the install line), never at a hyphen
HCLI = [("h_install", "curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash"),
        ("h_sim", "dewfpga sim tb_room_monitor"), ("h_wave", "dewfpga sim tb_room_monitor --wave"),
        ("h_flash", "dewfpga flash top_monitor")]


def hcli(s):
    out = []
    for key, cmd in HCLI:
        words = " ".join("<span>" + html.escape(w).replace("github.io/", "github.io/</span><wbr><span>") + "</span>" for w in cmd.split(" "))
        out.append('        <div class="hc"><p class="c"># ' + html.escape(s[key]) + '</p><div class="k"><b class="p" aria-hidden="true">%</b>'
                   + "<code>" + words + '</code><button class="copy" type="button" data-cmd="' + html.escape(cmd, quote=True) + '">'
                   + html.escape(s["copy"]) + "</button></div></div>")
    return "\n".join(out)


def page(lang, ver):
    s = STR[lang]
    t = open(os.path.join(HERE, "page.tmpl.html"), encoding="utf-8").read()
    # the script and the styles carry a hash of their bytes, so a browser that kept the old
    # ones does not run them under the new page
    for name, h in ver.items():
        t = t.replace('/dewfpga/' + name + '"', '/dewfpga/' + name + '?v=' + h + '"')
    # the attribute values are escaped; the few strings with markup in them are written as they are
    raw = {"board_line", "hl"}
    for k, v in s.items():
        if k in ("js", "ld_description") or k in dict(HCLI) or k == "copy":
            continue
        t = t.replace("{{" + k + "}}", v if k in raw else html.escape(v, quote=True))
    t = t.replace("{{hcli}}", hcli(s))
    t = t.replace("{{ld}}", ld(s))
    t = t.replace("{{js}}", json.dumps(s["js"], ensure_ascii=False).replace("</", "<\\/"))
    if "{{" in t:
        sys.exit("docs/home/build.py: a placeholder is left in the " + lang + " page: " + t[t.index("{{"):t.index("{{") + 30])
    return t


def write(path, text):
    p = os.path.join(ROOT, path)
    old = open(p, encoding="utf-8").read() if os.path.exists(p) else None
    if old != text:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    return len(text.encode())


def main():
    js = "// built by docs/home/build.py from docs/home/*.js; edit those, then run it\n" + \
        "\n".join(open(os.path.join(HERE, n), encoding="utf-8").read() for n in JS)
    css = open(os.path.join(HERE, "home.css"), encoding="utf-8").read()
    ver = {n: hashlib.sha256(b.encode()).hexdigest()[:10] for n, b in (("home.js", js), ("home.css", css))}
    print("site/home.js", write("site/home.js", js), "bytes")
    print("site/home.css", write("site/home.css", css), "bytes")
    print("site/index.html", write("site/index.html", page("en", ver)), "bytes")
    print("site/tr/index.html", write("site/tr/index.html", page("tr", ver)), "bytes")
    subprocess.run([sys.executable, os.path.join(ROOT, "docs", "nav.py")], check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
