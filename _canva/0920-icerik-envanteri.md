# dewfpga — içerik envanteri (20 Eyl 2026)

Canva kabuğu çizilirken referans. Sol sütun = sitede var olan metin, korunacak.
Kaynak: `site/` altındaki HTML'ler, 20 Eyl 2026 durumu.

## Sayfa haritası (16 HTML)

| url | dosya | rol |
|---|---|---|
| `/` | index.html | ana sayfa, EN |
| `/tr/` | tr/index.html | ana sayfa, TR (hreflang eşi) |
| `/docs/` | docs/index.html | 18 adımlık rehber, pandoc ile `docs/manual-setup.md`'den üretilir |
| `/why/` | why/index.html | altı duvar + CS223'e yetiyor mu |
| `/errors/` | errors/index.html | hata dizini, 9 hata |
| `/errors/<slug>/` | 9 dosya | tek tek hata sayfaları, h1 = terminaldeki hata satırı |
| `/cli/` | cli/index.html | komut satırı aracı |
| `/sim/`, `/sim/tb.html` | `sim/` ayrı Vite uygulaması, CI'da `out/sim/`'e kopyalanır | simülatör + testbench |
| 404 | 404.html | noindex |

## Global bileşenler (her sayfada aynı)

**nav:** marka `dewfpga ⋆` + docs · why · errors · simulator · cli · github · türkçe
(TR'de: rehber · neden · hatalar · simülatör · cli · github · english)

**footer:** `Damla Su Bilge · MIT · source · linkedin` + sağda sayfaya göre değişen tek link
(ana sayfada "the guide as a PDF", iç sayfalarda "home")

**favicon:** mor ⋆ (`#5b2fc9`), inline SVG data URI.

## Ana sayfa (/) — metin blokları

- h1: `CS223 labs on a Mac, without Vivado`
- lead: Simulate, synthesize and flash… M1 and later. Free, open-source tools. No Vivado, no virtual machine, no Rosetta.
- giriş paragrafı: 18 adım, ilk 9 adım kurulum, derleme ~4 dk, beş proje dosyası indirilebilir
- mute satırı: kart/kurulum yoksa simülatör + testbench runner; "Not for: Intel Macs, IP Catalog"
- **terminal bloğu** (aynen korunacak, 9 satır): `make sim` → TB passed / `make bit` → xdc ok: 33 ports + 209.60 MHz PASS / `make flash` → Load SRAM %100 + `done 1`
- altyazı: 4.6 s `.sv`→`.bit`, 1.76 GB vs 50–100 GB
- h2 `How does it work?` + 6 satırlık **araç tablosu** (stage | tool)
- h2 `Why does this exist?` → /why/ ve /errors/'a köprü
- h2 `What can it not do?` (id=limits) — 4 maddelik liste
- h2 `What is coming?` — tarayıcı derleyicisi henüz açık değil
- h2 `Who made this?` — Damla Su Bilge, Bilkent CS, 19 Eyl 2026, M2 8 GB, macOS 15

## /tr/ — ana sayfanın Türkçe karşılığı
Aynı iskelet, ama çeviri değil: ses daha birinci tekil ("Ben de dersin kullandığı kadarını kurdum",
"altı saatimi aldı"). Başlıklar: Nasıl çalışıyor? · Neden böyle bir şey yaptım? · Neyi yapamıyor? ·
Sırada ne var? · Kim yaptı?
İç sayfalar İngilizce, TR sayfası bunu açıkça söylüyor ("(İngilizce)").

## /why/ — metin blokları
- h1: `Why does dewfpga exist, and is it enough for CS223?`
- h2 `Is it enough for CS223?` — FSM + 16x8 RAM + debouncer + seven-segment: 136 LUT, 48 FF, 154.70 MHz, 4.5 s
- h2 `What does it cost, compared with Vivado?` — **6 satırlık karşılaştırma tablosu**
- h2 `What were the six walls?` — numaralı liste, her madde ilgili hata sayfasına link
  1. oss-cad-suite'te nextpnr-xilinx yok (497 MB)
  2. Homebrew Python pip'i reddediyor (PEP 668)
  3. Apple clang'de OpenMP yok (`-fopenmp`)
  4. hazır chip database yok (256 MB metin → 89 MB binary)
  5. prjxray bağımlılıklarını submodule'de saklıyor
  6. CMake 4 prjxray'i reddediyor
- h2 `What is dewfpga?` — şu an rehber, sonra CLI, simülatör, tarayıcı derleyicisi

## /errors/ — dizin
- h1: `Which error did you get?`
- lead: rehberin sırasına göre, terminalin bastığı satırın altında. Cmd+F ile ara.
  3. ve 6. adımlar hata satırı basmıyor.
- 9 kart, her biri: `step N` rozeti + hata metni (başlık, link) + 1 cümle açıklama
- h2 `Your error is not here?` — son satırları oku, LinkedIn
- altyazı: M2 8 GB, macOS 15, 19 Eyl 2026, versiyonlar step 17'de

### 9 hata (step → başlık → slug)
| step | başlık (h1 = terminal satırı) | slug |
|---|---|---|
| 3 | oss-cad-suite has no nextpnr-xilinx | oss-cad-suite-no-nextpnr-xilinx |
| 4 | error: externally-managed-environment | externally-managed-environment |
| 5 | clang++: error: unsupported option '-fopenmp' | fopenmp |
| 6 | nextpnr-xilinx: where is the chip database for the XC7A35T? | no-chipdb |
| 7 | Cannot specify include directories for target "yaml-cpp"… | yaml-cpp-not-built |
| 7 | Compatibility with CMake < 3.5 has been removed from CMake | cmake-policy-version-minimum |
| 8 | Makefile:29: *** missing separator.  Stop. | missing-separator |
| 9 | ERROR: port led[0] of type PAD has no IOSTANDARD property | no-iostandard-property |
| 12 | ERROR: Module port 'dp' is neither input nor output | port-neither-input-nor-output |

## /cli/ — metin blokları
- h1: `One command from SystemVerilog to a Basys3`
- lead + mute (simülatör alternatifi)
- **kurulum satırı**: `curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash` (~4 dk, 1.4 GB)
  — `data-copy` ile kopyalanabilir
- gereksinimler: macOS Apple Silicon, Xcode CLT, Homebrew; `~/.dewfpga`
- h2 `How do you use it?` — `dewfpga sim | bit | flash`
- h2 `Commands` — komut listesi bloğu
- h2 `What does it install?` — **7 satırlık tablo** (stage | tool | from)
- h2 `What was measured?` — **dl/kv listesi**: clean install 3:37–4:17 · ikinci koşu 2.7 s · bit 4.6 s / 552 MB · chipdb 859 MB · byte-identical frames · 27 test
- h2 `Scope` — 4 madde

## /docs/ — 18 bölüm (üretilen sayfa, elle yazılmaz)
Contents + 18 başlık, hepsi soru formunda:
1. What are you building? 2. What do you need before you start? 3. Which tools come ready-made?
4. Why do you need a Python environment? 5. How do you build nextpnr-xilinx? 6. How do you make the chip database?
7. How do you build the prjxray tools? 8. What goes in your project folder? 9. How do you run it?
10. How do you use it for your own lab? 11. How do you set up VS Code? 12. Which course file breaks?
13. What was tested? 14. What can it actually not do? 15. What should you be concerned about?
16. What went wrong during my setup? 17. Which versions did I use? 18. What is not verified?

**Uyarı:** `docs/index.html` `docs/build.sh` (pandoc) ile üretiliyor. Canva kabuğu buraya da uygulanacaksa
şablon `build.sh` içinde değişmeli, HTML elle düzenlenirse ilk `make site`'ta geri gider.

## 404
h1 `Nothing at this address` / lead `Like a port with no pin in the .xdc.` / 3 link.

## SEO — kabuk değişirken korunacaklar
- her sayfada: `<title>`, `meta description`, `link rel=canonical`
- ana sayfa + /tr/: `hreflang` üçlüsü (en, tr, x-default)
- og:type / og:title / og:description / og:url / og:image (`og.png`, 59 KB) + twitter:card
- JSON-LD: `/` WebSite, `/why/` TechArticle (author Damla Su Bilge, datePublished 2026-09-19)
- `sitemap.xml` 19 URL, `robots.txt` Allow all + sitemap satırı
- `404.html` ve `/cli/`… — NOT: cli artık noindex DEĞİL, sitemap'te ve nav'da var
- tüm iç linkler `/dewfpga/` mutlak prefix'li (GitHub Pages alt yolu)

## Deploy zinciri (CI, `.github/workflows/ci.yml`)
macos-15 runner → install.sh → test/run.sh → npm paketi → web installer →
`sim` vite build → `out/` = `site/` + tgz + templates + blink.zip + `sim/dist` → Pages.
**Canva çıktısı `site/` altına girmeli**; `out/` doğrudan elle doldurulmuyor.
