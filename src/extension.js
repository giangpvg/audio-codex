'use strict';

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { loadSettings, validateSetting } = require('./settings');
const { sessionsPath, belongsToWorkspace, SessionWatcher, claimReply } = require('./sessions');
const { SpeechQueue } = require('./speech');
const { VoicePanel } = require('./panel');

async function activate(context) {
  const output = vscode.window.createOutputChannel('Giọng Việt cho Codex');
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 15);
  bar.command = 'codexHoaimy.open';
  const configuration = () => vscode.workspace.getConfiguration('codexHoaimy');
  let settings = loadSettings(configuration());
  let latestReply = '';
  let watcher;
  let watcherGeneration = 0;
  let speech;

  const showError = error => {
    // No conversation text, proxy URL or WebSocket query strings in logs.
    const message = error.message?.startsWith('Dịch vụ Microsoft') || error.message?.startsWith('Không phát')
      ? error.message : 'Không đọc được đoạn này. Kiểm tra cài đặt hoặc thử lại.';
    output.appendLine(`${new Date().toISOString()} ${message}`);
    panel.update({ state: 'error', detail: message });
  };
  const updateSetting = async (key, value) => {
    validateSetting(key, value);
    await configuration().update(key, value, vscode.ConfigurationTarget.Global);
  };
  const playText = (text, label) => { panel.open(); speech.stop(); speech.enqueue(text, label); };
  const test = () => playText('Xin chào bạn. Mình là giọng đọc Hoài Mỹ. Bạn có thể chỉnh tốc độ, cao độ và âm lượng để nghe thoải mái hơn.', 'Nghe thử giọng');
  const replay = () => {
    if (latestReply) playText(latestReply, 'Đọc lại phản hồi Codex');
    else vscode.window.showInformationMessage('Chưa có phản hồi mới để đọc lại. Hãy chat với Codex trước.');
  };
  const panel = new VoicePanel(context, {
    settings: () => settings, setting: updateSetting,
    test, stop: () => speech?.stop(), replay,
    read: text => playText(text, 'Văn bản của bạn'), error: showError,
    folder: async () => {
      const result = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Chọn thư mục sessions' });
      if (result?.[0]) await updateSetting('sessionsDirectory', result[0].fsPath);
    },
    status: state => {
      const busy = ['generating', 'playing', 'paused'].includes(state.state);
      bar.text = `${busy ? '$(unmute)' : settings.enabled ? '$(megaphone)' : '$(mute)'} Giọng Việt`;
      bar.tooltip = `${state.detail}\nBấm để mở bảng điều khiển giọng đọc.`;
    },
  });
  speech = new SpeechQueue({
    settings: () => settings, play: (audio, signal) => panel.play(audio, signal),
    stop: () => panel.stop(), status: state => panel.update(state), error: showError,
  });

  const claims = path.join(context.globalStorageUri.fsPath, 'claims');
  await fs.mkdir(claims, { recursive: true });
  // Claims contain only hashes/timestamps. Expire them without keeping reply history.
  for (const name of await fs.readdir(claims)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const filename = path.join(claims, name);
    try { if (Date.now() - (await fs.stat(filename)).mtimeMs > 7 * 86400000) await fs.unlink(filename); }
    catch (error) { if (error.code !== 'ENOENT') output.appendLine('Không dọn được một dấu chống đọc trùng cũ.'); }
  }

  const restartWatcher = async () => {
    const generation = ++watcherGeneration;
    watcher?.dispose();
    const root = sessionsPath(settings.sessionsDirectory);
    watcher = new SessionWatcher(root, async reply => {
      if (generation !== watcherGeneration) return;
      const folders = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
      if (settings.readScope === 'workspace' && !belongsToWorkspace(reply.cwd, folders)) return;
      latestReply = reply.text;
      if (!settings.enabled || !await claimReply(claims, reply.id)) return;
      panel.open(false);
      speech.enqueue(reply.text);
    }, () => showError(new Error('Không theo dõi được thư mục sessions.')));
    await watcher.start();
    output.appendLine('Đã theo dõi phiên Codex; bỏ qua lịch sử trước lúc bật extension.');
  };

  context.subscriptions.push(output, bar, panel, speech, { dispose: () => { watcherGeneration++; watcher?.dispose(); } });
  for (const [name, handler] of Object.entries({
    open: () => panel.open(), toggle: () => updateSetting('enabled', !settings.enabled),
    test, stop: () => speech.stop(), replay,
    readSelection: () => {
      const editor = vscode.window.activeTextEditor;
      const text = editor?.document.getText(editor.selection);
      if (text?.trim()) playText(text, 'Văn bản đang chọn');
    },
  })) context.subscriptions.push(vscode.commands.registerCommand(`codexHoaimy.${name}`, handler));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
    if (!event.affectsConfiguration('codexHoaimy')) return;
    const previous = settings;
    settings = loadSettings(configuration());
    if (!settings.enabled && previous.enabled) speech.stop();
    panel.update({ voice: settings.voice });
    if (settings.sessionsDirectory !== previous.sessionsDirectory) {
      speech.stop();
      await restartWatcher().catch(showError);
    }
  }));
  panel.update({});
  bar.show();
  await restartWatcher().catch(showError);
  if (!context.globalState.get('welcomeShown')) {
    await context.globalState.update('welcomeShown', true);
    void vscode.window.showInformationMessage('Giọng Việt đã sẵn sàng. Văn bản được đọc sẽ gửi tới Microsoft. Tắt các bộ đọc Codex khác để tránh phát hai giọng.', 'Mở bảng điều khiển', 'Tắt tự đọc').then(choice => {
      if (choice === 'Mở bảng điều khiển') panel.open();
      if (choice === 'Tắt tự đọc') void updateSetting('enabled', false);
    });
  }
  // Expose only non-sensitive runtime state for extension-host validation.
  return { isWatching: () => !!watcher?.running, getSettings: () => ({ ...settings, proxy: '' }) };
}

module.exports = { activate };
