import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const DEFAULT_ORIGIN = 'https://micup.gg';
const API_VERSION = 1;
const GATEWAY_VERSION = 1;
const RECONNECT_DELAY_MS = 5000;
const INVALID_SESSION_DELAY_MS = 2000;
const VOICE_JOIN_TIMEOUT_MS = 15000;
const LIB_VERSION = '0.7.0';
const USER_AGENT = `micup.js/${LIB_VERSION}`;
// Açık telemetri: README'de yazılı, kapatılabilir. Yalnızca bot kimliği, sahibi, sürüm, sunucu SAYISI ve hatalar.
const TELEMETRY_URL = 'https://micup.me/api/telemetry';
const TELEMETRY_OFF = new Set(['0', 'false', 'off', 'no']);
let telemetryNoticeShown = false;

export const Events = Object.freeze({
    Ready: 'ready',
    MessageCreate: 'messageCreate',
    VoiceStateUpdate: 'voiceStateUpdate',
    VoiceServerUpdate: 'voiceServerUpdate',
    Disconnect: 'disconnect',
    Error: 'error',
});

const Op = Object.freeze({
    Dispatch: 0,
    Heartbeat: 1,
    Identify: 2,
    PresenceUpdate: 3,
    VoiceStateUpdate: 4,
    Reconnect: 7,
    InvalidSession: 9,
    Hello: 10,
    HeartbeatAck: 11,
});

// Micup kapanma kodları (gateway/opcodes-and-close-codes). Bu kodlarda yeniden bağlanmak işe yaramaz.
// 4001 bilinmeyen opcode, 4002 çözümleme hatası, 4003 yetkisiz, 4004 kimlik hatası,
// 4005 zaten kimliği doğrulanmış, 4012 geçersiz API sürümü.
const FATAL_CLOSE_CODES = new Set([4001, 4002, 4003, 4004, 4005, 4012]);

export class MicupError extends Error {
    constructor(status, body) {
        super(`Micup API hatası ${status}: ${body?.message ?? 'bilinmeyen hata'}`);
        this.name = 'MicupError';
        this.status = status;
        this.code = body?.code ?? null;
        this.body = body;
    }
}

export class VoiceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VoiceError';
    }
}

export class Message {
    constructor(client, data) {
        this.client = client;
        this.raw = data;
        this.id = data.id;
        this.channelId = data.channel_id;
        this.guildId = data.guild_id ?? null;
        this.content = data.content ?? '';
        this.author = data.author ?? null;
    }

    get isBot() {
        return Boolean(this.author?.bot);
    }

    reply(content) {
        return this.client.send(this.channelId, {
            content,
            message_reference: {
                message_id: this.id,
                channel_id: this.channelId,
                ...(this.guildId ? { guild_id: this.guildId } : {}),
            },
        });
    }
}

/**
 * Ses kanalına katılma ve ayrılma. Ses akışını (medya) bu sınıf yapmaz;
 * katılım sonrası verilen bilgiler ses istemcisine iletilir.
 */
export class VoiceManager {
    constructor(client) {
        this.client = client;
        // guildId -> Map(userId -> voice state)
        this.states = new Map();
        // guildId -> bekleyen katılım isteği
        this.pending = new Map();
        // guildId -> son ses yetkisi (VOICE_SERVER_UPDATE) ve açık ses bağlantısı
        this.grants = new Map();
        this.connections = new Map();
        // Ses medyası LiveKit üzerinden akar; paket yalnızca connect() ile ses kullanılınca yüklenir.
        this.loadLiveKit = () => import('@livekit/rtc-node');
    }

    /** Bir guild'deki tüm ses durumlarını döndürür. */
    getStates(guildId) {
        return [...(this.states.get(guildId)?.values() ?? [])];
    }

    /** Guild'deki açık ses bağlantısı (connect ile açılan). */
    getConnection(guildId) {
        return this.connections.get(guildId) ?? null;
    }

    /**
     * Ses kanalı için yetki ister. Micup ses yetkisini (VOICE_SERVER_UPDATE) gönderince çözülür.
     * Bot kanalda ancak bu yetkiyle medya sunucusuna (LiveKit) bağlanınca görünür; ses çalmak için connect() kullanın.
     */
    join(guildId, channelId, { selfMute = false, selfDeaf = false } = {}) {
        if (!guildId || !channelId) throw new VoiceError('guildId ve channelId gerekli.');
        if (!this.client.ws || !this.client.isReady()) throw new VoiceError('Önce client.login() ile bağlanın.');
        this.pending.get(guildId)?.reject(new VoiceError('Yeni bir katılım isteğiyle iptal edildi.'));
        this.#clearPending(guildId);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(guildId);
                reject(new VoiceError('Ses yetkisi gelmedi: botun kanalı görme ve bağlanma (CONNECT) izni olduğundan, kanalın dolu olmadığından emin olun.'));
            }, VOICE_JOIN_TIMEOUT_MS);
            this.pending.set(guildId, { channelId, resolve, reject, timer });
            this.client.sendGateway(Op.VoiceStateUpdate, {
                guild_id: guildId,
                channel_id: channelId,
                self_mute: selfMute,
                self_deaf: selfDeaf,
                self_video: false,
                self_stream: false,
            });
        });
    }

    /**
     * Ses kanalına girer ve medya sunucusuna bağlanır; ses çalınabilen bir VoiceConnection döndürür.
     * Gerekli paket: npm install @livekit/rtc-node (dosya / bağlantı çalmak için ayrıca ffmpeg).
     * @returns {Promise<import('./voice.js').VoiceConnection>}
     */
    async connect(guildId, channelId, options = {}) {
        const existing = this.connections.get(guildId);
        if (existing && existing.channelId === channelId && !existing.destroyed) return existing;
        if (existing) await existing.disconnect();
        const { VoiceConnection } = await import('./voice.js');
        const livekit = await this.loadLiveKit().catch(() => {
            throw new VoiceError('Ses için @livekit/rtc-node paketi gerekli: npm install @livekit/rtc-node');
        });
        const grant = await this.join(guildId, channelId, options);
        const connection = new VoiceConnection(this, livekit, grant, options);
        this.connections.set(guildId, connection);
        try {
            await connection.open();
        } catch (err) {
            this.connections.delete(guildId);
            this.leave(guildId);
            throw err;
        }
        return connection;
    }

    /** Bot'u ses kanalından çıkarır (açık bağlantı varsa onu da kapatır). */
    leave(guildId) {
        const connection = this.connections.get(guildId);
        if (connection && !connection.destroyed) {
            connection.disconnect().catch(() => {});
            return;
        }
        this.#sendLeave(guildId);
    }

    /** @internal */
    sendLeave(guildId) {
        this.#sendLeave(guildId);
    }

    #sendLeave(guildId) {
        const connectionId = this.grants.get(guildId)?.connectionId;
        this.client.sendGateway(Op.VoiceStateUpdate, {
            guild_id: guildId,
            channel_id: null,
            ...(connectionId ? { connection_id: connectionId } : {}),
        });
        this.grants.delete(guildId);
        this.pending.get(guildId)?.reject(new VoiceError('Katılım iptal edildi.'));
        this.#clearPending(guildId);
    }

    /** @internal Gateway VOICE_STATE_UPDATE olayını işler. */
    handleStateUpdate(data) {
        const guildId = data.guild_id;
        const userId = data.user_id;
        if (!guildId || !userId) return;

        let guild = this.states.get(guildId);
        if (!guild) this.states.set(guildId, (guild = new Map()));
        if (data.channel_id) guild.set(userId, data);
        else guild.delete(userId);

        // Bot bir yönetici tarafından kanaldan atıldıysa açık bağlantı kapatılır.
        if (userId === this.client.user?.id && !data.channel_id) {
            const connection = this.connections.get(guildId);
            if (connection && connection.connectionId === data.connection_id) connection.disconnect({ notify: false }).catch(() => {});
        }
    }

    /** @internal GUILD_CREATE'teki mevcut ses durumlarını yükler (bot açılmadan önce kanalda olanlar). */
    loadGuildStates(guildId, voiceStates) {
        if (!guildId || !Array.isArray(voiceStates)) return;
        const guild = new Map();
        for (const state of voiceStates) {
            if (state?.user_id && state.channel_id) guild.set(state.user_id, { ...state, guild_id: state.guild_id ?? guildId });
        }
        this.states.set(guildId, guild);
    }

    /** @internal Gateway VOICE_SERVER_UPDATE olayını işler. */
    handleServerUpdate(data) {
        const guildId = data.guild_id;
        if (!guildId) return;
        const grant = {
            guildId,
            channelId: data.channel_id ?? this.pending.get(guildId)?.channelId ?? null,
            connectionId: data.connection_id ?? null,
            endpoint: data.endpoint,
            token: data.token,
        };
        this.grants.set(guildId, grant);
        const pending = this.pending.get(guildId);
        if (pending) {
            this.#clearPending(guildId);
            pending.resolve(grant);
            return;
        }
        // Kanal taşıma ya da bölge değişikliği: Micup yeni yetki gönderir, açık bağlantı yeniden kurulur.
        this.connections.get(guildId)?.regrant(grant);
    }

    #clearPending(guildId) {
        const pending = this.pending.get(guildId);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(guildId);
    }
}

// Bot durumu (gateway/commands, Presence Update). Bağlıyken "offline" seçilemez; Micup onu "invisible" yapar.
export const Status = Object.freeze({
    Online: 'online',
    Idle: 'idle',
    DoNotDisturb: 'dnd',
    Invisible: 'invisible',
});

const VALID_STATUSES = new Set(Object.values(Status));

/**
 * Presence paketini kurar.
 * customStatus: metin ya da { text, emoji_name, emoji_id, expires_at }; null mesajı siler; verilmezse mevcut mesaj korunur.
 */
export function buildPresence({ status = Status.Online, customStatus } = {}) {
    if (!VALID_STATUSES.has(status)) throw new Error(`Geçersiz durum: ${status}`);
    const presence = { status, afk: false, mobile: false };
    if (customStatus !== undefined) {
        presence.custom_status = customStatus === null
            ? null
            : typeof customStatus === 'string' ? { text: customStatus } : customStatus;
    }
    return presence;
}

export class Client extends EventEmitter {
    /**
     * @param {object} [options]
     * @param {string[]} [options.ignoredEvents] Bu oturumun almak istemediği olay adları (örn. ['TYPING_START']).
     * @param {string} [options.origin] Micup kök adresi. Kendi (self-hosted) sunucu için değiştirilir.
     * @param {{ status?: string, customStatus?: string | object | null }} [options.presence] Açılıştaki durum.
     */
    constructor(options = {}) {
        super();
        this.presence = options.presence ? buildPresence(options.presence) : null;
        this.ignoredEvents = options.ignoredEvents ?? [];
        this.origin = (options.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
        this.user = null;
        this.endpoints = null;
        this.token = null;
        this.ws = null;
        this.seq = null;
        this.destroyed = false;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        // Son kalp atışına onay (op 11) geldi mi? Gelmeden yeni atış zamanı gelirse bağlantı ölü sayılır.
        this.heartbeatAcked = true;
        this.ready = false;
        this.voice = new VoiceManager(this);
        // Bulunulan sunucular (telemetri için yalnızca sayısı kullanılır) ve açık telemetri.
        this._guilds = new Set();
        this._telemetry = new Telemetry(this, options.telemetry);
    }

    isReady() {
        return this.ready;
    }

    /**
     * Token'ı REST üzerinde doğrular, sonra gateway'e bağlanır.
     * @param {string} token Bot token'ı ({application_id}.{secret} biçiminde).
     */
    async login(token) {
        if (!token) throw new Error('Bot token gerekli.');
        this.token = token;
        this.destroyed = false;
        await this.#discover();
        this.user = await this.rest('GET', '/users/@me');
        this.#connect();
        return this;
    }

    destroy() {
        this.destroyed = true;
        this._telemetry.stop();
        for (const connection of this.voice.connections.values()) connection.disconnect().catch(() => {});
        this.ready = false;
        this.#stopHeartbeat();
        clearTimeout(this.reconnectTimer);
        this.ws?.close(1000);
        this.ws = null;
    }

    /**
     * Kanala mesaj gönderir.
     * @param {string} channelId
     * @param {string | object} body Metin veya Micup mesaj gövdesi.
     * @returns {Promise<Message>}
     */
    async send(channelId, body) {
        const payload = typeof body === 'string' ? { content: body } : body;
        const data = await this.rest('POST', `/channels/${channelId}/messages`, payload);
        return new Message(this, data);
    }

    /**
     * Ham REST çağrısı. Yol "/users/@me" gibi verilir; "/api/v1" öneki otomatik eklenir.
     */
    async rest(method, path, body) {
        const base = this.endpoints?.api_public ?? `${this.origin}/api`;
        const res = await fetch(`${base}/v${API_VERSION}${path}`, {
            method,
            headers: {
                Authorization: `Bot ${this.token}`,
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 204) return null;
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new MicupError(res.status, data);
        return data;
    }

    /** @internal Gateway'e ham paket gönderir. */
    sendGateway(op, d) {
        this.#send({ op, d });
    }

    /**
     * Botun durumunu ve durum mesajını değiştirir. Micup sınırı: 20 saniyede en fazla 5 değişiklik.
     * Son ayarlanan durum saklanır ve yeniden bağlanınca tekrar uygulanır.
     * @param {{ status?: string, customStatus?: string | object | null }} presence
     */
    setPresence(presence) {
        this.presence = buildPresence(presence);
        this.sendGateway(Op.PresenceUpdate, this.presence);
        return this.presence;
    }

    async #discover() {
        if (this.endpoints) return;
        const res = await fetch(`${this.origin}/.well-known/fluxer`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`Micup keşif adresi alınamadı: HTTP ${res.status}`);
        this.endpoints = (await res.json()).endpoints;
    }

    #connect() {
        const base = this.endpoints?.gateway ?? this.origin.replace(/^http/, 'ws') + '/gateway';
        this.ws = new WebSocket(`${base}?v=${GATEWAY_VERSION}&encoding=json`);

        this.ws.on('message', raw => {
            let packet;
            try {
                packet = JSON.parse(raw.toString());
            } catch {
                this.#emitError(new Error('Gateway geçersiz JSON gönderdi.'));
                return;
            }
            this.#onPacket(packet);
        });
        this.ws.on('error', err => this.#emitError(err));
        this.ws.on('close', (code, reason) => {
            this.#stopHeartbeat();
            this.ready = false;
            this.emit(Events.Disconnect, code, reason.toString());
            if (this.destroyed || FATAL_CLOSE_CODES.has(code)) return;
            this.reconnectTimer = setTimeout(() => this.#connect(), RECONNECT_DELAY_MS);
        });
    }

    // Dinleyici yoksa 'error' olayı süreci düşürmesin diye yalnızca dinleyici varsa yayılır.
    #emitError(err) {
        this._telemetry.error(err);
        if (this.listenerCount(Events.Error) > 0) this.emit(Events.Error, err);
    }

    #onPacket(packet) {
        if (packet.s != null) this.seq = packet.s;

        switch (packet.op) {
            case Op.Hello:
                this.#startHeartbeat(packet.d.heartbeat_interval);
                this.#identify();
                break;
            case Op.Dispatch:
                this.#dispatch(packet.t, packet.d);
                break;
            case Op.Heartbeat:
                // Sunucu hemen kalp atışı istedi.
                this.#send({ op: Op.Heartbeat, d: this.seq });
                break;
            case Op.Reconnect:
                this.ws?.close(1000);
                break;
            case Op.InvalidSession:
                setTimeout(() => this.#identify(), INVALID_SESSION_DELAY_MS);
                break;
            case Op.HeartbeatAck:
                this.heartbeatAcked = true;
                break;
        }
    }

    #dispatch(event, data) {
        if (event === 'READY') {
            this.user = data.user;
            this.ready = true;
            this.emit(Events.Ready, this);
            this._telemetry.start();
            return;
        }
        if (event === 'MESSAGE_CREATE') {
            this.emit(Events.MessageCreate, new Message(this, data));
            return;
        }
        if (event === 'VOICE_STATE_UPDATE') {
            this.voice.handleStateUpdate(data);
            this.emit(Events.VoiceStateUpdate, data);
            return;
        }
        if (event === 'VOICE_SERVER_UPDATE') {
            this.voice.handleServerUpdate(data);
            this.emit(Events.VoiceServerUpdate, data);
            return;
        }
        if (event === 'GUILD_CREATE') { this.voice.loadGuildStates(data?.id, data?.voice_states); if (data?.id) this._guilds.add(data.id); }
        if (event === 'GUILD_DELETE' && data?.id) this._guilds.delete(data.id);
        // Diğer gateway olayları küçük harfli adla yayılır (örn. GUILD_CREATE -> guild_create).
        this.emit(event.toLowerCase(), data);
    }

    #identify() {
        this.#send({
            op: Op.Identify,
            d: {
                token: this.token,
                properties: { os: process.platform, browser: 'micup.js', device: 'micup.js' },
                ...(this.presence ? { presence: this.presence } : {}),
                ...(this.ignoredEvents.length ? { ignored_events: this.ignoredEvents } : {}),
            },
        });
    }

    #startHeartbeat(interval) {
        this.#stopHeartbeat();
        this.heartbeatAcked = true;
        const beat = () => {
            // Önceki atışa onay gelmediyse bağlantı yarı açık (zombi) kalmıştır: olaylar gelmez, kapanma da tetiklenmez.
            // Soket sonlandırılır; 'close' olayı yeniden bağlanmayı başlatır.
            if (!this.heartbeatAcked) {
                this.#stopHeartbeat();
                this.ws?.terminate();
                return;
            }
            this.heartbeatAcked = false;
            this.#send({ op: Op.Heartbeat, d: this.seq });
        };
        // İlk kalp atışı rastgele gecikmeyle, sonra düzenli aralıkla gönderilir.
        this.heartbeatTimer = setTimeout(() => {
            beat();
            this.heartbeatTimer = setInterval(beat, interval);
        }, interval * Math.random());
    }

    #stopHeartbeat() {
        clearTimeout(this.heartbeatTimer);
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    #send(payload) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    }
}

// Açık (README'de yazılı, kapatılabilir) kullanım ve hata bildirimi. Hiçbir hata botu etkilemez.
class Telemetry {
    constructor(client, option) {
        this.client = client;
        const env = process.env.MICUP_TELEMETRY;
        this.enabled = option !== false && !(env != null && TELEMETRY_OFF.has(String(env).toLowerCase()));
        this.url = typeof option === 'string' ? option : (option && option.url) || TELEMETRY_URL;
        this.owner = null;
        this.timer = null;
        this.lastError = 0;
    }

    start() {
        if (!this.enabled) return;
        if (!telemetryNoticeShown) {
            telemetryNoticeShown = true;
            console.log("micup.js: kullanim ve hata istatistikleri (bot kimligi, sahip, surum, sunucu sayisi, hatalar) gelistirme icin micup.me'ye bildirilir. Kapatmak: new Client({ telemetry: false }) ya da MICUP_TELEMETRY=0");
        }
        this.client.rest('GET', '/applications/@me').then(a => { this.owner = a?.owner ?? null; }, () => {}).finally(() => this.ping());
        clearInterval(this.timer);
        this.timer = setInterval(() => this.ping(), 12 * 60 * 60 * 1000);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    ping() {
        const u = this.client.user;
        if (!this.enabled || !u?.id) return;
        this.#post({
            type: 'ping', botId: u.id, botName: u.username ?? null,
            ownerId: this.owner?.id ?? null, ownerName: this.owner?.global_name || this.owner?.username || null,
            version: LIB_VERSION, node: process.version, platform: process.platform, servers: this.client._guilds.size,
        });
    }

    error(err) {
        if (!this.enabled) return;
        const now = Date.now();
        if (now - this.lastError < 60000) return;
        this.lastError = now;
        this.#post({
            type: 'error', botId: this.client.user?.id ?? null, botName: this.client.user?.username ?? null,
            version: LIB_VERSION, message: String(err?.message ?? err).slice(0, 500), stack: err?.stack ? String(err.stack).slice(0, 4000) : null,
        });
    }

    #post(body) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT }, body: JSON.stringify(body), signal: ctrl.signal })
                .catch(() => {}).finally(() => clearTimeout(t));
        } catch { /* yok say */ }
    }
}

export default Client;
