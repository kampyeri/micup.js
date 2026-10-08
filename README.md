# micup.js

Micup (Fluxer tabanlı) için Node.js bot kütüphanesi. Sıfır bağımlılık hedefi var; tek bağımlılık gateway WebSocket için `ws`.

## Kurulum

```bash
npm install
```

## Hızlı başlangıç

```js
import { Client, Intents } from 'micup.js';

const client = new Client({
    intents: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent,
});

client.on('ready', c => console.log(`Giriş: ${c.user.username}`));

client.on('messageCreate', async message => {
    if (message.isBot) return;
    if (message.content === '!ping') await message.reply('pong');
});

await client.login(process.env.MICUP_BOT_TOKEN);
```

## API

- `new Client({ intents })`: intents verilmezse Guilds + GuildMessages + MessageContent kullanılır.
- `client.login(token)`: token'ı REST'te doğrular, sonra gateway'e bağlanır.
- `client.send(channelId, content | body)`: kanala mesaj gönderir, `Message` döner.
- `client.rest(method, path, body)`: ham REST çağrısı. Yol `/users/@me` gibi, `/api/v1` öneki otomatik eklenir.
- `client.destroy()`: bağlantıyı kapatır, yeniden bağlanmayı durdurur.
- `message.reply(content)`, `message.isBot`, `message.content`, `message.author`.

Olaylar: `ready`, `messageCreate`, `disconnect`, `error`. Diğer gateway olayları `client.on('<event_adı_küçük_harf>')` ile dinlenebilir.

## Micup'a özgü bilgiler

Bu değerler canlı uç noktalardan doğrulandı:

| Ne | Değer |
|---|---|
| Keşif | `https://micup.gg/.well-known/fluxer` |
| REST | `https://micup.gg/api/v1` |
| Gateway | `wss://micup.gg/gateway?v=1&encoding=json` (sürüm 10 reddediliyor: 4012) |
| Gateway ilk paket | `op 10` Hello, `heartbeat_interval` 41250 ms |
| Yetkilendirme | `Authorization: Bot <token>` |

## Doğrulanmamış noktalar

- Intent bit değerleri Discord ile aynı varsayıldı. Gerçek bir token ile test edilmeli.
- `Identify` yanıtı ve `READY` içeriği gerçek token ile doğrulanmalı.
- Resume (kopan oturumu sürdürme) desteklenmiyor; her yeniden bağlantıda yeni kimlik doğrulaması yapılır.
- micup.gg/docs Cloudflare arkasında olduğu için resmi dokümanla karşılaştırılamadı.
