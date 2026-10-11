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

```js
const info = await client.voice.join(guildId, channelId, { selfMute: false });
// info: { guildId, channelId, sessionId, endpoint, token }
client.voice.leave(guildId);
const states = client.voice.getStates(guildId);
```

`join`, gateway'den ses durumu ve ses sunucusu bilgisi gelince çözülür. Ses medyası (Opus, şifreleme, yayın) bu kütüphanede yoktur; `info` bilgileri bir ses istemcisine verilmelidir.

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

- Gerçek Micup botuyla giriş ve mesaj akışı token ile test edildi; ses akışı henüz test edilmedi.
- Resume (kopan oturumu sürdürme) yok; her yeniden bağlantıda kimlik doğrulaması yapılır.
- Ses medyası yok.

## Lisans

MIT
