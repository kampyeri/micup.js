import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Client, Events } from '../micup.js';

// Kalp atışına onay vermeyen (zombi) ya da anında kalp atışı isteyen sahte gateway.
async function fakeMicup({ ack }) {
    const beats = [];
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/.well-known/fluxer') return res.end(JSON.stringify({ endpoints: { api_public: `${origin}/api`, gateway: `${origin.replace(/^http/, 'ws')}/gateway` } }));
        if (req.url === '/api/v1/users/@me') return res.end(JSON.stringify({ id: 'bot1', username: 'test', bot: true }));
        res.statusCode = 404;
        res.end('{}');
    });
    const wss = new WebSocketServer({ server, path: '/gateway' });
    wss.on('connection', ws => {
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 40 } }));
        ws.on('message', raw => {
            const p = JSON.parse(raw.toString());
            if (p.op === 2) {
                ws.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: { id: 'bot1', username: 'test' } } }));
                // Sunucu anında kalp atışı ister (op 1).
                ws.send(JSON.stringify({ op: 1, d: null }));
            }
            if (p.op === 1) {
                beats.push(Date.now());
                if (ack) ws.send(JSON.stringify({ op: 11 }));
            }
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, beats, close: () => { wss.close(); server.close(); } };
}

test('kalp atışına onay gelmezse bağlantı ölü sayılır ve kapatılır (yeniden bağlanma başlar)', async () => {
    const m = await fakeMicup({ ack: false });
    const client = new Client({ origin: m.origin });
    const closed = new Promise(resolve => client.once(Events.Disconnect, code => resolve(code)));
    await client.login('1.secret');
    const code = await Promise.race([closed, new Promise(r => setTimeout(() => r('timeout'), 2000))]);
    client.destroy();
    m.close();
    assert.equal(code, 1006, 'zombi bağlantı sonlandırıldı');
});

test('onay geldikçe bağlantı açık kalır; sunucu op 1 isteyince hemen kalp atışı gönderilir', async () => {
    const m = await fakeMicup({ ack: true });
    const client = new Client({ origin: m.origin });
    let disconnected = false;
    client.on(Events.Disconnect, () => { disconnected = true; });
    await client.login('1.secret');
    await new Promise(r => setTimeout(r, 300));
    client.destroy();
    m.close();
    assert.equal(disconnected, false);
    assert.ok(m.beats.length >= 3, `kalp atışları sürdü (${m.beats.length})`);
});
