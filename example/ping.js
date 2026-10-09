import 'dotenv/config';
import { Client } from '../micup.js';

const token = process.env.MICUP_BOT_TOKEN;
if (!token) {
    console.error('MICUP_BOT_TOKEN tanımlı değil. Örnek: .env dosyasına ekle.');
    process.exit(1);
}

const client = new Client();

client.on('ready', c => {
    console.log(`Giriş yapıldı: ${c.user.username}`);
});

client.on('messageCreate', async message => {
    if (message.isBot) return;
    if (message.content === '!ping') {
        await message.reply('pong');
    }
});

client.on('disconnect', (code, reason) => {
    console.warn(`Bağlantı kapandı (${code}) ${reason}`);
});

client.on('error', err => console.error('Gateway hatası:', err));

client.login(token).catch(err => {
    console.error('Micup girişi başarısız:', err.message);
    process.exit(1);
});
