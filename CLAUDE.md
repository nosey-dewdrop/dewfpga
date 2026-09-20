# dewfpga

## nerede kaldık — DEVRİ DAİM (20 Eyl 2026)

**DÜŞÜLEN TUZAKLAR** (yeni Claude buna düşme)
- "Siteyi düzelt" DENMEDİ. Masaüstü tasarımı (Canva shell, `site/art/nav.png`, `s.css` nav koordinatları, Silkscreen/VT323/Poppins) Damla'nın; dokunulmaz. İş: ürün kullanılabilirliği + mobil yerleşim.
- "Oldu" demeden önce ölç: `test/run.sh` (46), `sim/test/e2e.mjs` (31, gerçek Chromium), CI clean install. Kartlı flash sadece kart takılıyken; test suite kartı görürse flash testini atlar.
- Hakem raporu geçer not değil; Damla'nın gördüğü çıktıyı göster (terminal satırı, ekran görüntüsü).
- Yerel portlar kirli olabilir: 4173 ve 8765'te eski sunucular kalmıştı; preview için `BASE=http://localhost:4199/`.
- `site/install`'ı yerelde DEWFPGA_DIR ile koşturma: brew bin'deki `dewfpga` linkini geçici klasöre çevirir (bir kez oldu, geri alındı).
- Post yayında (LinkedIn, 20 Eyl). Linkler sabit; geriye uyumlu değişiklik serbest, adres değiştirme yok.

**GİZLİLİK**: repo PUBLIC. `.rabadon/`, `out/`, `.vercel/`, `.fpga_home`, `_canva/import/` gitignore'da. `test/run.sh` "/Users/" sızıntısını tarar (`/Users/you/` hariç). Kişisel yol, token, mail push edilmez.

**KOD DURUMU**
- `bin/dewfpga` (bash): install/check/sim/bit/flash/clean/new/uninstall; motor `templates/Makefile`. `install.sh` pinli commit'ler (nextpnr 3fd7878, prjxray c9f02d8), chipdb/venv damgaları. `site/install` = curl|bash, sha256, tek fonksiyon.
- `sim/` (vite): tek sayfa, `board` | `testbench` görünümü, aynı üç dosya; `blink` örneği `templates/`'ten `?raw`. `tb.html` yönlendirme.
- `docs/manual-setup.md` → `docs/build.sh` (html) + `docs/pdf.sh` (Chrome, 11 sayfa). 9 bölüm, her komutun gerçek çıktısı.
- Yayın: GitHub Pages (kanonik, `nosey-dewdrop.github.io/dewfpga`) + Vercel aynası `dewfpga.noseydewdrop.com` (`./deploy.sh`, `/dewfpga/` → `/`).
- Ölçüldü 20 Eyl: kurulum 3:37–4:17, `bit` 4.6 s, kartta 5 tasarım (blink, sw→led, Lab 2 adder, display sayaç, trafik FSM).

**YAPILDI 20 Eyl (akşam)**
- Sıfır bağlamlı okuyucu (ajan) docs'u CLI ile yürüdü; takıldıkları kapatıldı: `check_xdc.py` eksik pin hatası düzeltmeyi söylüyor (case farkını adıyla), kullanılmayan `led[15]` artık uyarı değil; Makefile nextpnr'ın `[current_design]` gürültüsünü ve tekrar satırlarını düşürüyor; `sim` testbench-yok mesajı somut; `errors/board-not-found/` sayfası + docs §2 bağlantısı; docs §2 clean listesi, §5 xdc için curl, §6 tasks metni.
- VS Code: `templates/.vscode/settings.json` → iverilog `-y . -Y .sv -Y .v` (testbench tek başına lint'lenince "Unknown module blink" ile hep kırmızıydı, düzeldi), `-g2012` uzantı zaten ekliyor, `files.associations` kaldırıldı (uzantının kendi `xdc` dilbilgisi var). Lint kaydedince koşar, docs öyle diyor. GUI ekran görüntüsü alınmadı: Terminal'de Ekran Kaydı izni yok ve Damla "VS Code'u açıp durma, ürün editörden bağımsız" dedi.
- Telefon: `site/s.css` ve `sim/src/style.css` sonunda `@media (max-width:700px)` bloğu: altı çip 44 px metin (per-chip masaüstü kuralları `nav.top a[class]` ile eziliyor), okuma sütunu tam genişlik, board genişliğe sığar, `code{overflow-wrap:anywhere}`. 11 sayfa × 2 viewport taşma 0; masaüstü 1366 yedi sayfa piksel-aynı (PIL diff). Hata alt sayfalarının nav'ı eski `ul` yapısındaydı (masaüstünde liste noktaları görünüyordu), altı çipli yapıya eşitlendi.
- Yayın: push (CI) + `./deploy.sh` (Vercel aynası doğrulandı: s.css'te phones bloğu, board-not-found 200).

**AÇIK İŞ**
1. Kanonik adres kararı Damla'da (github.io vs noseydewdrop). Değişirse README + installer BASE + canonical birlikte.
2. Kartlı doğrulama: `dewfpga flash` çıktısı bu turda kartsız alındı ("board not found" yolu doğrulandı); kart takılıyken `test/run.sh` flash testini de koşar.

**KALICI KARARLAR**: tek motor Makefile (CLI + manuel yol); `-nobram`, `--seed 1`, `--freq 100` yoksa; timing FAIL = hata; tb `$error` = exit 1; wrapper testi yok, ölçü "önemli problem, önemli çözüm".
