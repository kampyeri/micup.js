# micup.js

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
| `new Client({ ignoredEvents, origin })` | `ignoredEvents`: oturumun almak istemediği olay adları (örn. `['TYPING_START']`). `origin`: Micup kök adresi (varsayılan: `https://micup.gg`). |
| `await client.login(token)` | Token'ı REST'te doğrular, ardından gateway'e bağlanır. Hatalı token'da `MicupError` fırlatır. |
| `client.send(channelId, content \| body)` | Kanala mesaj gönderir, `Message` döner. |
| `client.rest(method, path, body)` | Ham REST çağrısı. Örnek: `client.rest('GET', '/users/@me')`. `/api/v1` öneki otomatik eklenir. |
| `client.voice` | Ses kanalı yönetimi (aşağıda). |
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

## Micup'a özgü kısıtlar (resmi dokümandan)

- **Intent yoktur.** Identify yalnızca `token` ve `properties` gönderir; olay filtreleme için `ignoredEvents` kullanılır.
- **Slash komutu ve etkileşim yoktur.** Uygulama komutu uç noktası ve etkileşim olayı dokümanda bulunmuyor.
- **Buton ve menü yalnızca birinci taraf botlarda vardır.** Üçüncü taraf bot token'ıyla gönderilen `components` alanı sunucu tarafında düşürülür.
- Tepki (reaction) olayları (`MESSAGE_REACTION_ADD`) desteklenir; etkileşim yerine tepkiler kullanılabilir.

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

Testler, yerel bir sahte Micup sunucusuna karşı uçtan uca gateway akışını da doğrular (giriş, mesaj, yanıt, ses katılımı).

## Bilinen sınırlar

- Gerçek Micup botuyla giriş, mesaj ve ses çalma (bağlanma, dosya çalma, duraklat / devam / durdur, çıkış) test edildi.
- Resume (kopan oturumu sürdürme) yok; her yeniden bağlantıda kimlik doğrulaması yapılır.
- Ses yalnızca gönderilir; kanaldakileri dinleme / kayıt ve görüntü (kamera, ekran paylaşımı) yok.

## Lisans

MIT
