import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Client, Events } from '../micup.js';

const TOKEN = '1.secret';
const BOT = { id: 'bot1', username: 'testbot', bot: true };

// Yerel sahte Micup: keşif, REST ve gateway. Gerçek sunucuya bağımlılığı kaldırır.
let server;
let wss;
let origin;
const received = { identify: null, posted: [], voice: [], presence: [] };

function startServer() {
    return new Promise(resolve => {
        server = http.createServer((req, res) => {
            const base = origin;
            if (req.url === '/.well-known/fluxer') {
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({
                    endpoints: { api_public: `${base}/api`, gateway: `${base.replace(/^http/, 'ws')}/gateway` },
                }));
            }
            if (req.url === '/api/v1/users/@me') {
                if (req.headers.authorization !== `Bot ${TOKEN}`) {
                    res.statusCode = 401;
                    return res.end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Unauthorized.' }));
                }
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify(BOT));
            }
            const m = req.url.match(/^\/api\/v1\/channels\/(\w+)\/messages$/);
            if (m && req.method === 'POST') {
                let body = '';
                req.on('data', c => (body += c));
                req.on('end', () => {
                    const payload = JSON.parse(body);
                    received.posted.push({ channelId: m[1], payload });
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ id: 'new1', channel_id: m[1], content: payload.content, author: BOT }));
                });
                return;
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found.' }));
        });

        wss = new WebSocketServer({ server, path: '/gateway' });
        wss.on('connection', ws => {
            const send = (op, extra = {}) => ws.send(JSON.stringify({ op, ...extra }));
            send(10, { d: { heartbeat_interval: 60000 } });
            ws.on('message', raw => {
                const p = JSON.parse(raw.toString());
                if (p.op === 2) {
                    received.identify = p.d;
                    if (p.d.token !== TOKEN) return ws.close(4004, 'Invalid token');
                    send(0, { t: 'READY', s: 1, d: { user: BOT } });
                    // Kanala gelen bir mesaj.
                    send(0, {
                        t: 'MESSAGE_CREATE',
                        s: 2,
                        d: { id: 'm1', channel_id: 'ch1', guild_id: 'g1', content: '!ping', author: { id: 'u1', username: 'ali', bot: false } },
                    });
                }
                if (p.op === 3) received.presence.push(p.d);
                if (p.op === 4) {
                    received.voice.push(p.d);
                    if (p.d.channel_id) {
                        // Gerçek Micup gibi: önce ses yetkisi gelir; botun ses durumu medya bağlantısından sonra yayılır.
                        send(0, { t: 'VOICE_SERVER_UPDATE', s: 3, d: { guild_id: 'g1', channel_id: p.d.channel_id, connection_id: 'conn1', endpoint: 'wss://voice.test', token: 'vtoken' } });
                        send(0, { t: 'VOICE_STATE_UPDATE', s: 4, d: { guild_id: 'g1', channel_id: p.d.channel_id, user_id: BOT.id, connection_id: 'conn1' } });
                    } else {
                        send(0, { t: 'VOICE_STATE_UPDATE', s: 5, d: { guild_id: 'g1', channel_id: null, user_id: BOT.id, connection_id: p.d.connection_id } });
                    }
                }
            });
        });

        server.listen(0, '127.0.0.1', () => {
            origin = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

before(startServer);
after(() => new Promise(resolve => {
    wss.close();
    server.close(resolve);
}));

function waitFor(emitter, event) {
    return new Promise(resolve => emitter.once(event, resolve));
}

test('giriş: REST doğrulama, gateway Identify ve ready olayı', async () => {
    const client = new Client({ origin });
    const ready = waitFor(client, Events.Ready);
    await client.login(TOKEN);
    const c = await ready;
    assert.equal(c.user.username, 'testbot');
    assert.equal(client.isReady(), true);
    assert.equal(received.identify.token, TOKEN);
    assert.equal('intents' in received.identify, false, 'Micup Identify içinde intents beklemez');
    assert.equal('ignored_events' in received.identify, false, 'ignoredEvents verilmezse alan gönderilmez');
    client.destroy();
});

test('yanlış token REST aşamasında MicupError verir', async () => {
    const client = new Client({ origin });
    await assert.rejects(() => client.login('bad.token'), err => err.status === 401);
});

test('mesaj alınır ve reply doğru kanala gider', async () => {
    const client = new Client({ origin });
    const msgP = waitFor(client, Events.MessageCreate);
    await client.login(TOKEN);
    const message = await msgP;
    assert.equal(message.content, '!ping');
    assert.equal(message.isBot, false);

    const reply = await message.reply('pong');
    assert.equal(reply.content, 'pong');
    const last = received.posted.at(-1);
    assert.equal(last.channelId, 'ch1');
    assert.equal(last.payload.message_reference.message_id, 'm1');
    assert.equal(last.payload.message_reference.guild_id, 'g1');
    client.destroy();
});

test('ses kanalına katılma ve ayrılma uçtan uca çalışır', async () => {
    const client = new Client({ origin });
    await client.login(TOKEN);
    await waitFor(client, Events.Ready);

    const info = await client.voice.join('g1', 'vc1', { selfMute: true });
    assert.deepEqual(info, {
        guildId: 'g1',
        channelId: 'vc1',
        connectionId: 'conn1',
        endpoint: 'wss://voice.test',
        token: 'vtoken',
    });
    assert.deepEqual(received.voice.at(-1), { guild_id: 'g1', channel_id: 'vc1', self_mute: true, self_deaf: false, self_video: false, self_stream: false });

    await new Promise(r => setTimeout(r, 50));
    client.voice.leave('g1');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(received.voice.at(-1).connection_id, 'conn1', 'çıkışta bağlantı kimliği gönderilir');
    assert.equal(client.voice.getStates('g1').length, 0);
    client.destroy();
});

test('durum: Identify açılış durumunu taşır, setPresence gateway e opcode 3 gönderir', async () => {
    const client = new Client({ origin, presence: { customStatus: 'Açılış durumu' } });
    const ready = waitFor(client, Events.Ready);
    await client.login(TOKEN);
    await ready;
    assert.equal(received.identify.presence.custom_status.text, 'Açılış durumu');

    client.setPresence({ customStatus: 'micup.gg/dcsv' });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(received.presence.at(-1).custom_status.text, 'micup.gg/dcsv');
    assert.equal(received.presence.at(-1).status, 'online');
    client.destroy();
});
