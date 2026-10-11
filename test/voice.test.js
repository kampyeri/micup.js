import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Client, VoiceError, Events } from '../micup.js';
import { VoiceConnectionStatus } from '../voice.js';

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

// LiveKit yerine geçen sahte modül: bağlantıları ve gönderilen ses karelerini kaydeder.
function fakeLiveKit() {
    const lk = { rooms: [], frames: [] };
    lk.RoomEvent = { Disconnected: 'disconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected', ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected' };
    lk.TrackSource = { SOURCE_MICROPHONE: 2 };
    lk.TrackPublishOptions = class { constructor(o) { Object.assign(this, o); } };
    lk.AudioFrame = class { constructor(data, rate, ch, n) { Object.assign(this, { data, rate, ch, n }); } };
    lk.AudioSource = class {
        constructor(rate, ch) { this.rate = rate; this.ch = ch; this.closed = false; }
        async captureFrame(f) { lk.frames.push(f); await new Promise(r => setImmediate(r)); }
        async waitForPlayout() {}
        clearQueue() {}
        async close() { this.closed = true; }
    };
    lk.LocalAudioTrack = { createAudioTrack: (name, source) => ({ name, source }) };
    lk.Room = class extends EventEmitter {
        constructor() { super(); this.published = []; this.remoteParticipants = new Map(); lk.rooms.push(this); }
        async connect(url, token, opts) {
            if (lk.failConnect) throw new Error('bağlantı reddedildi');
            Object.assign(this, { url, token, opts });
            this.localParticipant = { publishTrack: async (track, options) => { this.published.push({ track, options }); return { sid: 'TR_1' }; } };
        }
        async disconnect() { this.left = true; }
    };
    return lk;
}

const grant = { guild_id: 'g1', channel_id: 'ch1', connection_id: 'conn-1', endpoint: 'wss://ses-1.micup.test', token: 'vt' };

async function connected(c, lk, options) {
    c.voice.loadLiveKit = async () => lk;
    const p = c.voice.connect('g1', 'ch1', options);
    await new Promise(r => setImmediate(r));
    c.voice.handleServerUpdate(grant);
    return p;
}

test('join gateway op 4 gönderir ve Micup ses yetkisi gelince çözülür (durum beklemeden)', async () => {
    const c = fakeReadyClient();
    const p = c.voice.join('g1', 'ch1', { selfMute: true });
    assert.deepEqual(c.sent[0], {
        op: 4,
        d: { guild_id: 'g1', channel_id: 'ch1', self_mute: true, self_deaf: false, self_video: false, self_stream: false },
    });
    c.voice.handleServerUpdate(grant);
    assert.deepEqual(await p, { guildId: 'g1', channelId: 'ch1', connectionId: 'conn-1', endpoint: 'wss://ses-1.micup.test', token: 'vt' });
});

test('başka guild için gelen yetki katılımı tamamlamaz', async () => {
    const c = fakeReadyClient();
    let resolved = false;
    c.voice.join('g1', 'ch1').then(() => { resolved = true; }, () => {});
    c.voice.handleServerUpdate({ ...grant, guild_id: 'g2' });
    await new Promise(r => setImmediate(r));
    assert.equal(resolved, false);
    c.voice.leave('g1');
});

test('getStates ses durumlarını takip eder ve kullanıcı çıkınca siler', () => {
    const c = fakeReadyClient();
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'u1' });
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: 'ch1', user_id: 'u2' });
    assert.equal(c.voice.getStates('g1').length, 2);
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: null, user_id: 'u1' });
    assert.deepEqual(c.voice.getStates('g1').map(s => s.user_id), ['u2']);
});

test('join bağlı değilken VoiceError verir', () => {
    const c = new Client();
    assert.throws(() => c.voice.join('g1', 'ch1'), VoiceError);
});

test('leave op 4 ile channel_id null ve bilinen connection_id gönderir', () => {
    const c = fakeReadyClient();
    c.voice.leave('g1');
    assert.deepEqual(c.sent[0], { op: 4, d: { guild_id: 'g1', channel_id: null } });
    c.voice.handleServerUpdate(grant);
    c.voice.leave('g1');
    assert.deepEqual(c.sent[1], { op: 4, d: { guild_id: 'g1', channel_id: null, connection_id: 'conn-1' } });
});

test('voice olay adları sabit', () => {
    assert.equal(Events.VoiceStateUpdate, 'voiceStateUpdate');
    assert.equal(Events.VoiceServerUpdate, 'voiceServerUpdate');
});

test('connect: yetkiyle LiveKit odasına bağlanır ve mikrofon izi yayınlar', async () => {
    const c = fakeReadyClient();
    const lk = fakeLiveKit();
    const conn = await connected(c, lk);
    const room = lk.rooms[0];
    assert.equal(room.url, 'wss://ses-1.micup.test');
    assert.equal(room.token, 'vt');
    assert.equal(room.published.length, 1);
    assert.equal(room.published[0].options.source, 2);
    assert.equal(conn.status, VoiceConnectionStatus.Ready);
    assert.equal(c.voice.getConnection('g1'), conn);
    assert.equal(await c.voice.connect('g1', 'ch1'), conn, 'aynı kanal için aynı bağlantı');
});

test('connect: adres şemasızsa wss:// eklenir; bağlantı hatası VoiceError olur ve kanaldan çıkılır', async () => {
    const c = fakeReadyClient();
    const lk = fakeLiveKit();
    c.voice.loadLiveKit = async () => lk;
    let p = c.voice.connect('g1', 'ch1');
    await new Promise(r => setImmediate(r));
    c.voice.handleServerUpdate({ ...grant, endpoint: 'ses-2.micup.test' });
    await (await p).disconnect();
    assert.equal(lk.rooms[0].url, 'wss://ses-2.micup.test');

    lk.failConnect = true;
    p = c.voice.connect('g1', 'ch1');
    await new Promise(r => setImmediate(r));
    c.voice.handleServerUpdate(grant);
    await assert.rejects(p, VoiceError);
    assert.equal(c.voice.getConnection('g1'), null);
    assert.equal(c.sent.at(-1).d.channel_id, null);
});

test('connect: @livekit/rtc-node yoksa anlaşılır hata', async () => {
    const c = fakeReadyClient();
    c.voice.loadLiveKit = async () => { throw new Error('Cannot find package'); };
    await assert.rejects(c.voice.connect('g1', 'ch1'), /@livekit\/rtc-node/);
});

test('play (raw PCM): 20 ms karelere böler, ses seviyesi uygular, finish yayar', async () => {
    const c = fakeReadyClient();
    const lk = fakeLiveKit();
    const conn = await connected(c, lk);
    const pcm = Buffer.alloc(3840 * 2 + 100); // iki tam kare + artık
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(1000, i * 2);
    const events = [];
    conn.on('start', () => events.push('start'));
    conn.on('finish', i => events.push(`finish:${i.stopped}`));
    await conn.play(Readable.from([pcm.subarray(0, 1001), pcm.subarray(1001)]), { raw: true, volume: 0.5 });
    assert.equal(lk.frames.length, 3, 'iki kare + doldurulmuş son kare');
    assert.equal(lk.frames[0].n, 960);
    assert.equal(lk.frames[0].rate, 48000);
    assert.equal(lk.frames[0].data[0], 500);
    assert.deepEqual(events, ['start', 'finish:false']);
    assert.equal(conn.playing, false);
});

test('stop çalanı keser; disconnect kanaldan çıkar ve odayı kapatır', async () => {
    const c = fakeReadyClient();
    const lk = fakeLiveKit();
    const conn = await connected(c, lk);
    const endless = new Readable({ read() { this.push(Buffer.alloc(3840)); } });
    let finished;
    conn.on('finish', i => { finished = i; });
    const p = conn.play(endless, { raw: true });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(conn.playing, true);
    assert.equal(conn.pause(), true);
    assert.equal(conn.paused, true);
    assert.equal(conn.resume(), true);
    assert.equal(conn.stop(), true);
    await p;
    assert.deepEqual(finished, { stopped: true });
    assert.throws(() => conn.setVolume(3), VoiceError);
    await conn.disconnect();
    assert.equal(lk.rooms[0].left, true);
    assert.deepEqual(c.sent.at(-1), { op: 4, d: { guild_id: 'g1', channel_id: null, connection_id: 'conn-1' } });
    assert.equal(conn.status, VoiceConnectionStatus.Disconnected);
    assert.equal(c.voice.getConnection('g1'), null);
    await assert.rejects(conn.play(Readable.from([]), { raw: true }), VoiceError);
});

test('yeni yetki gelince yeniden bağlanır; bot kanaldan atılınca bağlantı kapanır', async () => {
    const c = fakeReadyClient();
    const lk = fakeLiveKit();
    const conn = await connected(c, lk);
    c.voice.handleServerUpdate({ ...grant, channel_id: 'ch2', connection_id: 'conn-2', endpoint: 'wss://ses-3.micup.test', token: 'vt2' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(lk.rooms.length, 2);
    assert.equal(lk.rooms[0].left, true);
    assert.equal(lk.rooms[1].url, 'wss://ses-3.micup.test');
    assert.equal(conn.channelId, 'ch2');
    assert.equal(conn.status, VoiceConnectionStatus.Ready);

    let gone = false;
    conn.on('disconnect', () => { gone = true; });
    const sentBefore = c.sent.length;
    c.voice.handleStateUpdate({ guild_id: 'g1', channel_id: null, user_id: 'bot1', connection_id: 'conn-2' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(gone, true);
    assert.equal(c.sent.length, sentBefore, 'atılınca tekrar çıkış isteği gönderilmez');
});

test('GUILD_CREATE içindeki ses durumları getStates ile görünür', () => {
    const c = fakeReadyClient();
    c.voice.loadGuildStates('g9', [{ user_id: 'u1', channel_id: 'v1' }, { user_id: 'u2', channel_id: null }]);
    assert.deepEqual(c.voice.getStates('g9'), [{ user_id: 'u1', channel_id: 'v1', guild_id: 'g9' }]);
});
