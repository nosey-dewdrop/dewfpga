# mac-fpga

macOS Apple Silicon'da **Vivado olmadan** SystemVerilog yazıp Basys3'e yükle.
Sanal makine yok, Rosetta yok. `.sv` → `.bit` → kart, ~4 saniye.

```bash
git clone <bu repo> && cd mac-fpga
./install.sh              # tek komut, ~5 dk, 1.4 GB, ~/fpga altına
bin/mac-fpga new blink    # LED yakan örnek proje
cd blink && make flash    # kart takılıyken: LED yanar
```

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
mac-fpga install       zinciri kur (= ./install.sh)
mac-fpga check         altı parça yerinde mi
mac-fpga new <dizin>   örnek proje: blink.sv + blink.xdc + Makefile + VS Code görevi
```

Proje içinde: `make sim` · `make bit` · `make flash` · `make check` · `make clean`.
VS Code'da ⌘⇧B = `make flash`.

## Kapsam

- Kart: Digilent **Basys3** (XC7A35T-1CPG236C). Başka 7-serisi kart için
  `install.sh` içinde `DEVICE` değişir ve chipdb yeniden üretilir; test edilmedi.
- Platform: **macOS arm64**. Intel Mac ve Linux test edilmedi, script reddeder.
- Dersin verdiği XDC dosyaları olduğu gibi çalışır (`PACKAGE_PIN` + `IOSTANDARD`).
- `make flash` SRAM'a yazar: kartın gücü kesilince silinir.

## Kanıt

19 Eyl 2026: bu script ile temiz bir dizine kurulan zincir, dünkü elle kurulan
zincirle **bire bir aynı `.fasm`** üretti; `.bit` yalnızca başlıktaki saat
damgasında (3 byte) ayrışıyor. Elle kurulan zincirle Basys3'te LED yandı.
