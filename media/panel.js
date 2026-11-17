'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let audioContext;
let gain;
let source;
let playbackId;
let resumeAttempt = 0;
let resumeTimer;
let settings = {};

function post(type, extra = {}) { vscode.postMessage({ type, ...extra }); }
function label(key, value) {
  byId(`${key}Value`).textContent = key === 'pitch' ? `${value > 0 ? '+' : ''}${value} Hz` : `${key === 'rate' && value > 0 ? '+' : ''}${value}%`;
}
function stopAudio() {
  resumeAttempt++;
  clearTimeout(resumeTimer);
  if (source) { source.onended = null; source.stop(); source.disconnect(); }
  source = undefined;
  playbackId = undefined;
  byId('pause').disabled = true;
}
function setVolume(value) {
  if (gain) gain.gain.value = Math.max(0, Math.min(1, value / 100));
}
function audioError(id) {
  if (id !== playbackId) return;
  stopAudio();
  post('audioError', { id });
}
async function resumeAudio() {
  if (!source) return;
  const id = playbackId;
  const attempt = ++resumeAttempt;
  clearTimeout(resumeTimer);
  try {
    // A locked AudioContext may leave resume() pending until a real click.
    resumeTimer = setTimeout(() => {
      if (attempt === resumeAttempt && audioContext.state !== 'running') {
        byId('pause').textContent = '▶ Tiếp tục';
        post('blocked', { id });
      }
    }, 200);
    await audioContext.resume();
    if (attempt !== resumeAttempt || id !== playbackId) return;
    byId('pause').textContent = 'Ⅱ Tạm dừng';
    post('resumed', { id });
  } catch (error) {
    if (attempt !== resumeAttempt || id !== playbackId) return;
    if (error.name === 'NotAllowedError') {
      byId('pause').textContent = '▶ Tiếp tục';
      post('blocked', { id });
    } else audioError(id);
  } finally {
    if (attempt === resumeAttempt) clearTimeout(resumeTimer);
  }
}

for (const key of ['rate', 'pitch', 'volume']) {
  byId(key).addEventListener('input', event => {
    label(key, Number(event.target.value));
    if (key === 'volume') setVolume(Number(event.target.value));
  });
  byId(key).addEventListener('change', event => post('setting', { key, value: Number(event.target.value) }));
}
for (const key of ['enabled', 'skipCode']) byId(key).addEventListener('change', event => post('setting', { key, value: event.target.checked }));
for (const key of ['voice', 'readScope']) byId(key).addEventListener('change', event => post('setting', { key, value: event.target.value }));
byId('fallback').addEventListener('change', event => post('setting', { key: 'fallbackVoice', value: event.target.checked ? 'en-US-EmmaMultilingualNeural' : '' }));
for (const [id, key, value] of [['resetRate', 'rate', 0], ['resetPitch', 'pitch', 0]]) byId(id).addEventListener('click', () => post('setting', { key, value }));
for (const type of ['test', 'stop', 'replay', 'settings', 'folder']) byId(type).addEventListener('click', () => post(type));
byId('readCustom').addEventListener('click', () => post('read', { text: byId('customText').value }));
byId('pause').addEventListener('click', async () => {
  if (!source) return;
  if (audioContext.state !== 'running') { void resumeAudio(); return; }
  const id = playbackId;
  try {
    await audioContext.suspend();
    if (id !== playbackId) return;
    byId('pause').textContent = '▶ Tiếp tục';
    post('paused', { id });
  } catch { audioError(id); }
});

window.addEventListener('message', async ({ data: message }) => {
  if (message.type === 'state') {
    settings = message.settings;
    for (const key of ['rate', 'pitch', 'volume']) { byId(key).value = settings[key]; label(key, settings[key]); }
    for (const key of ['enabled', 'skipCode']) byId(key).checked = settings[key];
    for (const key of ['voice', 'readScope']) byId(key).value = settings[key];
    byId('fallback').checked = !!settings.fallbackVoice;
    byId('sessionsPath').textContent = settings.sessionsDirectory || 'Tự động: ~/.codex/sessions';
    setVolume(settings.volume);
    const status = message.status;
    document.body.dataset.state = status.state;
    byId('stateName').textContent = ({ idle: settings.enabled ? 'Tự đọc đang bật' : 'Tự đọc đã tắt', generating: 'Đang tạo giọng', playing: 'Đang đọc', paused: 'Tạm dừng', error: 'Cần kiểm tra' })[status.state] || 'Sẵn sàng';
    byId('detail').textContent = status.detail;
    const activeVoice = status.voice || settings.voice;
    byId('voiceBadge').textContent = ({ 'vi-VN-HoaiMyNeural': 'HOÀI MỸ · NỮ', 'vi-VN-NamMinhNeural': 'NAM MINH · NAM', 'en-US-EmmaMultilingualNeural': 'EMMA · NỮ' })[activeVoice];
    byId('stop').disabled = !['generating', 'playing', 'paused'].includes(status.state);
    if (status.text) byId('transcript').textContent = status.text;
    if (status.label) byId('transcriptLabel').textContent = status.label;
  } else if (message.type === 'play') {
    stopAudio();
    const id = playbackId = message.id;
    try {
      if (!audioContext) {
        audioContext = new AudioContext();
        gain = audioContext.createGain();
        gain.connect(audioContext.destination);
      }
      setVolume(message.volume);
      const bytes = Uint8Array.from(atob(message.audio), char => char.charCodeAt(0));
      const buffer = await audioContext.decodeAudioData(bytes.buffer);
      if (id !== playbackId) return;
      source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => {
        if (id !== playbackId) return;
        stopAudio();
        post('ended', { id });
      };
      source.start();
      byId('pause').disabled = false;
      void resumeAudio();
    } catch { audioError(id); }
  } else if (message.type === 'stop') stopAudio();
});

post('ready');
