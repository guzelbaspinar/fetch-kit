# @guzelbaspinar/fetch-kit — Bug Raporu

**Paket:** https://www.npmjs.com/package/@guzelbaspinar/fetch-kit
**Repo:** https://github.com/guzelbaspinar/fetch-kit
**İnceleme yöntemi:** Repo klonlandı, `tsup` ile derlendi, bulgular gerçek kod çalıştırılarak (Node.js) doğrulandı.

> ## 🔄 GÜNCELLEME (v0.1.6) — Tüm buglar düzeltildi ✅
>
> Yazar `fix: resolve buildUrl/baseUrl, Content-Type case, and abort-during-retry bugs (#12)` commit'i ile paketi **0.1.6**'ya yükseltti. Repo yeniden klonlanıp derlendi ve aşağıdaki üç test **tekrar çalıştırılarak** doğrulandı:
>
> | # | Bug | Yeniden Test Sonucu |
> |---|-----|----------------------|
> | 1 | `buildUrl` mutlak URL + `baseUrl` | ✅ **Düzeltilmiş** — `https://other-service.com/data` artık olduğu gibi kullanılıyor, `baseUrl` bu durumda yok sayılıyor |
> | 2 | Case-sensitive `Content-Type` kontrolü | ✅ **Düzeltilmiş** — `content-type` (küçük harf) artık doğru tanınıyor, çakışan header oluşmuyor |
> | 3 | Retry bekleme süresi `AbortSignal`'i görmezden geliyordu | ✅ **Düzeltilmiş** — abort artık ~2ms içinde etkili oluyor (önceden 60 saniye sürüyordu) |
>
> Ayrıca **Bug 3'ün yan etkisiyle bahsedilen tasarım riski** (`isNetworkError`'ın her hatayı network hatası sayması) da düzeltilmiş: artık yalnızca `TypeError` (fetch/undici bağlantı hataları) ve bilinen Node hata kodları (`ECONNRESET`, `ENOTFOUND` vb.) retry edilebilir sayılıyor; alakasız programlama hataları artık sessizce retry edilmiyor.
>
> **README güncellemeleri de yapılmış:**
> - Yeni "Module formats (ESM, CJS, TypeScript)" bölümü eklenmiş (ESM/CJS/TS örnekleriyle).
> - `baseUrl` tablosunda mutlak URL davranışı artık doğru açıklanıyor ("ignored... this lets you call other hosts/services").
> - Request body bölümünde Content-Type kontrolünün case-insensitive olduğu açıkça belirtilmiş.
> - Retry bölümünde ağ hatası tespitinin artık `TypeError`/bilinen hata kodlarına dayandığı belirtilmiş.
> - Cancellation bölümüne "**Cancellation and retries**" alt başlığı eklenerek abort'un backoff bekleme sürecini de anında kestiği net biçimde yazılmış.
>
> Paketin kendi test suite'i de çalıştırıldı: **48/48 test geçti**, 0 hata.
>
> ## 🧪 İKİNCİ TUR — Tam Kapsamlı Test (v0.1.6)
>
> Bu ikinci turda **52 ayrı senaryo** gerçek bir HTTP sunucusuna karşı (mock `fetchImpl` değil, gerçek `node:http` sunucusu + gerçek native `fetch`) test edildi: tüm HTTP metodları (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), tüm `body`/`rawBody`/`FormData` kombinasyonları, yanıt `Content-Type` çeşitleri (json, json+charset, text/plain, text/csv, octet-stream, header yok, 204, bozuk JSON), query param encode kuralları, `baseUrl` birleştirme, header merge sırası, tüm retry mekanizmaları (`shouldRetry`, `computeDelay`, `onRetry`, `retryOnStatusCodes`, global+per-request merge, network hatası ayrımı), `timeoutMs`, `AbortSignal` (uçuşta + retry-backoff sırasında + önceden abort edilmiş), `FetchKitError` alanları, logger injection ve `resetConfiguration`.
>
> **Sonuç: 52 testten 50'si geçti, 2 yeni gerçek bug bulundu:**
>
> ### 🔴 Yeni Bug 4 — `HEAD` isteklerinde yanıt gövdesi hatalı parse ediliyor (crash)
> Sunucu `HEAD` isteğine `Content-Type: application/json` header'ı ile ama (HTTP spec gereği) **boş gövdeyle** cevap verdiğinde, kütüphane yine de `response.json()` çağırıyor ve `SyntaxError: Unexpected end of JSON input` ile patlıyor. Bu hata `FetchKitError` içine sarılıp network hatasıymış gibi kullanıcıya dönüyor — oysa istek aslında **başarılı** (HTTP 200), sadece kütüphanenin gövde ayrıştırma mantığı `HEAD` özel durumunu (204'te olduğu gibi) hesaba katmıyor.
> ```
> caught: Request failed for HEAD http://.../echo-method
> cause: SyntaxError: Unexpected end of JSON input
>     at parseBody (dist/index.js:222)
> ```
> Bu, gerçek dünyada `HEAD` ile herhangi bir JSON API'ye istek atan her kullanıcıyı etkiler (çoğu API, `HEAD` yanıtında `GET` ile aynı header'ları — dolayısıyla `Content-Type: application/json`'ı — döner, gövde olmadan).
>
> **Önerilen düzeltme:** `parseBody()` içinde `204` kontrolüne benzer şekilde `method === 'HEAD'` durumunu da erken dönecek şekilde ele alın:
> ```ts
> private async parseBody<T>(response: Response, method: HttpMethod): Promise<T> {
>   if (response.status === 204 || method === 'HEAD') return undefined as T;
>   ...
> }
> ```
>
> ### 🟡 Yeni Bug 5 — `logger.error` sadece network hatalarında çağrılıyor, HTTP status hatalarında değil (asimetri)
> Retry hakları tükendiğinde:
> - **Network/timeout hatası** ile tükenirse → `logger.warn` (her retry'de) + `logger.error` (son hata) **ikisi de** çağrılıyor. ✅
> - **HTTP status hatası** (örn. sürekli `503`) ile tükenirse → `logger.warn` çağrılıyor ama **`logger.error` hiç çağrılmıyor**. ❌
>
> Test kanıtı:
> ```
> // HTTP 503 ile retry tükenince:
> logs = { warn: 1, error: 0 }   ❌ error çağrılmalıydı
>
> // Network hatasıyla retry tükenince:
> logs = { warn: 1, error: 1 }   ✅ tutarlı
> ```
> Sebep: `index.ts`'te `!response.ok` dalında (HTTP status ile başarısız olan istekler) `FetchKitError` doğrudan fırlatılırken `this.logger.error?.()` çağrısı unutulmuş; bu çağrı yalnızca `catch` bloğundaki (network/exception) "pes etme" yolunda var. Bu, production'da `logger.error`'a bağlı alarm/monitoring kuran ekiplerin **kalıcı 5xx/429 hatalarını hiç görmemesi** anlamına gelir — sadece network kesintileri loglanır, asıl sık karşılaşılan senaryo olan "API sürekli 503 dönüyor" durumu sessiz kalır.
>
> **Önerilen düzeltme:** HTTP status hatası fırlatılmadan hemen önce de aynı `logger.error` çağrısını ekleyin:
> ```ts
> if (!response.ok) {
>   const text = await response.text().catch(() => '');
>   this.logger.error?.(`fetch-kit: ${method} ${url} failed after ${attempt} attempt(s), giving up.`, { status: response.status });
>   throw new FetchKitError(...);
> }
> ```
>
> ### Not: Yanlış pozitif (kütüphane bug'ı değil)
> İlk denemede `rawBody` ile string gönderildiğinde beklenmedik bir `Content-Type: text/plain;charset=UTF-8` header'ı gözlemlendi ve önce bug sanıldı. Ancak bu, **native `fetch`/undici'nin kendi davranışı** — ham string body verildiğinde tarayıcı/Node fetch standardı gereği otomatik bu header'ı ekliyor, fetch-kit buna müdahale etmiyor. README'nin "no automatic serialization" ifadesi teknik olarak doğru (kütüphane JSON.stringify yapmıyor), sadece native fetch'in kendi varsayılanı devreye giriyor. Bu netleştirme README'ye tek satırlık bir dipnot olarak eklenebilir ama bug değildir.
>
> ---

## Bug 1 — `buildUrl`: mutlak URL + `baseUrl` kombinasyonu geçersiz URL üretiyor

**Konum:** `src/url.ts` → `buildUrl()`

### Tekrar Üretme
```js
configure({ baseUrl: 'https://api.example.com' });
await request({ url: 'https://other-service.com/data' });
```

### Sonuç
```
Gerçekte çağrılan URL:
https://api.example.com/https://other-service.com/data   ❌
```

### Neden Oluyor
`path` bir `http(s)://` ile başlasa bile fonksiyon bunu `baseUrl`'e string olarak ekliyor. README bu davranışı "belgelenmiş özellik" gibi sunuyor ("hâlâ baseUrl ile birleştirilir"), ama üretilen sonuç geçersiz/kullanılamaz bir URL. `baseUrl` set edilmiş bir uygulamada başka bir servise (ör. üçüncü parti webhook) tam URL ile istek atmak isteyen herkes bu hataya düşer.

### Önerilen Düzeltme
```ts
export function buildUrl(baseUrl?: string, path: string, params?: QueryParams): string {
  if (/^https?:\/\//i.test(path)) {
    return `${path}${buildQueryString(params)}`; // mutlak URL varsa baseUrl'i yok say
  }
  const base = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const suffix = path.startsWith('/') || !base ? path : `/${path}`;
  return `${base}${suffix}${buildQueryString(params)}`;
}
```

---

## Bug 2 — `Content-Type` header kontrolü case-sensitive, çakışan header üretiyor

**Konum:** `src/index.ts` → `FetchKitEngine.request()`

### Tekrar Üretme
```js
await request({
  url, method: 'POST',
  body: { a: 1 },
  headers: { 'content-type': 'text/plain' } // küçük harf
});
```

### Sonuç
`fetch`'e gönderilen headers nesnesi:
```json
{ "content-type": "text/plain", "Content-Type": "application/json" }
```

### Neden Oluyor
Kütüphane şu kontrolü yapıyor:
```ts
if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
```
Bu kontrol yalnızca tam eşleşen anahtarı (`'Content-Type'`) arıyor. Kullanıcı `content-type` (küçük harfle) verirse görülmüyor ve ikinci bir `Content-Type: application/json` daha ekleniyor. HTTP header isimleri case-insensitive olduğundan native `fetch`/undici bu iki değeri birleştirip öngörülemez/geçersiz bir header gönderebiliyor.

### Önerilen Düzeltme
```ts
const hasContentType = Object.keys(headers).some(
  (k) => k.toLowerCase() === 'content-type'
);
if (!hasContentType) headers['Content-Type'] = 'application/json';
```

---

## Bug 3 (en kritik) — Retry bekleme süresi `AbortSignal`'i tamamen görmezden geliyor

**Konum:** `src/index.ts` → `FetchKitEngine.waitBeforeRetry()` ve `src/backoff.ts` → `sleep()`

### Tekrar Üretme
```js
configure({
  fetchImpl: async () => new Response('fail', { status: 503 }),
  retry: { retries: 5, baseDelayMs: 2000, jitter: false }
});

const controller = new AbortController();
const p = request({ url: 'https://x.com/y', signal: controller.signal });

setTimeout(() => controller.abort(), 100); // 100ms sonra iptal et
```

### Sonuç (gerçek test çıktısı)
```
aborting at ms: 142
rejected after ms: 60084   ❌ (60 saniye sonra!)
total fetch calls made: 6  (tüm retry'ler tamamlandı)
```

### Neden Oluyor
`backoff.ts` içindeki `sleep(ms, signal?)` fonksiyonu bir `signal` parametresi kabul edip iptali destekleyecek şekilde tasarlanmış, ancak `index.ts` içindeki `waitBeforeRetry()`, `sleep(delayMs)` çağrısına **hiçbir signal geçmiyor**:
```ts
await sleep(delayMs); // signal parametresi eksik
```
Sonuç: kullanıcı `AbortController.abort()` çağırsa bile, retry'ler arasındaki bekleme (backoff) süresi tamamen çalışmaya devam ediyor ve iptal ancak tüm retry döngüsü bitince fark ediliyor. Bu, `AbortSignal`'in en temel amacını (anlık iptal) geçersiz kılıyor. Yüksek `retries`/`baseDelayMs` ayarlarıyla kullanıcı arayüzü onlarca saniye "asılı" kalabilir.

### Önerilen Düzeltme
```ts
private async waitBeforeRetry(
  attempt: number,
  retryConfig: RetryOptions & Required<...>,
  ctx: RetryDecisionContext,
  signal?: AbortSignal            // + eklendi
): Promise<void> {
  const defaultDelay = computeExponentialDelay(attempt, retryConfig);
  const delayMs = retryConfig.computeDelay ? retryConfig.computeDelay(ctx, defaultDelay) : defaultDelay;

  retryConfig.onRetry?.({ ...ctx, delayMs });
  this.logger.warn?.(/* ... */);

  await sleep(delayMs, signal);     // + signal iletildi
}

// Çağrı yerlerinde:
await this.waitBeforeRetry(attempt, retryConfig, decisionCtx, config.signal);
```
Ayrıca `request()` içinde `sleep`'in fırlattığı abort hatasını yakalayıp retry sayılmadan doğrudan fırlatmak gerekir.

---

## Küçük Tasarım Riski (bug değil, ama dikkat edilmeli)

**Konum:** `src/url.ts` → `isNetworkError()`

```ts
export function isNetworkError(error: unknown): boolean {
  return !(error instanceof DOMException && error.name === 'AbortError');
}
```

Bu mantık "AbortError değilse her şey network hatasıdır" varsayımına dayanıyor. Bu yüzden kullanıcının özel `fetchImpl`'inde (örn. test/mock ortamında) atılan alakasız bir `TypeError` veya programlama hatası bile sessizce `retries` kadar tekrar denenir. Bilinen network hata tiplerine karşı (ör. `TypeError: fetch failed`, `ECONNRESET`, DNS hataları) daha dar/beyaz liste bazlı bir kontrol, gerçek programlama hatalarının maskelenmesini önler.

---

## README'e Eklenmesi Gereken Notlar

Modül dağıtımı (ESM/CJS/TypeScript) tarafı test edildi ve doğru çalıştığı doğrulandı — `package.json`'daki `exports` alanı doğru kurgulanmış, `tsup` hem ESM hem CJS build'i ayrı ayrı üretiyor. Ancak README şu an bunu hiç belirtmiyor. Aşağıdaki maddelerin README'ye eklenmesi hem kullanıcı güvenini artırır hem de yukarıdaki buglarla ilgili beklenti yönetimini sağlar:

1. **Modül uyumluluğu bölümü eksik.** README'de "ships both CJS (`require`) and ESM (`import`) builds" cümlesi geçiyor ama bunun somut kanıtı (örnek `require(...)` kullanımı, TypeScript ile generic tip kullanımı örneği) yok. Kısa bir "Module formats" / "CJS & ESM & TypeScript" bölümü eklenip her üçü için birer satırlık örnek verilmeli:
   ```ts
   // ESM
   import { request } from '@guzelbaspinar/fetch-kit';
   // CommonJS
   const { request } = require('@guzelbaspinar/fetch-kit');
   ```

2. **`baseUrl` + mutlak URL davranışı yanlış/eksik açıklanmış (Bug 1 ile ilgili).** Mevcut metin şöyle diyor: *"If `request()` uses a full `http(s)://` URL, it is still combined with `baseUrl` unless you omit `baseUrl`"* — bu ifade, üretilen sonucun **geçersiz bir URL** olduğunu gizliyor. Bug düzeltilene kadar README'de bu davranışın bir **bilinen kısıtlama / uyarı** olarak (⚠️ işaretiyle) yeniden yazılması ve kullanıcının mutlak URL kullanmak istediğinde `baseUrl`'i `undefined` yapması gerektiğinin açıkça belirtilmesi gerekiyor. Bug düzeltildikten sonra da davranış değişikliği CHANGELOG'da not düşülmeli.

3. **Header birleştirme (case-sensitivity) belirtilmemiş (Bug 2 ile ilgili).** README "per-request keys win" diyor ama header anahtarlarının **case-sensitive** olarak karşılaştırıldığını, yani `content-type` ile `Content-Type`'ın farklı anahtarlar sayıldığını söylemiyor. Bug düzeltilene kadar en azından şu uyarı eklenmeli: *"Content-Type anahtarını her zaman `'Content-Type'` (büyük C, büyük T) olarak verin; farklı case kullanmak çakışan header'a yol açabilir."*

4. **`AbortSignal` + retry etkileşimi eksik/yanıltıcı (Bug 3 ile ilgili — en kritik).** README'nin "Request cancellation" bölümü, `signal`'in retry döngüsüyle nasıl etkileştiğinden hiç bahsetmiyor. Kullanıcı mantıken "abort edersem istek hemen durur" bekler; oysa şu an retry'ler arası bekleme (backoff) sırasında abort **hiçbir etki yapmıyor** ve iptal onlarca saniye gecikebiliyor. Bug düzeltilene kadar bu, README'de büyük harflerle **bilinen sınırlama** olarak belgelenmeli, aksi halde kullanıcılar production'da sessizce "asılı kalan" isteklerle karşılaşıp bunu kütüphanenin hatası olarak fark edemeyebilir (timeout sanıp yanlış yerde debug yapabilirler).

5. **Genel öneri: "Known Limitations" / "Bilinen Sınırlamalar" bölümü açılmalı.** Şu an README yalnızca "mutlu yol" (happy path) senaryolarını gösteriyor; yukarıdaki 3 bug düzeltilene kadar bunların en azından listelenmesi, kullanıcıların üretim kodunda beklenmedik davranışlarla karşılaşmadan önce haberdar olmasını sağlar. Bug'lar düzeltildiğinde bu bölüm CHANGELOG'a taşınabilir.

---

## Özet Tablo

| # | Bug | Önem | Etki | Durum |
|---|-----|------|------|-------|
| 1 | `buildUrl` mutlak URL + `baseUrl` → geçersiz URL | Yüksek | İstekler yanlış adrese/404'e gider | ✅ Düzeltildi (v0.1.6) |
| 2 | Case-sensitive `Content-Type` kontrolü | Orta | Çakışan/geçersiz header | ✅ Düzeltildi (v0.1.6) |
| 3 | Retry bekleme süresi `AbortSignal`'i görmezden geliyor | Kritik | Kullanıcı iptali dakikalarca gecikebilir | ✅ Düzeltildi (v0.1.6) |
| 4 | `HEAD` isteğinde JSON parse crash'i | **Yüksek** | Başarılı `HEAD` isteği hata olarak dönüyor | 🔴 **Hâlâ mevcut** |
| 5 | `logger.error` HTTP status hatalarında çağrılmıyor | Orta | Monitoring/alarm sistemleri kalıcı 5xx'leri kaçırır | 🔴 **Hâlâ mevcut** |
| — | `isNetworkError` aşırı geniş kapsam | Düşük (tasarım notu) | — | ✅ Düzeltildi (v0.1.6) |

Kütüphanenin genel API tasarımı (tek `request()` fonksiyonu, `configure()` ile global varsayılanlar, zengin retry hook'ları — `shouldRetry`, `computeDelay`, `onRetry`) temiz ve iyi dokümante edilmiş durumda. Modül dağıtımı (ESM/CJS/TypeScript) da doğru çalışıyor. Ancak yukarıdaki üç bug, özellikle **Bug 3**, production kullanımında ciddi sorunlara yol açabileceğinden öncelikli olarak düzeltilmeli; düzeltme yapılana kadar da en azından README'de "Bilinen Sınırlamalar" olarak belgelenmelidir.