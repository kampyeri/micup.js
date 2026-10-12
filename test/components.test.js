import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Container, SelectMenu, Paginator, ComponentError, Message } from '../micup.js';
import { emojiKey } from '../components.js';

// Ağ yerine REST çağrılarını kaydeden istemci.
function fakeClient() {
    const c = new Client({ telemetry: false });
    c.user = { id: 'BOT' };
    c.calls = [];
    let n = 0;
    c.rest = async (method, path, body) => {
        c.calls.push([method, path, body]);
        if (method === 'POST' && /\/messages$/.test(path)) return { id: `M${++n}`, channel_id: path.split('/')[2], guild_id: 'G', content: body.content ?? '' };
        return {};
    };
    return c;
}
const tick = () => new Promise(r => setImmediate(r));
const react = (c, messageId, emoji, userId = 'U1') => c.components.handleReaction({ message_id: messageId, channel_id: 'C', guild_id: 'G', user_id: userId, emoji: { name: emoji, id: null }, member: { user: { id: userId, username: 'ali' } } });

test('Container bölümleri sırayla tek embed olur; buton açıklaması altta', () => {
    const msg = new Container()
        .title('Oy Paneli').color('#5865F2').text('Merhaba').separator()
        .section({ title: 'Kurallar', text: '12 saatte bir oy', thumbnail: 'https://x/t.png' })
        .links([{ label: 'micup.me', url: 'https://micup.me' }])
        .button({ emoji: '❤️', label: 'Oy ver' }).button({ emoji: '📊', label: 'Sıralama' })
        .footer('DCSV').toMessage();
    const e = msg.embeds[0];
    assert.equal(e.title, 'Oy Paneli');
    assert.equal(e.color, 0x5865F2);
    assert.equal(e.thumbnail.url, 'https://x/t.png');
    assert.equal(e.description, 'Merhaba\n\n────────────────────\n\n**Kurallar**\n12 saatte bir oy\n\n[micup.me](https://micup.me)\n\n❤️ Oy ver · 📊 Sıralama');
    assert.equal(e.footer.text, 'DCSV');
});

test('sınırlar baştan kontrol edilir', () => {
    assert.throws(() => new Container().title('x'.repeat(257)), ComponentError);
    assert.throws(() => new Container().text('x'.repeat(4097)).toMessage(), /4096/);
    assert.throws(() => new Container().button({ label: 'emoji yok' }), /emoji/);
    assert.throws(() => new Container().button({ emoji: '❤️' }).button({ emoji: '❤' }).toMessage(), /iki kez/, 'U+FE0F farkı aynı emoji sayılır');
    const many = new Container();
    for (let i = 0; i < 21; i++) many.button({ emoji: String.fromCodePoint(0x1F600 + i) });
    assert.throws(() => many.toMessage(), /20/);
    assert.throws(() => new SelectMenu({ options: Array.from({ length: 11 }, (_, i) => ({ label: `s${i}` })) }), /10/);
});

test('gönderilince tepkiler sırayla eklenir; tıklanınca onClick çalışır ve kullanıcının tepkisi geri alınır', async () => {
    const c = fakeClient();
    const clicks = [];
    const sent = await c.send('C', new Container().title('Panel').button({ emoji: '❤️', label: 'Oy', onClick: i => clicks.push([i.userId, i.guildId, i.messageId]) }));
    assert.ok(sent instanceof Message);
    assert.deepEqual(c.calls.filter(x => x[0] === 'PUT').map(x => x[1]), [`/channels/C/messages/${sent.id}/reactions/${encodeURIComponent('❤️')}/@me`]);
    await react(c, sent.id, '❤');
    assert.deepEqual(clicks, [['U1', 'G', sent.id]]);
    assert.ok(c.calls.some(x => x[0] === 'DELETE' && x[1].endsWith(`/reactions/${encodeURIComponent('❤')}/U1`)));
});

test('botun kendi tepkisi, bilinmeyen emoji ve kayıtsız mesaj yok sayılır', async () => {
    const c = fakeClient();
    let n = 0;
    const sent = await c.send('C', new Container().button({ emoji: '✅', onClick: () => n++ }));
    await react(c, sent.id, '✅', 'BOT');
    await react(c, sent.id, '🙂');
    await react(c, 'BASKA', '✅');
    assert.equal(n, 0);
});

test('only, bekleme süresi, once ve filtre', async () => {
    const c = fakeClient();
    let a = 0;
    let b = 0;
    const sent = await c.send('C', new Container()
        .only('U1').cooldown(60_000)
        .button({ emoji: 'A', onClick: () => a++ })
        .button({ emoji: 'B', once: true, onClick: () => b++ }));
    await react(c, sent.id, 'A', 'U2');
    assert.equal(a, 0, 'yalnızca U1');
    await react(c, sent.id, 'A');
    await react(c, sent.id, 'A');
    assert.equal(a, 1, 'bekleme süresi');

    const c2 = fakeClient();
    const s2 = await c2.send('C', new Container().cooldown(0).button({ emoji: 'B', once: true, onClick: () => b++ }).button({ emoji: 'F', filter: i => i.userId === 'VIP', onClick: () => a++ }));
    await react(c2, s2.id, 'B');
    await react(c2, s2.id, 'B');
    assert.equal(b, 1, 'once: bir kez');
    await react(c2, s2.id, 'F');
    assert.equal(a, 1, 'filtre geçmedi');
});

test('seçim menüsü: numaralı satırlar ve 1️⃣ … tepkileriyle seçim', async () => {
    const c = fakeClient();
    const picked = [];
    const menu = new SelectMenu({ placeholder: 'Kategori seç', onSelect: (i, o) => picked.push([i.value, o.label]) })
        .option({ label: 'Oyun', value: 'game', emoji: '🎮' })
        .option({ label: 'Müzik', value: 'music', description: 'Şarkılar' });
    const box = new Container().title('Menü').select(menu);
    assert.match(box.toMessage().embeds[0].description, /\*\*Kategori seç\*\*\n1️⃣ 🎮 \*\*Oyun\*\*\n2️⃣ \*\*Müzik\*\* — Şarkılar/);
    const sent = await c.send('C', box);
    assert.equal(c.calls.filter(x => x[0] === 'PUT').length, 2);
    await react(c, sent.id, '2️⃣');
    assert.deepEqual(picked, [['music', 'Müzik']]);
});

test('sayfalama: ◀️ ▶️ ile sayfa değişir, alt bilgi "Sayfa x/y" olur, kendi alt bilgisi korunur', async () => {
    const c = fakeClient();
    const pages = [1, 2, 3].map(n => new Container().title(`Sayfa ${n}`).footer('DCSV'));
    const p = new Paginator(pages);
    const sent = await c.send('C', p);
    assert.equal(c.calls[0][2].embeds[0].footer.text, 'Sayfa 1/3 · DCSV');
    assert.equal(c.calls.filter(x => x[0] === 'PUT').length, 2, '3 sayfada yalnızca ◀️ ▶️');
    await react(c, sent.id, '▶️');
    const patch = c.calls.filter(x => x[0] === 'PATCH').at(-1);
    assert.equal(patch[2].embeds[0].title, 'Sayfa 2');
    assert.equal(patch[2].embeds[0].footer.text, 'Sayfa 2/3 · DCSV');
    await new Promise(r => setTimeout(r, 1));
    p.go(-1);
    assert.equal(p.index, 2, 'başa sarar');
    assert.equal(new Paginator(i => new Container().title(`#${i}`), { count: 5 }).controls().length, 4, '3+ sayfada ⏮️ ⏭️ de var');
    assert.throws(() => new Paginator([]), ComponentError);
});

test('update yeni butonlarla: eksik tepki eklenir, artık olan bot tepkisi kaldırılır', async () => {
    const c = fakeClient();
    let done = false;
    const sent = await c.send('C', new Container().button({ emoji: 'A', onClick: async i => {
        await i.update(new Container().title('Yeni').button({ emoji: 'B', onClick: () => { done = true; } }));
    } }));
    await react(c, sent.id, 'A');
    assert.ok(c.calls.some(x => x[0] === 'DELETE' && x[1].endsWith('/reactions/A/@me')));
    assert.ok(c.calls.some(x => x[0] === 'PUT' && x[1].endsWith('/reactions/B/@me')));
    await new Promise(r => setTimeout(r, 1100));
    await react(c, sent.id, 'B');
    assert.equal(done, true);
});

test('süre dolunca butonlar bırakılır ve onEnd çağrılır; süresiz panel kalır', async () => {
    const c = fakeClient();
    const ended = [];
    let n = 0;
    const sent = await c.send('C', new Container().timeout(20).onEnd(e => ended.push(e.reason)).button({ emoji: 'A', onClick: () => n++ }));
    await new Promise(r => setTimeout(r, 40));
    await react(c, sent.id, 'A');
    assert.equal(n, 0);
    assert.deepEqual(ended, ['timeout']);
    const kalici = await c.send('C', new Container().timeout(0).button({ emoji: 'A', onClick: () => n++ }));
    assert.equal(c.components.active.get(kalici.id).timer, null);
});

test('reply ve gateway olayları: MESSAGE_REACTION_ADD yönlendirilir, MESSAGE_DELETE kaydı bırakır', async () => {
    const c = fakeClient();
    let n = 0;
    const msg = new Message(c, { id: 'ORIG', channel_id: 'C', guild_id: 'G' });
    const sent = await msg.reply(new Container().title('Yanıt').button({ emoji: 'A', onClick: () => n++ }));
    assert.deepEqual(c.calls[0][2].message_reference, { message_id: 'ORIG', channel_id: 'C', guild_id: 'G' });
    await c.components.handleReaction({ message_id: sent.id, channel_id: 'C', user_id: 'U1', emoji: { name: 'A' } });
    assert.equal(n, 1);
    c.components.handleDelete({ id: sent.id });
    assert.equal(c.components.active.has(sent.id), false);
    await tick();
});

test('emoji anahtarı: varyasyon seçici ve özel emoji', () => {
    assert.equal(emojiKey('❤️'), emojiKey('❤'));
    assert.equal(emojiKey('<:dcsv:123>'), '123');
    assert.equal(emojiKey({ name: 'dcsv', id: '123' }), '123');
});
