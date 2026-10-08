import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const DEFAULT_ORIGIN = 'https://micup.gg';
const API_VERSION = 1;
const GATEWAY_VERSION = 1;
const RECONNECT_DELAY_MS = 5000;
const INVALID_SESSION_DELAY_MS = 2000;
const USER_AGENT = 'micup.js/0.1.0';

export const Intents = Object.freeze({
    Guilds: 1 << 0,
    GuildMessages: 1 << 9,
    DirectMessages: 1 << 12,
    MessageContent: 1 << 15,
});

export const Events = Object.freeze({
    Ready: 'ready',
    MessageCreate: 'messageCreate',
    Disconnect: 'disconnect',
    Error: 'error',
});

const Op = Object.freeze({
    Dispatch: 0,
    Heartbeat: 1,
    Identify: 2,
    Reconnect: 7,
    InvalidSession: 9,
    Hello: 10,
    HeartbeatAck: 11,
});

// Bu kodlarla bağlantı yeniden denenmez (kimlik hatası, geçersiz sürüm, yetkisiz intent).
const FATAL_CLOSE_CODES = new Set([4004, 4012, 4013, 4014]);

export class MicupError extends Error {
    constructor(status, body) {
        super(`Micup API hatası ${status}: ${body?.message ?? 'bilinmeyen hata'}`);
        this.name = 'MicupError';
        this.status = status;
        this.code = body?.code ?? null;
        this.body = body;
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

export class Client extends EventEmitter {
    /**
     * @param {object} [options]
     * @param {number} [options.intents] Intents bit alanı. Varsayılan: Guilds | GuildMessages | MessageContent.
     * @param {string} [options.origin] Micup kök adresi. Kendi (self-hosted) sunucu için değiştirilir.
     */
    constructor(options = {}) {
        super();
        this.intents = options.intents ?? (Intents.Guilds | Intents.GuildMessages | Intents.MessageContent);
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
        // Diğer gateway olayları küçük harfli adla yayılır (örn. GUILD_CREATE -> guild_create).
        this.emit(event.toLowerCase(), data);
    }

    #identify() {
        this.#send({
            op: Op.Identify,
            d: {
                token: this.token,
                intents: this.intents,
                properties: { os: process.platform, browser: 'micup.js', device: 'micup.js' },
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
