# dewfpga

Apple Silicon Mac'te SystemVerilog yaz, Digilent **Basys3**'e yükle. Vivado yok, sanal
makine yok, Rosetta yok. `.sv` → `.bit` → kart, beş saniyenin altında.

[English](README.md)

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash   # ~4 dk, 1.4 GB, tek sefer
```

Sonra `blink.sv` + `blink.xdc` olan herhangi bir klasörde:

```bash
dewfpga sim      # iverilog
dewfpga bit      # .sv -> .bit   (4.6 sn)
dewfpga flash    # karta yükle: LED yanıp söner
```

`dewfpga bit` üç satır basar, place-and-route logunun tamamı `<top>.log`'da kalır:

```
xdc ok: 33 ports, all mapped.
pnr ok: 73 LUT, 27 FF, 278.71 MHz (PASS at 100.00 MHz)   (full log: blink.log)
blink.bit  2.2 MB
```

Makefile yok, proje yapısı yok. Klasörde modül tutan her `.sv`/`.v` sentezlenir (alt modüller
kendi dosyalarında olabilir, dosya adı serbest; içinde modül olmayan bir dosya, yani tek başına bir
package, interface ya da dosya düzeyinde typedef, şimdilik dışarıda kalıyor). Top modül, başka hiçbir modülün instantiate
etmediği modüldür, Vivado'daki gibi; iki modül uyuyorsa adını ver: `dewfpga flash <top>` (şimdilik CLI, `.xdc` ile
ya da kendi dosyasıyla aynı adı taşıyanı sormadan seçiyor). Portu olmayan
ya da `$finish` veya `$stop` çağıran modül `sim` için testbench'tir, bu yüzden bunlardan birini
çağıran bir tasarım modülü de şimdilik testbench sayılıyor: `$finish` ile `$stop`'u testbench'te
tut. Örnek: `dewfpga new blink`.

## Kurulum

Tek satır, Node gerekmez:

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash
```

CLI'ı `~/.dewfpga`'ya koyar (sha256 `dewfpga.tgz.sha256` ile karşılaştırılır; bu bir bütünlük
kontrolü, imza değil), `dewfpga`'yı Homebrew'un bin klasörüne bağlar ve `dewfpga install`'u
çalıştırır. Güncellemek için aynı satırı tekrar çalıştır. `dewfpga uninstall` kurulumun
`~/fpga`'da ürettiklerini (nextpnr-xilinx, prjxray, chipdb, venv, log), `~/.dewfpga`'yı ve
linki siler; `~/fpga`'daki başka dosyalara dokunmaz. Gerekenler: Apple Silicon'da macOS,
Xcode Command Line Tools, Homebrew. Sonradan npm paketine geçeceksen önce
`$(brew --prefix)/bin/dewfpga`'yı sil, npm aynı yolu istiyor.

## Ne kuruyor?

| Aşama | Araç | Nereden |
|---|---|---|
| simülasyon | iverilog | brew |
| sentez | yosys | brew |
| place & route | nextpnr-xilinx | kaynaktan, sabit commit |
| fasm → frames | prjxray `fasm2frames` | kaynaktan, sabit commit, venv |
| frames → .bit | prjxray `xc7frames2bit` | kaynaktan |
| chipdb XC7A35T | `bbaexport` + `bbasm` | üretilir (~90 MB) |
| karta yükleme | openFPGALoader | brew |

Vivado beş işi tek pencerede yapıyor; burada beş açık kaynak araç yapıyor, `install.sh`
bunları birbirine bağlıyor.

## Neden bir script?

Bu zinciri elle kurmak altı saat sürdü. Hiçbiri tek bir yerde yazılı olmayan altı duvar:

1. **oss-cad-suite'te nextpnr-xilinx yok.** 497 MB indirip içinde yalnızca
   ice40/ecp5/gowin olduğunu öğreniyorsun. Kaynaktan derlemek şart.
2. **Apple clang'de `-fopenmp` yok.** nextpnr `-DUSE_OPENMP=OFF` istiyor.
3. **PEP 668.** Homebrew Python'a `pip install` reddediliyor; venv şart.
4. **prjxray `--recursive` istiyor.** Yoksa yaml-cpp / googletest / abseil eksik kalıyor, cmake patlıyor.
5. **cmake 4 prjxray'i reddediyor.** `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` istiyor.
6. **Hazır chipdb yok.** Cihaz başına `bbaexport.py` + `bbasm` ile üretiliyor.

Script'i tekrar çalıştırınca biten adımlar atlanır. Log: `~/fpga/install.log`.

## Komutlar

```
dewfpga install                     zinciri kur (tekrar çalıştırmak güvenli)
dewfpga check                       her parça yerinde mi
dewfpga sim|bit|flash|clean [top]   bulunduğun klasördeki .sv dosyaları
dewfpga new <dizin>                 VS Code görevli blink örneği (⌘⇧B = flash)
dewfpga uninstall                   kurulumun ürettiklerini, CLI'ı ve linki sil (senin dosyaların ve brew paketleri kalır)
dewfpga --version
```

## Kapsam

- Kart: yalnızca Digilent **Basys3** (XC7A35T-1CPG236C). Başka bir 7-serisi kart kendi
  chipdb'sini (`install.sh`'de `DEVICE`), parça adını (Makefile'da `PART`, `CHIPDB`) ve
  openFPGALoader kart adını ister; hiçbiri bağlanmadı, test edilmedi.
- Platform: **macOS arm64**. Intel Mac ve Linux test edilmedi, script reddeder.
- Dersin XDC dosyaları olduğu gibi çalışır (`PACKAGE_PIN` + `IOSTANDARD`); tasarımın kullanmadığı pinler yok sayılır.
- Bellekler dağıtık RAM olur (`-nobram`): lab boyutunda sorun yok, bir VGA framebuffer sığmaz. `(* ram_style = "block" *)`
  ya da `(* rom_style = "block" *)` ile işaretli bir bellek block RAM olur ve onun zamanlaması ölçülmez.
- `bit` timing tutmazsa bitstream yazmaz. XDC'de `create_clock` yoksa bölünmüş saat dahil her saat
  100 MHz'de kontrol edilir; Vivado bölünmüş saati kontrol etmez. Yosys'un içinde register olan bir DSP48E1'e koyduğu çarpıcının
  timing'i hiç kontrol edilmez (nextpnr-xilinx). `sim` testbench `$error`/`$fatal` basınca 1 ile çıkar.
- `flash` SRAM'a yazar: kartın gücü kesilince tasarım silinir.

## Testler

`test/run.sh` (46 kontrol: statik analiz, golden `.fasm`, determinizm, çok dosyalı tasarımlar,
her hata yolu, idempotent kurulum). `FULL=1 test/run.sh` geçici bir klasöre temiz kurulumu da
ekler. CI her push'ta temiz bir `macos-15` (Apple Silicon) GitHub makinesinde temiz kurulumu,
test paketini ve npm paketini koşar.

2026-09-19 ve 20'de 8 GB'lık bir M2'de ölçüldü: temiz kurulum 3 dk 37 sn ile 4 dk 17 sn
arası (üç koşu), 1.4 GB; ikinci koşu 2.7 sn; `bit` 4.6 sn, tepe 552 MB RAM; chipdb üretimi
tepe 859 MB RAM. Kartta, 19 ve 20 Eylül'de beş tasarım: blink şablonu, anahtardan LED'e,
Lab 2 toplayıcı/çıkarıcı, ekran sayacı ve trafik ışığı FSM'i, her biri `dewfpga flash` ile.
yosys 0.69 ile script'in kurduğu zincir, LED'i yakan elle kurulmuş zincirle bayt bayt aynı
`.frames` üretiyor; başka bir yosys ile netlist değişir ve yalnızca I/O yerleşimi karşılaştırılır.
