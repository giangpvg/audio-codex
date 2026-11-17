'use strict';

const defaults = Object.freeze({
  enabled: true, voice: 'vi-VN-HoaiMyNeural', rate: -5, pitch: 0, volume: 100,
  skipCode: true, readScope: 'workspace', sessionsDirectory: '', retryCount: 3,
  fallbackVoice: 'en-US-EmmaMultilingualNeural', proxy: '',
});
const voices = [defaults.voice, 'vi-VN-NamMinhNeural', 'en-US-EmmaMultilingualNeural'];
const numeric = { rate: [-50, 100], pitch: [-50, 50], volume: [0, 100], retryCount: [0, 5] };

function validateSetting(key, value) {
  if (!Object.hasOwn(defaults, key)) throw new Error('Thuộc tính không được hỗ trợ.');
  if (numeric[key]) {
    const [min, max] = numeric[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Giá trị ${key} phải từ ${min} đến ${max}.`);
  } else if (typeof value !== typeof defaults[key]) throw new Error(`Giá trị ${key} không hợp lệ.`);
  if (key === 'voice' && !voices.includes(value)) throw new Error('Giọng đọc không hợp lệ.');
  if (key === 'fallbackVoice' && !['', defaults.fallbackVoice].includes(value)) throw new Error('Giọng dự phòng không hợp lệ.');
  if (key === 'readScope' && !['workspace', 'all'].includes(value)) throw new Error('Phạm vi đọc không hợp lệ.');
  if (key === 'proxy' && value && !/^https?:\/\//i.test(value)) throw new Error('Proxy cần bắt đầu bằng http:// hoặc https://.');
  return value;
}

function loadSettings(configuration) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    try { return [key, validateSetting(key, configuration.get(key, fallback))]; }
    catch { return [key, fallback]; }
  }));
}

function signed(value, unit) { return `${value >= 0 ? '+' : ''}${value}${unit}`; }
module.exports = { defaults, voices, validateSetting, loadSettings, signed };
