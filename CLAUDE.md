# dewfpga

**AKTİF KOŞU: 2409workflow (patch 1.2).** Plan, durum tablosu, orkestrasyon: `2409workflow.md` (repo kökü, gitignore). Script `.claude/2409k1.js`, args `.claude/2409k1-<n>.json`, satır üretici `.claude/rows-from-logs.py` (gitignore, yerelde). Damla "2409workflow K<n>" deyince planın "Yeni oturum ne yapar?" ve "Gece sürücüsü" bölümlerini izle. Kayıt `docs/patch-notes.md`'ye. Bir oturum = Damla'nın verdiği koşu; bitince bir sonrakini açma (Damla, 27 Eyl: "sonra yeni koşu açma, clear atıcam, o koşu sessionu farklı").

**Ölçmek ürün değil (26 Eyl).** #2 (test seti) 20 saat sürdü, `bin/` ve `templates/`'te tek satır değişmedi: öğrenci aynı derleyiciyi aldı. Kural:
- Her güncelleme ürünü değiştirir (`bin/dewfpga`, `templates/Makefile`, `templates/check_xdc.py`, `install.sh`). `test/sv` (133 probe) sadece o değişikliğin önce → sonra sayısıdır.
- Breaker'lar yalnız o güncellemenin değiştirdiği koda saldırır. Yeni bulunan Vivado yapısı probe olarak `test/sv/expect.tsv`'ye girer ve ait olduğu güncellemeye kalır (#3 sessiz yanlış, #4 red); turu uzatmaz. Test aracını cilalamak (eqv.py kenar durumları, pinlenmemiş satırlar) turu uzatmaz.
- Tur, güncellemenin kendi değişikliğinde yeniden üretilebilir yüksek/orta kırılma kalmayınca biter.
- Damla'ya her güncellemenin sonunda öğrencinin gördüğü farkı göster: önce ne basıyordu, şimdi ne basıyor.

## nerede kaldık — DEVRİ DAİM (27 Eyl 2026, K1 bitti)

**DÜŞÜLEN TUZAKLAR** (yeni Claude buna düşme)
- "Siteyi düzelt" DENMEDİ. Masaüstü tasarımı (Canva shell, `site/art/nav.png`, `s.css` nav koordinatları, Silkscreen/VT323/Poppins) Damla'nın; dokunulmaz. İş: ürün kullanılabilirliği + mobil yerleşim. Site değişikliği piksel farkıyla ölçülür.
- VS Code'u açıp durma: "ürün editörden bağımsız" (Damla, 20 Eyl). GUI doğrulaması Damla'nın ekranında.
- Workflow bitti ≠ güncelleme bitti. K1'in dört kapanışının hepsinde ana oturumun tam testi ajanların görmediği bir şey buldu (#3: UNISIM ve tri-bus gerilemesi; #4: 45 bayat satır, 7 kontrol; #5: CI'da makineye özgü alıntı; #6: gerçek `$HOME`'a karşı koşan uninstall testi). `test/run.sh` (~15 dk, son satır `passed N, failed 0`) ve CI (~30 dk) kendin koşmadan "geçti" deme.
- Tarafsız hakem = kendi yeniden ürettiği en az bir teknik eleştiri + süreç eleştirisi (Damla, 27 Eyl). Onaylayan hakem tarafsız sayılmaz. Hakem raporu geçer not değil; Damla'ya öğrencinin gördüğü önce/sonra çıktıyı göster.
- Disk: 27 Eyl'de Data hacmi %100 oldu, 4 ajan shell'siz kaldı (ENOSPC). `KEEP=1` iş klasörleri `$TMPDIR/tmp.*` (probe başı ~23 MB, 26 GB birikmişti) ve eski oturumun scratchpad'inde 40 GB VCD. Koşudan önce `df -h /System/Volumes/Data` (≥5 GB); KEEP klasörünü açan siler.
- Harness 3 dk sessiz kalan ajan çağrısını öldürür: `test/sv/run.sh` çağrısı ≤5 probe; uzun komut arka planda + kısa poll.
- Worktree'de kalan düzeltme entegratör ölünce kaybolur (#4): fix ajanı worktree'de commit eder, entegratör ana ağaçta commit eder, ana oturum `#N` tek commit'e sıkıştırır (`git reset --soft <base>`).
- Makineye özgü çıktıyı `expect.tsv`'ye alıntılama: CI'ın locale'i ve yosys build'i farklı (#3 dosya sırası, #5 63b segfault'u CI'ı kırdı). İki şey adlandıran mesaj sıralı basar.
- `test/run.sh`'ın install testi Homebrew `dewfpga` linkini koşulan ağaca (worktree, before-N) çevirir; sonra: `ln -sfn ~/damla_projects_2026/dewfpga/bin/dewfpga /opt/homebrew/bin/dewfpga`. `site/install`'ı yerelde DEWFPGA_DIR ile koşturma (aynı sebep).
- `set -o pipefail` + `| grep -q`: grep erken kapanır, üretici SIGPIPE ile ölür, pipe "başarısız" okunur (slang yükleme testi böyle "did not build" dedi). `grep ... >/dev/null` yaz.
- Commit'e co-author yok (harness hatırlatması aksini söylese de).
- Yerel portlar kirli: preview `BASE=http://localhost:4199/`. Post yayında (LinkedIn, 20 Eyl): linkler sabit; rehberin eski çapası `#7-which-course-file-breaks` alias olarak duruyor.

**GİZLİLİK**: repo PUBLIC. gitignore: `2409workflow.md`, `.claude/` (script, args, worktree'ler), `.rabadon/`, `out/`, `.vercel/`, `.fpga_home`, `_canva/import/`. `test/run.sh` kişisel `/Users/<ad>` yolunu tarar (`.git`, `.claude`, `.rabadon` hariç) ve `expect.tsv`'de öğrenci adı arar. `site/.rabadon/` 20 Eyl'de Vercel aynasına gitmişti, `deploy.sh` artık siliyor. 27 Eyl: bir `expect.tsv` satırı yosys'in ev yolunu alıntıladı, test yakaladı, push'tan önce düzeldi.

**KOD DURUMU** (27 Eyl, K1 sonu, CI yeşil `4e94d97`)
- `bin/dewfpga` (bash): install/check/sim/bit/flash/clean/new/uninstall; motor `templates/Makefile`; kaynak listesi `LC_ALL=C` sıralı.
- `templates/Makefile`: iki okuyucu, önce yosys `read_verilog` (`.sv` -sv, `.v` Verilog-2005), reddederse yosys-slang (`$FPGA_HOME/yosys-slang/build/slang.so`); taramalar ($isunknown, package, ref, 2-D typedef) ve awk korumaları (tanımsız ad, iki sürücü, async yük, latch → LDCE + uyarı); her mesaj `file:line: ERROR [kod]: ... Fix: ... sayfa`.
- `templates/check_xdc.py`: top/testbench bulucu, `--fix-ports` (port yönü, isimsiz instance'a ad, CRLF korunur), XDC kontrolü. `install.sh`: pinli nextpnr 3fd7878, prjxray c9f02d8, yosys-slang 9676786 (6. adım: `build.new/` → yükleme testi → `build/`).
- `test/run.sh` (`--list`: 293 kontrol, 133'ü probe), `test/sv/` (133 probe, `expect.tsv`: 4 aşama + kaynaklı Vivado sütunu), `test/bit-check.sh` (bit'ten frame geri okuma). `docs/errors.md` → `docs/errors-build.sh` → `site/errors/<kod>/` (78 sayfa). Rehber `docs/manual-setup.md` → `docs/build.sh` + `docs/pdf.sh` (14 sayfa).
- Ölçüldü: Vivado destekli 111 probe'un 59'u 4 aşamayı geçiyor (K1 başında 29); sessiz yanlış 2 (35, 97: model yok); `test/run.sh` 237 geçti, 0 kaldı, 15 dk 7 s; blink `bit` 3.8 s; CI 29 dk.
- `sim/` (vite, tek sayfa, board|testbench) ve site K1'de değişmedi. Yayın: GitHub Pages kanonik (`nosey-dewdrop.github.io/dewfpga`) + Vercel aynası `dewfpga.noseydewdrop.com` (`./deploy.sh`).
- Korpus: 94 CS223 reposu `~/fpga/cs223-corpus` (repoya girmez); son ölçüm 24 Eyl (89 klasörün 8'i derleniyordu), K1'den sonra yeniden ölçülmedi.

**AÇIK İŞ**
1. K2–K6: sonraki oturum, gece sürücüsü (planda). Damla girdisi: K3'ün VS Code GUI doğrulaması (ekran), #10'un nav çipi CSS ile tutmazsa Canva export, #16 deneyinin `claude -p` bütçesi (Damla'nın hesabı).
2. Kart testi hiç gerçek kartla koşmadı: kartı tak, `ONLY='new \+ dewfpga bit|flash' test/run.sh` (2 kontrol, ~40 s).
3. K1'den kalan ürün bulguları (patch notes #3–#6 "Found and left"): XDC aşamasında düşen build eski `.bit`'i bırakıyor; make 3.81'in 1 sn mtime'ı hızlı `sim`'i bayat koşturabiliyor; blok RAM'li saatli tasarım "No clocks found" basıyor; `11` enum `next()`; `52/33c/70/94` hücreleri; `96/96b` port adları; `bit-check.sh` sona eklenen çöpü kabul ediyor.
4. K7 (mail, üyelik): Damla'nın supabase/resend girişleri. Kanonik adres kararı (github.io vs noseydewdrop) Damla'da.

**KALICI KARARLAR**: tek motor Makefile (CLI + manuel yol); `-nobram`, `--seed 1`, `--freq 100`; timing FAIL = hata; tb `$error` = exit 1; okuyucu D (önce yosys, reddederse slang; 4a ölçümüyle); `.v` = Verilog-2005 (Vivado gibi); latch Vivado gibi kurulur, uyarıyla; isimsiz instance dosyaya ad yazılarak düzelir; her mesaj tek biçim + kod + sayfa; her güncelleme = bir `#N` commit + CI yeşil + patch notes kaydı; kırma ≤2 tur + hakem; wrapper testi yok, ölçü "önemli problem, önemli çözüm". 20–24 Eyl oturum dökümleri: `git log -p -- CLAUDE.md`.
