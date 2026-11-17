'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let audio;
let objectUrl;
let playbackId;
let settings = {};

function post(type, extra = {}) { vscode.postMessage({ type, ...extra }); }
function label(key, value) {
  byId(`${key}Value`).textContent = key === 'pitch' ? `${value > 0 ? '+' : ''}${value} Hz` : `${key === 'rate' && value > 0 ? '+' : ''}${value}%`;
}
function stopAudio() {
  if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
  audio = undefined;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  playbackId = undefined;
  byId('pause').disabled = true;
}
async function resumeAudio() {
  if (!audio) return;
  try {
    await audio.play();
    byId('pause').textContent = 'Ⅱ Tạm dừng';
    post('resumed');
  } catch { byId('pause').textContent = '▶ Tiếp tục'; post('blocked'); }
}

for (const key of ['rate', 'pitch', 'volume']) {
  byId(key).addEventListener('input', event => {
    label(key, Number(event.target.value));
    if (key === 'volume' && audio) audio.volume = Number(event.target.value) / 100;
  });
  byId(key).addEventListener('change', event => post('setting', { key, value: Number(event.target.value) }));
}
for (const key of ['enabled', 'skipCode']) byId(key).addEventListener('change', event => post('setting', { key, value: event.target.checked }));
for (const key of ['voice', 'readScope']) byId(key).addEventListener('change', event => post('setting', { key, value: event.target.value }));
byId('fallback').addEventListener('change', event => post('setting', { key: 'fallbackVoice', value: event.target.checked ? 'en-US-EmmaMultilingualNeural' : '' }));
for (const [id, key, value] of [['resetRate', 'rate', 0], ['resetPitch', 'pitch', 0]]) byId(id).addEventListener('click', () => post('setting', { key, value }));
for (const type of ['test', 'stop', 'replay', 'settings', 'folder']) byId(type).addEventListener('click', () => post(type));
byId('readCustom').addEventListener('click', () => post('read', { text: byId('customText').value }));
byId('pause').addEventListener('click', () => {
  if (!audio) return;
  if (audio.paused) void resumeAudio();
  else { audio.pause(); byId('pause').textContent = '▶ Tiếp tục'; post('paused'); }
});

window.addEventListener('message', async ({ data: message }) => {
  if (message.type === 'state') {
    settings = message.settings;
    for (const key of ['rate', 'pitch', 'volume']) { byId(key).value = settings[key]; label(key, settings[key]); }
    for (const key of ['enabled', 'skipCode']) byId(key).checked = settings[key];
    for (const key of ['voice', 'readScope']) byId(key).value = settings[key];
    byId('fallback').checked = !!settings.fallbackVoice;
    byId('sessionsPath').textContent = settings.sessionsDirectory || 'Tự động: ~/.codex/sessions';
    if (audio) audio.volume = settings.volume / 100;
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
    playbackId = message.id;
    const bytes = Uint8Array.from(atob(message.audio), char => char.charCodeAt(0));
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    audio = new Audio(objectUrl);
    audio.volume = Math.max(0, Math.min(1, message.volume / 100));
    audio.onended = () => { const id = playbackId; stopAudio(); post('ended', { id }); };
    audio.onerror = () => { const id = playbackId; stopAudio(); post('audioError', { id }); };
    byId('pause').disabled = false;
    await resumeAudio();
  } else if (message.type === 'stop') stopAudio();
});

post('ready');
