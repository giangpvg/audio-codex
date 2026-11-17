'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async () => {
  const signalDirectory = process.env.HOAIMY_TEST_SIGNALS;
  try {
    const extension = vscode.extensions.getExtension('local-tools.codex-hoaimy');
    assert.ok(extension, 'Development extension is discoverable');
    const api = await extension.activate();
    assert.ok(api.isWatching(), 'Session watcher starts in the extension host');
    const configuration = vscode.workspace.getConfiguration('codexHoaimy');
    const commands = await vscode.commands.getCommands(true);
    for (const name of ['open', 'test', 'stop', 'toggle', 'replay', 'readSelection']) assert.ok(commands.includes(`codexHoaimy.${name}`));
    await configuration.update('rate', -12, vscode.ConfigurationTarget.Global);
    await configuration.update('pitch', 4, vscode.ConfigurationTarget.Global);
    await configuration.update('volume', 55, vscode.ConfigurationTarget.Global);
    // Configuration notifications arrive asynchronously in the extension host.
    for (let count = 0; count < 50 && api.getSettings().volume !== 55; count++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(api.getSettings().rate, -12);
    assert.equal(api.getSettings().pitch, 4);
    assert.equal(api.getSettings().volume, 55);
    await vscode.commands.executeCommand('codexHoaimy.open');
    await fs.writeFile(path.join(signalDirectory, 'host-ready'), 'ready');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      try {
        const result = await fs.readFile(path.join(signalDirectory, 'ui-result.json'), 'utf8');
        const value = JSON.parse(result);
        assert.equal(value.ok, true, value.error);
        assert.equal(api.getSettings().rate, 18, 'UI slider persists to VS Code settings');
        assert.equal(api.getSettings().pitch, -7, 'UI pitch persists');
        assert.equal(api.getSettings().volume, 64, 'UI volume persists');
        assert.equal(api.getSettings().enabled, true, 'UI toggle controls automatic reading');
        console.log('HOST PASS: activation, watcher, commands, persisted settings, UI and playback');
        return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('UI test did not complete in time');
  } catch (error) {
    await fs.writeFile(path.join(signalDirectory, 'host-error'), String(error.stack));
    throw error;
  }
};
