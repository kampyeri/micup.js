# micup.js

Micup (Fluxer tabanlı) için Node.js bot kütüphanesi. `discord.js` ile benzer bir yapıda: `Client`, olaylar (`on('ready')`, `on('messageCreate')`), `message.reply()`.

## Kurulum

GitHub'dan:

```bash
npm install github:kampyeri/micup.js
```

Yerel klasörden:

```bash
npm install ../micup.js
```

Node.js 18 veya üstü gerekir. TypeScript tipleri paketle birlikte gelir.

## Hızlı başlangıç

```js
import { Client, Intents, Events } from 'micup.js';

const client = new Client({
    intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent,
});

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
| `new Client({ intents, origin })` | `intents`: gateway intent bit alanı (varsayılan: Guilds, GuildMessages, MessageContent). `origin`: Micup kök adresi (varsayılan: `https://micup.gg`, kendi sunucunuz için değiştirin). |
| `await client.login(token)` | Token'ı REST'te doğrular, ardından gateway'e bağlanır. Hatalı token'da `MicupError` fırlatır. |
| `client.send(channelId, content \| body)` | Kanala mesaj gönderir, `Message` döner. |
| `client.rest(method, path, body)` | Ham REST çağrısı. Örnek: `client.rest('GET', '/users/@me')`. `/api/v1` öneki otomatik eklenir. |
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

## Olaylar

| Olay | Argümanlar | Ne zaman |
|---|---|---|
| `ready` | `client` | Gateway `READY` gönderdiğinde. |
| `messageCreate` | `message` | Yeni mesaj geldiğinde. |
| `disconnect` | `code`, `reason` | Gateway bağlantısı koptuğunda. Kapanma kodu kalıcı hataysa (örn. 4004) yeniden bağlanılmaz. |
| `error` | `error` | Gateway hatası. Dinleyici yoksa hata sessizce yutulur, süreç düşmez. |

Diğer gateway olayları küçük harfli adla yayılır: `GUILD_CREATE` → `guild_create`.

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

## Micup'a özgü bilgiler

| Ne | Değer |
|---|---|
| Keşif | `https://micup.gg/.well-known/fluxer` |
| REST | `https://micup.gg/api/v1` |
| Gateway | `wss://micup.gg/gateway?v=1&encoding=json` |
| Yetkilendirme | `Authorization: Bot <token>` |

Bu değerler canlı uç noktalardan doğrulandı (keşif, REST yetki yanıtı, gateway Hello ve Identify yanıtı).

## Test

```bash
npm install
npm test
```

## Bilinen sınırlar

- Gerçek bir bot token'ı ile `READY` ve mesaj akışı uçtan uca henüz doğrulanmadı.
- Intent bit değerleri Discord ile aynı varsayıldı.
- Resume (kopan oturumu sürdürme) yok; her yeniden bağlantıda kimlik doğrulaması yapılır.
- Slash komutları, bileşenler (buton/menü/modal) ve ses desteği yok.
- `micup.gg/docs` Cloudflare arkasında olduğu için resmi dokümanla karşılaştırılamadı.

## Lisans

MIT
