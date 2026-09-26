# dewfpga

**AKTİF KOŞU: 2409workflow (patch 1.2).** Plan, brifingler, durum tablosu: `2409workflow.md` (repo kökü, gitignore). Damla "2409workflow K<n>" deyince o dosyadaki "Yeni oturum ne yapar?" adımlarını izle: önce brifing, sonra koşu. Log'lar `docs/patch-notes.md`'ye.

**Ölçmek ürün değil (26 Eyl).** #2 (test seti) 20 saat sürdü, `bin/` ve `templates/`'te tek satır değişmedi: öğrenci aynı derleyiciyi aldı. Kural:
- Her güncelleme ürünü değiştirir (`bin/dewfpga`, `templates/Makefile`, `templates/check_xdc.py`, `install.sh`). `test/sv` (132 probe) sadece o değişikliğin önce → sonra sayısıdır.
- Breaker'lar yalnız o güncellemenin değiştirdiği koda saldırır. Yeni bulunan Vivado yapısı probe olarak `test/sv/expect.tsv`'ye girer ve ait olduğu güncellemeye kalır (#3 sessiz yanlış, #4 red); turu uzatmaz. Test aracını cilalamak (eqv.py kenar durumları, pinlenmemiş satırlar) turu uzatmaz.
- Tur, güncellemenin kendi değişikliğinde yeniden üretilebilir yüksek/orta kırılma kalmayınca biter.
- Damla'ya her güncellemenin sonunda öğrencinin gördüğü farkı göster: önce ne basıyordu, şimdi ne basıyor.

## nerede kaldık — DEVRİ DAİM (20 Eyl 2026)

**DÜŞÜLEN TUZAKLAR** (yeni Claude buna düşme)
- "Siteyi düzelt" DENMEDİ. Masaüstü tasarımı (Canva shell, `site/art/nav.png`, `s.css` nav koordinatları, Silkscreen/VT323/Poppins) Damla'nın; dokunulmaz. İş: ürün kullanılabilirliği + mobil yerleşim.
- "Oldu" demeden önce ölç: `test/run.sh` (son satır `passed N, failed 0, known gaps G`; güncel sayılar `docs/patch-notes.md`'de), `sim/test/e2e.mjs` (31, gerçek Chromium), CI clean install. Kartlı flash sadece kart takılıyken; test suite kartı görürse flash testini atlar.
- Hakem raporu geçer not değil; Damla'nın gördüğü çıktıyı göster (terminal satırı, ekran görüntüsü).
- Yerel portlar kirli olabilir: 4173 ve 8765'te eski sunucular kalmıştı; preview için `BASE=http://localhost:4199/`.
- `site/install`'ı yerelde DEWFPGA_DIR ile koşturma: brew bin'deki `dewfpga` linkini geçici klasöre çevirir (bir kez oldu, geri alındı).
- Post yayında (LinkedIn, 20 Eyl). Linkler sabit; geriye uyumlu değişiklik serbest, adres değiştirme yok.

**GİZLİLİK**: repo PUBLIC. `.rabadon/`, `out/`, `.vercel/`, `.fpga_home`, `_canva/import/` gitignore'da. `test/run.sh` "/Users/" sızıntısını tarar (`/Users/you/` hariç). Kişisel yol, token, mail push edilmez.

**KOD DURUMU**
- `bin/dewfpga` (bash): install/check/sim/bit/flash/clean/new/uninstall; motor `templates/Makefile`. `install.sh` pinli commit'ler (nextpnr 3fd7878, prjxray c9f02d8), chipdb/venv damgaları. `site/install` = curl|bash, sha256, tek fonksiyon.
- `sim/` (vite): tek sayfa, `board` | `testbench` görünümü, aynı üç dosya; `blink` örneği `templates/`'ten `?raw`. `tb.html` yönlendirme.
- `docs/manual-setup.md` → `docs/build.sh` (html) + `docs/pdf.sh` (Chrome, 13 sayfa). 9 bölüm, her komutun gerçek çıktısı.
- Yayın: GitHub Pages (kanonik, `nosey-dewdrop.github.io/dewfpga`) + Vercel aynası `dewfpga.noseydewdrop.com` (`./deploy.sh`, `/dewfpga/` → `/`).
- Ölçüldü 20 Eyl: kurulum 3:37–4:17, `bit` 4.6 s, kartta 5 tasarım (blink, sw→led, Lab 2 adder, display sayaç, trafik FSM).

**YAPILDI 20 Eyl (akşam)**
- Sıfır bağlamlı okuyucu (ajan) docs'u CLI ile yürüdü; takıldıkları kapatıldı: `check_xdc.py` eksik pin hatası düzeltmeyi söylüyor (case farkını adıyla), kullanılmayan `led[15]` artık uyarı değil; Makefile nextpnr'ın `[current_design]` gürültüsünü ve tekrar satırlarını düşürüyor; `sim` testbench-yok mesajı somut; `errors/board-not-found/` sayfası + docs §2 bağlantısı; docs §2 clean listesi, §5 xdc için curl, §6 tasks metni.
- VS Code: `templates/.vscode/settings.json` → iverilog `-y . -Y .sv -Y .v` (testbench tek başına lint'lenince "Unknown module blink" ile hep kırmızıydı, düzeldi), `-g2012` uzantı zaten ekliyor, `files.associations` kaldırıldı (uzantının kendi `xdc` dilbilgisi var). Lint kaydedince koşar, docs öyle diyor. GUI ekran görüntüsü alınmadı: Terminal'de Ekran Kaydı izni yok ve Damla "VS Code'u açıp durma, ürün editörden bağımsız" dedi.
- Telefon: `site/s.css` ve `sim/src/style.css` sonunda `@media (max-width:700px)` bloğu: altı çip 44 px metin (per-chip masaüstü kuralları `nav.top a[class]` ile eziliyor), okuma sütunu tam genişlik, board genişliğe sığar, `code{overflow-wrap:anywhere}`. 11 sayfa × 2 viewport taşma 0; masaüstü 1366 yedi sayfa piksel-aynı (PIL diff). Hata alt sayfalarının nav'ı eski `ul` yapısındaydı (masaüstünde liste noktaları görünüyordu), altı çipli yapıya eşitlendi.
- Yayın: push (CI) + `./deploy.sh` (Vercel aynası doğrulandı: s.css'te phones bloğu, board-not-found 200).

- Gece turu (üç denetim ajanı: CLI işkence 40+ vaka, site tarama 2 host × 2 viewport, docs çapraz tutarlılık): CLI'da 7 kıran kapandı (`$display` sentezde düşürülür `delete t:$print`; `_tb.v`; `bit src/x` net hata; BOM net hata; `vvp -n` + perl alarm `SIM_TIMEOUT=120` ile asılma yok; `tb_top.sv` gibi `_tb`siz testbench yakalanır), yanıltanlar kapandı (çok saatli özet her saati yazar, `iteration LUT` bug'ı, "yorumlu pin" vs "yanlış ad" ayrımı, IOSTANDARD eksik kontrolü, sığmama ipucu, başarısız build eski `.bit`'i siler, no-op'ta tek satır). Sayılar tek gerçek: 46 test, 5 elle adım, 4.6 s, 5 kart tasarımı; hata sayfaları rehberin bölüm numaralarını ve pinli komutları kullanır. **Vercel sızıntısı** kapatıldı: `site/.rabadon/` aynaya gidiyordu (oturum json'ları), `deploy.sh` artık siliyor, eski 13 deploy `vercel rm` ile silindi, canlıda 404. iverilog wasm build reçetesi+patch repoda (`sim/src/tb/wasm/build/`, GPL iddiası artık doğru). Sitemap'ten noindex `sim/` çıkarıldı (sim hâlâ noindex: Damla paylaşmadı).

- **Gerçek repo turu (21 Eyl):** GitHub'dan 94 CS223 reposu klonlandı, 81 gerçek lab klasörü CLI'dan geçirildi (harness `scratchpad/corpus_run.py`, sonuçlar `corpus_results*.json`). Başta 2 lab derleniyordu, 21 Eyl'de 8 (o günün dökümü 33+23+17+5 = 78 ediyordu, 73 değil). 24 Eyl'de kaydedilen ölçüm (`corpus_results.json`, 89 klasör): 8'i derleniyor (`dewfpga bit` tek başına 2'sini derledi, 061'de Vivado projesinin top'unu değil düz sayacı; 6'sı CLI top seçmeyi reddedince harness'ın verdiği adla derlendi, 058'de o ad da Vivado'nun top'u değil; probe 93); 40'ı sadece testbench klasörü; 23'ü kendi pin dosyasını istiyor; 7'si netlist biçiminde dosya (2'si Vivado'nun funcsim çıktısı, 5'i dersin netlist biçimli hazır modülleri: 4'ü tek bir repodaki dersin dağıttığı klasörün kopyası, 1'i bu modülleri kopyalamış bir öğrenci projesi; Vivado derliyor, CLI reddediyor, bizim açığımız, probe 57); 10'u Vivado'nun kabul ettiği ya da ne yaptığı doğrulanmamış kod (5 isimsiz instance, 3 always_comb latch, 1 async reset'li always_ff'te if/else'ten sonra atama, 1 async reset'e OR'lanmış senkron clear; hepsinin `test/sv`'de probe'u var: 02, 01, 80, 53); 1'i geçersiz kod (kapanmamış begin, probe 06). Top artık hiyerarşiden bulunuyor (Vivado gibi: kimsenin instantiate etmediği modül), testbench içerikten (portsuz ya da `$finish`), dosya adı serbest; yedi-segment port satırı yerinde düzeltilip not basılıyor. Test paketi o gün 51.

**AÇIK İŞ**
1. Kanonik adres kararı Damla'da (github.io vs noseydewdrop). Değişirse README + installer BASE + canonical birlikte.
2. Kartlı doğrulama: `dewfpga flash` çıktısı bu turda kartsız alındı ("board not found" yolu doğrulandı); kart takılıyken `test/run.sh` flash testini de koşar.

**KALICI KARARLAR**: tek motor Makefile (CLI + manuel yol); `-nobram`, `--seed 1`, `--freq 100` yoksa; timing FAIL = hata; tb `$error` = exit 1; wrapper testi yok, ölçü "önemli problem, önemli çözüm".
