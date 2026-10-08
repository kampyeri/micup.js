import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Intents, VoiceError, Events } from '../micup.js';

// Gateway olmadan, ses katılım akışını sahte bir istemciyle test eder.
function fakeReadyClient() {
    const c = new Client();
    c.user = { id: 'bot1', username: 'testbot' };
    c.ready = true;
    c.ws = { readyState: 1 };
    c.sent = [];
    c.sendGateway = (op, d) => c.sent.push({ op, d });
    return c;
}

test('GuildVoiceStates intent varsayılan olarak açık', () => {
    assert.equal(Intents.GuildVoiceStates, 128);
    assert.ok((new Client().intents & Intents.GuildVoiceStates) !== 0);
});

test('join gateway op 4 gönderir ve durum + sunucu gelince çözülür', async () => {
    const c = fakeReadyClient();
    const p = c.voice.join('g1', 'ch1', { selfMute: true });
    assert.deepEqual(c.sent[0], {
        op: 4,
        d: { guild_id: 'g1', channel_id: 'ch1', self_mute: true, self_deaf: false },
    });

    c.voice.handleServerUpdate({ guild_id: 'g1', endpoint: 'voice.micup.test', token: 'vt' });
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'bot1', session_id: 'sess' });

    const info = await p;
    assert.deepEqual(info, {
        guildId: 'g1',
        channelId: 'ch1',
        sessionId: 'sess',
        endpoint: 'voice.micup.test',
        token: 'vt',
    });
});

test('başka kullanıcının ses durumu katılımı tamamlamaz', async () => {
    const c = fakeReadyClient();
    let resolved = false;
    c.voice.join('g1', 'ch1').then(() => { resolved = true; }, () => {});
    c.voice.handleServerUpdate({ guild_id: 'g1', endpoint: 'e', token: 't' });
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'other', session_id: 's' });
    await new Promise(r => setImmediate(r));
    assert.equal(resolved, false);
    c.voice.leave('g1');
});

test('getStates ses durumlarını takip eder ve kullanıcı çıkınca siler', () => {
    const c = fakeReadyClient();
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'u1', session_id: 's1' });
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'u2', session_id: 's2' });
    assert.equal(c.voice.getStates('g1').length, 2);
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: null, user_id: 'u1', session_id: 's1' });
    assert.deepEqual(c.voice.getStates('g1').map(s => s.user_id), ['u2']);
});

test('join bağlı değilken VoiceError verir', () => {
    const c = new Client();
    assert.throws(() => c.voice.join('g1', 'ch1'), VoiceError);
});

test('leave op 4 ile channel_id null gönderir', () => {
    const c = fakeReadyClient();
    c.voice.leave('g1');
    assert.deepEqual(c.sent[0], { op: 4, d: { guild_id: 'g1', channel_id: null } });
});

test('voice olay adları sabit', () => {
    assert.equal(Events.VoiceStateUpdate, 'voiceStateUpdate');
    assert.equal(Events.VoiceServerUpdate, 'voiceServerUpdate');
});
