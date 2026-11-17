'use strict';

const vscode = require('vscode');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

class VoicePanel {
  constructor(context, callbacks) {
    this.context = context; this.callbacks = callbacks;
    this.state = { state: 'idle', detail: 'Sẵn sàng đọc phản hồi mới.', text: '', label: 'Chưa có phản hồi' };
    this.panel = undefined; this.playback = undefined;
  }

  open(reveal = true) {
    if (this.panel) {
      if (reveal) this.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel('codexHoaimy.player', 'Giọng Việt · Codex',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] });
    this.panel = panel;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    const nonce = randomBytes(24).toString('base64');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.js'));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.css'));
    panel.webview.html = fs.readFileSync(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.html').fsPath, 'utf8')
      .replaceAll('{{NONCE}}', nonce).replaceAll('{{CSP_SOURCE}}', panel.webview.cspSource)
      .replaceAll('{{SCRIPT_URI}}', script.toString()).replaceAll('{{STYLE_URI}}', style.toString());
    panel.webview.onDidReceiveMessage(message => this.receive(message), undefined, this.context.subscriptions);
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.resolveReady?.(false);
      this.callbacks.stop();
    }, undefined, this.context.subscriptions);
  }

  async receive(message) {
    if (!message || typeof message !== 'object') return;
    try {
      switch (message.type) {
        case 'ready': this.resolveReady?.(true); this.update({}); break;
        case 'setting': await this.callbacks.setting(message.key, message.value); break;
        case 'test': this.callbacks.test(); break;
        case 'stop': this.callbacks.stop(); break;
        case 'replay': this.callbacks.replay(); break;
        case 'read':
          if (typeof message.text === 'string' && message.text.length <= 40000 && message.text.trim()) this.callbacks.read(message.text);
          break;
        case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings', 'codexHoaimy'); break;
        case 'folder': await this.callbacks.folder(); break;
        case 'ended': if (message.id === this.playback?.id) this.finishPlayback(); break;
        case 'audioError':
          if (message.id === this.playback?.id) this.finishPlayback(new Error('Không phát được MP3 trong IDE. Hãy thử mở lại bảng điều khiển.'));
          break;
        case 'paused':
          if (message.id === this.playback?.id) this.update({ state: 'paused', detail: 'Đang tạm dừng.' });
          break;
        case 'resumed':
          if (message.id === this.playback?.id) this.update({ state: 'playing', detail: 'Đang đọc…' });
          break;
        case 'blocked':
          if (message.id === this.playback?.id) this.update({ state: 'paused', detail: 'Bấm Tiếp tục một lần để cho phép tự đọc trong phiên này.' });
          break;
      }
    } catch (error) { this.callbacks.error(error); }
  }

  update(value) {
    this.state = { ...this.state, ...value };
    this.panel?.webview.postMessage({ type: 'state', settings: this.callbacks.settings(), status: this.state });
    this.callbacks.status?.(this.state);
  }

  async play(audio, signal) {
    this.open(false);
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Bảng giọng đọc chưa khởi động. Mở lại bảng điều khiển rồi thử lại.')), 15000);
      this.ready.finally(() => clearTimeout(timer));
    });
    const ready = await Promise.race([this.ready, timeout]);
    signal.throwIfAborted();
    if (!ready || !this.panel) throw new Error('Bảng giọng đọc đã đóng.');
    return new Promise((resolve, reject) => {
      const id = randomBytes(12).toString('hex');
      const abort = () => this.finishPlayback(new DOMException('Stopped', 'AbortError'));
      const timer = setTimeout(() => this.finishPlayback(new Error('Phần phát âm thanh đã hết thời gian chờ.')), 30 * 60 * 1000);
      this.playback = { id, resolve, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
      signal.addEventListener('abort', abort, { once: true });
      this.panel.webview.postMessage({ type: 'play', id, audio: audio.toString('base64'), volume: this.callbacks.settings().volume });
    });
  }

  finishPlayback(error) {
    const playback = this.playback;
    if (!playback) return;
    this.playback = undefined;
    playback.cleanup();
    if (error) playback.reject(error); else playback.resolve();
  }

  stop() {
    this.panel?.webview.postMessage({ type: 'stop' });
    this.finishPlayback(new DOMException('Stopped', 'AbortError'));
  }
  dispose() { this.stop(); this.panel?.dispose(); }
}

module.exports = { VoicePanel };
