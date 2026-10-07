# dewfpga

Apple Silicon Mac'te SystemVerilog yaz, Digilent **Basys3**'e yükle. Vivado yok, sanal
makine yok, Rosetta yok. `.sv` → `.bit` → kart, beş saniyenin altında.

[English](README.md)

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash   # ~4 dk, diskte yaklaşık 0.3 GB, tek sefer
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

`.sv`/`.v` modülleri ve `.xdc` bulunan düz bir klasörde veya Vivado projesinde çalışır.
`.xpr`, etkin tasarım, kısıt ve simülasyon dosyalarını seçer. İç içe bir `.srcs` klasöründen
çalıştırılan komut proje kökünü kullanır; çıktılar da oraya yazılır. `dewfpga tops`, dosya
bırakmadan top adaylarını listeler. Adını ayrıca vermediğinde projenin seçili top modülü
kullanılır: `dewfpga bit <top>`. Düz klasörde hiyerarşi ve tek eşleşen `.xdc` seçim yapar;
belirsiz durumda top adını vermen gerekir. Dosya adı tek başına seçim nedeni değildir.
Testbench, portu olmayan ve tasarımı instantiate eden modüldür; tasarım modülündeki
`$finish`/`$stop` hatadır. Yalnız package/interface/typedef içeren dosyalar hâlâ CLI sınırıdır.
Örnek: `dewfpga new blink`.

## Kurulum

Tek satır, Node gerekmez:

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash
```

CLI'ı `~/.dewfpga`'ya koyar (sha256 `dewfpga.tgz.sha256` ile karşılaştırılır; bu bir bütünlük
kontrolü, imza değil), `dewfpga`'yı Homebrew'un bin klasörüne bağlar ve `dewfpga install`'u
çalıştırır. Güncellemek için aynı satırı tekrar çalıştır. `dewfpga uninstall` kurulumun
`~/fpga`'da ürettiklerini (nextpnr-xilinx, prjxray, chipdb, venv, log), `~/.dewfpga`'yı ve
linki siler; `~/fpga`'daki başka dosyalara dokunmaz. Gerekenler: Apple Silicon'da macOS ve
Homebrew. Derlemeler Apple'ın Command Line Tools'unu da ister (git, make, clang); Homebrew'un
kurucusu eksikse onları kendi kurar, iki kurucu da kontrol eder ve biri eksikse ya da Homebrew
PATH'te değilse çalıştırılacak tek satırı basar. Sonradan npm paketine geçeceksen önce
`$(brew --prefix)/bin/dewfpga`'yı sil, npm aynı yolu istiyor. 7 Ekim 2026'dan önce yapılmış bir kurulum
klonlarını (1.5 GB, 7 Ekim'de ölçülen 1543 MB) tutar ve olduğu gibi bırakılır; `dewfpga uninstall && dewfpga install` küçük olanı kurar.

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
dewfpga sim|bit|flash|clean [top]   düz klasör veya Vivado projesi
dewfpga tops                        top adaylarını dosya yazmadan listele
dewfpga vscode [--remove]           editör bağlantısını kur veya kaldır
dewfpga new <dizin>                 VS Code görevli blink örneği (⌘⇧B = flash)
dewfpga uninstall                   kurulumun ürettiklerini, CLI'ı ve linki sil (senin dosyaların ve brew paketleri kalır)
dewfpga mcp                         ajan araçlarını stdio üzerinden sun
dewfpga --version
```

Ajanlar için `check`, `sim`, `bit` ve `flash`, `--json` kabul eder:
`dewfpga sim --json --timeout=180`. Standart çıktıda tek `dewfpga/result@1` nesnesi
bulunur; süreç kodu `exit_code` ile eşleşir. `diagnostics` hata ve düzeltmeleri,
`log.tail` ayrıştırılamayan çıktıyı gösterir. Eski `.bit` dosyası yeni derlemenin
başarısı sayılmaz; `artifacts` yeni, önbellekteki ve bayat çıktıları ayırır.
[Ajan arayüzü ve sınırlar](docs/agent-interface.md).

`dewfpga install`, isteğe bağlı MCP SDK ortamını da kurar. İstemciyi `dewfpga mcp`
komutuna bağlayın: [kurulum ve araç parametreleri](docs/agent-interface.md#mcp-server).

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

## Hatalar

`sim`, `bit` ya da `flash` durduğunda tek biçimde tek satır basar, `dosya:satır: ERROR [kod]: mesaj`,
ardından düzeltmeyi ve o kodun sayfasının adresini. Her kod, gördüğün satır, nedeni, düzeltmesi ve bir
örnekle: [hata kataloğu](https://nosey-dewdrop.github.io/dewfpga/errors/), `docs/errors.md`'den
`docs/errors-build.sh` üretir.

## Testler

`test/run.sh` (351 kontrol, `test/run.sh --list`'in bastığı sayı: statik analiz, golden `.fasm`,
determinizm, çok dosyalı tasarımlar, her hata yolu, yeniden derleme kuralları, idempotent kurulum,
bozuk kopyada probe koşturucu ve `test/sv`'deki 137 SystemVerilog probe'u; kart testi ve temiz kurulum koşmasa
da sayılır, yani bir koşu bundan daha az PASS satırı basar, daha çok değil). `--list` her kontrolün
adını basar; `ONLY=regex test/run.sh` adı eşleşenleri koşar. `FULL=1 test/run.sh` geçici bir klasöre temiz kurulumu da
ekler. CI her push'ta temiz bir `macos-15` (Apple Silicon) GitHub makinesinde temiz kurulumu,
test paketini ve npm paketini koşar.

`test/fuzz/run.sh <ilk tohum> <adet>` paketten ayrıdır: `gen.py` her tohum için DDCA'nın öğrettiği
SystemVerilog'da rastgele bir tasarım yazar (her dil özelliği bir anahtar, `--list` adlarını basar), üzerinde
`dewfpga sim` ve `dewfpga bit` koşar, netlist aynı testbench ile simüle edilir ve iki iz bit bit karşılaştırılır.
Son satırı sonuçları sayar (`ok`, `silent-wrong`, `refused-coded`, `refused-uncoded`, `crash`, `sim-refused`).

2026-09-19 ve 20'de 8 GB'lık bir M2'de ölçüldü: temiz kurulum 3 dk 37 sn ile 4 dk 17 sn
arası (üç koşu), diskte yaklaşık 0.3 GB (7 Ekim'de ölçülen 237 MB; isteğe bağlı ajan SDK'sı 51 MB ekler;
derlerken yaklaşık 1 GB, kurucu 2 GB boş yer ister); ikinci koşu 2.7 sn; `bit` 4.6 sn, tepe 552 MB RAM; chipdb üretimi
tepe 859 MB RAM. Kartta, 19 ve 20 Eylül'de beş tasarım: blink şablonu, anahtardan LED'e,
Lab 2 toplayıcı/çıkarıcı, ekran sayacı ve trafik ışığı FSM'i, her biri `dewfpga flash` ile.
yosys 0.69 ile script'in kurduğu zincir, LED'i yakan elle kurulmuş zincirle bayt bayt aynı
`.frames` üretiyor; başka bir yosys ile netlist değişir ve yalnızca I/O yerleşimi karşılaştırılır.
