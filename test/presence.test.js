import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Status, buildPresence } from '../micup.js';

test('buildPresence: metin, nesne, silme ve koruma', () => {
    assert.deepEqual(buildPresence({ customStatus: 'Sunucunu Büyüt' }), {
        status: 'online', afk: false, mobile: false, custom_status: { text: 'Sunucunu Büyüt' },
    });
    assert.deepEqual(buildPresence({ status: Status.Idle, customStatus: null }).custom_status, null);
    assert.equal('custom_status' in buildPresence({ status: Status.DoNotDisturb }), false, 'verilmezse mevcut mesaj korunur');
    assert.deepEqual(buildPresence({ customStatus: { text: 'x', emoji_name: '🔥' } }).custom_status, { text: 'x', emoji_name: '🔥' });
});

test('geçersiz durum reddedilir (Micup 4002 ile kapatırdı)', () => {
    assert.throws(() => buildPresence({ status: 'offline' }), /Geçersiz durum/);
    assert.throws(() => buildPresence({ status: 'mesgul' }), /Geçersiz durum/);
});

test('setPresence opcode 3 gönderir ve son durumu saklar', () => {
    const c = new Client();
    const sent = [];
    c.sendGateway = (op, d) => sent.push({ op, d });
    const p = c.setPresence({ status: Status.Online, customStatus: 'micup.gg/dcsv' });
    assert.deepEqual(sent, [{ op: 3, d: p }]);
    assert.equal(c.presence.custom_status.text, 'micup.gg/dcsv');
});

test('açılış durumu seçeneği saklanır', () => {
    const c = new Client({ presence: { status: Status.Idle, customStatus: 'Açılış' } });
    assert.equal(c.presence.status, 'idle');
    assert.equal(c.presence.custom_status.text, 'Açılış');
    assert.equal(new Client().presence, null);
});
