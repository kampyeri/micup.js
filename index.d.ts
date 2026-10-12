export interface ClientOptions {
    /** Bu oturumun almak istemediği olay adları (örn. ['TYPING_START']). Micup'ta intent yoktur. */
    ignoredEvents?: string[];
    /** Açılıştaki durum ve durum mesajı. */
    presence?: PresenceInput;
    /** Micup kök adresi. Varsayılan: https://micup.gg */
    origin?: string;
    /**
     * Açık kullanım ve hata bildirimi (telemetri). Varsayılan açık.
     * Gönderilen: bot kimliği ve adı, bot sahibinin kimliği ve adı, micup.js / Node sürümü, platform, sunucu SAYISI ve hatalar.
     * Kapatmak: `false` ya da `MICUP_TELEMETRY=0`. Adresi değiştirmek: `{ url }`.
     */
    telemetry?: boolean | string | { url?: string };
}

export interface MessageReference {
    message_id: string;
    channel_id: string;
    guild_id?: string;
}

export interface MessageBody {
    content?: string;
    message_reference?: MessageReference;
    [key: string]: unknown;
}

export interface MicupUser {
    id: string;
    username: string;
    bot?: boolean;
    [key: string]: unknown;
}

export interface MessageData {
    id: string;
    channel_id: string;
    guild_id?: string | null;
    content?: string;
    author?: MicupUser | null;
    [key: string]: unknown;
}

export interface VoiceStateData {
    guild_id: string;
    channel_id: string | null;
    user_id: string;
    session_id?: string;
    connection_id?: string;
    self_mute?: boolean;
    self_deaf?: boolean;
    [key: string]: unknown;
}

export interface VoiceServerData {
    guild_id: string;
    channel_id?: string;
    connection_id?: string;
    /** LiveKit medya sunucusu (örn. wss://ses-1.micup.gg). */
    endpoint: string;
    /** Medya yetkisi; 600 saniye geçerlidir. */
    token: string;
    [key: string]: unknown;
}

/** Micup'un verdiği ses yetkisi (VOICE_SERVER_UPDATE). */
export interface VoiceConnectionInfo {
    guildId: string;
    channelId: string | null;
    connectionId: string | null;
    endpoint: string;
    token: string;
}

export interface VoiceJoinOptions {
    selfMute?: boolean;
    selfDeaf?: boolean;
}

export interface VoiceConnectOptions extends VoiceJoinOptions {
    /** Başlangıç ses seviyesi (0-2). Varsayılan 1. */
    volume?: number;
    /** ffmpeg yolu. Varsayılan: FFMPEG_PATH, ffmpeg-static ya da sistemdeki ffmpeg. */
    ffmpegPath?: string;
}

export declare const Events: Readonly<{
    Ready: 'ready';
    MessageCreate: 'messageCreate';
    VoiceStateUpdate: 'voiceStateUpdate';
    VoiceServerUpdate: 'voiceServerUpdate';
    Disconnect: 'disconnect';
    Error: 'error';
}>;

export type StatusValue = 'online' | 'idle' | 'dnd' | 'invisible';

export declare const Status: Readonly<{
    Online: 'online';
    Idle: 'idle';
    DoNotDisturb: 'dnd';
    Invisible: 'invisible';
}>;

export interface CustomStatus {
    text?: string | null;
    emoji_name?: string | null;
    emoji_id?: string | null;
    expires_at?: string | null;
}

export interface PresenceInput {
    status?: StatusValue;
    /** Metin ya da durum nesnesi. null mesajı siler; verilmezse mevcut mesaj korunur. */
    customStatus?: string | CustomStatus | null;
}

export interface PresencePayload {
    status: StatusValue;
    afk: boolean;
    mobile: boolean;
    custom_status?: CustomStatus | null;
}

export declare function buildPresence(input?: PresenceInput): PresencePayload;

export class MicupError extends Error {
    readonly status: number;
    readonly code: string | null;
    readonly body: unknown;
    constructor(status: number, body: { code?: string; message?: string } | null);
}

export class VoiceError extends Error {
    constructor(message: string);
}

export class Message {
    readonly client: Client;
    readonly raw: MessageData;
    readonly id: string;
    readonly channelId: string;
    readonly guildId: string | null;
    readonly content: string;
    readonly author: MicupUser | null;
    readonly isBot: boolean;
    constructor(client: Client, data: MessageData);
    reply(content: string | MessageBody): Promise<Message>;
}

export class VoiceManager {
    constructor(client: Client);
    /** Bir guild'deki bilinen ses durumlarını döndürür. */
    getStates(guildId: string): VoiceStateData[];
    /** Ses kanalı için yetki ister; Micup yetkiyi gönderince çözülür. Ses çalmak için connect() kullanın. */
    join(guildId: string, channelId: string, options?: VoiceJoinOptions): Promise<VoiceConnectionInfo>;
    /**
     * Ses kanalına girer, medya sunucusuna bağlanır ve ses çalınabilen bir bağlantı döndürür.
     * Gerekli: npm install @livekit/rtc-node (dosya / bağlantı çalmak için ayrıca ffmpeg ya da ffmpeg-static).
     */
    connect(guildId: string, channelId: string, options?: VoiceConnectOptions): Promise<import('./voice.js').VoiceConnection>;
    /** Guild'deki açık ses bağlantısı. */
    getConnection(guildId: string): import('./voice.js').VoiceConnection | null;
    /** Bot'u ses kanalından çıkarır (açık bağlantı varsa kapatır). */
    leave(guildId: string): void;
}

export interface ClientEvents {
    ready: [client: Client];
    messageCreate: [message: Message];
    voiceStateUpdate: [state: VoiceStateData];
    voiceServerUpdate: [server: VoiceServerData];
    disconnect: [code: number, reason: string];
    error: [error: Error];
    [gatewayEvent: string]: unknown[];
}

export class Client {
    readonly ignoredEvents: string[];
    readonly origin: string;
    user: MicupUser | null;
    readonly token: string | null;
    readonly destroyed: boolean;
    readonly voice: VoiceManager;
    presence: PresencePayload | null;

    constructor(options?: ClientOptions);

    login(token: string): Promise<this>;
    destroy(): void;
    isReady(): boolean;
    /** Durumu ve durum mesajını değiştirir (20 saniyede en fazla 5 kez). */
    setPresence(presence: PresenceInput): PresencePayload;
    send(channelId: string, body: string | MessageBody): Promise<Message>;
    rest<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;

    on<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    once<E extends keyof ClientEvents>(event: E, listener: (...args: ClientEvents[E]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
}

export default Client;

/** Kütüphanenin yapımcısı: "DCSV" (https://dcsv.me). */
export const MADE_BY: string;
