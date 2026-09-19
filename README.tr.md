# mac-fpga

[English](README.md)

macOS Apple Silicon'da **Vivado olmadan** SystemVerilog yazıp Basys3'e yükle.
Sanal makine yok, Rosetta yok. `.sv` → `.bit` → kart, ~4 saniye.

```bash
curl -fsSL https://nosey-dewdrop.github.io/mac-fpga/install | bash   # ~4 dk, 1.4 GB, tek sefer
```

Sonra herhangi bir klasörde `blink.sv` + `blink.xdc` yaz ve:

```bash
mac-fpga sim      # iverilog
mac-fpga bit      # .sv -> .bit  (~4 sn)
mac-fpga flash    # karta yükle: LED yanar
```

Makefile yok, proje yapısı yok. Klasördeki bütün `.sv`/`.v` dosyaları sentezlenir
(alt modüller ayrı dosyada olabilir). Top modül: `.xdc`'si olan dosya; belirsizse
`mac-fpga flash <top>`. Simülasyon `<top>_tb.sv` ister. Örnek: `mac-fpga new blink`.

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

Vivado'nun tek pencerede yaptığı beş işi beş açık kaynak araç yapıyor;
`install.sh` bunları kurup birbirine bağlıyor.

## Neden bu script var?

Bu zinciri elle kurmak 6 saat sürdü. Hiçbiri tek yerde yazılı olmayan altı duvar:

1. **oss-cad-suite'te nextpnr-xilinx yok.** 497 MB indirip içinde ice40/ecp5/gowin
   olduğunu, Xilinx olmadığını öğrenirsin. Kaynaktan derlemek şart.
2. **Apple clang `-fopenmp` bilmiyor.** nextpnr `-DUSE_OPENMP=OFF` ister.
3. **PEP 668.** Homebrew Python'a `pip install` yasak; venv şart.
4. **prjxray `--recursive` ister.** Yoksa yaml-cpp / googletest / abseil gelmez, cmake patlar.
5. **cmake 4 prjxray'i reddediyor.** `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` ister.
6. **Hazır chipdb yok.** Cihaz başına `bbaexport.py` + `bbasm` ile elle üretilir.

Script her adımı bitince işaretler; yeniden çalıştırınca biten adımlar atlanır.
Log: `~/fpga/install.log`.

## Komutlar

```
mac-fpga install                 zinciri kur (yeniden çalıştırmak güvenli)
mac-fpga check                   altı parça yerinde mi
mac-fpga sim|bit|flash|clean [top]   bulunduğun klasördeki .sv dosyaları + <top>.xdc
mac-fpga --version
mac-fpga new <dizin>             örnek proje: blink.sv + xdc + Makefile + VS Code görevi (⌘⇧B = flash)
```

Kaynaktan: `git clone … && ./install.sh` de aynı işi yapar; `mac-fpga`'yı brew bin'e bağlar.

## Kapsam

- Kart: Digilent **Basys3** (XC7A35T-1CPG236C). Başka 7-serisi kart için
  `install.sh` içinde `DEVICE` değişir ve chipdb yeniden üretilir; test edilmedi.
- Platform: **macOS arm64**. Intel Mac ve Linux test edilmedi, script reddeder.
- Dersin verdiği XDC dosyaları olduğu gibi çalışır (`PACKAGE_PIN` + `IOSTANDARD`).
- `make flash` SRAM'a yazar: kartın gücü kesilince silinir.

## Testler (19 Eyl 2026, M2 8 GB, macOS 15)

| Test | Sonuç |
|---|---|
| Temiz kurulum (boş `FPGA_HOME`) | exit 0, **4 dk 17 s**, 1.4 GB. Adımlar: nextpnr 77 s · venv 5 s · prjxray 114 s · chipdb 58 s |
| Aynı kurulum, boşluklu yola (`sp ace/fpga`) | exit 0, 4 dk 11 s, `make bit` geçti |
| İkinci koşu (idempotency) | exit 0, **2.7 s**, 15 adım "zaten var" ile atlandı |
| Çıktı eşitliği | Taze zincirin `.frames` dosyası elle kurulan zincirle **bayt bayt aynı**; `.bit` yalnızca başlıktaki saat damgasında 4 byte farklı |
| Sabitleme | nextpnr-xilinx `3fd7878`, prjxray `c9f02d8` ve tüm submodule SHA'ları elle kurulanla aynı |
| `make bit` | 4.6 s, tepe 552 MB RAM · `make check` 0.08 s · chipdb üretimi tepe 859 MB RAM |
| shellcheck (`-S style`) | temiz |
| gitleaks | sızıntı yok; repoda kişisel yol / e-posta yok |
| Script hijyeni | `sudo`, `eval`, `curl \| sh` yok; 3 URL hepsi https; yazma yalnız `FPGA_HOME` + brew |
| Intel Mac / brew yok / ağ yok | üçü de tek satır `HATA:` ile exit 1, yarım durum bırakmaz (yarım klon sonraki koşuda yeniden çekilir) |
| `new` var olan dizine / bilinmeyen komut / eksik zincirde `check` | exit 1 |
| npm: `npm pack` → `npm install -g` → boş klasörde `mac-fpga bit` | `.fasm` elle kurulanla aynı; `npm uninstall -g` temiz kaldırır |
| Klasörde iki `.sv` / `.xdc` yok / testbench yok / zincir kurulmamış | tek satır HATA, exit 1 |
| `top.sv` + `counter.sv` (alt modül ayrı dosyada) | top `.xdc`'den bulundu, `top.bit` üretildi |
| `sudo ./install.sh` / boş disk < 4 GB / bozuk venv (Python güncellemesi) | HATA ile durur / HATA ile durur / venv yeniden kurulur |
| Kodda olup XDC'de olmayan port | derlemeden önce `HATA: ... led[15]` ile durur, exit 2 |

Test edilmedi: Intel Mac, Linux, Basys3 dışı kart, kartın olmadığı makinede `make flash`.

## Kanıt

19 Eyl 2026: elle kurulan zincirle Basys3'te LED yandı. Bu script ile temiz dizine
kurulan zincir aynı `.frames` dosyasını üretiyor (yukarıdaki tablo).
Test paketi: `test/run.sh` (27 kontrol). CI her push'ta temiz bir macOS-15 (Apple Silicon)
GitHub makinesinde sıfırdan kurulum + testler + npm paketi koşuyor.
