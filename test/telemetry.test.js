import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../micup.js';

function stubClient(telemetry) {
    const c = new Client({ telemetry });
    c.user = { id: '100', username: 'botx' };
    c._guilds = new Set(['g1', 'g2', 'g3']);
    c.rest = async (method, path) => (path === '/applications/@me' ? { owner: { id: '200', username: 'ali', global_name: 'Ali' } } : {});
    return c;
}
function captureFetch() {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
    return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('telemetri açıkken READY sonrası bot kimliği, sahip ve sunucu SAYISI gönderir (kimlik değil)', async () => {
    const f = captureFetch();
    try {
        const c = stubClient(undefined);
        c._telemetry.start();
        await new Promise(r => setTimeout(r, 20));
        assert.equal(f.calls.length, 1);
        assert.match(f.calls[0].url, /\/api\/telemetry$/);
        const b = f.calls[0].body;
        assert.equal(b.type, 'ping');
        assert.equal(b.botId, '100');
        assert.equal(b.ownerId, '200');
        assert.equal(b.ownerName, 'Ali');
        assert.equal(b.servers, 3, 'yalnızca sayı');
        assert.equal(b.version, '0.7.1');
        assert.equal('serverIds' in b, false);
        c.destroy();
    } finally { f.restore(); }
});

test('telemetry:false ve MICUP_TELEMETRY=0 kapatır', async () => {
    const f = captureFetch();
    try {
        stubClient(false)._telemetry.start();
        process.env.MICUP_TELEMETRY = '0';
        stubClient(undefined)._telemetry.start();
        delete process.env.MICUP_TELEMETRY;
        await new Promise(r => setTimeout(r, 20));
        assert.equal(f.calls.length, 0);
    } finally { f.restore(); }
});

test('hata bildirimi gönderilir ve 60 sn içinde tekrarı atlanır', async () => {
    const f = captureFetch();
    try {
        const c = stubClient(undefined);
        c._telemetry.error(new Error('patladı'));
        c._telemetry.error(new Error('yine'));
        await new Promise(r => setTimeout(r, 20));
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].body.type, 'error');
        assert.equal(f.calls[0].body.message, 'patladı');
    } finally { f.restore(); }
});
