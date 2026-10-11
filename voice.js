// Micup ses bağlantısı: Micup'un verdiği ses yetkisiyle (VOICE_SERVER_UPDATE: endpoint + token) LiveKit odasına
// bağlanır ve mikrofon izi olarak ses yayınlar. Micup'un ayrı bir ses gateway'i, UDP keşfi ya da şifreleme
// el sıkışması yoktur; medya tamamen LiveKit protokolüyle akar (docs.fluxer.app/voice).
// Dosya, bağlantı ya da akış ffmpeg ile 48 kHz stereo 16 bit PCM'e çevrilip 20 ms'lik karelerle gönderilir.
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { VoiceError } from './micup.js';

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
const FRAME_SAMPLES = 960; // 20 ms
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;
// LiveKit ses tamponu (ms): küçük tutulur ki duraklat / durdur hemen duyulsun.
const QUEUE_MS = 200;

export const VoiceConnectionStatus = Object.freeze({
    Connecting: 'connecting',
    Ready: 'ready',
    Reconnecting: 'reconnecting',
    Disconnected: 'disconnected',
});

let ffmpegStatic;
async function resolveFfmpeg(path) {
    if (path) return path;
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    // ffmpeg-static kuruluysa onu, değilse sistemdeki ffmpeg'i kullan.
    if (ffmpegStatic === undefined) ffmpegStatic = await import('ffmpeg-static').then(m => m.default ?? null, () => null);
    return ffmpegStatic ?? 'ffmpeg';
}

const toUrl = endpoint => (/^wss?:\/\//i.test(endpoint) ? endpoint : `wss://${endpoint}`);

export class VoiceConnection extends EventEmitter {
    /** @internal client.voice.connect() ile oluşturulur. */
    constructor(manager, livekit, grant, options = {}) {
        super();
        this.manager = manager;
        this.lk = livekit;
        this.guildId = grant.guildId;
        this.channelId = grant.channelId;
        this.connectionId = grant.connectionId;
        this.grant = grant;
        this.options = options;
        this.status = VoiceConnectionStatus.Connecting;
        this.destroyed = false;
        this.room = null;
        this.source = null;
        this.track = null;
        this.volume = options.volume ?? 1;
        this.current = null; // çalan parça
    }

    /** @internal */
    async open() {
        const { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource } = this.lk;
        const room = new Room();
        room.on(RoomEvent.Disconnected, reason => {
            if (this.room !== room) return;
            this.disconnect({ notify: true, reason }).catch(() => {});
        });
        room.on(RoomEvent.Reconnecting, () => this.#setStatus(VoiceConnectionStatus.Reconnecting));
        room.on(RoomEvent.Reconnected, () => this.#setStatus(VoiceConnectionStatus.Ready));
        room.on(RoomEvent.ParticipantConnected, p => this.emit('memberJoin', p.identity));
        room.on(RoomEvent.ParticipantDisconnected, p => this.emit('memberLeave', p.identity));
        try {
            await room.connect(toUrl(this.grant.endpoint), this.grant.token, { autoSubscribe: false, dynacast: false });
        } catch (err) {
            throw new VoiceError(`Ses sunucusuna bağlanılamadı: ${err.message}`);
        }
        this.room = room;
        if (!this.source) {
            this.source = new AudioSource(SAMPLE_RATE, CHANNELS, QUEUE_MS);
            this.track = LocalAudioTrack.createAudioTrack('micup.js', this.source);
        }
        await room.localParticipant.publishTrack(this.track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
        this.#setStatus(VoiceConnectionStatus.Ready);
    }

    /** @internal Kanal taşıma / bölge değişikliğinde gelen yeni yetkiyle yeniden bağlanır. */
    async regrant(grant) {
        if (this.destroyed) return;
        const old = this.room;
        this.grant = grant;
        this.channelId = grant.channelId ?? this.channelId;
        this.connectionId = grant.connectionId ?? this.connectionId;
        this.room = null;
        this.#setStatus(VoiceConnectionStatus.Reconnecting);
        await old?.disconnect().catch(() => {});
        try {
            await this.open();
        } catch (err) {
            this.#emitError(err);
            await this.disconnect();
        }
    }

    /** Odadaki diğer katılımcıların sayısı (bot hariç). */
    get memberCount() {
        return this.room?.remoteParticipants?.size ?? 0;
    }

    get playing() {
        return Boolean(this.current) && !this.current.paused;
    }

    get paused() {
        return Boolean(this.current?.paused);
    }

    /**
     * Ses çalar. Önceki parça durdurulur. Parça bitince (ya da durdurulunca) çözülür.
     * @param {string | import('node:stream').Readable} input Dosya yolu, http(s) bağlantısı ya da akış.
     * @param {{ volume?: number, seek?: number, ffmpegPath?: string, ffmpegArgs?: string[], raw?: boolean }} [options]
     *   raw: true ise girdi zaten 48 kHz stereo s16le PCM'dir (ffmpeg kullanılmaz).
     */
    async play(input, options = {}) {
        if (this.destroyed || !this.source) throw new VoiceError('Ses bağlantısı kapalı.');
        this.stop();
        if (options.volume != null) this.setVolume(options.volume);

        let proc = null;
        let pcm;
        if (options.raw) {
            pcm = typeof input === 'string' ? (await import('node:fs')).createReadStream(input) : input;
        } else {
            const ffmpeg = await resolveFfmpeg(options.ffmpegPath ?? this.options.ffmpegPath);
            const fromStream = input instanceof Readable;
            const args = [
                '-hide_banner', '-loglevel', 'error', '-nostdin',
                ...(options.seek ? ['-ss', String(options.seek)] : []),
                ...(typeof input === 'string' && /^https?:/i.test(input) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []),
                '-i', fromStream ? 'pipe:0' : String(input),
                ...(options.ffmpegArgs ?? []),
                '-vn', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), 'pipe:1',
            ];
            proc = spawn(ffmpeg, args, { stdio: [fromStream ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
            if (fromStream) {
                input.on('error', () => proc.kill('SIGKILL'));
                proc.stdin.on('error', () => {});
                input.pipe(proc.stdin);
            }
            pcm = proc.stdout;
        }

        const track = { paused: false, stopped: false, proc, pcm, resume: null, stderr: '' };
        proc?.stderr.on('data', d => { track.stderr = (track.stderr + d).slice(-2000); });
        let spawnError = null;
        proc?.once('error', err => { spawnError = err; });
        const closed = proc ? new Promise(r => proc.once('close', code => r(code))) : null;
        this.current = track;
        this.emit('start');

        let leftover = Buffer.alloc(0);
        let error = null;
        try {
            const feed = (async () => {
                for await (const chunk of pcm) {
                    if (track.stopped) break;
                    let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
                    let offset = 0;
                    while (buf.length - offset >= FRAME_BYTES) {
                        if (track.paused) await new Promise(r => { track.resume = r; });
                        if (track.stopped) break;
                        await this.#sendFrame(buf.subarray(offset, offset + FRAME_BYTES));
                        offset += FRAME_BYTES;
                    }
                    leftover = Buffer.from(buf.subarray(offset));
                }
                if (!track.stopped && leftover.length >= 4) {
                    const padded = Buffer.alloc(FRAME_BYTES);
                    leftover.copy(padded);
                    await this.#sendFrame(padded);
                }
                if (!track.stopped) await this.source?.waitForPlayout();
            })();
            await feed;
            const code = closed && !track.stopped ? await closed : 0;
            if (spawnError) {
                throw new VoiceError(spawnError.code === 'ENOENT' ? 'ffmpeg bulunamadı: ffmpeg kurun ya da npm install ffmpeg-static' : `ffmpeg başlatılamadı: ${spawnError.message}`);
            }
            if (code && !track.stopped) throw new VoiceError(`Ses okunamadı (ffmpeg ${code}): ${track.stderr.trim().split('\n').at(-1) ?? ''}`);
        } catch (err) {
            error = err instanceof VoiceError ? err : new VoiceError(err.message);
        } finally {
            proc?.kill('SIGKILL');
            if (this.current === track) this.current = null;
        }
        if (error && !track.stopped) {
            this.#emitError(error);
            throw error;
        }
        this.emit('finish', { stopped: track.stopped });
    }

    /** Çalan parçayı durdurur. */
    stop() {
        const track = this.current;
        if (!track) return false;
        track.stopped = true;
        track.paused = false;
        track.resume?.();
        track.proc?.kill('SIGKILL');
        track.pcm?.destroy?.();
        this.source?.clearQueue();
        this.current = null;
        return true;
    }

    pause() {
        if (!this.current || this.current.paused) return false;
        // Tampondaki ses (en fazla QUEUE_MS) çalınır, sonra besleme durur; devam edince kaldığı yerden sürer.
        this.current.paused = true;
        return true;
    }

    resume() {
        if (!this.current?.paused) return false;
        this.current.paused = false;
        this.current.resume?.();
        this.current.resume = null;
        return true;
    }

    /** Ses seviyesi: 0 sessiz, 1 normal, 2 iki kat. */
    setVolume(volume) {
        const v = Number(volume);
        if (!Number.isFinite(v) || v < 0 || v > 2) throw new VoiceError('Ses seviyesi 0 ile 2 arasında olmalı.');
        this.volume = v;
    }

    /** Kanaldan çıkar ve bağlantıyı kapatır. */
    async disconnect({ notify = true, reason } = {}) {
        if (this.destroyed) return;
        this.destroyed = true;
        this.stop();
        if (this.manager.connections.get(this.guildId) === this) this.manager.connections.delete(this.guildId);
        if (notify) this.manager.sendLeave(this.guildId);
        const room = this.room;
        this.room = null;
        await room?.disconnect().catch(() => {});
        await this.source?.close().catch(() => {});
        this.source = null;
        this.#setStatus(VoiceConnectionStatus.Disconnected);
        this.emit('disconnect', reason);
    }

    async #sendFrame(bytes) {
        const samples = new Int16Array(FRAME_SAMPLES * CHANNELS);
        const aligned = bytes.byteOffset % 2 ? Buffer.from(bytes) : bytes;
        const view = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
        if (this.volume === 1) samples.set(view);
        else for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-32768, Math.min(32767, Math.round(view[i] * this.volume)));
        if (!this.source) return;
        // Gerçek zamanlı besleme: LiveKit kuyruğu QUEUE_MS'yi aşarsa beklenir. Böylece tüm parça bir anda
        // kuyruğa dolmaz; duraklat / durdur hemen etkili olur.
        const queued = this.source.queuedDuration ?? 0;
        if (queued > QUEUE_MS) await new Promise(r => setTimeout(r, queued - QUEUE_MS / 2));
        if (!this.source) return;
        await this.source.captureFrame(new this.lk.AudioFrame(samples, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES));
    }

    #setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.emit('status', status);
    }

    #emitError(err) {
        if (this.listenerCount('error') > 0) this.emit('error', err);
    }
}
