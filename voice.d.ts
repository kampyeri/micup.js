import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

export declare const SAMPLE_RATE: 48000;
export declare const CHANNELS: 2;

export declare const VoiceConnectionStatus: Readonly<{
    Connecting: 'connecting';
    Ready: 'ready';
    Reconnecting: 'reconnecting';
    Disconnected: 'disconnected';
}>;

export type VoiceConnectionStatusValue = 'connecting' | 'ready' | 'reconnecting' | 'disconnected';

export interface PlayOptions {
    /** Ses seviyesi (0-2). */
    volume?: number;
    /** Başlangıç saniyesi. */
    seek?: number;
    /** ffmpeg yolu. */
    ffmpegPath?: string;
    /** Çıkıştan önce ffmpeg'e eklenecek argümanlar (örn. ['-af', 'bass=g=5']). */
    ffmpegArgs?: string[];
    /** true ise girdi zaten 48 kHz stereo s16le PCM'dir; ffmpeg kullanılmaz. */
    raw?: boolean;
}

export interface VoiceConnectionEvents {
    start: [];
    finish: [info: { stopped: boolean }];
    status: [status: VoiceConnectionStatusValue];
    memberJoin: [identity: string];
    memberLeave: [identity: string];
    disconnect: [reason?: unknown];
    error: [error: Error];
}

export declare class VoiceConnection extends EventEmitter {
    readonly guildId: string;
    readonly channelId: string | null;
    readonly connectionId: string | null;
    readonly status: VoiceConnectionStatusValue;
    readonly destroyed: boolean;
    readonly volume: number;
    /** Odadaki diğer katılımcı sayısı (bot hariç). */
    readonly memberCount: number;
    readonly playing: boolean;
    readonly paused: boolean;
    /** Dosya yolu, http(s) bağlantısı ya da akış çalar; parça bitince ya da durdurulunca çözülür. */
    play(input: string | Readable, options?: PlayOptions): Promise<void>;
    stop(): boolean;
    pause(): boolean;
    resume(): boolean;
    setVolume(volume: number): void;
    /** Kanaldan çıkar ve bağlantıyı kapatır. */
    disconnect(): Promise<void>;
    on<K extends keyof VoiceConnectionEvents>(event: K, listener: (...args: VoiceConnectionEvents[K]) => void): this;
    once<K extends keyof VoiceConnectionEvents>(event: K, listener: (...args: VoiceConnectionEvents[K]) => void): this;
}
