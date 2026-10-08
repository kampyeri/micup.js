export interface ClientOptions {
    /** Intents bit alanı. Varsayılan: Intents.Guilds | Intents.GuildMessages | Intents.MessageContent */
    intents?: number;
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

export declare const Intents: Readonly<{
    Guilds: number;
    GuildMessages: number;
    DirectMessages: number;
    MessageContent: number;
}>;

export declare const Events: Readonly<{
    Ready: 'ready';
    MessageCreate: 'messageCreate';
    Disconnect: 'disconnect';
    Error: 'error';
}>;

export class MicupError extends Error {
    readonly status: number;
    readonly code: string | null;
    readonly body: unknown;
    constructor(status: number, body: { code?: string; message?: string } | null);
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

export interface ClientEvents {
    ready: [client: Client];
    messageCreate: [message: Message];
    disconnect: [code: number, reason: string];
    error: [error: Error];
    [gatewayEvent: string]: unknown[];
}

export class Client {
    readonly intents: number;
    readonly origin: string;
    user: MicupUser | null;
    readonly token: string | null;
    readonly destroyed: boolean;

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
