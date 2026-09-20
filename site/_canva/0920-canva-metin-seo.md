# dewfpga — Canva metin + SEO (20 Eyl 2026)

Canva site kuracak, metin ve SEO buradan. Her bölüm = Canva'da bir blok.
Sen tasarlarsın, buradaki metni yapıştırırsın.

Kaynak: `site/` altındaki 16 HTML, 20 Eyl 2026 durumu. Metinler aynen alındı,
uydurma yok.

**Canva'da kaç sayfa:** 6 sayfa. `/` · `/docs/` · `/why/` · `/errors/` · `/cli/` · `/tr/`
(9 tekil hata sayfası + sim ayrı uygulama — aşağıda "Canva'ya girmeyenler")

---

## SEO — Canva'da her sayfa için doldurulacak alanlar

Canva Websites'ta her sayfanın SEO paneli var: Page title, Description.
Sitenin tamamı için bir kez: Site name, favicon, domain.

**Site geneli**
- Site adı: `dewfpga`
- Favicon: mor ⋆ (`#5b2fc9`)
- Dil: İngilizce (TR sayfası hariç)

**Sayfa sayfa**

| Canva sayfası | Page title | Description |
|---|---|---|
| `/` | dewfpga: CS223 labs on a Mac, without Vivado | Run CS223 FPGA labs on an Apple Silicon Mac without Vivado. SystemVerilog to a Digilent Basys3 with Icarus Verilog, Yosys, nextpnr-xilinx, prjxray and openFPGALoader. 1.76 GB instead of 50 to 100 GB, a bitstream in under five seconds. |
| `/docs/` | How do you run CS223 labs on a Mac without Vivado? The 18-step guide | Step by step: Yosys, nextpnr-xilinx, prjxray, Icarus Verilog and openFPGALoader on an Apple Silicon Mac, from opening the terminal to an LED blinking on a Digilent Basys3. Every command, what it does, what you should see, and every error with its fix. |
| `/why/` | Why does dewfpga exist, and is it enough for CS223? | Vivado has no macOS build. Setting up Yosys, nextpnr-xilinx and prjxray on Apple Silicon by hand took six hours because of six undocumented walls: no nextpnr-xilinx in oss-cad-suite, no OpenMP in Apple clang, PEP 668, prjxray submodules, CMake 4, no prebuilt chip database. |
| `/errors/` | Errors while setting up Yosys, nextpnr-xilinx and prjxray on macOS, with fixes | Every error hit while building the open-source FPGA chain for a Digilent Basys3 on an Apple Silicon Mac: -fopenmp, externally-managed-environment, yaml-cpp not built, CMake policy version, IOSTANDARD, missing separator, and more. Exact error text, cause, fix. |
| `/cli/` | dewfpga cli: one command from SystemVerilog to a Basys3 | Install the open-source FPGA chain for a Basys3 on an Apple Silicon Mac with one line, then dewfpga sim, bit and flash in any folder. No Makefile, no project layout. |
| `/tr/` | dewfpga: Mac'te Vivado olmadan CS223 | Apple Silicon Mac'te Vivado olmadan CS223 FPGA labları. SystemVerilog'dan Digilent Basys3'e: Icarus Verilog, Yosys, nextpnr-xilinx, prjxray ve openFPGALoader. 50 ila 100 GB yerine 1.76 GB, bitstream 5 saniyenin altında. |

**SEO'da dikkat:** başlıklar soru formunda ve "?" ile bitiyor — aynen böyle kalsın,
Google'da sorulan sorunun kendisi bunlar. `docs` ve `why` başlıkları arama trafiğini
taşıyan iki sayfa; kısaltma.

---

## Nav (her sayfada aynı)

Marka: `dewfpga ⋆`

Linkler, bu sırayla:
`docs` · `why` · `errors` · `simulator` · `cli` · `github` · `türkçe`

TR sayfasında:
`rehber` · `neden` · `hatalar` · `simülatör` · `cli` · `github` · `english`

Hepsi küçük harf.

**Link hedefleri**
- docs → `/docs/` sayfası
- why → `/why/`
- errors → `/errors/`
- simulator → `https://nosey-dewdrop.github.io/dewfpga/sim/` (Canva dışı, ayrı uygulama)
- cli → `/cli/`
- github → `https://github.com/nosey-dewdrop/dewfpga`
- türkçe → `/tr/`

## Footer (her sayfada aynı)

`Damla Su Bilge · MIT · source · linkedin`

- source → `https://github.com/nosey-dewdrop/dewfpga`
- linkedin → `https://www.linkedin.com/in/damla-su-bilge-278841278/`

Sağda, sayfaya göre:
- ana sayfada: `the guide as a PDF` → `/docs/CS223_Mac_Setup.pdf`
- iç sayfalarda: `home` → `/`
- TR'de: `kaynak` · `linkedin` + `rehber PDF olarak`

---

# SAYFA 1 — `/` ana sayfa

## Blok 1 — hero

H1:
```
CS223 labs on a Mac, without Vivado
```

Lead:
```
Simulate, synthesize and flash your CS223 labs to a Digilent Basys3 from an Apple Silicon Mac, M1 and later. Free, open-source tools. No Vivado, no virtual machine, no Rosetta.
```

## Blok 2 — giriş

```
Start with the setup guide: 18 steps, from opening the terminal to an LED blinking on the board, written so that copying a command and pressing Enter is enough. Steps 1 to 9 are the install. The compiling in them is about 4 minutes; the rest is downloads and pasting. The five project files are downloadable as they are, so nothing has to be typed.
```
Link: `setup guide` → `/docs/` · `five project files` → `/docs/#8-what-goes-in-your-project-folder`

## Blok 3 — kartı olmayanlar (soluk/ikincil)

```
No board and no install? The Basys3 simulator runs your design in the browser, and the testbench runner runs your testbench with a waveform. Not for: Intel Macs, anything from Vivado's IP Catalog. Details below.
```
Link: `Basys3 simulator` → `/sim/` · `testbench runner` → `/sim/tb.html` · `Details below` → sayfadaki limits bloğu

## Blok 4 — terminal (monospace, koyu kutu)

```
$ make sim
TB passed
$ make bit
xdc ok: 33 ports, all matched.
Info: Max frequency for clock 'clk': 209.60 MHz (PASS at 100.00 MHz)
$ make flash
Load SRAM: [==================================================] 100.00%
Done
ir: 1 isc_done 1 isc_ena 0 init 1 done 1
```

Altına, küçük ve soluk:
```
The blink example on a Basys3, from an M2 with 8 GB. done 1 means the chip accepted the design, and LED 0 starts blinking. 4.6 seconds from .sv to .bit. The whole chain takes 1.76 GB of disk; Vivado asks for 50 to 100 GB.
```

## Blok 5 — H2 `How does it work?`

```
Vivado does five jobs for a CS223 lab. One open-source tool does each job here, plus a chip database generated once, and a small Makefile runs them in order.
```

Tablo, iki sütun — başlıklar `stage` / `tool`:
```
simulation          Icarus Verilog
synthesis           Yosys
place and route     nextpnr-xilinx, built from source
bitstream           prjxray fasm2frames + xc7frames2bit
chip database       generated once for the XC7A35T
programming         openFPGALoader over USB
```

Tablonun altına:
```
Your .sv and .xdc files are the same ones Vivado reads. The course's pin files work as they are, once you uncomment the pins you use.
```

## Blok 6 — H2 `Why does this exist?`

```
Vivado has no macOS build. Setting up the open-source chain by hand took six hours, because of six walls that nobody documents in one place. The six walls, what each one cost, and whether the result is enough for CS223. When a step fails, the error text is the fastest way in: every error hit during this setup, with the fix.
```
Link: `The six walls, what each one cost, and whether the result is enough for CS223` → `/why/` · `every error hit during this setup, with the fix` → `/errors/`

## Blok 7 — H2 `What can it not do?`

Dört madde, liste:
```
Nothing from Vivado's IP Catalog: no Block Design, MicroBlaze, AXI, Clocking Wizard or the BRAM, VGA and UART cores. 35 old CS223 student repos with 240 source files were checked; none of them use any of it.

On the Mac chain there is no waveform viewer, schematic or in-chip debugger: make sim writes a .vcd file and stops there. The testbench runner in the browser draws the waveform instead.

Only the Basys3 (XC7A35T), only Apple Silicon. Intel Macs, Linux and other boards are untested.

The tools are unofficial. AMD does not make or support them. What you should be concerned about.
```
Link: `testbench runner in the browser` → `/sim/tb.html` · `What you should be concerned about` → `/docs/#15-what-should-you-be-concerned-about`

## Blok 8 — H2 `What is coming?`

```
A compiler in the browser: SystemVerilog to a Basys3 bitstream without installing anything. Not public yet. The simulator, the testbench runner and the command-line tool are.
```
Link: `simulator` → `/sim/` · `testbench runner` → `/sim/tb.html` · `command-line tool` → `/cli/`

## Blok 9 — H2 `Who made this?`

```
Damla Su Bilge, Bilkent CS. Everything here was run on 19 September 2026 on an M2 with 8 GB of RAM, macOS 15 and a Basys3. If a step fails for you, open an issue or write on LinkedIn with the last ten lines of the terminal and the step number.
```
Link: `issue` → `https://github.com/nosey-dewdrop/dewfpga/issues` · `LinkedIn` → LinkedIn profili

---

# SAYFA 2 — `/why/`

H1:
```
Why does dewfpga exist, and is it enough for CS223?
```

Lead:
```
Vivado has no macOS build. The open-source chain that replaces it exists, but nobody had written down how to stand it up on an Apple Silicon Mac in one place.
```

## H2 `Is it enough for CS223?`

```
Real lab code from old student repos went through: an FSM with typedef enum, a 16x8 RAM, a debouncer with a carry chain, and the course's seven-segment module. All four together synthesize to 136 LUTs and 48 flip-flops, timing passes at 154.70 MHz against the 100 MHz clock, and the bitstream is ready in 4.5 seconds. parameter, generate, struct packed, $clog2, unique case, packed arrays and interface with modport all synthesized with zero errors.

Nothing from Vivado's IP Catalog is available, and that is the real limit. 35 old CS223 student repos with 240 source files were checked for it; none of them use any of it. The course has you write clock dividers and memory by hand, which is the part this chain handles. What is untested is in the guide: what it cannot do and what you should be concerned about.
```
Link: `what it cannot do` → `/docs/#14-what-can-it-actually-not-do` · `what you should be concerned about` → `/docs/#15-what-should-you-be-concerned-about`

## H2 `What does it cost, compared with Vivado?`

Tablo, üç sütun — başlıklar boş / `this chain` / `Vivado`:
```
disk                            1.76 GB                             50 to 100 GB
runs on Apple Silicon           natively                            no macOS build; a Windows or Linux VM
blink to bitstream              4.6 s on an M2, 8 GB                not measured here
IP Catalog, Block Design, ILA   none                                yes
waveforms, schematic view       none                                yes
official support                none, these are unofficial tools    AMD
```

Altına, küçük ve soluk:
```
The Vivado disk figure is AMD's own requirement; nothing else about Vivado was measured here.
```

## H2 `What were the six walls?`

```
CS223 is Bilkent's digital design course: write SystemVerilog, simulate, synthesize, load it onto a Basys3. The five open-source tools that cover that loop all run on macOS; getting them to work together took six hours, and the time went into these.
```

Numaralı liste, altı madde. Her maddenin kalın başlığı bir hata sayfasına link:

1. **oss-cad-suite does not ship nextpnr-xilinx.** It is YosysHQ's ready-made bundle with a macOS build, and it looks like the obvious first try. It has nextpnr for ice40, ecp5, nexus and Gowin chips. 497 MB downloaded to learn that Xilinx is missing. nextpnr-xilinx has to be built from source.
   → `/errors/oss-cad-suite-no-nextpnr-xilinx/`

2. **Homebrew's Python refuses pip install.** PEP 668 marks it as externally managed. Two steps of the chain are Python scripts with a few packages, so a venv is required.
   → `/errors/externally-managed-environment/`

3. **Apple's clang has no OpenMP.** nextpnr's default build dies on the first file with unsupported option '-fopenmp'. It needs -DUSE_OPENMP=OFF, which only slows one part of placement, and at lab sizes you do not notice.
   → `/errors/fopenmp/`

4. **There is no prebuilt chip database.** nextpnr knows how to place and route but nothing about the XC7A35T. The database is generated per device with bbaexport.py and bbasm: a 256 MB text file, packed into an 89 MB binary.
   → `/errors/no-chipdb/`

5. **prjxray hides its dependencies in submodules.** Without --recursive CMake fails on yaml-cpp, then on googletest, then on abseil, one at a time. Nothing gives you the list up front.
   → `/errors/yaml-cpp-not-built/`

6. **CMake 4 rejects prjxray.** The project is written for an older CMake and the current one refuses to configure it without -DCMAKE_POLICY_VERSION_MINIMUM=3.5.
   → `/errors/cmake-policy-version-minimum/`

## H2 `What is dewfpga?`

```
Right now, the guide: the six walls removed, in 18 steps that a first-year student can paste. Next, a command-line tool that installs the chain in one line and builds any folder of .sv files without a Makefile, then a Basys3 simulator and a compiler in the browser.
```
Link: `guide` → `/docs/`

---

# SAYFA 3 — `/errors/`

H1:
```
Which error did you get?
```

Lead:
```
Every wall hit while setting up the chain on a Mac, in the order of the guide, filed under the exact line the terminal printed. Press Cmd F and paste a piece of your error. Two of them, steps 3 and 6, print no error line; they are the places you get stuck with nothing to search for.
```

Dokuz kart. Her kartta: adım etiketi + hata başlığı (link) + açıklama.
Hata başlıkları terminalden gelen gerçek satırlar — harfi harfine böyle kalsın.

```
step 3   oss-cad-suite has no nextpnr-xilinx
         the obvious first try, 497 MB later. YosysHQ's bundle ships nextpnr for
         ice40, ecp5, nexus and Gowin. Not Xilinx.

step 4   error: externally-managed-environment
         pip, with Homebrew's Python on macOS. PEP 668. Homebrew's Python refuses
         a plain pip install. The chain needs a venv.

step 5   clang++: error: unsupported option '-fopenmp'
         nextpnr-xilinx, while compiling on macOS. nextpnr's default build asks
         Apple's clang for OpenMP, which it does not have.

step 6   nextpnr-xilinx: where is the chip database for the XC7A35T?
         nextpnr-xilinx, the first time you run it. There is no prebuilt chipdb.
         It is generated per device from the prjxray data.

step 7   Cannot specify include directories for target "yaml-cpp" which is not built by this project
         CMake, while configuring prjxray. prjxray was cloned without --recursive,
         so its submodules are empty.

step 7   Compatibility with CMake < 3.5 has been removed from CMake
         CMake 4, while configuring prjxray. prjxray is written for an older CMake.
         CMake 4 refuses it without a policy flag.

step 8   Makefile:29: *** missing separator.  Stop.
         make, on a Makefile copied from a PDF or a web page. The recipe lines lost
         their Tab characters when you copied them.

step 9   ERROR: port led[0] of type PAD has no IOSTANDARD property
         nextpnr-xilinx, at the start of place and route. A port in your design has
         no pin in the .xdc file. nextpnr names the wrong port.

step 12  ERROR: Module port 'dp' is neither input nor output
         Yosys, while synthesizing the course's SevSeg_4digit.sv. The course's
         seven-segment module has a broken port line. Vivado accepts it, Yosys does not.
```

Kart linkleri sırayla:
`/errors/oss-cad-suite-no-nextpnr-xilinx/` · `/errors/externally-managed-environment/` ·
`/errors/fopenmp/` · `/errors/no-chipdb/` · `/errors/yaml-cpp-not-built/` ·
`/errors/cmake-policy-version-minimum/` · `/errors/missing-separator/` ·
`/errors/no-iostandard-property/` · `/errors/port-neither-input-nor-output/`

## H2 `Your error is not here?`

```
Read the last lines in the terminal, not the first. Most tools print the real reason last. If it is still stuck, send the last ten lines and the step number on LinkedIn.
```

Altına, küçük ve soluk:
```
All of this was hit on an M2 with 8 GB, macOS 15, on 19 September 2026, with the tool versions listed in step 17 of the guide. Newer versions can move the walls.
```
Link: `step 17 of the guide` → `/docs/#17-which-versions-did-i-use`

---

# SAYFA 4 — `/cli/`

H1:
```
One command from SystemVerilog to a Basys3
```

Lead:
```
The 18-step guide, done for you. One line installs the chain; after that, dewfpga builds whatever .sv files are in the folder.
```

Soluk satır:
```
No Mac or no board with you? The Basys3 simulator and the testbench runner do the same first two steps in a browser, with nothing installed.
```
Link: `Basys3 simulator` → `/sim/` · `testbench runner` → `/sim/tb.html`

Terminal kutusu (kopyalanabilir olsun):
```
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash   # ~4 min, 1.4 GB, once
```

Altına, küçük ve soluk:
```
Requirements: macOS on Apple Silicon, Xcode Command Line Tools, Homebrew. It puts the CLI in ~/.dewfpga, links dewfpga into Homebrew's bin and runs dewfpga install. Re-run the same line to update. No Node needed.
```

## H2 `How do you use it?`

```
In any folder with blink.sv and blink.xdc:
```

Terminal kutusu:
```
dewfpga sim      # iverilog
dewfpga bit      # .sv -> .bit   (~4 s)
dewfpga flash    # program the board: the LED blinks
```

```
No Makefile, no project layout. Every .sv and .v in the folder is synthesized, so submodules can live in their own files. The top module is the .sv with a matching .xdc; if that is ambiguous, dewfpga flash <top>. sim needs <top>_tb.sv. First time? dewfpga new blink gives you the blinking LED to start from, with a Makefile and a VS Code task (⌘⇧B = flash).
```

## H2 `Commands`

Terminal kutusu:
```
dewfpga install                     install the toolchain (safe to re-run)
dewfpga check                       is every piece in place
dewfpga sim|bit|flash|clean [top]   work on the .sv files in the current folder
dewfpga new <dir>                   example project with Makefile + VS Code task
dewfpga --version
```

## H2 `What does it install?`

Tablo, üç sütun — `stage` / `tool` / `from`:
```
simulation        iverilog                      brew
synthesis         yosys                         brew
place & route     nextpnr-xilinx                source, pinned commit
fasm → frames     prjxray fasm2frames           source, pinned commit, venv
frames → .bit     prjxray xc7frames2bit         source
chipdb XC7A35T    bbaexport + bbasm             generated, ~90 MB
programming       openFPGALoader                brew
```

```
Everything goes into ~/fpga. Re-running the script skips finished steps. Log: ~/fpga/install.log.
```

## H2 `What was measured?`

```
19 September 2026, M2 with 8 GB, macOS 15.
```

Etiket–değer listesi:
```
clean install        3 min 37 s to 4 min 17 s over three runs, 1.4 GB
second run           2.7 s, every step skipped as already done
bit                  4.6 s, peak 552 MB RAM
chipdb generation    peak 859 MB RAM
output               byte-identical .frames to the hand-built chain that lit the LED
tests                27 checks in test/run.sh; CI does a clean install, the suite and
                     the npm package on a fresh macos-15 runner on every push
```

## H2 `Scope`

Dört madde:
```
Board: Digilent Basys3 (XC7A35T-1CPG236C). Other 7-series boards: change DEVICE in install.sh and regenerate the chipdb; untested.

Platform: macOS arm64. Intel Mac and Linux are untested and refused by the script.

The course's XDC files work as-is (PACKAGE_PIN + IOSTANDARD).

flash writes SRAM: the design is gone after a power cycle.
```

---

# SAYFA 5 — `/docs/` rehber

Bu sayfa 18 adımlık uzun rehber. `docs/manual-setup.md`'den pandoc ile üretiliyor.
Canva'ya taşınırsa el ile taşınacak; metni buraya kopyalamadım çünkü çok uzun
ve zaten tek kaynağı var: `docs/manual-setup.md`.

H1:
```
How do you run CS223 labs on a Mac without Vivado?
```

Üst bilgi çubuğu:
```
19 September 2026 · M2, 8 GB, macOS 15   |   PDF, 16 pages   |   the five project files   |   steps 1 to 9 install, 10 and 11 are your lab, 12 to 18 are reference
```
Link: `PDF, 16 pages` → `/docs/CS223_Mac_Setup.pdf` · `the five project files` → `/templates/Makefile`

18 adımın başlıkları — Canva'da içindekiler bloğu olarak:
```
1.  What are you building?
2.  What do you need before you start?
3.  Which tools come ready-made?
4.  Why do you need a Python environment?
5.  How do you build nextpnr-xilinx?
6.  How do you make the chip database?
7.  How do you build the prjxray tools?
8.  What goes in your project folder?
9.  How do you run it?
10. How do you use it for your own lab?
11. How do you set up VS Code?
12. Which course file breaks?
13. What was tested?
14. What can it actually not do?
15. What should you be concerned about?
16. What went wrong during my setup?
17. Which versions did I use?
18. What is not verified?
```

**Karar gereken yer:** bu sayfa Canva'da 18 adımlık uzun bir sayfa mı olacak,
yoksa Canva'da sadece içindekiler durup PDF'e mi gönderecek? İkincisi daha az iş
ama rehber sitenin asıl trafik taşıyan sayfası — SEO'yu PDF taşımaz.

---

# SAYFA 6 — `/tr/`

Bu, ana sayfanın Türkçesi ama **çeviri değil** — ses daha birinci tekil.
Aynen böyle kalsın, İngilizcesinden yeniden çevirme.

H1:
```
Mac'te Vivado olmadan CS223
```

Lead:
```
Vivado'nun Mac sürümü yok. Ben de dersin kullandığı kadarını açık kaynak araçlarla kurdum: M1 ve sonrası bir Mac'te SystemVerilog yaz, simüle et, sentezle, Basys3'e yükle. Sanal makine yok, Rosetta yok.
```

Giriş:
```
Nereden başlanır: kurulum rehberi. 18 adım, terminali açmaktan kartta LED'in yanmasına kadar. Komutu kopyala, Enter'a bas, ekranda ne görmen gerektiğini de yazdım. İlk 9 adım kurulum; içindeki derleme dört dakika sürüyor, kalanı indirme ve yapıştırma. Rehber İngilizce, ama komutlar zaten dil bilmiyor. Beş proje dosyasını tek tek yazmana da gerek yok, indirip kullanıyorsun.
```

Soluk satır:
```
Kart yanında değil mi, hiçbir şey kurmak istemiyor musun? Basys3 simülatörü tasarımını doğrudan tarayıcıda çalıştırıyor, switch'leri elle çeviriyorsun, LED'ler yanıyor. Testbench çalıştırıcı da testbench'ini koşup dalga formunu çiziyor. Şunlar için değil: Intel Mac, Vivado IP Catalog'undan herhangi bir şey. Aşağıda hepsi yazıyor.
```

Terminal kutusu — ana sayfadakinin aynısı (çıktı İngilizce, öyle kalsın):
```
$ make sim
TB passed
$ make bit
xdc ok: 33 ports, all matched.
Info: Max frequency for clock 'clk': 209.60 MHz (PASS at 100.00 MHz)
$ make flash
Load SRAM: [==================================================] 100.00%
Done
ir: 1 isc_done 1 isc_ena 0 init 1 done 1
```

Altına, küçük ve soluk:
```
Yukarıdaki, 8 GB'lık M2'mde blink örneğinin gerçek çıktısı. Son satırdaki done 1, çipin tasarımı kabul ettiği anlamına geliyor; o an LED 0 yanıp sönmeye başlıyor. .sv'den .bit'e 4.6 saniye. Bütün zincir diskte 1.76 GB yer kaplıyor, Vivado 50 ila 100 GB istiyor.
```

## H2 `Nasıl çalışıyor?`

```
Vivado bir CS223 labı için aslında beş ayrı iş yapıyor. Burada her işi ayrı bir açık kaynak araç yapıyor, bir de bir kez üretilen chip database var; küçük bir Makefile hepsini sırayla çalıştırıyor.
```

Tablo — `aşama` / `araç`:
```
simülasyon                    Icarus Verilog
sentez                        Yosys
yerleştirme ve yönlendirme    nextpnr-xilinx, kaynaktan derleniyor
bitstream                     prjxray fasm2frames + xc7frames2bit
chip database                 XC7A35T için bir kez üretiliyor
karta yükleme                 openFPGALoader, USB üzerinden
```

```
Yazdığın .sv ve .xdc, Vivado'ya vereceğin dosyaların aynısı. Dersin verdiği pin dosyaları da olduğu gibi çalışıyor; sadece kullandığın pinlerin başındaki #'i kaldırıyorsun.
```

## H2 `Neden böyle bir şey yaptım?`

```
Vivado'nun macOS sürümü yok, sanal makine de M serisi Mac'te işe yaramıyor. Zinciri elle kurmak altı saatimi aldı; sebebi, hiçbiri tek yerde yazmayan altı duvardı. Altı duvarın her biri, bana neye mal olduğu ve sonucun CS223'e yetip yetmediği burada (İngilizce). Bir adım patlarsa en hızlı yol hata metnini aramak: kurulumda karşıma çıkan her hata, çözümüyle (İngilizce).
```

## H2 `Neyi yapamıyor?`

```
Vivado'nun IP Catalog'undan hiçbir şey çalışmıyor: Block Design, MicroBlaze, AXI, Clocking Wizard, hazır BRAM, VGA ve UART blokları yok. 35 eski CS223 öğrenci reposuna, 240 kaynak dosyaya baktım; hiçbiri bunları kullanmıyor, labları elle yazıyoruz zaten.

Mac'teki zincirde dalga formu görüntüleyici, şematik ya da çip içi debugger yok: make sim bir .vcd dosyası bırakıp duruyor. Dalga formuna bakmak istersen tarayıcıdaki testbench çalıştırıcıyı kullan.

Sadece Basys3 (XC7A35T) ve sadece Apple Silicon denendi. Intel Mac, Linux ve başka kartlar için bir şey diyemem.

Bu araçlar resmi değil, AMD'nin yaptığı ya da desteklediği şeyler değil. Lab demosundan önce tasarımını bir kez okuldaki bilgisayarda Vivado'da açmanı öneririm.
```

## H2 `Sırada ne var?`

```
Tarayıcıda derleyici: hiçbir şey kurmadan SystemVerilog'dan Basys3 bitstream'ine. O henüz açık değil. Simülatör, testbench çalıştırıcı ve komut satırı aracı kullanıma açık.
```

## H2 `Kim yaptı?`

```
Damla Su Bilge, Bilkent CS. Buradaki her şeyi 19 Eylül 2026'da 8 GB RAM'li bir M2'de, macOS 15 ve elimdeki Basys3 ile çalıştırdım. Bir adım sende patlarsa terminalin son on satırını ve kaçıncı adımda olduğunu yaz: GitHub'da issue açabilirsin ya da LinkedIn'den ulaşabilirsin.
```

---

# Canva'ya girmeyenler

Bunlar HTML olarak kalmalı, Canva'ya taşınmaz:

- **`/sim/` ve `/sim/tb.html`** — ayrı bir Vite uygulaması, çalışan kod. Canva sayfa
  yapamaz. Canva'dan link verilir, adres: `https://nosey-dewdrop.github.io/dewfpga/sim/`
- **9 tekil hata sayfası** (`/errors/<slug>/`) — her biri tek bir hata satırı için,
  uzun kuyruk SEO taşıyor. Canva'da 9 sayfa daha açmak istemezsen mevcut HTML'de
  kalsınlar, `/errors/` kartlarından oraya link verilir. **Bunlar HTML'de kalırsa
  site tam Canva'ya geçmemiş olur — karar senin.**
- **`/install`** — `curl | bash` ile çekilen kurulum scripti. Dosya, sayfa değil.
- **`/docs/CS223_Mac_Setup.pdf`** ve `/templates/` — indirilen dosyalar.
- **`robots.txt`, `sitemap.xml`, `404.html`** — Canva bunları kendi üretir.

---

# Açık kalemler

1. **`/docs/` Canva'da uzun sayfa mı, içindekiler + PDF mi?** Rehber sitenin en çok
   arama trafiği taşıyan sayfası; PDF'e gönderirsen o trafiği kaybedersin.
2. **9 hata sayfası Canva'ya taşınacak mı?** Taşınmazsa iki ayrı yerde site olur.
3. **Adres ne olacak?** Şu an `nosey-dewdrop.github.io/dewfpga/`. Canva kendi
   adresini verir; eski adresten yönlendirme kurulmazsa mevcut SEO sıfırlanır.
