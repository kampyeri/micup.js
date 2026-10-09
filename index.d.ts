export interface ClientOptions {
    /** Bu oturumun almak istemediği olay adları (örn. ['TYPING_START']). Micup'ta intent yoktur. */
    ignoredEvents?: string[];
    /** Micup kök adresi. Varsayılan: https://micup.gg */
    origin?: string;
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
    session_id: string;
    self_mute?: boolean;
    self_deaf?: boolean;
    [key: string]: unknown;
}

export interface VoiceServerData {
    guild_id: string;
    endpoint: string;
    token: string;
    [key: string]: unknown;
}

export interface VoiceConnectionInfo {
    guildId: string;
    channelId: string;
    sessionId: string;
    endpoint: string;
    token: string;
}

export interface VoiceJoinOptions {
    selfMute?: boolean;
    selfDeaf?: boolean;
}

export declare const Events: Readonly<{
    Ready: 'ready';
    MessageCreate: 'messageCreate';
    VoiceStateUpdate: 'voiceStateUpdate';
    VoiceServerUpdate: 'voiceServerUpdate';
    Disconnect: 'disconnect';
    Error: 'error';
}>;

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
    /** Bot'u ses kanalına katıştırır. Ses sunucusu bilgisi gelince çözülür. */
    join(guildId: string, channelId: string, options?: VoiceJoinOptions): Promise<VoiceConnectionInfo>;
    /** Bot'u ses kanalından çıkarır. */
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

    constructor(options?: ClientOptions);

    login(token: string): Promise<this>;
    destroy(): void;
    isReady(): boolean;
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
