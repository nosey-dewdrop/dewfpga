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

**AÇIK İŞ**
1. VS Code uçtan uca: `dewfpga new x && code x` → uzantı önerisi çıkıyor mu, noktalı virgül silince kırmızı çizgi geliyor mu (DOĞRULANMADI, headless bakılamadı), Cmd Shift B flash. Eksikse `templates/.vscode/settings.json` düzelt.
2. Mobil yerleşim: `site/*.html` + `sim/index.html` telefonda; nav strip `nav.png` 1366 sabit, `.work` grid 1000px altı tek sütun ama board SVG 860px min. Masaüstünü bozmadan `@media` ile; ekran görüntüsüyle kanıtla (Chrome headless `--window-size=390,844`).
3. Kanonik adres kararı Damla'da (github.io vs noseydewdrop). Değişirse README + installer BASE + canonical birlikte.

**KALICI KARARLAR**: tek motor Makefile (CLI + manuel yol); `-nobram`, `--seed 1`, `--freq 100` yoksa; timing FAIL = hata; tb `$error` = exit 1; wrapper testi yok, ölçü "önemli problem, önemli çözüm".
