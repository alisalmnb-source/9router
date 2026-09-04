# 9router Fork — Özellik Gereksinimleri

Bu dosya fork'un upstream'e **ne** eklediğini anlatır: her özellik hangi sorunu çözüyor, kullanıcı açısından neyi değiştiriyor, hangi davranış bekleniyor.

**Bu dosya "nasıl" sorusunu cevaplamaz.** Dosya adı, kod yapısı, ayar anahtarı, uç nokta ve veri şeması burada bilinçli olarak yoktur. Bunlar `FORK-CHANGES.md`'de ve kodun kendisinde durur. Bu dosyayı okuyan bir ajan, implementasyon hakkında hiçbir varsayım yapmadan "kullanıcı şunları istiyor" diyebilmelidir.

**Bir gereksinimin neden o sınırda çizildiği ise burada kalır.** Gerekçesiz bir gereksinim, bir sonraki turda "basitleştirilerek" ortadan kaldırılır. Kapsam dışı olan şey tasarımın gerekçesi değil, tasarımın kendisi.

**Durum:** Aşağıdaki on bir özelliğin hepsi uygulanmıştır. Gövde yine de gereklilik kipinde yazılmıştır ("olmalı", "gösterilmeli") — çünkü bu cümleler yalnızca bugünü değil, korunması gereken davranışı tarif eder: "bugün böyle yapıyor ve böyle kalmalı". Uygulanmamış bir madde yoktur; bir madde eklenirse durumu burada belirtilmelidir.

"Kabul edilmiş sınırlar" başlıkları, özelliğin bilerek yapmadığı şeyleri listeler — eksik değil, karar.

---

## Özet

| # | Özellik | Kullanıcı bunu nerede görür |
|---|---|---|
| 1.1 | Kilit sürelerinin ayarlanabilirliği | Ayarlar sayfasında altı süre alanı |
| 1.2 | Kilidi elle açma | Bağlantı satırında bir düğme |
| 2.1 | Satır içi bağlantı testi | Bağlantı satırında bir düğme |
| 2.2 | Token yenileme durumu | Bağlantı satırında bir bilgi satırı |
| 3.1 | Yük ve sağlığa göre hesap sıralaması | Strateji seçim listesinde üçüncü seçenek |
| 3.2 | Sohbetin aynı hesapta kalması | Ayrı kontrolü yok, 3.1 ile gelir |
| 4.1 | Deneme sayısı ve süre sınırı | Ayarlar sayfasında iki alan |
| 4.2 | Bozuk isteklerde hesap dolaşmayı durdurma | Görünür kontrolü yok |
| 4.3 | İstemci vazgeçtiğinde denemeyi durdurma | Görünür kontrolü yok |
| 5.1 | Sansürsüz istek kaydı görüntüleyici | Smart Logs sayfası |
| 5.2 | Smart Logs sayfası | Kenar çubuğunda yeni bir sayfa |

---

## 1. Hesap kilitleri

Bir hesap başarısız olduğunda 9router onu bir süre kenara çeker. Bu bölümün ikisi de o kenara çekmenin **süresi** ve **elle iptali** hakkında.

**Bölüm kapsamı dışı:** Hangi hatanın kilitlenmeye yol açacağına karar veren sınıflandırma. Ücretsiz ve kimlik doğrulaması gerektirmeyen sağlayıcılar da kapsam dışı — orada kilitlenecek bir hesap yok.

---

### 1.1 Kilit sürelerinin ayarlanabilirliği

**Sorun.** Varsayılan kilit süreleri paylaşılan, API anahtarı tabanlı kurulumlar için ölçülmüş. Abonelik tabanlı hesaplarda çok kısa: iki saniye sonra aynı hesaba dönmek sağlayıcı tarafında "yeniden deneme" değil "ısrar" olarak okunuyor ve hesabın toparlanmasına hiç fırsat kalmıyor.

**İstenen.** Kullanıcı, hangi hata türünün ne kadar kilit alacağını Ayarlar sayfasından belirleyebilmeli. Altı ayrı süre alanı olmalı:

| Alan | Neyi kapsar | Fork varsayılanı | Varsayılan öncesi |
|---|---|---|---|
| Hız sınırı — ilk adım | İlk hız sınırı kilidi; her tekrarda ikiye katlanır | 90 saniye | 2 saniye |
| Hız sınırı — tavan | Katlanmanın durduğu üst sınır | 90 dakika | 5 dakika |
| Kimlik ve erişim hataları | Yetkisiz erişim, ödeme, yasak, bulunamadı, kimlik bilgisi yok | 5 dakika | 2 dakika |
| İzin verilmeyen istek | Sağlayıcının neredeyse anında tekrar denenebilir saydığı durum | 30 saniye | 5 saniye |
| Geçici ve bilinmeyen hatalar | Sunucu hataları ve ağ arızaları. **En sık devreye giren** | değişmedi (30 saniye) | 30 saniye |
| Sağlayıcı bildirimi tavanı | Sağlayıcının kendi bildirdiği sıfırlanma zamanının üst sınırı | 90 dakika | 30 dakika |

Ek gereksinimler:

- Alanlar **isteğe bağlı** olmalı. Boş bırakılan alan varsayılana döner; kullanıcının kartı hiç açmaması geçerli bir durum.
- Süreler saniye cinsinden girilmeli.
- **Hız sınırı tavanı ilk adımın altına inemez.** Altına ayarlanırsa ilk adım değerine yükseltilir; ilk adımdan kısa bir üst sınır anlamsız olurdu. Bu geçersiz bir değer değil, çelişen iki geçerli değer — bu yüzden varsayılana dönmüyor, yükseltiliyor, ve alanın ipucu bunu söylemeli.
- "Sağlayıcı bildirimi tavanı" bir süre değil, bir **tavan**: sağlayıcı bir dakika diyorsa kilit bir dakikadır. Bu alanı düşürmek o kilitleri kısaltır, yükseltmek yalnızca kırpmayı bırakır.
- Aylık kotanın bitmesi hiçbir ayarı dinlememeli. O bir süre değil, sonraki ayın başına kadar geçerli mutlak bir tarih.

**Kabul kriterleri.**
- Ayarlar sayfası altı alanı, her birinin ne kapsadığını açıklayan bir ipucuyla gösterir.
- Bir alan boşken kullanıcı o alanın hangi değere döneceğini görür.
- Fork varsayılanı upstream'den farklı olan alanlarda, upstream'in sayısı da ipucunda yazılıdır.
- Kaydedilen bir değer, bir sonraki başarısızlıkta geçerli olur.

**Kabul edilmiş sınırlar.**
- **Kaydedilen değer, hâlihazırda yazılmış bir kilidi kısaltmaz.** Duran kilitleri serbest bırakmanın yolu 1.2.
- **Bu varsayılanlarla kartı hiç açmamış bir kurulum upstream gibi davranmaz**, hesapları belirgin biçimde daha uzun kilitler. Bu, değerlerin yan etkisi değil amacı.
- **Geçersiz değer sessizce yok sayılır.** Sıfır, negatif, boş veya sayı olmayan bir giriş varsayılana döner ve **uyarı gösterilmez**.
- **Bir sağlayıcının kendi kota engeli bu ayarların tamamen dışında.** O engel bu mekanizmadan geçmiyor; sağlayıcının bildirdiği zaman geçince veya program yeniden başlayınca kalkıyor.
- Ücretsiz ve kimlik doğrulaması olmayan sağlayıcılar hiç kilitlenmez.

---

### 1.2 Kilidi elle açma

**Sorun.** Bir hesabın kilidi yazıldıktan sonra beklemekten başka yapılacak bir şey yok. Oysa kullanıcı çoğu zaman kilidin sebebinin ortadan kalktığını biliyor — kotasını yeniledi, kimlik bilgisini düzeltti, ağ arızası geçti.

**İstenen.**
- Bağlantı satırında, o bağlantıyı hemen yeniden kullanılabilir hâle getiren bir düğme olmalı.
- Düğme **hep ya hep** çalışmalı: o bağlantıdaki bütün modellerin kilitleri, son hata metni, hata kodu, test sonucu ve birikmiş katlanma seviyesi birlikte temizlenir. Yalnızca kilitleri temizlemek satırı gerçek bir istek başarılı olana kadar "kullanılamaz" göstermeye devam ettirirdi; katlanma seviyesi kalırsa bir sonraki başarısızlık uzun sürelerden devam ederdi.
- Düğme yalnızca temizlenecek bir şey varken görünmeli.
- Başarısız bir temizleme kullanıcıya bildirilmeli — satırda başka hiçbir şey hareket etmediği için sessiz kalmak "çalıştı" gibi okunur.

**Kabul kriterleri.**
- Kilitli bir bağlantıda düğmeye basıldıktan sonra satır kullanılabilir görünür ve bir sonraki istek o hesaba gidebilir.
- Kapalı bir bağlantıda düğme görünmez.
- Düğme, ne yaptığını açıklayan bir ipucu taşır.

**Kabul edilmiş sınırlar.**
- **Model bazlı seçenek yok.** Tek bir modelin kilidini açmak isteyen kullanıcı için ayrı bir yüzey zaten var.
- **Uzaktan erişimde çalışmaz.** Tünel veya uzak ağ üzerinden panele bağlanıldığında düğme hata verir ve kilit kalır. Bu bilinçli bir güvenlik sınırı: bu düğmeye tekrar tekrar basabilen biri, bu kurulumun kimlik bilgileriyle bir sağlayıcıyı hiç bekleme olmadan zorlayabilir.
- **Görsel, video ve ses sağlayıcılarının bağlantı listesinde düğme yok.**
- **Bir sağlayıcının kendi kota engelini kaldırmaz.** O satırda düğme görünür ve başarı bildirir, ama hesap engelli kalır.

---

## 2. Bağlantı sağlığının görünürlüğü

Bir bağlantının şu anda çalışıp çalışmadığı sorusunun iki ayrı yarısı: elle sorulan bir soru (2.1) ve kendiliğinden görünen bir durum (2.2). İkisi de aynı yerde, bağlantı listesinin satırlarında görünür.

---

### 2.1 Satır içi bağlantı testi

**Sorun.** Tek bir bağlantıyı test etmek için o bağlantının düzenleme penceresini açmak gerekiyor. Liste seviyesinde tek seçenek, bütün bağlantıları sırayla gezen toplu test.

**İstenen.**
- Her bağlantı satırında, yalnızca o bağlantıyı test eden bir düğme olmalı.
- Sonuç, satırda hâlihazırda bulunan test rozetinde görünmeli — ikinci bir gösterim yolu üretilmemeli.
- Testten sonra satırın tamamı tazelenmeli. Test yalnızca rozeti değil, hata metnini, kilit durumunu ve token bilgisini de değiştiriyor; tazelenmeyen bir satır **yanlış bilgi verir**: yenilemesi başarısız olmuş bir bağlantı, testin az önce geçersiz kıldığı kırmızı bir uyarının yanında yeşil rozet gösterir.
- Testin bir üst süre sınırı olmalı, böylece cevap vermeyen bir sağlayıcı satırı süresiz "test ediliyor" durumunda bırakmasın.

**Kabul kriterleri.**
- Düğmeye basıldığında yalnızca o bağlantı test edilir, diğerleri etkilenmez.
- Toplu test sürerken satır düğmeleri devre dışıdır.
- Test bitince satırın gösterdiği her alan test sonrası duruma geçer.

**Kabul edilmiş sınırlar.**
- **Süre sınırı yalnızca beklemeyi kesiyor**, sunucu tarafındaki testi durdurmuyor.
- **Bazı sağlayıcılarda yeşil sonuç, sağlayıcıya ulaşıldığı anlamına gelmez.** Altı sağlayıcıda test yalnızca saklanmış bir sona erme tarihine veya bir token'ın varlığına bakar; makineden hiçbir şey çıkmaz.
- **Başarısız bir test bozuk bir vekil sunucu da demek olabilir.** Test önce vekil sunucuyu yokluyor ve o ölüyse sağlayıcıya hiç ulaşmadan durur.
- **Hata metninin dolu olması başarısızlık demek değil.** Bazı sonuçlar geçerli sayılıp yanına uyarı yazar.
- **Toplu test sırasında başlatılmış tek satır testi bir rozeti eskitebilir.** Etkisi kozmetik; toplu tarama o satıra geldiğinde düzelir.

---

### 2.2 Token yenileme durumu

**Sorun.** Bir bağlantının kimlik bilgisinin yenilenmeye devam edip etmediği hiçbir yerde görünmüyor. Daha kötüsü: başarısız bir yenileme hiçbir yere yazılmıyor, eski kimlik bilgisi sessizce geri veriliyor. Yani yenileme yetkisi iptal edilmiş bir bağlantı, birisi elle test edene veya gerçek bir istek ona denk gelene kadar **süresiz olarak "etkin" görünüyor.**

**İstenen.** Her uygun bağlantının satırında tek bir bilgi satırı olmalı ve üç soruyu cevaplamalı:

1. En son ne zaman yenilendi?
2. O yenileme başarılı mıydı? Değilse sebep neydi?
3. Sıradaki yenileme ne zaman?

Ek gereksinimler:

- **Hem başarı hem başarısızlık kaydedilmeli.** Yalnızca başarısızlıklar kaydedilse, sonradan gelen bir başarının ardından ekranda eski bir hata kalırdı; yalnızca başarılar kaydedilse "hiç denenmedi" ile "denendi ve başarısız oldu" ayırt edilemezdi.
- Yeniden kimlik doğrulaması gerektiren kalıcı bir hata, geçici bir hatadan ayırt edilmeli.
- Bu özelliğin **hiçbir ayarı olmamalı.** Ayarlanacak bir davranış yok, gösterilecek bir durum var.
- Yanılma yönü **yanlış alarm** olmalı, yanlış yeşil değil: satır bir sorunu abartabilir, gizleyemez.

**Kabul kriterleri.**
- Yenilemeye uygun olmayan bağlantılarda (API anahtarı, çerez, kapalı bağlantı) satır hiç görünmez.
- Sona erme tarihi olmayan uygun bir bağlantıda satır, yenilemenin yalnızca istek geldiğinde olacağını söyler.
- Geçmişte kalmış bir "sıradaki yenileme" zamanı hata gibi gösterilmez.
- Yenileme sonrası ekranda gösterilen sonuç, gerçekten kaydedilmiş olan sonuçla aynıdır.

**Kabul edilmiş sınırlar.**
- **Geçmiş tutulmuyor.** Tek bir deneme saklanır, bir sonraki üzerine yazar. Sayaç yok, seri yok.
- **"Sıradaki yenileme" bir zaman, bir taahhüt değil.** Arka plan taraması kendi aralığıyla çalışıyor; yenileme gösterilen andan sonraki ilk turda olur. Değer bu yüzden kaba gösteriliyor.
- **Çoğu başarısızlığın sebebi yok.** Sağlayıcıların çoğu boş dönüyor; çoğu satır için cevap "şu saatte başarısız oldu, sebep yok".
- **Yenilemenin gerçekleştiği bazı durumlar bu satıra yazılmıyor**: bir istek sırasında ortaya çıkan kimlik hatasının ardından yapılan yenileme, ve elle test. İkisi de görünmez değil (biri isteği başarısız ediyor, diğeri rozete yazıyor); yapmadıkları şey bunu bir *yenileme sonucu* olarak etiketlemek.
- **Durum kendi kendine tazelenmez.** Sayfa yenilendiğinde yenilenir.
- **Durum bilgisi alınamazsa bütün satırlar kaybolur** ve hata gösterilmez. Boş sonuç, hiçbir bağlantının uygun olmadığı bir listeyle aynı görünür.
- **Satırın olmaması hiçbir şeyin kanıtı değil.** API anahtarı, çerez, kapalı bağlantı ve yenileme yetkisi olmaması aynı görünür.
- **Görsel, video ve ses sağlayıcılarının listesinde satır yok.**
- Durum bilgisi saklanamazsa sessizce geçilir. Bir panel satırı, bir token yenilemesinin başarısız bildirilmesinin sebebi olamaz.

---

## 3. Hesap seçimi

Gelen bir isteğin hangi hesap üzerinden sağlayıcıya gideceği.

**Bölüm kapsamı dışı:** Combo seviyesi yönlendirme. Ücretsiz ve kimlik doğrulaması olmayan sağlayıcılar da kapsam dışı — orada birden fazla hesap yok.

---

### 3.1 Yük ve sağlığa göre hesap sıralaması (Smart Routing)

**Sorun.** Mevcut iki strateji de önemli olan iki şeyi görmüyor. Biri bütün yükü ilk hesaba yığıyor, diğeri hesapları körlemesine sırayla geziyor. İkisi de bir hesabın ne kadar yüklü olduğunu ve son zamanlarda çalışıp çalışmadığını dikkate almıyor.

**İstenen.** Üçüncü bir strateji seçeneği: hesapları, çalışma ihtimali en yüksek olandan başlayarak sıralar.

- Seçenek **hem genel ayarlarda hem sağlayıcı bazlı ayarda** sunulmalı. Yalnızca genel ayara eklenirse, sağlayıcı bazlı bir tercih ayarlanmış kullanıcıda strateji sessizce devreye girmez: seçim yapılır, o sağlayıcıda hiçbir şey değişmez ve sebebi görünmez.
- Sıralama şu üç ölçütü bu sırayla kullanmalı:
  1. **Hesabın taşıdığı sohbet sayısı** — az olan önce. Yeni bir sohbetin ne kadar kota tüketeceği bilinemediği için, bilgi yokken en makul varsayım sohbetleri eşit dağıtmak.
  2. **En son ne zaman sona gönderildiği** — hiç gönderilmemiş olanlar önce, sonra en eskiden en yeniye.
  3. **Kullanıcının belirlediği mevcut statik öncelik.**
- **Sıralama bir sağlık raporu değil, bir tahmin.** Hedef "her zaman doğru hesabı seç" değil, "yanlış seçim düşük maliyetli olsun ve kendini düzeltsin". Bu, bu özelliğin ölçüsü: arada bir boşa giden tek bir istek kabul edilebilir, tekrar tekrar boşa gidenler değil.
- Hesap başarısız oldukça bir **hata sayacı** birikmeli ve eşiğe ulaşan hesap listenin en altına gönderilmeli:

| Hata türü | Sayaca yazdığı | Kaç tekrarda alta gider |
|---|---|---|
| Ağır — kota bitişi, kredi tükenmesi | 4 puan | 3 |
| Hafif — hız sınırı, geçici hata | 2 puan | 5 |
| Bozuk istek (bkz. 4.2) | 0 puan | hiç |

  Eşik 10 puan. Karışık durumlar kendiliğinden toplanır: bir ağır ve üç hafif de 10 puandır.
- **Ağır ve hafif ayrımında sağlayıcının kesin beyanı, metnindeki ifadeden üstün olmalı.** Somut örnek: gövdede "hız sınırına ulaşıldı" yazan ama kalan istek sayısını sıfır bildiren bir cevap, geçici bir yavaşlama değil kota bitişidir.
- **Tanınmayan hata hafif sayılmalı.** Yanılmanın iki yönü eşit maliyetli değil: bir hatayı yanlışlıkla hafif saymak gözden çıkarmayı birkaç istek geciktirir; yanlışlıkla ağır saymak sağlıklı bir hesabı listenin dibine gönderir ve orada uzun süre tutar.
- **Başarılı bir istek sayacı sıfırlamalı**, ama sona gönderme tarihini temizlememeli. Tarih bir durum değil, diğer hesaplar başarısız oldukça solan göreceli bir konum; ilk başarıda temizlemek tek bir şanslı isteğe birikmiş bir kanaati geri alma yetkisi verirdi.
- **Bir hesabın sağlık değerlendirmesi her model için ayrı yapılmalı.** Hesabın tamamı için tek bir değerlendirme tutulsaydı, bir modelde kotası tükenmiş hesap diğer modellerin istekleri için de sona gönderilirdi.
- Sona gönderme **tek hamlede en dibe** olmalı, birkaç sıra aşağı değil: amaç sağlıklı hesapları yukarı taşımak değil, sorunluyu yoldan tamamen çekmek.

**Kabul kriterleri.**
- Yeni eklenmiş bir hesap, hiçbir özel kural olmadan üst grupta çıkar.
- Sürekli hata veren bir hesap en alta iner ve orada kalır.
- Kilitli bir hesap sıralamaya hiç girmez; kilit dolduğunda birikmiş puanlarıyla kaldığı yerden devam eder.
- Kullanıcı bir hesabın neden öne çıkmadığını 5.2'den okuyabilir.

**Kabul edilmiş sınırlar.**
- **Sona gönderme kalıcı bir dışlama değil.** Sohbetleri boşaldıkça hesap yeniden üst gruba çıkabilir. Engelleme işini kilitler yapıyor; hesap öne çıkıp bir kez daha başarısız olursa maliyet tek bir istek.
- **Sayaçlar strateji seçili olmasa da birikir.** Bir sağlayıcı bu stratejiye alındığında sayaçlar sıfırdan başlamaz.
- **Sıfırlanmış bir sayaç sağlıklı demek değil.** Eşiğe ulaşan sayaç sıfırlanıyor; sona gönderilmiş bir hesap hemen ardından sıfır gösterir. Sona gönderme tarihiyle birlikte okunmalı.
- **Görsel, video ve ses sağlayıcıları için sunulmuyor.** Orada çok turlu sohbet kavramı yok; hem yük hem süreklilik ölçütü anlamsız kalıyor. Ama **sunulmaması gizlenmesi değil:** bir medya sağlayıcısında bu strateji zaten seçili durumdaysa listede görünmeli ve nereye ait olduğu yazılmalı. Görünmezse liste kendi durumunu yanlış bildirir ve kullanıcının listeye ilk dokunuşu saklı seçimi sessizce ezer.
- **Kilit süreleri çok kısaltılırsa bu özellik anlamını kaybeder.** Hesap iyileşmeye zaman bulamadan yeniden denenir, sayaç hızla dolar ve sona gönderme bir sağlık kararı olmaktan çıkıp gecikme ölçümüne döner. Mekanizma çalışmaya devam eder, sadece ölçtüğü şey değişir.

---

### 3.2 Sohbetin aynı hesapta kalması

**Sorun.** Sağlayıcı tarafındaki bağlam önbelleği hesap kimliğine bağlı. Bir sohbetin istekleri hesaplar arasında dolaşırsa önbellek her seferinde sıfırlanıyor ve aynı bağlam tekrar tekrar ücretlendiriliyor.

**İstenen.**
- Bir sohbetin bütün istekleri aynı hesaba gitmeli.
- **Ayrı bir açma/kapama kontrolü olmamalı.** 3.1 seçildiğinde çalışır, seçilmediğinde çalışmaz. Diğer iki stratejiyle birleşimi işe yaramaz: biri zaten her seferinde aynı hesabı seçiyor, diğeriyle ortaya çıkan şey 3.1'in sağlık ölçütü çıkarılmış zayıf bir kopyası.
- **Dağıtım sohbet birimiyle olmalı, istek birimiyle değil.** Yükü dağıtmak kotayı koruyor, aynı hesapta kalmak önbellekten yararlanmayı sağlıyor; bu ikisi kısmen çelişiyor. İş bölümü: 3.1 yeni bir sohbetin nereye gideceğine karar veriyor, bu özellik o sohbetin orada kalmasını sağlıyor.
- Bir sohbetin kimliği, istemci bir sohbet kimliği gönderiyorsa ondan gelmeli; göndermiyorsa sohbetin kendisinden **tanınmalı**. Her istekte yeni bir kimlik uydurulursa süreklilik hiç kurulmaz.
- Bu tanıma, sohbet büyüdükçe ve istemci davranışını değiştirdikçe **aynı kalmalı**. Somut örnek: bir ajan istemcisi plan modundan build moduna geçtiğinde gönderdiği talimatlar değişiyor; kimlik bundan etkilenirse sohbetin ortasında değişir, sohbet başka hesaba düşer — yani tam önlenmeye çalışılan şey olur.
- Süreklilik sohbet başına değil, sohbetin kullandığı **her model için ayrı** kurulmalı. Sohbetin tamamı tek hesaba bağlanırsa, bir combo'nun aynı isteği birden fazla modele aynı anda gönderdiği durumda o paralel çağrıların hepsi tek hesaba, aynı anda yığılır — yük dağıtımı tam zirvede çöker.
- Yaşam döngüsü:

| Durum | Beklenen davranış |
|---|---|
| Sohbet kimliği henüz yok (ilk tur) | Sıralamanın seçtiği hesaba gider, eşleşme yazılmaz |
| Kimlik var, eşleşme yok | Sıralamanın seçtiği hesap atanır ve kaydedilir |
| Eşleşme var, hesap uygun | Aynı hesaba gider |
| Eşleşme var, hesap kilitli | Eşleşme bırakılır, sıralamadan yeni hesap istenir |
| Eşleşme var, istek başarısız | Eşleşme bırakılır, sıralamadan yeni hesap istenir |
| Sohbet 30 dakika istek almıyor | Eşleşme silinir |

- **30 dakika bir kiralama değil, boşta kalma penceresi.** Sohbet istek attığı sürece aynı hesapta kalır ve bu saatler sürebilir. Süre son istekten itibaren sayılır.
- **Bir hesap başarısız olduğunda ona bağlı diğer sohbetler toplu hâlde koparılmamalı.** Her sohbet kendi bir sonraki isteğinde kopar. Toplu koparmak hepsinin sağlayıcı tarafındaki önbelleğini aynı anda yok ederdi, ve başarısız hesabın sohbet sayısını anında sıfıra düşürerek onu birinci ölçüt gereği listenin **en üstüne** çıkarırdı.
- **Program yeniden başladığında hiçbir süreklilik taşınmamalı.** Program kapatılıp uzun süre sonra açıldığında eski bağlar anlamsız olurdu; o sohbetler çoktan bitmiş olmasına rağmen hesapları meşgul göstermeye devam ederdi.

**Kabul kriterleri.**
- Aynı sohbetin ikinci ve sonraki istekleri, ilk isteğin gittiği hesaba gider.
- Aynı sohbette iki farklı model kullanılırsa bunlar iki ayrı hesaba dağılabilir.
- Bağlı olduğu hesap kilitlenen bir sohbet, bir sonraki isteğinde çalışan bir hesaba geçer.

**Kabul edilmiş sınırlar.**
- **İlk tur bağlantısız kalıyor.** Bir sohbetin ilk isteğinde türetilecek bir kimlik henüz yok; kimlik ikinci turda ortaya çıkıyor. Maliyeti bir kez önbellek kaybı, ve bu kayıp sohbetin en küçük olduğu yerde oluşuyor.
- **Aynı anda birden fazla yeni sohbet başlarsa hepsi aynı hesabı seçebilir.** Dengesizlik kalıcı olmuyor: ikinci turda her sohbet kendi eşleşmesini alıyor.
- **Çakışma mümkün.** İki ayrı sohbet birebir aynı şekilde başlarsa aynı kimliğe düşer. Sonucu iki sohbetin tek hesaba düşmesi — bir bozulma değil, bir dağıtım kaçırması.
- **Program yeniden başladığında bütün eşleşmeler kaybolur.** Doğru davranış, ama 5.2'nin aktif sohbet bölümü bu yüzden boş açılır ve bunu **açıkça söylemek zorunda**: sebebini yazmayan boş bir liste, bozuk bir liste gibi okunur.

---

## 4. Başarısızlık sonrası davranış

Seçilen hesap başarısız olduğunda 9router sıradaki hesabı deniyor. Bu bölümün üç kuralı da o dolaşmanın **nerede duracağı** hakkında.

Bu kurallar **hangi strateji seçili olduğuna bakmaksızın ve bütün istek türleri için** geçerli olmalı.

**Ayarlar tarafına yalnızca değer alanları çıkmalı — bir düzeltmenin kapatılması seçenek olarak sunulmamalı.** Kapalı hâl hatalı hâl: bir istek bozuk olduğu için bir modeldeki bütün hesapları kilitlemek, seçenek olarak korunmaya değer bir davranış değil.

---

### 4.1 Deneme sayısı ve süre sınırı

**Sorun.** Deneme sayısı basitçe hesap sayısı kadar. Yüzlerce hesabı olan bir sağlayıcıda tek bir istemci isteği yüzlerce sağlayıcı isteğine dönüşüyor.

**İstenen.**
- Tek bir istemci isteğinin deneyebileceği hesap sayısı sınırlı olmalı. Varsayılan: 30.
- Ayrıca bir süre bütçesi olmalı. Varsayılan: 1 dakika. Hangisi önce dolarsa döngü orada durur.
- Süre sınırı sayıya ek olarak gerekli: zaman aşımına giden bir deneme uzun sürebilir, ve yavaş ama yanıt veren çok sayıda hesap art arda denenirse sayı sınırı mutlu kalırken istemci çok uzun bekler.
- **İlk deneme sınırsız olmalı.** Kodlama isteklerinde ilk yanıtın yirmi saniye sonra gelmesi normal; süre isteğin başından işlese yavaş ama çalışan bir yanıt yarıda kesilirdi. Sayaç ilk denemeden sonra başlar.
- **Denemeler arasına bekleme konulmamalı.** Beklemenin tek gerekçesi sağlayıcıyı boğmamak olurdu, ama her deneme farklı bir hesaba yani farklı bir kota kovasına gidiyor. İstemci tarafında maliyeti ise büyük.
- Sınır dolduğunda istemciye **son gerçek sağlayıcı hatası** dönmeli. Sentezlenmiş bir "hizmet kullanılamıyor" cevabı bunu daha az bilgiyle değiştirirdi.
- İki değer de Ayarlar sayfasından değiştirilebilmeli.

**Kabul kriterleri.**
- Yüzlerce hesabı olan bir sağlayıcıda tek bir istemci isteği en fazla ayarlanan sayıda hesabı dener.
- Yavaş ama başarılı bir ilk yanıt hiçbir zaman kesilmez.
- Sınır dolduğunda istemcinin gördüğü hata, gerçekten yaşanmış son hatadır.

**Kabul edilmiş sınırlar.**
- **Bu iki varsayılan yan yana durduğunda pratikte genellikle süre önce doluyor.** Gerçek sınırı süre belirliyor; 30 nadiren devreye giren bir üst tavan.
- Geçersiz bir değer sessizce varsayılana döner.

---

### 4.2 Bozuk isteklerde hesap dolaşmayı durdurma

**Sorun.** İsteğin kendisinde bir sorun varsa istek bütün hesaplarda aynı şekilde başarısız olur — ve her başarısız denemede o hesaba kilit yazılır. Yani tek bir bozuk istek, ilgili modeldeki bütün hesapları kilitleyebilir. Kendi kendine yaratılmış bir kesinti.

**İstenen.**
- Sorun isteğin kendisindeyse hesap dolaşma durmalı ve hata doğrudan dönmeli.
- İstek **en fazla bir hesap** üzerinden sağlayıcıya iletilmiş olmalı.
- **Bozuk bir istek hiçbir hesabı kilitlememeli** — denediği tek hesap dâhil. Yalnızca dolaşmayı durdurmak yetmez: istek doğru şekilde durur ama bir hesap kendi kabahati olmayan bir şey için kilitlenmiş olur, ve bu havuz boyunca tekrarlandığında bu kuralın önlemek için var olduğu kesintinin aynısı ortaya çıkar.
- **Tespit pozitif çalışmalı:** yalnızca tanınan bir durum bozuk istek sayılır. "Şu hata kodu gelen her şey bozuktur, şunlar hariç" biçiminde kurulsaydı, listeye alınmamış her yeni durum otomatik olarak bozuk istek sayılır ve hesap dolaşma sessizce devre dışı kalırdı.
- Bozuk sayılacak üç grup: mesaj formatı hatalı olan istekler, modelin bağlam sınırını aşan istekler, izin verilen aralığın dışında parametre taşıyan istekler.
- İki istisna bozuk istek **değil**, çünkü bunlar hesabın sorunu: bazı sağlayıcıların hız sınırını bu hata koduyla bildirmesi, ve kredi veya kota bitişini bu hata koduyla bildirmesi.

**Kabul kriterleri.**
- Bağlam sınırını aşan bir istek tek bir hesabı dener ve hiçbir hesabı kilitlemez.
- Tanınmayan bir hata bugünkü gibi davranır ve hesap değiştirmeye devam eder.

**Kabul edilmiş sınırlar.**
- **Tanınan durumların listesi dar başladı ve zamanla büyüyecek.** Yanlışlıkla "bu istek bozuk" demek gerçekten sorunlu bir hesapta çalışan hesap dolaşmayı bozar; yanlışlıkla "bozuk değil" demek sadece bugünkü davranışı sürdürür.

---

### 4.3 İstemci vazgeçtiğinde denemeyi durdurma

**Sorun.** İstemci isteği iptal ettiğinde bunu algılayan bir mekanizma yok. İstemci vazgeçmiş olsa bile kimsenin beklemediği bir cevap için hesap hesap denenmeye devam ediliyor.

**İstenen.**
- İstemci bağlantıyı kopardığında devam eden hesap dolaşma kesilmeli.
- Kopmuş bir istek fazladan **tek bir hesap denemesine bile** yol açmamalı.
- **Uçuşta olan deneme tamamlanmalı ve sonucu kaydedilmeli.** İstemci deneme sürerken koparsa o deneme kendi sonuna kadar gider; başarısızsa hesabına kilit de yazılır. Duran şey **sonraki** denemeler. Kesmek, cevabı çoktan gelmiş olabilecek bir denemenin sonucunu çöpe atmak olurdu, ve o sonuç hesabın sağlığı hakkında zaten kazanılmış bir bilgi.
- Sonuç, kayıt tarafında "istemci vazgeçti" olarak okunabilmeli — bir sunucu hatası veya olmayan bir başarı gibi görünmemeli.

**Kabul kriterleri.**
- İstemci bir isteği iptal ettiğinde ek hesap denemesi yapılmaz.
- İptal edilen bir isteğin son denemesi hesabın sağlık kaydına normal şekilde yazılır.

**Kabul edilmiş sınırlar.**
- **Yalnızca dolaşma durur.** Gönderilmiş ve yanıt bekleyen sağlayıcı isteği iptal edilmiyor. Dolaşmayı durdurmak kalan bütün denemeleri kurtarıyor, uçuştaki isteği iptal etmek yalnızca birini — ve ikincisi çok daha geniş bir değişiklik. Ayrı bir iş.

---

## 5. Görünürlük

Yukarıdaki kararların kullanıcıya görünür olması. **Bu bölüm davranış değiştirmez, yalnızca gösterir.**

**Bu bölümün sayfaları salt-okunur olmalı.** Aynı ayarı iki yerden yazabilen iki kontrol, ikisinden birinin diğerini sessizce ezmesi demek. Değiştirme işi mevcut ayar yüzeylerinde kalır.

---

### 5.1 Sansürsüz istek kaydı görüntüleyici

**Sorun.** 9router istek başına ayrıntılı gözlem verisi toplayabiliyor, ama iki şey birden yapıyor: bu toplama varsayılan olarak kapalı, ve açıldığında bile veriyi panele göstermeden önce siliyor — istek gövdesi, sağlayıcı adresi ve başlıkları, ham cevap çerçeveleri, hata izleri, dördü de koşulsuz "sansürlendi" olarak dönüyor. Bu **paylaşılan bir kurulum için doğru bir karar**: panele erişebilen herkes aksi hâlde bütün sohbetleri okuyabilirdi. Ama bu fork tek kullanıcılı ve yerel, ve teşhis için o veriye ihtiyacı var.

**İstenen.**
- Sağlayıcıya gerçekte ne gittiğini ve ne döndüğünü sansürsüz gösteren bir görünüm olmalı: istemcinin gövdesi, sağlayıcının adresi ve başlıkları, ham akış çerçeveleri, hata yığınları.
- **Mevcut sansürlü görünüm olduğu gibi kalmalı.** Fork kendi görünümünü yanına ekler. Bedeli kabul edilmiş: aynı istekler iki yerde iki farklı biçimde görünür.
- **Kayıt toplama varsayılan olarak açık olmalı.** Upstream'de kapalı; kapalıyken bu görünüm boş kalır, yani özellik kurulu ama görünmez biçimde işlevsiz olur. Kullanıcının bir şeyi açmak için ayarlara gitmesi gerekmemeli.
- Bir isteğin **gerçekten çalışıp çalışmadığı** güvenilir şekilde gösterilmeli. Bir akış için "başladı" ile "tamamlandı" aynı şey değil; sonuç, en zayıf değil en güçlü kanıta göre belirlenmeli.
- **Erişim yalnızca yerel olmalı.** Panelin kendi giriş kontrolüne güvenmek yetmiyor: oturum zorunluluğu kapalıyken o kontrol herkesi içeri alıyor. Bu kısıt aynı zamanda tünel ve uzak erişim adreslerini de dışarıda tutar.
- **Kimlik bilgisi taşıyan başlıklar maskelenmeli.** Değer kısaltılmamalı, tamamen değiştirilmeli — bir token'ın bir kısmı da token'dır. Başlığın adı görünür kalmalı, böylece kullanıcı maskelemenin çalıştığını görebilir.
- Saklanan kayıt sayısının bir üst sınırı olmalı ve eski kayıtlar temizlenmeli. Temizlik yalnızca bu özelliğin kendi ürettiği kayıtlara dokunmalı.

**Kabul kriterleri.**
- Kullanıcı bir isteğin istemciden gelen gövdesini ve sağlayıcıya giden hâlini kelimesi kelimesine görebilir.
- Yarıda kopmuş bir akış "başarılı" görünmez.
- Uzak bir tarayıcıdan bu görünüme ulaşılamaz.
- Diske yazılmış başlıklarda canlı token veya API anahtarı bulunmaz.

**Güvenlik gereksinimi (kapsam içi ve zorunlu).**
- **Gövdeler hiçbir yerde maskelenmiyor. Bu özelliğin kendisi bu, eksiklik değil.** Ama sonucu açıkça yazılmalı: gövde kayıtları isteği kelimesi kelimesine tutuyor. Başlık yerine gövdede taşınan bir kimlik bilgisi, imzalı bir adres veya bir istemin içine yapıştırılmış bir token düz metin olarak diske düşer.
- **Bu kayıtlar bir kimlik deposu kadar hassas sayılmalı.** Kazara paylaşılmaları mümkün olmamalı.
- Kaydın içine yazılan hiçbir alan gizli sayılmamalı. Bu kayıtların özet bilgisi panele yerel erişim kısıtı olmadan çıkıyor; yani kayda eklenen her alan yayınlanmış sayılır.

**Kabul edilmiş sınırlar.**
- **Bir kayıt bir denemeye karşılık gelir, bir istemci isteğine değil.** A başarısız olup B başarılı olursa iki kayıt oluşur, ve **bunları birbirine bağlayan hiçbir şey yok.**
- **Bazı başarısızlıklar hiç kayıt üretmiyor, ve en sık yaşanacak olan da bunların içinde:** bütün hesaplar kilitliyken istek, kayıt yazan katmana hiç ulaşmadan geri dönüyor. Yani sizi tamamen kilitlemiş bir sağlayıcı, başarısız trafik olarak değil **hiç trafik olmamış** gibi görünür. Bu görünümün en kolay yanlış okunan yeri.
- **Yalnızca sohbet istekleri kayıt üretiyor.** Model listeleme, gömme ve benzerleri yazmıyor.
- **Kayıt toplamayı kapatmak bu görünümü de boşaltır**, ve boş görünüm sebebini söylemiyor. Ayarlar sayfasındaki mevcut anahtar bunu yapabilir. Ayrıca kurulum ortamından gelen bir değer o anahtarı geçersiz kılabilir; o durumda anahtar açık görünürken kayıt tutulmaz ve ekranda bunu açıklayan bir şey olmaz.
- **Saklama sınırı bakıldığı zaman işliyor.** Zamanlayıcı yok: silme, liste okunduğunda çalışıyor. Sınır canlı bir tavan değil, sonraki bakışta uygulanan bir yüksek su işareti; görünüm kapalıyken hiçbir şey silinmiyor ve kayıt sayısı sınırın çok üstüne çıkabilir.
- **Saklama sınırının kullanıcı kontrolü yok.** Sınır var ve işliyor, ama 1.1 ile 4.1'in alanlarının aksine kullanıcıya açılmış bir alanı yok.
- **Çok büyük bir kayıt dosyası ilk kısmıyla gösteriliyor.** Bir dosyanın *içinden* hiçbir şey ayıklanmıyor — alan gizleyen bir ham görünüm, dosya hakkında yalan söylemiş olurdu.
- **Çerçeve seviyesindeki ayrıntı yalnızca akış yolunda var.** Tek parça cevaplanan istekler birleştirilmiş gövdeyi kaydediyor.
- **Sonuç filtresi yalnızca görüntülenen sayfayı daraltıyor**, bütün geçmişi değil.
- **Görünür bir gecikme var**: bir istek bittiği anda listede olmayabilir.
- **Bu kayıtlar veritabanı yedeklerine dâhil değil**, ham dosyalar da yedeklenmiyor.
- **Kaydı bulunamayan bir satır için yedek gösterim yok.** Bedeli: saklama sınırıyla silinmiş bir satır ile kayıt klasörü taşınmış bir kurulum arayüzde birebir aynı görünüyor.

---

### 5.2 Smart Logs sayfası

**Sorun.** 3.1'in sıralaması tamamen görünmez. Hata sayacı ve sona gönderme tarihi tutuluyor ama hiçbir yerde okunmuyor; kullanıcı bir hesabın neden artık öne çıkmadığını göremiyor, sadece istediği hesabın seçilmediğini görüyor. Sıralama bir **tahmin**, ve tahminin dayanağı görünmezse tahmin denetlenemez.

**İstenen.** Tek bir sayfa, yukarıdan aşağıya daralan bir soru dizisi olarak: "şu an ne oluyor" → "ne olmuştu" → "neden öyle sıralandı".

**Bölüm 1 — Aktif sohbetler.** Her canlı eşleşme için bir kart: sohbetin kimliği, hangi hesaba ve hangi modele bağlı olduğu, boşta kalma süresinin ne zaman dolacağı.
- **Bir sohbet iki kart üretebilir**, çünkü eşleşme sohbet ve model çiftine göre tutuluyor.
- Geri sayım **biteceği an** olarak verilmeli, kalan süre olarak değil: kalan süre gönderilse gönderildiği anda eskimeye başlar ve açık bırakılmış bir sayfa donmuş bir sayı gösterir.
- **Sohbet kimliği ham hâliyle hiçbir yerde gösterilmemeli.** İstemciden gelen kimlikler içeriğini bizim belirlemediğimiz serbest metinler ve kullanıcıyı tanımlayabilirler; panel ise oturum zorunluluğu kapalıyken erişebilen herkese açık. Gösterimin işi kimliği okutmak değil **gruplamak** — "şu on kayıt aynı sohbete ait" — ve bunun için türetilmiş kısa bir etiket yeter.

**Bölüm 2 — İstek kayıtları.** 5.1'in listesi, hangi sohbete ait olduğu bilgisi eklenmiş hâlde.
- İstek kayıtlarına sohbet etiketi eklenmeli; bu bilgi hiçbir kayıtta yoktu. Sonradan aktif eşleşmelerden türetmek de mümkün değil, çünkü o eşleşmeler otuz dakikada siliniyor ve yeniden başlatmada kayboluyor — oysa istek kayıtları kalıcı.
- Saklanan değer, gösterilen etiketle **aynı** olmalı. Üst bölümdeki kartlarla alt bölümdeki kayıtların gözle eşleşebilmesi gerekiyor.

**Bölüm 3 — Sağlayıcı kutucukları.** Yalnızca 3.1'in çalıştığı sağlayıcılar listelenmeli; o strateji çalışmayan bir sağlayıcı için gösterilecek anlamlı bir sıra da yok, sayaç da anlamsız. Boş liste, kendisini üreten iki ayarı adıyla söylemeli.

**Sağlayıcı detayı — sıralamanın gerekçesi.** Bir kutucuğa tıklandığında o sağlayıcının bağlantıları 3.1 sıralamasıyla listelenmeli.
- **İki ayrı tablo olmalı, tek liste değil:** sıralanmış havuz, ve havuza hiç girmeyenler (kilitli veya kapalı hesaplar, dönüş zamanı en yakın olan üstte). Kilitli bir hesap en sona konmuyor, havuzdan **çıkarılıyor**; ikisini tek listede birleştirmek seçimin hiçbir zaman üretmeyeceği bir sıra göstermek olurdu.
- Her satır şunları taşımalı — ilk dördü sıralamanın girdileri, kalanı o girdileri okunabilir kılan bağlam:

| Sütun | Kapsamı | Rolü |
|---|---|---|
| Kaç sohbete hizmet ediyor | Hesap (modeller arası toplam) | **1. ölçüt** |
| ⤷ bunların kaçı seçili modelde | Hesap ve model | yalnızca bilgi, sıralamada kullanılmaz |
| En son ne zaman sona gönderildi | Hesap ve model | **2. ölçüt** |
| Hata sayacı durumu (örn. `4/10`) | Hesap ve model | ölçüt değil — 2. ölçütü *üreten* sayaç |
| Statik öncelik | Hesap | **3. ölçüt** |
| Sıra numarası | — | yalnızca havuz tablosunda |
| Hesap adı | Hesap | kapalıysa ayrıca belirtilir |
| Kilidin ne zaman düşeceği | Hesap ve model | geri sayım olarak |

- Sıra numarası ölçüt olmadığı hâlde gerekli: sıralanmış bir tablo, numara olmadan yalnızca "bir sıra var" diyor, "bu hesap kaçıncı" demiyor.
- **Kilit sütunu havuz tablosunda da durmalı**, çünkü bir hesabın kilidi seçili modelde değil başka bir modelde olabilir — o zaman bu model için havuzdadır ama üzerinde bir kilit vardır.
- **Sohbet sayısı iki kapsamda birlikte gösterilmeli ve büyük olan sıralamanın kullandığı olmalı.** İkinci satır gerekli, çünkü bu, model seçicisini takip etmeyen tek sütun: "3 sohbet / 7 puan" ifadesinde puanlar seçili modele ait, sohbetler değil. İkinci sayı sıralamada kullanılmaz.
- **Bir model seçici olmalı ve "hepsi" seçeneği olmamalı.** Ölçütlerin kapsamı simetrik değil: sohbet sayısı hesap başına, ama sona gönderme tarihi ve hata sayacı hesap ve model çiftine ait. Model bazlı iki ölçütü modeller arasında toplamak anlamsız bir sayı üretir: bir modelde kotası bitmiş, diğer üçünde çalışan bir hesap toplandığında ne sağlıklı ne sorunlu görünür.
- Başlangıç seçimi, o sağlayıcıda en çok aktif eşleşmesi olan model olmalı; hiç eşleşme yoksa sağlayıcının ilk modeli. Seçili model her zaman ekranda yazılı olmalı.

**Kabul kriterleri.**
- Kullanıcı, bir hesabın neden öne çıkmadığını bu sayfada gerekçesiyle görebilir.
- Gösterilen sıra, seçimde gerçekten kullanılan sıradır.
- Aynı sohbet, aktif sohbet kartlarında ve istek kayıtlarında aynı etiketle görünür.
- Program yeniden başladıktan sonra aktif sohbetler bölümü boştur ve **bunun sebebi ekranda yazılıdır.**

**Kabul edilmiş sınırlar.**
- **Bu sayfanın kendi parametresi yok.** Gösterdiği her süre ve her eşik başka bir bölüme ait: boşta kalma süresi 3.2'de, sayaç eşiği 3.1'de, kayıt saklama sınırı 5.1'de.
- **Yalnızca sohbet istekleri sohbet etiketi taşır.** Görsel, ses, gömme ve arama istekleri bir sohbete ait değil; o satırlarda alan boş kalır ve **boş olduğu açıkça belirtilir** — eksik veri ile bulunmayan veri arasındaki fark görünmezse alan bozuk sanılır.
- **Sohbet etiketi yalnızca bu özellikten sonraki kayıtlarda var.** Geçmiş kayıtlar için eşleştirilecek bir şey yok.
- **Sıfırlanmış bir sayaç sağlıklı demek değil** (3.1). Sona gönderme tarihi doluysa satır o durumu belirgin biçimde gösterir.
- **Sayaçlar strateji seçili olmasa da birikir**, bu sayfa onları göstermese bile.
- **Sayfayı açmak ölçtüğü şeyi değiştirmemeli.** Bir sohbetin boşta kalma süresi son *isteğinden* itibaren sayılıyor; sayfayı açmak o süreyi uzatmamalı.

---

## Nereye bakılır

| Soru | Kaynak |
|---|---|
| Kullanıcı ne istiyor? | Bu dosya |
| Fork upstream'e göre hangi dosyaları nasıl değiştirdi? Merge'de neye dikkat edilmeli? | `FORK-CHANGES.md` |
| Bu satır neden upstream'den farklı? | O satırın yanındaki `FORK(...)` yorumu |
| Bir kuralın tam somut hâli | Kodun kendisi |
