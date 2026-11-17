'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaults, loadSettings, validateSetting } = require('../src/settings');
const { spokenText, speechChunks } = require('../src/text');
const { SessionTail, SessionWatcher, belongsToWorkspace, sessionsPath, claimReply } = require('../src/sessions');
const { synthesize, SpeechQueue } = require('../src/speech');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hoaimy-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'session.jsonl');
  const append = async (payload, type = 'event_msg', timestamp = new Date().toISOString()) => {
    await fs.appendFile(filename, JSON.stringify({ type, timestamp, payload }) + '\n');
  };
  await append({ cwd: '/project', source: 'vscode' }, 'session_meta');
  return { root, filename, append };
}

test('settings reject spoofed keys, non-finite numbers and unsupported voices', () => {
  for (const [key, value] of [['__proto__', {}], ['rate', Infinity], ['rate', 101], ['enabled', 'true'], ['voice', '<voice>'], ['proxy', 'file:///etc/passwd']]) {
    assert.throws(() => validateSetting(key, value));
  }
  assert.equal(validateSetting('pitch', -20), -20);
  assert.equal(loadSettings({ get: (key, fallback) => key === 'volume' ? NaN : fallback }).volume, 100);
});

test('Markdown speaks labels and skips closed and unfinished code fences', () => {
  assert.equal(spokenText('# Xin **chào**\n```py\nsecret()\n```\n[Hướng dẫn](/some/path)\n~~~\nunfinished'), 'Xin chào Hướng dẫn');
  assert.match(spokenText('```\nprint(1)\n```', false), /print\(1\)/);
});

test('speech omits filenames and paths in inline code and Markdown link labels', () => {
  assert.equal(spokenText('Cài lại file `codex-hoaimy/releases/codex-hoaimy-0.1.0.vsix`, rồi chạy **Developer: Reload Window**.'),
    'Cài lại file, rồi chạy Developer: Reload Window.');
  assert.equal(spokenText('Đã sửa [speech.js](./src/speech.js:120), xem [hướng dẫn](./README.md).'),
    'Đã sửa xem hướng dẫn.');
  assert.equal(spokenText('Mở `Mẫu báo cáo.docx` và `src/components` để kiểm tra.'),
    'Mở và để kiểm tra.');
  assert.equal(spokenText('Xem **app.py**, _app.ts_ và `media/` để sửa.'), 'Xem và để sửa.');
});

test('speech omits bare filenames, dotfiles and explicit paths', () => {
  for (const reference of ['app.ts', 'report.pdf', 'src/app.py:12:4', '.env.local', 'README', 'Dockerfile', './src', '../media', '~/sessions', '/tmp/sessions', 'C:\\project\\app.js']) {
    assert.equal(spokenText(`Đã sửa ${reference}, xong.`), 'Đã sửa xong.', reference);
  }
});

test('file filtering preserves prose, commands, numbers and product names', () => {
  const text = 'Dùng Node.js, Next.js và Vue.js phiên bản v1.2.3; mất 2.5 giây, đọc/ghi 10/20 mục.';
  assert.equal(spokenText(text), text);
  assert.equal(spokenText('Chạy `npm test` rồi **Reload Window**.'), 'Chạy npm test rồi Reload Window.');
  assert.equal(spokenText('Xem https://example.com/help và example.com.'), 'Xem liên kết và example.com.');
  assert.equal(spokenText('Sửa `app.js` rồi chạy `npm test`.', false), 'Sửa rồi chạy npm test.');
});

test('chunking preserves words, punctuation and Unicode without excessive requests', () => {
  const text = Array.from({ length: 80 }, () => 'Xin chào bạn. 🌻').join(' ');
  const chunks = speechChunks(text, 130);
  assert.equal(chunks.join(' '), text);
  assert.ok(chunks.every(chunk => chunk.length <= 130));
  assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('workspace matching has directory boundaries and Windows case folding', () => {
  assert.equal(belongsToWorkspace('/project/src', ['/project']), true);
  assert.equal(belongsToWorkspace('/project-other', ['/project']), false);
  assert.equal(belongsToWorkspace('C:\\Work\\App\\src', ['c:\\work\\app'], 'win32'), true);
  assert.equal(belongsToWorkspace('D:\\Work\\App', ['c:\\work\\app'], 'win32'), false);
  assert.equal(belongsToWorkspace('', ['/project']), false);
  assert.equal(sessionsPath('~/custom', {}, '/user'), path.resolve('/user/custom'));
  assert.equal(sessionsPath('', { CODEX_HOME: '/custom' }, '/user'), '/custom/sessions');
});

test('only completed main-session replies are emitted, with no prompts or commentary', async t => {
  const { filename, append } = await fixture(t);
  const tail = new SessionTail(filename); await tail.initialize(false);
  await append({ type: 'user_message', message: 'private prompt' });
  await append({ type: 'agent_message', phase: 'commentary', message: 'working' });
  await append({ role: 'tool', content: 'private output' }, 'response_item');
  await append({ type: 'agent_message', phase: 'final_answer', message: 'Xin chào' });
  assert.deepEqual(await tail.readCompleted(0), []);
  await append({ type: 'task_complete', turn_id: 'one' });
  const replies = await tail.readCompleted(0);
  assert.deepEqual(replies.map(reply => reply.text), ['Xin chào']);
  assert.equal(replies[0].cwd, '/project');
  assert.deepEqual(await tail.readCompleted(0), []);
});

test('initial history and stale records in discovered files are skipped', async t => {
  const { filename, append } = await fixture(t);
  await append({ type: 'task_complete', last_agent_message: 'old' }, 'event_msg', '2020-01-01T00:00:00Z');
  const tail = new SessionTail(filename); await tail.initialize(true);
  assert.deepEqual(await tail.readCompleted(0), []);
  await append({ type: 'task_complete', last_agent_message: 'new' });
  assert.deepEqual((await tail.readCompleted(0)).map(reply => reply.text), ['new']);
  const discovered = new SessionTail(filename); await discovered.initialize(false);
  assert.deepEqual((await discovered.readCompleted(Date.now() - 1000)).map(reply => reply.text), ['new']);
});

test('partial multibyte JSONL records are buffered without duplicate playback', async t => {
  const { filename } = await fixture(t);
  const tail = new SessionTail(filename); await tail.initialize(true);
  const data = Buffer.from(JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_complete', last_agent_message: 'Tiếng Việt' } }) + '\n');
  const cut = data.indexOf(Buffer.from('ế')) + 1;
  await fs.appendFile(filename, data.subarray(0, cut));
  assert.deepEqual(await tail.readCompleted(0), []);
  await fs.appendFile(filename, data.subarray(cut));
  assert.deepEqual((await tail.readCompleted(0)).map(reply => reply.text), ['Tiếng Việt']);
});

test('subagent sessions never become spoken replies', async t => {
  const { filename, append } = await fixture(t);
  await fs.writeFile(filename, '');
  await append({ cwd: '/project', source: { subagent: { parent: 'parent' } } }, 'session_meta');
  await append({ type: 'task_complete', last_agent_message: 'internal answer' });
  const tail = new SessionTail(filename); await tail.initialize(false);
  assert.deepEqual(await tail.readCompleted(0), []);
});

test('atomic claims prevent multiple windows from speaking the same turn', async t => {
  const { root } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => claimReply(path.join(root, 'claims'), 'session:turn')));
  assert.equal(results.filter(Boolean).length, 1);
});

test('watcher sees a completed appended turn and stops cleanly', async t => {
  const { root, append } = await fixture(t);
  const replies = [];
  const watcher = new SessionWatcher(root, reply => replies.push(reply), error => assert.fail(error));
  await watcher.start(); t.after(() => watcher.dispose());
  clearTimeout(watcher.timer);
  await append({ type: 'task_complete', last_agent_message: 'live' });
  await watcher.poll();
  assert.deepEqual(replies.map(reply => reply.text), ['live']);
  watcher.dispose();
  assert.equal(watcher.running, false);
});

test('speech retries transient failures before switching to the configured fallback', async () => {
  const calls = [];
  const request = async (_, __, ___, voice) => {
    calls.push(voice);
    if (voice === defaults.voice) throw new Error('upstream unavailable');
    return { audio: Buffer.from('mp3'), voice };
  };
  const result = await synthesize('hello', { ...defaults, retryCount: 1 }, new AbortController().signal, () => {}, request, async () => {});
  assert.deepEqual(calls, [defaults.voice, defaults.voice, defaults.fallbackVoice]);
  assert.equal(result.voice, defaults.fallbackVoice);
});

test('stop aborts synthesis and clears queued speech without error notifications', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let played = false;
  const queue = new SpeechQueue({
    settings: () => defaults, play: async () => { played = true; }, stop: () => {}, status: () => {},
    error: error => assert.fail(error),
    synth: (_, __, signal) => new Promise((resolve, reject) => {
      started(); signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  queue.enqueue('First'); queue.enqueue('Second');
  await ready; queue.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(played, false); assert.equal(queue.jobs.length, 0); assert.equal(queue.running, false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const flushSpeech = () => new Promise(resolve => setImmediate(resolve));
const longReply = [1, 2, 3].map(value => String(value).repeat(900) + '.').join(' ');

test('speech prepares only one chunk ahead during playback and preserves order', async () => {
  const chunks = speechChunks(longReply);
  const generated = [], played = [], statuses = [];
  const playback = chunks.map(() => deferred());
  const queue = new SpeechQueue({
    settings: () => defaults, stop: () => {}, status: value => statuses.push(value),
    error: error => assert.fail(error),
    synth: async (text, settings, signal, onStatus) => {
      generated.push(text);
      if (generated.length > 1) onStatus({ state: 'generating', detail: 'background retry' });
      return { audio: Buffer.from(text), voice: settings.voice };
    },
    play: audio => { played.push(audio.toString()); return playback[played.length - 1].promise; },
  });
  queue.enqueue(longReply);
  await flushSpeech();
  assert.deepEqual(generated, chunks.slice(0, 2));
  assert.deepEqual(played, chunks.slice(0, 1));
  assert.equal(statuses.at(-1).state, 'playing');
  assert.ok(!statuses.some(value => value.detail === 'background retry'));
  playback[0].resolve(); await flushSpeech();
  assert.deepEqual(generated, chunks);
  assert.deepEqual(played, chunks.slice(0, 2));
  playback[1].resolve(); await flushSpeech();
  assert.deepEqual(played, chunks);
  playback[2].resolve(); await flushSpeech();
  assert.equal(queue.running, false);
  assert.equal(statuses.at(-1).detail, 'Đã đọc xong.');
});

test('stop cancels both playback and the next synthesis without playing queued replies', async () => {
  let generated = 0, played = 0, prefetchSignal;
  const queue = new SpeechQueue({
    settings: () => defaults, stop: () => {}, status: () => {}, error: error => assert.fail(error),
    synth: async (_, settings, signal) => {
      if (++generated === 1) return { audio: Buffer.from('first'), voice: settings.voice };
      prefetchSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    play: (_, signal) => {
      played++;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  queue.enqueue(longReply); queue.enqueue('Queued reply');
  await flushSpeech();
  assert.equal(generated, 2);
  queue.stop(); await flushSpeech();
  assert.equal(prefetchSignal.aborted, true);
  assert.equal(played, 1);
  assert.equal(queue.jobs.length, 0);
  assert.equal(queue.running, false);
});

test('a failed prefetch is handled while the current chunk finishes playing', async () => {
  const playback = deferred();
  const failure = new Error('next synthesis failed');
  const errors = [];
  let generated = 0, played = 0;
  const queue = new SpeechQueue({
    settings: () => defaults, stop: () => {}, status: () => {}, error: error => errors.push(error),
    synth: async (_, settings) => {
      if (++generated > 1) throw failure;
      return { audio: Buffer.from('first'), voice: settings.voice };
    },
    play: () => { played++; return playback.promise; },
  });
  queue.enqueue(longReply); await flushSpeech();
  assert.deepEqual(errors, []);
  assert.equal(played, 1);
  playback.resolve(); await flushSpeech();
  assert.deepEqual(errors, [failure]);
  assert.equal(played, 1);
  assert.equal(queue.running, false);
});

test('a playback failure aborts synthesis of the next chunk', async () => {
  const playback = deferred();
  const failure = new Error('player failed');
  const errors = [];
  let generated = 0, prefetchSignal;
  const queue = new SpeechQueue({
    settings: () => defaults, stop: () => {}, status: () => {}, error: error => errors.push(error),
    synth: async (_, settings, signal) => {
      if (++generated === 1) return { audio: Buffer.from('first'), voice: settings.voice };
      prefetchSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    play: () => playback.promise,
  });
  queue.enqueue(longReply); await flushSpeech();
  playback.reject(failure); await flushSpeech();
  assert.deepEqual(errors, [failure]);
  assert.equal(prefetchSignal.aborted, true);
  assert.equal(queue.running, false);
});
