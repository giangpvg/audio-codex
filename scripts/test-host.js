'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await wait(150); }
  throw new Error('Timed out waiting for test state');
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const extensionDirectory = process.env.HOAIMY_TEST_EXTENSION || root;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hoaimy-host-'));
  const profile = path.join(temporary, 'profile');
  const workspace = path.join(temporary, 'workspace');
  const sessions = path.join(temporary, 'sessions');
  await Promise.all([fs.mkdir(path.join(profile, 'User'), { recursive: true }), fs.mkdir(workspace), fs.mkdir(sessions)]);
  await fs.writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'codexHoaimy.enabled': false, 'codexHoaimy.sessionsDirectory': sessions,
    'codexHoaimy.retryCount': 1, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off',
    'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
    'window.titleBarStyle': 'custom',
  }));
  const port = await freePort();
  const environment = { ...process.env, HOAIMY_TEST_SIGNALS: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  const executable = process.env.VSCODE_EXECUTABLE || '/usr/share/code/code';
  const child = spawn(executable, [
    '--no-sandbox', '--disable-gpu', '--disable-extensions', '--skip-welcome', '--skip-release-notes',
    '--disable-workspace-trust', `--user-data-dir=${profile}`, `--extensions-dir=${path.join(temporary, 'extensions')}`,
    `--extensionDevelopmentPath=${extensionDirectory}`, `--extensionTestsPath=${path.join(root, 'test', 'host')}`,
    `--remote-debugging-port=${port}`, workspace,
  ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', data => { logs.push(data.toString()); if (data.toString().includes('HOST PASS')) process.stdout.write(data); });
  child.stderr.on('data', data => logs.push(data.toString()));
  let browser;
  let frame;
  try {
    await waitFor(async () => {
      try { return await fs.stat(path.join(temporary, 'host-ready')); }
      catch { if (child.exitCode !== null) throw new Error(`VS Code exited early: ${logs.join('').slice(-5000)}`); return false; }
    }, 45000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    frame = await waitFor(async () => {
      for (const context of browser.contexts()) for (const page of context.pages()) for (const candidate of page.frames()) {
        try { if (await candidate.locator('#rate').count()) return candidate; } catch { /* Frame is still loading. */ }
      }
    });
    assert.equal(await frame.locator('#rate').inputValue(), '-12');
    assert.equal(await frame.locator('#pitch').inputValue(), '4');
    assert.equal(await frame.locator('#volume').inputValue(), '55');
    for (const [key, value] of [['rate', '18'], ['pitch', '-7'], ['volume', '64']]) {
      await frame.locator(`#${key}`).evaluate((element, value) => {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await wait(250);
    }
    await frame.locator('#enabled').check();
    await waitFor(async () => (await fs.readFile(path.join(profile, 'User', 'settings.json'), 'utf8')).includes('"codexHoaimy.enabled": true'));
    // A genuine appended completion exercises watcher -> synthesis -> webview audio.
    const session = path.join(sessions, 'test.jsonl');
    const record = (type, payload) => JSON.stringify({ type, payload, timestamp: new Date().toISOString() }) + '\n';
    await fs.writeFile(session, record('session_meta', { cwd: workspace, source: 'vscode' }) +
      record('event_msg', { type: 'agent_message', phase: 'commentary', message: 'Do not speak commentary' }) +
      record('event_msg', { type: 'task_complete', turn_id: 'ui-test', last_agent_message: 'Xin chào bạn. Extension giọng Việt đã sẵn sàng.' }));
    await frame.locator('#transcript').filter({ hasText: 'Extension giọng Việt đã sẵn sàng.' }).waitFor({ timeout: 15000 });
    await waitFor(async () => frame.evaluate(() => document.body.dataset.state === 'playing' || document.body.dataset.state === 'paused'), 120000);
    if (await frame.evaluate(() => document.body.dataset.state === 'paused')) {
      await frame.locator('#pause').click();
      await waitFor(async () => frame.evaluate(() => document.body.dataset.state === 'playing'));
    }
    await frame.locator('#pause').click();
    await waitFor(async () => frame.evaluate(() => document.body.dataset.state === 'paused'));
    await frame.locator('#pause').click();
    await waitFor(async () => frame.evaluate(() => document.body.dataset.state === 'playing'));
    await frame.locator('main').screenshot({ path: path.join(root, 'releases', 'extension-preview.png') });
    await waitFor(async () => (await frame.locator('#detail').innerText()) === 'Đã đọc xong.', 45000);
    // Verify code/content cannot inject markup into the transcript panel.
    await frame.locator('#customText').fill('<img src=x onerror=alert(1)>');
    assert.equal(await frame.locator('#customText').inputValue(), '<img src=x onerror=alert(1)>');
    await fs.writeFile(path.join(temporary, 'ui-result.json'), JSON.stringify({ ok: true }));
    await waitFor(() => child.exitCode !== null, 15000);
    assert.equal(child.exitCode, 0, logs.join('').slice(-5000));
    console.log('UI PASS: sliders, auto-read toggle, session detection, MP3 playback, pause/resume, screenshot');
    console.log(`Screenshot: ${path.join(root, 'releases', 'extension-preview.png')}`);
  } catch (error) {
    if (frame) await frame.page().screenshot({ path: path.join(root, 'releases', 'test-failure.png') }).catch(() => {});
    await fs.writeFile(path.join(temporary, 'ui-result.json'), JSON.stringify({ ok: false, error: error.message }));
    console.error(logs.join('').slice(-6000));
    console.error(`Diagnostic profile: ${temporary}`);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
