import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

// Micup, Fluxer üzerine kurulu. Adresler https://micup.gg/.well-known/fluxer üzerinden alınır.
const ORIGIN = 'https://micup.gg';
const API_VERSION = 1;
const GATEWAY_VERSION = 1;
const USER_AGENT = 'micup.js/0.1.0';

export const Intents = {
    Guilds: 1 << 0,
    GuildMessages: 1 << 9,
    DirectMessages: 1 << 12,
    MessageContent: 1 << 15,
};

const Op = {
    Dispatch: 0,
    Heartbeat: 1,
    Identify: 2,
    Reconnect: 7,
    InvalidSession: 9,
    Hello: 10,
    HeartbeatAck: 11,
};

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
        this.author = data.author;
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
    constructor(options = {}) {
        super();
        this.intents = options.intents ?? Intents.Guilds | Intents.GuildMessages | Intents.MessageContent;
        this.user = null;
        this.endpoints = null;
        this.destroyed = false;
        this.token = null;
        this.ws = null;
        this.seq = null;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
    }

    async login(token) {
        if (!token) throw new Error('Bot token gerekli.');
        this.token = token;
        this.destroyed = false;
        await this.#discover();
        // Token'ı gateway'e bağlanmadan önce REST'te doğrula; hata erken ve açık görünsün.
        this.user = await this.rest('GET', '/users/@me');
        this.#connect();
        return this;
    }

    destroy() {
        this.destroyed = true;
        this.#stopHeartbeat();
        clearTimeout(this.reconnectTimer);
        this.ws?.close(1000);
        this.ws = null;
    }

    send(channelId, body) {
        const payload = typeof body === 'string' ? { content: body } : body;
        return this.rest('POST', `/channels/${channelId}/messages`, payload).then(data => new Message(this, data));
    }

    async rest(method, path, body) {
        const base = this.endpoints?.api_public ?? `${ORIGIN}/api`;
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
        const res = await fetch(`${ORIGIN}/.well-known/fluxer`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`Micup keşif adresi alınamadı: HTTP ${res.status}`);
        this.endpoints = (await res.json()).endpoints;
    }

    #connect() {
        const base = this.endpoints?.gateway ?? 'wss://micup.gg/gateway';
        this.ws = new WebSocket(`${base}?v=${GATEWAY_VERSION}&encoding=json`);

        this.ws.on('message', raw => this.#onPacket(JSON.parse(raw.toString())));
        this.ws.on('error', err => this.emit('error', err));
        this.ws.on('close', (code, reason) => {
            this.#stopHeartbeat();
            this.emit('disconnect', code, reason.toString());
            if (this.destroyed || FATAL_CLOSE_CODES.has(code)) return;
            this.reconnectTimer = setTimeout(() => this.#connect(), 5000);
        });
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
                setTimeout(() => this.#identify(), 2000);
                break;
            case Op.HeartbeatAck:
                break;
        }
    }

    #dispatch(event, data) {
        if (event === 'READY') {
            this.user = data.user;
            this.emit('ready', this);
            return;
        }
        if (event === 'MESSAGE_CREATE') {
            this.emit('messageCreate', new Message(this, data));
            return;
        }
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
        // Discord/Fluxer benzeri: ilk kalp atışı rastgele gecikmeyle, sonra düzenli.
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
