import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Client, Container } from '../micup.js';

// Sahte Micup: gönderilen bileşenli mesaja botun tepki eklemesini bekler, sonra gateway'den
// bir kullanıcının tepkisini (MESSAGE_REACTION_ADD) iter. Buton gerçek gateway yolundan çalışmalı.
test('uçtan uca: Container gönderilir, tepki eklenir, gateway tepkisi butonu çalıştırır', async () => {
    const TOKEN = '1.secret';
    const BOT = { id: 'bot1', username: 'testbot', bot: true };
    const rest = [];
    let socket = null;
    let seq = 1;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            rest.push([req.method, req.url]);
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/.well-known/fluxer') {
                return res.end(JSON.stringify({ endpoints: { api_public: `${origin}/api`, gateway: `${origin.replace(/^http/, 'ws')}/gateway` } }));
            }
            if (req.url === '/api/v1/users/@me') return res.end(JSON.stringify(BOT));
            if (req.method === 'POST' && req.url === '/api/v1/channels/ch1/messages') {
                return res.end(JSON.stringify({ id: 'panel1', channel_id: 'ch1', guild_id: 'g1', author: BOT, ...JSON.parse(body) }));
            }
            if (req.method === 'PUT' && req.url.endsWith('/@me')) {
                res.statusCode = 204;
                res.end();
                // Bot tepkisini ekledi: şimdi bir üye tıklar.
                socket.send(JSON.stringify({ op: 0, t: 'MESSAGE_REACTION_ADD', s: ++seq, d: { message_id: 'panel1', channel_id: 'ch1', guild_id: 'g1', user_id: 'u9', emoji: { name: '❤', id: null }, member: { user: { id: 'u9', username: 'veli' } } } }));
                return;
            }
            if (req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
            res.statusCode = 404;
            res.end('{}');
        });
    });
    const wss = new WebSocketServer({ server, path: '/gateway' });
    wss.on('connection', ws => {
        socket = ws;
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
        ws.on('message', raw => {
            const p = JSON.parse(raw.toString());
            if (p.op === 2) ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: BOT, guilds: [] } }));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const client = new Client({ origin, telemetry: false });
    const clicked = new Promise(resolve => {
        client.on('ready', () => {
            client.send('ch1', new Container().title('Oy Paneli').button({ emoji: '❤️', label: 'Oy ver', onClick: i => resolve(i) }));
        });
    });
    await client.login(TOKEN);
    const interaction = await Promise.race([clicked, new Promise((_, rej) => setTimeout(() => rej(new Error('buton çalışmadı')), 3000))]);
    assert.equal(interaction.userId, 'u9');
    assert.equal(interaction.user.username, 'veli');
    assert.equal(interaction.messageId, 'panel1');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(rest.some(([m, u]) => m === 'PUT' && u === `/api/v1/channels/ch1/messages/panel1/reactions/${encodeURIComponent('❤️')}/@me`));
    assert.ok(rest.some(([m, u]) => m === 'DELETE' && u === `/api/v1/channels/ch1/messages/panel1/reactions/${encodeURIComponent('❤')}/u9`), 'üyenin tepkisi geri alındı');

    client.destroy();
    wss.close();
    server.close();
});
