// micup.js bileşenleri (DCSV Components). Made by DCSV · https://dcsv.me
//
// Micup, mesaj bileşenlerini (buton, menü) yalnızca kendi resmi botlarına açar; bot token'ıyla gönderilen
// "components" alanı sunucuda silinir ve gateway'de etkileşim olayı yoktur. Bu modül, Components V2'ye benzer
// bir yazımı Micup'ın desteklediği parçalara çevirir:
//   Container / Section / Text / Separator / Thumbnail  -> düzenli bir embed
//   Button                                              -> tepki butonu (tıklanınca onClick, tepki geri alınır)
//   SelectMenu                                          -> numaralı tepkiler (1️⃣ … 🔟)
//   Paginator                                           -> ◀️ ▶️ ile sayfalar
// Micup ileride bileşenleri bot geliştiricilerine açarsa aynı yazım gerçek bileşenlere taşınabilir.

export class ComponentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ComponentError';
    }
}

// Micup embed sınırları (Discord ile aynı değerler).
export const LIMITS = Object.freeze({
    title: 256,
    description: 4096,
    footer: 2048,
    author: 256,
    total: 6000,
    reactions: 20,
    selectOptions: 10,
    label: 80,
});

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const SEPARATOR = '────────────────────';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const BASE_FOOTER = new WeakMap();

// Kalp gibi emojiler istemciye göre U+FE0F (variation selector) ile ya da onsuz gelir; ikisi aynı sayılır.
export function emojiKey(emoji) {
    if (!emoji) return '';
    if (typeof emoji === 'object') return emoji.id ? String(emoji.id) : String(emoji.name ?? '').replace(/️/g, '');
    const custom = String(emoji).match(/^<?a?:?[\w~]+:(\d+)>?$/);
    return custom ? custom[1] : String(emoji).replace(/️/g, '');
}

// REST yolundaki emoji: unicode olduğu gibi, özel emoji "ad:id".
function emojiPath(emoji) {
    if (typeof emoji === 'object') return encodeURIComponent(emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name);
    const custom = String(emoji).match(/^<?a?:?([\w~]+):(\d+)>?$/);
    return encodeURIComponent(custom ? `${custom[1]}:${custom[2]}` : String(emoji));
}

const emojiText = emoji => (typeof emoji === 'object' ? (emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name) : String(emoji));

function check(value, max, what) {
    if (value != null && String(value).length > max) throw new ComponentError(`${what} en fazla ${max} karakter olabilir (${String(value).length}).`);
}

function parseColor(color) {
    if (color == null) return undefined;
    if (typeof color === 'number') return color;
    const n = Number.parseInt(String(color).replace(/^#/, ''), 16);
    if (Number.isNaN(n)) throw new ComponentError(`Geçersiz renk: ${color}`);
    return n;
}

/**
 * Seçim menüsü: seçenekler numaralı satırlar olarak yazılır, 1️⃣ … 🔟 tepkileriyle seçilir.
 * onSelect(interaction, option) seçilen seçenekle çağrılır.
 */
export class SelectMenu {
    constructor({ placeholder = null, options = [], onSelect = null } = {}) {
        this.placeholder = placeholder;
        this.options = [];
        this.onSelect = onSelect;
        for (const o of options) this.option(o);
    }

    option({ label, value = label, description = null, emoji = null }) {
        if (!label) throw new ComponentError('Seçeneğin "label" alanı gerekli.');
        check(label, LIMITS.label, 'Seçenek adı');
        if (this.options.length >= LIMITS.selectOptions) throw new ComponentError(`Bir menüde en fazla ${LIMITS.selectOptions} seçenek olabilir.`);
        this.options.push({ label, value, description, emoji });
        return this;
    }

    /** @internal */
    lines() {
        return [
            ...(this.placeholder ? [`**${this.placeholder}**`] : []),
            ...this.options.map((o, i) => `${NUMBER_EMOJIS[i]} ${o.emoji ? `${emojiText(o.emoji)} ` : ''}**${o.label}**${o.description ? ` — ${o.description}` : ''}`),
        ];
    }

    /** @internal */
    controls() {
        return this.options.map((o, i) => ({
            emoji: NUMBER_EMOJIS[i],
            run: interaction => this.onSelect?.(Object.assign(interaction, { value: o.value, option: o }), o),
        }));
    }
}

/**
 * Container: Components V2 benzeri düzen. Bölümler sırayla tek bir embed'e yazılır;
 * butonlar ve menü tepki olarak eklenir. client.send(kanalId, container) ile gönderilir.
 */
export class Container {
    constructor() {
        this.parts = [];
        this.buttons = [];
        this.menu = null;
        this.embed = {};
        this.options = { timeout: DEFAULT_TIMEOUT_MS, only: null, cooldown: 1000, removeReaction: true, legend: true, onEnd: null, filter: null };
        this.content = null;
    }

    /** Embed dışında, üstte düz metin (ör. bir üyeyi etiketlemek için). */
    message(text) { this.content = text; return this; }
    title(text, url = null) { check(text, LIMITS.title, 'Başlık'); this.embed.title = text; if (url) this.embed.url = url; return this; }
    author(name, { icon = null, url = null } = {}) { check(name, LIMITS.author, 'Yazar'); this.embed.author = { name, ...(icon ? { icon_url: icon } : {}), ...(url ? { url } : {}) }; return this; }
    color(value) { this.embed.color = parseColor(value); return this; }
    /** Markdown metin bloğu. */
    text(markdown) { this.parts.push({ type: 'text', value: String(markdown) }); return this; }
    /** Başlıklı bölüm; isteğe bağlı küçük resim (embed'in sağ üstü). */
    section({ title = null, text = '', thumbnail = null } = {}) {
        this.parts.push({ type: 'section', title, text: String(text) });
        if (thumbnail) this.thumbnail(thumbnail);
        return this;
    }
    separator() { this.parts.push({ type: 'separator' }); return this; }
    /** Tıklanabilir bağlantılar satırı: [{ label, url }]. Micup'ta "link butonu" karşılığı. */
    links(items) { this.parts.push({ type: 'links', items }); return this; }
    thumbnail(url) { this.embed.thumbnail = { url }; return this; }
    image(url) { this.embed.image = { url }; return this; }
    footer(text, icon = null) { check(text, LIMITS.footer, 'Alt bilgi'); this.embed.footer = { text, ...(icon ? { icon_url: icon } : {}) }; return this; }
    timestamp(date = new Date()) { this.embed.timestamp = new Date(date).toISOString(); return this; }

    /**
     * Tepki butonu. onClick(interaction) tıklanınca çalışır.
     * { emoji, label, onClick, once, disabled, filter }
     */
    button({ emoji, label = null, onClick = null, once = false, disabled = false, filter = null }) {
        if (!emoji) throw new ComponentError('Butonun "emoji" alanı gerekli (Micup butonları tepkidir).');
        check(label, LIMITS.label, 'Buton etiketi');
        this.buttons.push({ emoji, label, onClick, once, disabled, filter });
        return this;
    }

    select(menu) {
        if (!(menu instanceof SelectMenu)) menu = new SelectMenu(menu);
        this.menu = menu;
        return this;
    }

    /** Etkileşim süresi (ms). 0 = süresiz (kalıcı paneller için). Varsayılan 15 dakika. */
    timeout(ms) { this.options.timeout = Math.max(0, Number(ms) || 0); return this; }
    /** Yalnızca bu kullanıcı(lar) tıklayabilir. */
    only(...userIds) { this.options.only = new Set(userIds.flat().map(String)); return this; }
    /** Aynı kullanıcının art arda tıklamaları arasındaki en kısa süre (ms). */
    cooldown(ms) { this.options.cooldown = Math.max(0, Number(ms) || 0); return this; }
    /** Tıklanan tepkiyi geri alma (varsayılan açık; botta Mesajları Yönet izni gerekir). */
    keepReactions() { this.options.removeReaction = false; return this; }
    /** Butonların altta "❤️ Oy ver · 📊 Sıralama" diye açıklanmasını kapatır. */
    hideLegend() { this.options.legend = false; return this; }
    /** Genel süzgeç: false dönerse tıklama yok sayılır. */
    filter(fn) { this.options.filter = fn; return this; }
    /** Süre dolunca çağrılır (ör. mesajı "süresi doldu" diye düzenlemek için). */
    onEnd(fn) { this.options.onEnd = fn; return this; }

    /** Micup mesaj gövdesi. Sınırlar burada kontrol edilir. */
    toMessage() {
        const lines = [];
        for (const p of this.parts) {
            if (p.type === 'text') lines.push(p.value);
            else if (p.type === 'section') lines.push([p.title ? `**${p.title}**` : null, p.text].filter(Boolean).join('\n'));
            else if (p.type === 'separator') lines.push(SEPARATOR);
            else if (p.type === 'links') lines.push(p.items.map(l => `[${String(l.label).replace(/[[\]]/g, '')}](${l.url})`).join(' · '));
        }
        if (this.menu) lines.push(this.menu.lines().join('\n'));
        const legend = this.options.legend ? this.buttons.filter(b => b.label && !b.disabled).map(b => `${emojiText(b.emoji)} ${b.label}`) : [];
        if (legend.length) lines.push(legend.join(' · '));
        const description = lines.join('\n\n');
        check(description, LIMITS.description, 'İçerik (açıklama)');
        const embed = { ...this.embed, ...(description ? { description } : {}) };
        const total = [embed.title, embed.description, embed.footer?.text, embed.author?.name].filter(Boolean).join('').length;
        if (total > LIMITS.total) throw new ComponentError(`Embed toplamda en fazla ${LIMITS.total} karakter olabilir (${total}).`);
        if (this.controls().length > LIMITS.reactions) throw new ComponentError(`Bir mesajda en fazla ${LIMITS.reactions} tepki butonu olabilir.`);
        return { ...(this.content ? { content: this.content } : {}), embeds: [embed] };
    }

    /** @internal Tepki karşılıkları. */
    controls() {
        const out = this.buttons.filter(b => !b.disabled).map(b => ({ emoji: b.emoji, run: b.onClick, once: b.once, filter: b.filter }));
        if (this.menu) out.push(...this.menu.controls());
        const seen = new Set();
        for (const c of out) {
            const k = emojiKey(c.emoji);
            if (seen.has(k)) throw new ComponentError(`Aynı emoji iki kez kullanılamaz: ${emojiText(c.emoji)}`);
            seen.add(k);
        }
        return out;
    }
}

/**
 * Sayfalama: sayfalar Container dizisi ya da sayfa üreten fonksiyon (page => Container) ve sayfa sayısı.
 * ◀️ ▶️ ile gezilir; 3'ten çok sayfada ⏮️ ⏭️ de eklenir. Alt bilgiye "Sayfa 2/5" yazılır.
 */
export class Paginator {
    constructor(pages, { count = null, start = 0, footer = true } = {}) {
        this.render = typeof pages === 'function' ? pages : i => pages[i];
        this.count = typeof pages === 'function' ? count : pages.length;
        if (!this.count || this.count < 1) throw new ComponentError('Sayfalama için en az bir sayfa gerekli (fonksiyonla kullanırken { count } verin).');
        this.index = Math.min(Math.max(0, start), this.count - 1);
        this.showFooter = footer;
        this.options = { timeout: DEFAULT_TIMEOUT_MS, only: null, cooldown: 600, removeReaction: true, onEnd: null, filter: null };
    }

    timeout(ms) { this.options.timeout = Math.max(0, Number(ms) || 0); return this; }
    only(...userIds) { this.options.only = new Set(userIds.flat().map(String)); return this; }
    onEnd(fn) { this.options.onEnd = fn; return this; }

    /** @internal */
    current() {
        const page = this.render(this.index);
        if (!(page instanceof Container)) throw new ComponentError('Her sayfa bir Container olmalı.');
        if (this.showFooter && this.count > 1) {
            // Sayfanın kendi alt bilgisi bir kez saklanır; sayfa tekrar gösterildiğinde üst üste eklenmez.
            if (!BASE_FOOTER.has(page)) BASE_FOOTER.set(page, page.embed.footer ?? null);
            const base = BASE_FOOTER.get(page);
            page.footer(`Sayfa ${this.index + 1}/${this.count}${base?.text ? ` · ${base.text}` : ''}`, base?.icon_url ?? null);
        }
        return page;
    }

    toMessage() {
        return this.current().toMessage();
    }

    go(index) {
        this.index = (index + this.count) % this.count;
        return this;
    }

    /** @internal */
    controls() {
        if (this.count < 2) return [];
        const turn = to => async i => { this.go(to(this.index)); await i.update(this); };
        const nav = [{ emoji: '◀️', run: turn(n => n - 1) }, { emoji: '▶️', run: turn(n => n + 1) }];
        if (this.count > 3) {
            nav.unshift({ emoji: '⏮️', run: turn(() => 0) });
            nav.push({ emoji: '⏭️', run: turn(() => this.count - 1) });
        }
        return nav;
    }
}

const isInteractive = body => Boolean(body && typeof body.toMessage === 'function' && typeof body.controls === 'function');

/** Gönderilen gövde: Container / Paginator ise Micup mesajına çevrilir. */
export function toPayload(body) {
    if (typeof body === 'string') return { content: body };
    if (body && typeof body.toMessage === 'function') return body.toMessage();
    return body;
}

/**
 * Tepki butonlarını yönetir: gönderilen bileşenli mesajları tutar, gelen tepkiyi doğru işleve yönlendirir,
 * süre dolunca bırakır. Client içinde client.components olarak bulunur.
 */
export class ComponentManager {
    constructor(client) {
        this.client = client;
        this.active = new Map(); // messageId -> kayıt
    }

    /** Mesaja bileşenin tepkilerini ekler ve tıklamaları dinlemeye başlar. */
    async attach(message, body) {
        if (!isInteractive(body)) return null;
        const controls = body.controls();
        const entry = this.#entry(message, body, controls);
        for (const c of controls) {
            await this.client.rest('PUT', `/channels/${message.channelId}/messages/${message.id}/reactions/${emojiPath(c.emoji)}/@me`).catch(err => this.#error(err));
        }
        return entry;
    }

    /** Mesajı bırakır (tepkiler yerinde kalır). */
    release(messageId, reason = 'manual') {
        const entry = this.active.get(messageId);
        if (!entry) return false;
        clearTimeout(entry.timer);
        this.active.delete(messageId);
        if (reason !== 'replace') Promise.resolve(entry.options.onEnd?.({ reason, messageId, channelId: entry.channelId })).catch(err => this.#error(err));
        return true;
    }

    /** @internal Gateway MESSAGE_REACTION_ADD. */
    async handleReaction(data) {
        const entry = this.active.get(data?.message_id);
        if (!entry) return;
        const userId = String(data.user_id ?? data.member?.user?.id ?? '');
        if (!userId || userId === String(this.client.user?.id)) return;
        const key = emojiKey(data.emoji);
        const control = entry.controls.find(c => emojiKey(c.emoji) === key);

        // Kullanıcının tepkisi geri alınır ki buton tekrar tıklanabilsin ve mesaj düzenli kalsın.
        if (entry.options.removeReaction) {
            const raw = data.emoji?.id ? `${data.emoji.name}:${data.emoji.id}` : data.emoji?.name;
            if (raw) this.client.rest('DELETE', `/channels/${entry.channelId}/messages/${entry.messageId}/reactions/${encodeURIComponent(raw)}/${userId}`).catch(() => {});
        }
        if (!control) return;
        if (entry.options.only && !entry.options.only.has(userId)) return;
        const now = Date.now();
        if (entry.options.cooldown && now - (entry.lastClick.get(userId) ?? 0) < entry.options.cooldown) return;
        entry.lastClick.set(userId, now);

        const interaction = this.#interaction(entry, data, userId);
        try {
            if (entry.options.filter && !(await entry.options.filter(interaction))) return;
            if (control.filter && !(await control.filter(interaction))) return;
            await control.run?.(interaction);
            if (control.once) entry.controls = entry.controls.filter(c => c !== control);
        } catch (err) {
            this.#error(err);
        }
    }

    /** @internal Silinen mesajın kaydı bırakılır. */
    handleDelete(data) {
        if (data?.id) this.release(data.id, 'deleted');
    }

    #entry(message, body, controls) {
        const prev = this.active.get(message.id);
        if (prev) this.release(message.id, 'replace');
        const options = { ...body.options };
        const entry = {
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId ?? null,
            body,
            controls,
            options,
            lastClick: prev?.lastClick ?? new Map(),
            timer: null,
        };
        if (options.timeout > 0) {
            entry.timer = setTimeout(() => this.release(message.id, 'timeout'), options.timeout);
            entry.timer.unref?.();
        }
        this.active.set(message.id, entry);
        return entry;
    }

    #interaction(entry, data, userId) {
        const client = this.client;
        const manager = this;
        const base = `/channels/${entry.channelId}/messages/${entry.messageId}`;
        return {
            userId,
            user: data.member?.user ?? { id: userId },
            member: data.member ?? null,
            guildId: data.guild_id ?? entry.guildId,
            channelId: entry.channelId,
            messageId: entry.messageId,
            emoji: data.emoji,
            /** Aynı kanala, tıklanan mesaja yanıt olarak yazar. */
            reply(body) {
                return client.send(entry.channelId, {
                    ...toPayload(body),
                    message_reference: { message_id: entry.messageId, channel_id: entry.channelId, ...(entry.guildId ? { guild_id: entry.guildId } : {}) },
                });
            },
            /** Mesajı yeni içerikle düzenler; yeni bir Container / Paginator verilirse butonlar da güncellenir. */
            async update(body) {
                const data = await client.rest('PATCH', base, toPayload(body));
                if (isInteractive(body)) await manager.#resync(entry, body);
                return data;
            },
            /** Mesajı siler. */
            async delete() {
                manager.release(entry.messageId, 'deleted');
                return client.rest('DELETE', base);
            },
            /** Bu mesajın butonlarını durdurur. */
            end() {
                manager.release(entry.messageId, 'ended');
            },
        };
    }

    // Düzenlemede butonlar değiştiyse: yeni emojiler eklenir, artık olmayan bot tepkileri kaldırılır.
    async #resync(entry, body) {
        const controls = body.controls();
        const before = new Set(entry.controls.map(c => emojiKey(c.emoji)));
        const after = new Set(controls.map(c => emojiKey(c.emoji)));
        const base = `/channels/${entry.channelId}/messages/${entry.messageId}/reactions`;
        for (const c of entry.controls) if (!after.has(emojiKey(c.emoji))) await this.client.rest('DELETE', `${base}/${emojiPath(c.emoji)}/@me`).catch(() => {});
        for (const c of controls) if (!before.has(emojiKey(c.emoji))) await this.client.rest('PUT', `${base}/${emojiPath(c.emoji)}/@me`).catch(err => this.#error(err));
        entry.body = body;
        entry.controls = controls;
        entry.options = { ...body.options, onEnd: body.options.onEnd };
    }

    #error(err) {
        if (this.client.listenerCount?.('error') > 0) this.client.emit('error', err);
        else console.error('micup.js bileşen hatası:', err?.message ?? err);
    }
}
