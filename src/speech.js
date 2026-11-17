'use strict';

const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { EdgeTTS } = require('node-edge-tts');
const { generateSecMsGecToken_V2, TRUSTED_CLIENT_TOKEN, SEC_MS_GEC_VERSION_V2, CHROMIUM_FULL_VERSION } = require('node-edge-tts/dist/drm');
const { WebSocket } = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { signed } = require('./settings');
const { spokenText, speechChunks } = require('./text');

// Pin node-edge-tts and use the same Bing endpoint as edge-tts 7.3.1.
// Its public release otherwise connects to a different Edge endpoint.
class CancellableEdgeTTS extends EdgeTTS {
  constructor(options, signal) { super(options); this.signal = signal; }
  async _connectWebSocket() {
    this.signal.throwIfAborted();
    const query = new URLSearchParams({
      TrustedClientToken: TRUSTED_CLIENT_TOKEN,
      ConnectionId: randomBytes(16).toString('hex'),
      'Sec-MS-GEC': generateSecMsGecToken_V2(),
      'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION_V2,
    });
    const socket = new WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${query}`, {
      handshakeTimeout: 20000,
      headers: {
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
      },
      agent: this.proxy ? new HttpsProxyAgent(this.proxy) : undefined,
    });
    const abort = () => socket.terminate();
    this.signal.addEventListener('abort', abort, { once: true });
    socket.once('close', () => this.signal.removeEventListener('abort', abort));
    // ws can emit an error when an in-progress connection is terminated.
    socket.on('error', () => {});
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(socket));
      socket.once('error', () => reject(new Error('Không kết nối được dịch vụ đọc Microsoft.')));
      socket.once('close', () => reject(new Error('Kết nối giọng đọc đã đóng.')));
    });
  }
}

async function requestAudio(text, settings, signal, voice = settings.voice) {
  signal.throwIfAborted();
  const serviceVoice = voice.replace(/^([a-z]{2}-[A-Z]{2})-(.+)$/, 'Microsoft Server Speech Text to Speech Voice ($1, $2)');
  const speech = new CancellableEdgeTTS({
    voice: serviceVoice, lang: voice === 'en-US-EmmaMultilingualNeural' ? 'en-US' : 'vi-VN',
    rate: signed(settings.rate, '%'), pitch: signed(settings.pitch, 'Hz'), volume: '+0%',
    timeout: 45000, proxy: settings.proxy || process.env.HTTPS_PROXY || process.env.https_proxy || undefined,
  }, signal);
  const buffers = [];
  for await (const part of speech.streamAudio(text)) {
    signal.throwIfAborted();
    if (Buffer.isBuffer(part)) buffers.push(part);
  }
  signal.throwIfAborted();
  const audio = Buffer.concat(buffers);
  if (!audio.length) throw new Error('Microsoft chưa trả âm thanh.');
  return { audio, voice };
}

async function synthesize(text, settings, signal, onStatus, request = requestAudio, sleep = delay) {
  const voices = [settings.voice];
  if (settings.fallbackVoice && !voices.includes(settings.fallbackVoice)) voices.push(settings.fallbackVoice);
  for (const voice of voices) {
    for (let attempt = 0; attempt <= settings.retryCount; attempt++) {
      signal.throwIfAborted();
      try { return await request(text, settings, signal, voice); }
      catch {
        signal.throwIfAborted();
        if (attempt < settings.retryCount) {
          onStatus({ state: 'generating', detail: `Đang thử lại giọng đọc (${attempt + 1}/${settings.retryCount})…` });
          await sleep(Math.min(8000, 1000 * 2 ** attempt), undefined, { signal });
        }
      }
    }
    if (voice !== voices.at(-1)) onStatus({ state: 'generating', detail: 'Hoài Mỹ tạm lỗi, đang thử giọng nữ dự phòng…' });
  }
  throw new Error('Dịch vụ Microsoft chưa tạo được âm thanh. Kiểm tra Internet hoặc thử lại sau.');
}

class SpeechQueue {
  constructor({ settings, play, stop, status, error, synth = synthesize }) {
    this.settings = settings; this.play = play; this.stopPlayer = stop;
    this.status = status; this.error = error; this.synth = synth;
    this.jobs = []; this.running = false; this.current = undefined; this.disposed = false;
  }
  enqueue(text, label = 'Phản hồi Codex') {
    if (this.disposed) return;
    this.jobs.push({ text, label });
    void this.pump();
  }
  stop() {
    this.jobs.length = 0;
    this.current?.abort();
    this.stopPlayer();
    this.status({ state: 'idle', detail: 'Đã dừng đọc.' });
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length && !this.disposed) {
        const job = this.jobs.shift();
        this.current = new AbortController();
        const signal = this.current.signal;
        try {
          const text = spokenText(job.text, this.settings().skipCode);
          const chunks = speechChunks(text);
          let activeIndex = 0;
          const prepare = async index => {
            try {
              const result = await this.synth(chunks[index], this.settings(), signal, value => {
                if (index === activeIndex && !signal.aborted) this.status(value);
              });
              return { result };
            } catch (error) {
              // Observe background failures immediately; report when this chunk is due.
              return { error };
            }
          };
          let prepared = chunks.length ? prepare(0) : undefined;
          for (let index = 0; index < chunks.length; index++) {
            activeIndex = index;
            signal.throwIfAborted();
            this.status({ state: 'generating', detail: `Đang tạo giọng · ${index + 1}/${chunks.length}`, text: job.text, label: job.label, voice: this.settings().voice });
            const { result, error } = await prepared;
            signal.throwIfAborted();
            if (error) throw error;
            this.status({ state: 'playing', detail: 'Đang đọc…', voice: result.voice });
            const playback = this.play(result.audio, signal);
            prepared = index + 1 < chunks.length ? prepare(index + 1) : undefined;
            await playback;
          }
          if (!signal.aborted) this.status({ state: 'idle', detail: 'Đã đọc xong.' });
        } catch (error) {
          if (!signal.aborted) this.error(error);
        } finally {
          this.current.abort();
          this.current = undefined;
        }
      }
    } finally { this.running = false; }
  }
  dispose() { this.disposed = true; this.stop(); }
}

module.exports = { requestAudio, synthesize, SpeechQueue };
