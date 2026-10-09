import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const DEFAULT_ORIGIN = 'https://micup.gg';
const API_VERSION = 1;
const GATEWAY_VERSION = 1;
const RECONNECT_DELAY_MS = 5000;
const INVALID_SESSION_DELAY_MS = 2000;
const VOICE_JOIN_TIMEOUT_MS = 15000;
const USER_AGENT = 'micup.js/0.4.0';

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
    }

    /** Bir guild'deki tüm ses durumlarını döndürür. */
    getStates(guildId) {
        return [...(this.states.get(guildId)?.values() ?? [])];
    }

    /** Bot'un ses kanalına katılır. Gateway'den durum ve sunucu bilgisi gelince çözülür. */
    join(guildId, channelId, { selfMute = false, selfDeaf = false } = {}) {
        if (!guildId || !channelId) throw new VoiceError('guildId ve channelId gerekli.');
        if (!this.client.ws || !this.client.isReady()) throw new VoiceError('Önce client.login() ile bağlanın.');

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(guildId);
                reject(new VoiceError('Ses kanalına katılma zaman aşımına uğradı.'));
            }, VOICE_JOIN_TIMEOUT_MS);
            this.pending.set(guildId, { state: null, server: null, resolve, reject, timer });
            this.client.sendGateway(Op.VoiceStateUpdate, {
                guild_id: guildId,
                channel_id: channelId,
                self_mute: selfMute,
                self_deaf: selfDeaf,
            });
        });
    }

    /** Bot'u ses kanalından çıkarır. */
    leave(guildId) {
        this.client.sendGateway(Op.VoiceStateUpdate, { guild_id: guildId, channel_id: null });
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

        const pending = this.pending.get(guildId);
        if (pending && userId === this.client.user?.id) {
            pending.state = data.channel_id ? data : null;
            this.#maybeResolve(guildId);
        }
    }

    /** @internal Gateway VOICE_SERVER_UPDATE olayını işler. */
    handleServerUpdate(data) {
        const pending = this.pending.get(data.guild_id);
        if (pending) {
            pending.server = data;
            this.#maybeResolve(data.guild_id);
        }
    }

    #maybeResolve(guildId) {
        const pending = this.pending.get(guildId);
        if (!pending || !pending.state || !pending.server) return;
        this.#clearPending(guildId);
        pending.resolve({
            guildId,
            channelId: pending.state.channel_id,
            sessionId: pending.state.session_id,
            endpoint: pending.server.endpoint,
            token: pending.server.token,
        });
    }

    #clearPending(guildId) {
        const pending = this.pending.get(guildId);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(guildId);
    }
}

export class Client extends EventEmitter {
    /**
     * @param {object} [options]
     * @param {string[]} [options.ignoredEvents] Bu oturumun almak istemediği olay adları (örn. ['TYPING_START']).
     * @param {string} [options.origin] Micup kök adresi. Kendi (self-hosted) sunucu için değiştirilir.
     */
    constructor(options = {}) {
        super();
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
        this.ready = false;
        this.voice = new VoiceManager(this);
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
            case Op.Reconnect:
                this.ws?.close(1000);
                break;
            case Op.InvalidSession:
                setTimeout(() => this.#identify(), INVALID_SESSION_DELAY_MS);
                break;
            case Op.HeartbeatAck:
                break;
        }
    }

    #dispatch(event, data) {
        if (event === 'READY') {
            this.user = data.user;
            this.ready = true;
            this.emit(Events.Ready, this);
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
        // Diğer gateway olayları küçük harfli adla yayılır (örn. GUILD_CREATE -> guild_create).
        this.emit(event.toLowerCase(), data);
    }

    #identify() {
        this.#send({
            op: Op.Identify,
            d: {
                token: this.token,
                properties: { os: process.platform, browser: 'micup.js', device: 'micup.js' },
                ...(this.ignoredEvents.length ? { ignored_events: this.ignoredEvents } : {}),
            },
        });
    }

    #startHeartbeat(interval) {
        this.#stopHeartbeat();
        const beat = () => this.#send({ op: Op.Heartbeat, d: this.seq });
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

export default Client;
