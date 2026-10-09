import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Events, Message, MicupError } from '../micup.js';

test('varsayılan origin ve boş ignoredEvents', () => {
    const c = new Client();
    assert.equal(c.origin, 'https://micup.gg');
    assert.deepEqual(c.ignoredEvents, []);
});

test('origin sondaki eğik çizgiyi temizler', () => {
    assert.equal(new Client({ origin: 'https://ornek.test///' }).origin, 'https://ornek.test');
});

test('MicupError alanları', () => {
    const err = new MicupError(401, { code: 'UNAUTHORIZED', message: 'Unauthorized.' });
    assert.equal(err.status, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.match(err.message, /401/);
});

test('Message isBot ve reply gövdesi', async () => {
    const sent = [];
    const fakeClient = { send: async (channelId, body) => sent.push({ channelId, body }) };
    const msg = new Message(fakeClient, {
        id: '1',
        channel_id: '99',
        guild_id: '7',
        content: '!ping',
        author: { id: '2', username: 'x', bot: false },
    });
    assert.equal(msg.isBot, false);
    await msg.reply('pong');
    assert.deepEqual(sent[0], {
        channelId: '99',
        body: {
            content: 'pong',
            message_reference: { message_id: '1', channel_id: '99', guild_id: '7' },
        },
    });
});

test('Message author yoksa güvenli', () => {
    const msg = new Message({}, { id: '1', channel_id: '2' });
    assert.equal(msg.isBot, false);
    assert.equal(msg.author, null);
    assert.equal(msg.content, '');
});

test('send metin verilince content gövdesine çevrilir', async () => {
    const c = new Client();
    const calls = [];
    c.rest = async (method, path, body) => {
        calls.push({ method, path, body });
        return { id: '5', channel_id: '9' };
    };
    const msg = await c.send('9', 'merhaba');
    assert.deepEqual(calls[0], { method: 'POST', path: '/channels/9/messages', body: { content: 'merhaba' } });
    assert.ok(msg instanceof Message);
    assert.equal(msg.id, '5');
});

test('login token olmadan hata verir', async () => {
    await assert.rejects(() => new Client().login(''), /Bot token gerekli/);
});

test('olay adları ve hata olayı dinleyicisiz çökertmez', () => {
    assert.equal(Events.Ready, 'ready');
    assert.equal(Events.MessageCreate, 'messageCreate');
    const c = new Client();
    // Dinleyici yokken 'error' emit edilmez; süreç düşmemeli.
    assert.doesNotThrow(() => c.emit('noop'));
    assert.equal(c.isReady(), false);
});
