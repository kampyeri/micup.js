# micup.js

**Made by DCSV** · [dcsv.me](https://dcsv.me) · [micup.me](https://micup.me)

Micup (Fluxer tabanlı) için Node.js bot kütüphanesi. `discord.js` ile benzer bir yapıda: `Client`, olaylar (`on('ready')`, `on('messageCreate')`), `message.reply()`.

## Kurulum

```bash
npm install micup.js
```

Node.js 18 veya üstü gerekir. TypeScript tipleri paketle birlikte gelir.

## Hızlı başlangıç

```js
import { Client, Events } from 'micup.js';

const client = new Client();

client.on(Events.Ready, c => {
    console.log(`Giriş yapıldı: ${c.user.username}`);
});

client.on(Events.MessageCreate, async message => {
    if (message.isBot) return;
    if (message.content === '!ping') await message.reply('pong');
});

await client.login(process.env.MICUP_BOT_TOKEN);
```

## Client

| Seçenek / metot | Açıklama |
|---|---|
| `new Client({ ignoredEvents, origin, telemetry })` | `ignoredEvents`: oturumun almak istemediği olay adları (örn. `['TYPING_START']`). `origin`: Micup kök adresi (varsayılan: `https://micup.gg`). `telemetry`: kullanım ve hata bildirimi, varsayılan açık; kapatmak için `false` (aşağıda). |
| `await client.login(token)` | Token'ı REST'te doğrular, ardından gateway'e bağlanır. Hatalı token'da `MicupError` fırlatır. |
| `client.send(channelId, content \| body)` | Kanala mesaj gönderir, `Message` döner. |
| `client.rest(method, path, body)` | Ham REST çağrısı. Örnek: `client.rest('GET', '/users/@me')`. `/api/v1` öneki otomatik eklenir. |
| `client.voice` | Ses kanalı yönetimi (aşağıda). |
| `client.components` | Tepki butonları, seçim menüleri ve sayfalama (aşağıda). |
| `client.isReady()` | `READY` alındıysa `true`. |
| `client.user` | Bot kullanıcı bilgisi (giriş sonrası dolar). |
| `client.destroy()` | Bağlantıyı kapatır ve yeniden bağlanmayı durdurur. |

## Message

| Alan / metot | Açıklama |
|---|---|
| `id`, `channelId`, `guildId`, `content`, `author` | Mesaj bilgileri. |
| `isBot` | Yazan hesap bot ise `true`. Kendi mesajlarını yok saymak için kullanın. |
| `reply(content \| body)` | Bu mesaja yanıt verir. |
| `raw` | Micup'tan gelen ham veri. |

## Bileşenler (buton, menü, sayfalama)

Micup, gerçek mesaj bileşenlerini (buton satırları) yalnızca kendi resmi botlarına açar; bot token'ıyla gönderilen `components` alanı sunucuda silinir. micup.js bu yüzden Components V2 benzeri bir yazımı Micup'ın desteklediği parçalara çevirir: düzen **embed** olarak, butonlar **tepki** olarak çalışır. Tıklanan tepki otomatik geri alınır (botta **Mesajları Yönet** izni gerekir).

```js
import { Client, Container, SelectMenu, Paginator } from 'micup.js';

const panel = new Container()
    .title('Oy Paneli')
    .color('#5865F2')
    .text('Bu ay en çok oy verenler…')
    .separator()
    .section({ title: 'Kurallar', text: 'Her üye 12 saatte bir oy verebilir.' })
    .links([{ label: 'micup.me', url: 'https://micup.me' }])
    .button({ emoji: '❤️', label: 'Oy ver', onClick: i => i.reply(`<@${i.userId}> oy verdi!`) })
    .button({ emoji: '📊', label: 'Sıralama', onClick: i => i.update(siralama()) })
    .timeout(0); // 0 = süresiz panel (varsayılan 15 dakika)

await client.send(channelId, panel);
```

| Container | Açıklama |
|---|---|
| `title(text, url?)`, `author(name, { icon, url })`, `color(hex)` | Başlık, yazar, renk |
| `text(md)`, `section({ title, text, thumbnail })`, `separator()`, `links([{ label, url }])` | İçerik, sırayla tek embed'e yazılır |
| `thumbnail(url)`, `image(url)`, `footer(text, icon?)`, `timestamp()` | Görseller ve alt bilgi |
| `button({ emoji, label, onClick, once, disabled, filter })` | Tepki butonu; `label` mesajın altında açıklanır (`hideLegend()` ile kapatılır) |
| `select(menu)` | Seçim menüsü (aşağıda) |
| `timeout(ms)`, `only(...userIds)`, `cooldown(ms)`, `filter(fn)`, `onEnd(fn)`, `keepReactions()` | Süre, kullanıcı kısıtı, art arda tıklama sınırı, süzgeç, bitişte çağrı |

Tıklamada gelen `interaction`: `userId`, `user`, `member`, `guildId`, `channelId`, `messageId`, `emoji` ve `reply(body)`, `update(body)` (mesajı düzenler; yeni Container verilirse butonlar da değişir), `delete()`, `end()`.

**Seçim menüsü:** seçenekler numaralı satırlar olarak yazılır, 1️⃣ … 🔟 tepkileriyle seçilir (en fazla 10).

```js
const menu = new SelectMenu({ placeholder: 'Kategori seç', onSelect: (i, secim) => i.reply(`Seçtin: ${secim.label}`) })
    .option({ label: 'Oyun', value: 'game', emoji: '🎮' })
    .option({ label: 'Müzik', value: 'music', description: 'Şarkı botları' });

await message.reply(new Container().title('Kategoriler').select(menu).only(message.author.id));
```

**Sayfalama:** ◀️ ▶️ ile gezilir, 3'ten çok sayfada ⏮️ ⏭️ eklenir; alt bilgiye "Sayfa 2/5" yazılır.

```js
const sayfalar = gruplar.map((g, n) => new Container().title(`Liste ${n + 1}`).text(g.join('
')));
await client.send(channelId, new Paginator(sayfalar).only(message.author.id));
// Çok sayıda sayfa için: new Paginator(i => sayfaUret(i), { count: 40 })
```

Sınırlar (başlık 256, açıklama 4096, toplam 6000 karakter, mesaj başına 20 tepki) gönderilmeden kontrol edilir ve aşılırsa `ComponentError` fırlatılır. Mesaj yardımcıları: `message.edit(body)`, `message.react(emoji)`, `message.delete()`.

## Ses (voice)

Bot ses kanalına girip dosya, internet bağlantısı ya da akış çalabilir. Micup'un sesi LiveKit üzerinden çalışır; micup.js bağlantıyı kurar, sesi ffmpeg ile çevirip gönderir.

**Kurulum** (sesi kullanacaksanız):

```bash
npm install micup.js @livekit/rtc-node ffmpeg-static
```

`ffmpeg-static` yerine sistemde kurulu `ffmpeg` de kullanılabilir (ya da `FFMPEG_PATH` ortam değişkeni). Docker'da `ca-certificates` paketi kurulu olmalıdır (`node:*-slim` imajlarında yoktur).

```js
import { Client, Events } from 'micup.js';

const client = new Client();

client.on(Events.MessageCreate, async message => {
    if (message.content === '!çal') {
        // Komutu yazanın bulunduğu ses kanalı
        const state = client.voice.getStates(message.guildId).find(s => s.user_id === message.author.id);
        if (!state) return message.reply('Önce bir ses kanalına gir.');

        const connection = await client.voice.connect(message.guildId, state.channel_id);
        await connection.play('./muzik.mp3', { volume: 0.8 }); // parça bitince çözülür
        await connection.disconnect();
    }
    if (message.content === '!dur') client.voice.getConnection(message.guildId)?.stop();
});

await client.login(process.env.MICUP_BOT_TOKEN);
```

| Metot / alan | Açıklama |
|---|---|
| `await client.voice.connect(guildId, channelId, { volume, selfDeaf })` | Kanala girer, ses sunucusuna bağlanır, `VoiceConnection` döner. |
| `client.voice.getConnection(guildId)` | Açık bağlantı ya da `null`. |
| `client.voice.getStates(guildId)` | Kanaldaki ses durumları (kim hangi kanalda, sessiz mi). |
| `client.voice.leave(guildId)` | Kanaldan çıkar. |
| `await connection.play(girdi, { volume, seek, ffmpegArgs, raw })` | Dosya yolu, `http(s)` bağlantısı ya da akış çalar. Önceki parça durur. `raw: true`: girdi 48 kHz stereo s16le PCM. |
| `connection.pause()` / `resume()` / `stop()` | Duraklat, devam et, durdur. |
| `connection.setVolume(0-2)` | Ses seviyesi. |
| `connection.playing`, `paused`, `status`, `memberCount` | Durum bilgileri. |
| `await connection.disconnect()` | Kanaldan çıkar, bağlantıyı kapatır. |

Bağlantı olayları: `start`, `finish` (`{ stopped }`), `status` (`connecting`, `ready`, `reconnecting`, `disconnected`), `memberJoin`, `memberLeave`, `disconnect`, `error`.

- Botun kanalı görme ve **Bağlan** izni olmalı; **Konuş** izni yoksa bot girer ama ses duyulmaz.
- Bot kanaldan atılırsa bağlantı kapanır (`disconnect` olayı); kanal taşınırsa yeniden bağlanır.
- `client.voice.join()` yalnızca Micup'un ses yetkisini (`endpoint`, `token`, `connectionId`) döndürür; kendi ses istemcinizi kullanacaksanız işinize yarar.

## Durum (presence)

```js
import { Client, Status } from 'micup.js';

// Açılış durumu
const client = new Client({ presence: { status: Status.Online, customStatus: 'Sunucunu Büyüt' } });

// Çalışırken değiştirme
client.setPresence({ status: Status.Idle, customStatus: 'micup.gg/dcsv' });
client.setPresence({ customStatus: null }); // durum mesajını siler
```

- Durumlar: `online`, `idle`, `dnd`, `invisible`. Bağlıyken `offline` seçilemez.
- Micup'ta "Oynuyor/İzliyor" gibi aktiviteler yoktur; yalnızca durum mesajı (custom status) vardır.
- Sınır: 20 saniyede en fazla 5 durum değişikliği.
- Son ayarlanan durum yeniden bağlanınca otomatik uygulanır.

## Olaylar

| Olay | Argümanlar | Ne zaman |
|---|---|---|
| `ready` | `client` | Gateway `READY` gönderdiğinde. |
| `messageCreate` | `message` | Yeni mesaj geldiğinde. |
| `voiceStateUpdate` | `state` | Bir kullanıcının ses durumu değiştiğinde. |
| `voiceServerUpdate` | `server` | Ses sunucusu bilgisi geldiğinde. |
| `disconnect` | `code`, `reason` | Gateway bağlantısı koptuğunda. Kalıcı hata kodlarında yeniden bağlanılmaz. |
| `error` | `error` | Gateway hatası. Dinleyici yoksa hata sessizce yutulur, süreç düşmez. |

Diğer gateway olayları küçük harfli adla yayılır: `GUILD_CREATE` → `guild_create`, `MESSAGE_REACTION_ADD` → `message_reaction_add`.

## Hatalar

API hataları `MicupError` olarak gelir:

```js
import { MicupError } from 'micup.js';

try {
    await client.login(token);
} catch (err) {
    if (err instanceof MicupError) console.error(err.status, err.code);
}
```

## Kullanım ve hata bildirimi (telemetri)

micup.js, kütüphaneyi geliştirebilmek ve sorun yaşayan geliştiricilere destek verebilmek için **açık ve kapatılabilir** bir bildirim yapar. İlk bağlantıda konsola bir kez bilgi satırı yazılır.

Gönderilenler (`https://micup.me/api/telemetry` adresine):

| Ne zaman | Alanlar |
|---|---|
| Bağlanınca ve 12 saatte bir | bot kimliği ve adı, bot sahibinin kimliği ve adı, micup.js sürümü, Node sürümü, işletim sistemi, botun ekli olduğu **sunucu sayısı** |
| Kütüphane bir hata yakalayınca (en fazla dakikada bir) | bot kimliği ve adı, micup.js sürümü, hata mesajı ve yığın izi |

Gönderilmeyenler: bot token'ı, mesaj içerikleri, kullanıcı ya da sunucu kimlikleri, sunucu adları ve davet bağlantıları.

Veriler herkese açık sayfalarda gösterilmez; yalnızca micup.me yönetim panelinde, destek ve hata ayıklama için görülür. Bir bildirim başarısız olursa botunuz etkilenmez.

Kapatmak için:

```js
const client = new Client({ telemetry: false });
```

ya da ortam değişkeni: `MICUP_TELEMETRY=0` (`false`, `off`, `no` da kabul edilir).

## Micup'a özgü kısıtlar (resmi dokümandan)

- **Intent yoktur.** Identify yalnızca `token` ve `properties` gönderir; olay filtreleme için `ignoredEvents` kullanılır.
- **Slash komutu ve etkileşim yoktur.** Uygulama komutu uç noktası ve etkileşim olayı dokümanda bulunmuyor.
- **Buton ve menü yalnızca birinci taraf botlarda vardır.** Üçüncü taraf bot token'ıyla gönderilen `components` alanı sunucu tarafında düşürülür.
- Tepki (reaction) olayları (`MESSAGE_REACTION_ADD`) desteklenir; micup.js bileşenleri (`Container`, `SelectMenu`, `Paginator`) bu yüzden tepkiyle çalışır.

## Micup'a özgü bilgiler

| Ne | Değer |
|---|---|
| Keşif | `https://micup.gg/.well-known/fluxer` |
| REST | `https://micup.gg/api/v1` (`endpoints.api_public`) |
| Gateway | `wss://micup.gg/gateway?v=1&encoding=json` (sürüm 1 tek geçerli sürüm) |
| Yetkilendirme | `Authorization: Bot <token>` |
| Token biçimi | `uygulamaID.gizliKod` |

Kaynak: [micup.gg/docs](https://micup.gg/docs/) (gateway/commands, gateway/event-filtering, gateway/opcodes-and-close-codes, http-api/applications, http-api/messages).

## Test

```bash
npm install
npm test
```

Testler, yerel bir sahte Micup sunucusuna karşı uçtan uca gateway akışını da doğrular (giriş, mesaj, yanıt, ses katılımı, tepki butonları).

## Bilinen sınırlar

- Gerçek Micup botuyla giriş, mesaj ve ses çalma (bağlanma, dosya çalma, duraklat / devam / durdur, çıkış) test edildi.
- Resume (kopan oturumu sürdürme) yok; her yeniden bağlantıda kimlik doğrulaması yapılır.
- Ses yalnızca gönderilir; kanaldakileri dinleme / kayıt ve görüntü (kamera, ekran paylaşımı) yok.
- Bileşenler tepki tabanlıdır: gerçek butonlar gibi etiketli görünmez (etiketler mesajın altında yazılır) ve tepki kaldırmak için botta Mesajları Yönet izni gerekir. Bileşenli mesajlar bellekte tutulur; bot yeniden başlarsa eski mesajların butonları yeniden `client.send` / `message.edit` ile kurulmalıdır.

## Lisans

MIT
