# dewfpga

## nerede kaldık — DEVRİ DAİM (4 Ekim 2026)

**DÜŞÜLEN TUZAKLAR** (yeni Claude buna düşme)
- Dev diary talimatı ilk mesajdaydı ve başlıklar netti, ama gece boyunca yazılmadı; Damla sormak zorunda kaldı.
  Sonra iki kez yanlış okundu: "kalabalık yapma" kısa tut demek DEĞİL ("o zaman commit history döner"),
  "her değişiklik" her commit demek DEĞİL ("yazmaya değer, büyük, önemli değişiklik"). Damla bu defterden
  yazı yazıyor. Kural aşağıda, "Aktif iş ve yetki" bölümünde.
- Ajanın "bitti"si kabul değil. T2 "öbür testler etkilenmez" dedi, test_sender_idem'i koşmamıştı. Ana
  oturumun koşusu rollback'in migration diye yüklendiğini yakaladı. Her ajan sonucunda 9 mail paketi +
  tarayıcı ana oturumda koşulur.
- Girdi gelmeden aynı Supabase Unauthorized kontrolünü, aynı testleri, aynı CI'ı tekrar etme; hazır adayı
  baştan geliştirme. Önce `.claude/recovery-20261003/fable-handoff-state.json` ve özel girdi dosyasının dolu
  alanlarına bak (değerleri basma).
- Alt ajanlar YALNIZ Fable (Damla, 3 Eki: "Codex veya Opus kullanma"). En çok 3 eşzamanlı Claude oturumu.
- Push iki CI koşusu açar (push + pull_request). Kabul kaynağı PR koşusu; push kopyası iptal edilir (GitHub
  dakika limiti). `gh run watch` GitHub 504'te düşer: koşu bitmeden düştüyse dayanıklı döngüyle izle.

**GİZLİLİK**: repo public. Secret'lar yalnız `.claude/recovery-20261003/activation-inputs.private.json`
(0600, git dışı); sohbete, loga, ajan çıktısına, commit'e girmez. Dev diary `DDMM-dev-diary.txt` ana repo
kökünde, git dışı. Push öncesi diff'te `/Users/`, kişisel ad, JWT/`re_` anahtar taraması yapılır.

**KOD DURUMU**: dal `worktree-dewfpga-night-20261003`, HEAD c2cf391, PR#1 taslak; CI 37156455217 başarılı
(macOS CLI 271/0/52, iki web, offline-mail). Ana dala merge ve canlı yayın yok. Mail: `mail/sql` yalnız
001–003 migration'ı; operatör scriptleri `mail/ops/` (read-only preflight, dewfpga-only rollback). Yerel 9
paket: activation142/0, SQL187/0, mail60/0, sender tüm senaryolar, lifecycle112/0, usage13 OK,
integration8 OK, pages137/0, browser158/0.

**AÇIK İŞ** (hepsi dış girdi bekliyor; otonom açılmaz)
1. Damla özel girdi dosyasına yazacak: `SUPABASE_DB_URL`, `SUPABASE_SERVICE_KEY`, Full access
   `RESEND_API_KEY`, `DEWFPGA_OWNER_EMAIL`, privacy controller/contact/retention. Sonra: preflight read-only,
   GET /usage + domain, kesin uygulama listesi, tek canlı onay (migration, Auth SMTP/redirect, merge/yayın,
   owner-test).
2. Fiziksel: Basys3 takılınca `ONLY='new \+ dewfpga bit|flash' test/run.sh`; VS Code GUI Damla'nın ekranında;
   Safari/telefon kabulü yayından sonra.
3. 52 bilinen derleyici açığı bu devrin kapsamı değil.

**KALICI KARARLAR**: ledger yalnız dewfpga'nın kendi payını sınırlar; ölçüm yoksa gönderme. CI ve varsayılan
CLI mail göndermez. Provider kabulü inbox teslimi değildir. Sahte attestation yok. Tasarım (Canva shell,
nav, fontlar) korunur.

## Aktif iş ve yetki

2409workflow, patch 1.2. Yerel plan `2409workflow.md`; ilerleme ve kanıtlar
`.claude/recovery-20261003/`; ürün kaydı `docs/patch-notes.md`.
3 Ekim talimatı: planı bitene kadar sürdür, orkestrasyonu yönet, teknik sorunları
kanıtla ve düzelt. Önceki "bir koşu bitince dur, clear bekle" talimatı bu devam
izniyle değişti. Bir ajan veya test başarılı döndü diye bütün hedefi tamamlandı sayma.

Alt ajanlar mevcut Claude Code abonelik oturumunda yalnız Fable 5.1 kullanır (3 Ekim devri;
Opus ve Codex yok). Gerçek model/oturum ve süreç durumunu doğrula. API hesabına, başka
sağlayıcıya veya ödeme yoluna sessizce geçme. Görevler küçük, dosya sahipliği açık,
çalışma ağaçları ayrı olsun; kısa kanıt devri kullan, bütün geçmişi yeniden okuma.
En fazla üç eşzamanlı Claude görevi; ağır sentez süreçlerinde makine kaynaklarını
kontrol et. Gözlem zaman aşımını ölü süreç sanma; aynı handle veya PID'yi doğrula.

Geliştirme dalı, testler ve taslak PR güncellemeleri yürütülebilir. Ana dala merge,
canlı site/DB/Auth değişikliği veya gerçek mail/duyuru yapılmış sayılmasın; bunlar
ayrı canlı kabul ve yetki gerektirir. Ana planın dış hesap ve fiziksel adımlarını
sessizce kapsamdan çıkarma. Dev diary: ana repo kökünde gün başına `DDMM-dev-diary.txt`
(git'e girmez). Yalnız önemli değişiklik ya da gerçek test sonucu girer; başlıklar birebir
`geliştirmeler/güncellemeler:`, `testler:`, `yeni özellikler:`. Her madde "Eskiden / Artık",
düz cümle ve gerçek sayı; log yolu, SHA, jargon yok (kanıt state dosyasında). Damla bundan yazı
yazıyor: kısaltma da, dolgu da yok. Yalnız ana oturum yazar.

## Doğrulanmış durum — 3 Ekim 2026

- #7–16 geliştirme dalında; ilgili uzak CI koşuları geçti. #16 ajan deneyinin
  önceki V2 karşılaştırması geçersiz; V3 raporu sınırlı kanıtı ve sapmayı açıklar.
- #17–23 `db5b855`: tarayıcı çalışma alanı, dosya aktarımı, lint/Problems, kart ve
  saat davranışı, motor düzeltmeleri. İki tarayıcıda source24/0, workspace69/0,
  UI129/0, eski hata5/0, board72/0, worker17/0. Gerçek worker için üç netlist ve
  576 DigitalJS çıktı karşılaştırması; motor izolasyonu16/0. Bunlar tüm korpusta
  davranış eşdeğerliği değildir. 133 derleme kararında124 aynı,7/2 farklı.
- Aynı #17–23 adayının gerçek MCP SDK ile tam yerel CLI koşusu273/0,52 bilinen açık.
  Uzak CI37129232619 geçti: iki web işi ve macOS başarılı, CLI271/0/52; iki kontrol
  CI Yosys sürümüne bağlı atlandı. Pages yayın işi atlandı. Yerel paketlerin link
  kontrolü104 sayfa/1909 bağlantı/0 hata; CLI arşivi #16 ile bayt eşit.
- #24–26 mail/hesap adayı `mail/` ve `site/` altında. Yerel gerçek PostgreSQL
  SQL173/0, mail60/0, sender27 senaryo, lifecycle112/0; usage10/0 ve entegrasyon8/0;
  kaynak sayfa137/0, Chromium/WebKit79'ar kontrol (158/0). Auth ve sağlayıcı yanıtı
  testlerde taklit. Gerçek SMTP, JWT ve inbox teslimatı doğrulanmış değil.
- Yeni birleşik adayın gerçek SDK ile tam CLI koşusu273/0,52 bilinen açık;1055sn,
  test edilen kaynak hash'leri aynı. Pages/ayna109 sayfa2006 bağlantı0 hata;
  CLI arşivi önceki kabul edilmiş sürümle bayt eşit. Bağımsız son Opus
  incelemesi sınırlı kapsamda yeni güvenlik hatası göstermedi; eski duyuru/yeniden
  rıza çakışmasının temkinli atlama davranışı ve logu netleştirildi, dört önceki
  durum test edildi. Son commit'in uzak CI sonucunu PR#1 üzerinden doğrula; önceki
  db5b855 CI'ı bu adayı doğrulamaz.
- c054097 CI37139899837: mail ve Chromium geçti; macOS271/0/52 ve paket geçti;
  WebKit UI128/1, tek45s toplam süre beklentisi46.2s ölçtü. Takip düzeltmesi ürün
  scheduler'ını değiştirmeden gerçek worker post/reply kuyruğunu ve bounded
  completion'ı sınar. Dört küçük enjekte iş negatif kontroldür. Son testin
  bağımsız Opus incelemesi sonrası süre çıkarımları kaldırıldı; gerçek click
  capture ölçülür. Sonuç için her zaman PR#1'in güncel head CI'ını kontrol et.
- 4 Ekim, aktivasyon öncesi (canlı değil): `mail/ops/preflight_readonly.sql` paylaşılan
  projeyi tek read-only transaction'da raporlar; `mail/ops/rollback_dewfpga.sql` yalnız
  dewfpga nesnelerini siler, yabancı kullanım varsa hiçbir şey silmez. Operatör scriptleri
  `mail/sql` dışında: o klasörü glob'layan her şey (test_sender_idem, operatör döngüsü)
  rollback'i migration sanıyordu. Resend/Supabase belgelerine karşı denetim düzeltmeleri:
  sending-only anahtarda usage 401 restricted_api_key sebebi görünür (worker full_access
  ister), 429 sonrası yeni anahtardan önce bekleme, ledger sequence'i anon/authenticated'a
  kapalı, 002 yeniden uygulamada operatörün consumer satırını silmez. Yerel: activation142/0,
  SQL187/0, mail60/0, sender tüm senaryolar, lifecycle112/0, usage13 OK, pages137/0,
  browser158/0. Kanıt `.claude/recovery-20261003/fable-handoff-state.json`.
- #27 kapanış belgeleri hazırlanıyor; canlı duyuru yapılmadı. Gerçek Basys3,
  VS Code GUI ve gerçek Safari/telefon kabulü açık. Kanonik site GitHub Pages,
  Vercel aynası `deploy.sh` akışı; bu koşuda canlı yayın yapılmadı.

## K7 sözleşmesi ve kalan kabul

UI tek kaynak: `site/mail.js`, `site/config.js`, `site/newsletter/`,
`site/account/`, `site/privacy/`. Ayrı `mail/site/` kopyası yaratma.
Boş public config formları kapalı tutar; servis ve Resend anahtarları siteye,
git'e veya öğrenci CLI paketine girmez. Kurulum ve gerçek operatör adımları
`mail/README.md` içinde. Privacy taslağındaki eksik kimlik/iletişim/işleme/retention
bilgilerini uydurma; hukuki uygunluk iddiası yazma.

Supabase Auth ortak kimliktir. Uygulama SQL'i `auth.users` oluşturmaz veya silmez,
ortak signup trigger'ı kurmaz. Normal magic-link signup yeni Auth kimliği açabilir.
Enrolment açıkça yapılır; export/delete yalnız dewfpga profili ve token ile
bağlanmış abonelikleri kapsar. Başka uygulamanın CASCADE/RESTRICT kayıtları korunur.
Yeni rızada tokenlar yenilenir, hesap bağlantısı yeniden ispatlanır. Onay gönderimini
kaydetme RPC'si gerçekten gönderilen tokenı eşleştirir; temizlik canlı48s linki bozmaz.

Ledger uygulamanın KENDİ kotasını sınırlar. Tüm tüketicilerin aynı kilide katılması
ve hosted Auth için matematiksel günlük rezerv ispatı şartı, planı gereksiz ağırlaştırdı;
bağımsız eleştiri sonrası kaldırıldı. Canlı sender hesap kullanımını rezervasyondan
önce okur; kapasite/ölçüm yoksa erteler. Bu ölçüm başka tüketicilere karşı kilit veya
Auth'a ayrılmış pay değildir. Provider kota reddi hâlâ belirleyicidir.

Belirsiz kabul aynı payload/key ile sınırlı denenir; ilk belirsiz yanıtı sonraki ret
silemez. Süre dolunca yeni anahtar uydurulmaz, operatör gerçek kanıtla uzlaştırır.
Provider kabulü inbox teslimatı değildir. Owner-test için gerçek rıza, gerçek çıkış
linki, receipt ve çıkış ölçümü gerekir; sent etiketi tek başına yeterli değil.

Son adayın bağımsız denetimi ve nihai CI sonrası canlı girdiler/izinler hâlâ açık
ise bunu açık bırak. Harici giriş eksikliği yerel entegrasyonu durdurma gerekçesi
olarak kullanılmasın. Tüm plan bitmeden hedefi tamamlandı işaretleme.

## Doğrulama ve çalışma kuralları

- Ölçüm ürün değildir: değişiklik öğrencinin/operatörün davranışını iyileştirmeli.
  İnceleme güncellemenin diff'i ve iddiasıyla sınırlı; yeni alakasız probe'larla
  sonsuz tur açma. En çok iki break turu, somut kalan açıklar kayda girer.
- Hakem raporunu bağımsız kanıtla değerlendir. Eleştiri uydurma; geçen testleri de
  bütün ürün veya canlı sistem için sınırsız garantiye çevirme.
- `test/run.sh` ve uzak CI'ı kendin doğrulamadan "geçti" deme. MCP SDK kapısı için
  `DEWFPGA_MCP_REQUIRE_SDK=1` ve gerekli gerçek SDK Python ortamını kullan.
  Yerel araç zinciri: `LC_ALL=C LC_CTYPE=C LANG=C`; `C.UTF-8` bu makinede sorun çıkarır.
- Testler `install.sh` üzerinden Homebrew CLI linkini çalışma ağacına çevirebilir.
  Yalnız bu testin değiştirdiği linki önceki ana-repo hedefine geri al; eşdeğer
  `/var` ve `/private/var` yollarını resolve ederek karşılaştır. Yabancı süreç veya
  kurulumları temizleme. Yerel installer denemelerini izole et.
- Uzun testler için gerçek exit code, log, kaynak hash'i ve başlangıç/bitişi sakla.
  Başarısız logları sonraki yeşille üzerine yazma. Bekleyen süreç/işi sık aralıklarla
  kontrol et; sessizlik tek başına öldürme gerekçesi değildir.
- Önce disk kontrolü: en az5GB boş yer. Kendi geçici veritabanı ve browser'ını kapat;
  genel `/tmp` veya `$TMPDIR` temizliği yapma. Tarayıcı testinde EOF ardından hemen
  SIGTERM atmak PostgreSQL temizliğini yarıda bırakır; kapanışı bekle.
- `set -o pipefail` altında `grep -q` üreticiyi SIGPIPE ile düşürebilir; gerektiğinde
  `grep ... >/dev/null` kullan. Makineye özel yolu beklenen çıktıya sabitleme.
- Commit'te co-author yok. Seçilen dosyaları ekle, ilgisiz kullanıcı değişikliklerine
  dokunma. Ürün güncellemesi, patch notes ve CI kanıtı birlikte gözden geçirilir.

## Korunan tasarım ve teknik kararlar

Masaüstü Canva shell, `site/art/nav.png`, nav koordinatları ve mevcut font/tasarım
korunur. Yeni nav kopyaları `docs/nav.py`; metadata/sitemap jeneratörden üretilir.
VS Code'u açmak GUI kabulü değildir; kullanıcı ekranında gerçek kontrol gerekir.

CLI ve manuel yolun motoru `templates/Makefile`: `-nobram`, `--seed 1`, `--freq 100`;
timing FAIL hatadır; TB `$error` başarısız exit verir. Okuyucu önce yosys, reddederse
slang; `.v` Verilog-2005, `.sv` SystemVerilog. Latch LDCE + uyarı; hata biçimi
`file:line: ERROR [kod]`. FPGA araçları/SDK'yı gerekçesiz güncelleme. Basys3 clock/RAM
model açıklarını fiziksel test yapılmış gibi kapatma.

Repo public. Strateji, plan, özel oturum/kanıtlar `.claude/` ve yerel plan dosyasında
kalır; `out/`, `.vercel/`, `.fpga_home`, `.rabadon/` yayın girdisi değildir. CLI paketi
`scripts/package.py` seçili girdilerinden kurulur; mail backend'i pakete eklenmez.
Önceki K1 tarihsel kararlar ve sayılar git geçmişi ile patch notes'ta korunur.
