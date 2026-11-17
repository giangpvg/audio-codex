'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../media/panel.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function player(t, locked = false) {
  const elements = new Map(), contexts = [], messages = [], handlers = {};
  let gesture = false;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { addEventListener(type, callback) { this[type] = callback; } });
    return elements.get(id);
  };
  class AudioContext {
    constructor() {
      this.state = locked ? 'suspended' : 'running';
      this.allowed = !locked; this.pending = []; this.sources = [];
      contexts.push(this);
    }
    createGain() { return this.gain = { gain: { value: 1 }, connect() {} }; }
    async decodeAudioData(data) { return data; }
    createBufferSource() {
      const source = { connect() {}, start() { this.started = true; },
        stop() { this.stopped = true; }, disconnect() { this.disconnected = true; } };
      this.sources.push(source);
      return source;
    }
    resume() {
      if (gesture) this.allowed = true;
      if (!this.allowed) return new Promise(resolve => this.pending.push(resolve));
      this.state = 'running';
      for (const resolve of this.pending.splice(0)) resolve();
      return Promise.resolve();
    }
    async suspend() { this.state = 'suspended'; }
  }
  const context = vm.createContext({
    AudioContext, Uint8Array, setTimeout, clearTimeout,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }),
    document: { getElementById: element, body: { dataset: {} } },
    window: { addEventListener: (type, callback) => { handlers[type] = callback; } },
  });
  vm.runInContext(script, context);
  const send = data => handlers.message({ data });
  const play = id => send({ type: 'play', id, audio: Buffer.from('audio').toString('base64'), volume: 70 });
  const click = async id => {
    gesture = true;
    try { await element(id).click(); } finally { gesture = false; }
    await flush();
  };
  t.after(() => send({ type: 'stop' }));
  return { contexts, messages, element, send, play, click };
}

test('one permission click unlocks subsequent chunks, replies and playback after stop', async t => {
  const p = player(t, true);
  const first = p.play('first');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(p.messages.at(-1).type, 'blocked');
  assert.equal(p.messages.at(-1).id, 'first');
  await p.click('pause'); await first;
  assert.equal(p.messages.at(-1).type, 'resumed');
  const context = p.contexts[0];
  context.sources[0].onended();
  assert.equal(p.messages.at(-1).type, 'ended');
  assert.equal(context.sources[0].disconnected, true);
  await p.play('next-chunk');
  context.sources[1].onended();
  await p.play('next-reply');
  await p.send({ type: 'stop' });
  await p.play('after-stop'); await flush();
  assert.equal(p.contexts.length, 1);
  assert.equal(p.messages.filter(message => message.type === 'blocked').length, 1);
  assert.equal(p.messages.at(-1).type, 'resumed');
  assert.equal(p.messages.at(-1).id, 'after-stop');
});

test('pause, resume and volume affect the current source without losing permission', async t => {
  const p = player(t);
  await p.play('reply');
  const context = p.contexts[0];
  assert.equal(context.gain.gain.value, 0.7);
  await p.click('pause');
  assert.equal(context.state, 'suspended');
  assert.equal(p.messages.at(-1).type, 'paused');
  await p.click('pause');
  assert.equal(context.state, 'running');
  assert.equal(p.messages.at(-1).type, 'resumed');
  p.element('volume').input({ target: { value: '25' } });
  assert.equal(context.gain.gain.value, 0.25);
  assert.equal(context.sources.length, 1);
});

test('a canceled decode cannot play or report an error against a newer reply', async t => {
  const p = player(t);
  await p.play('initial');
  const context = p.contexts[0];
  let reject;
  context.decodeAudioData = () => new Promise((resolve, fail) => { reject = fail; });
  const stale = p.play('stale');
  await p.send({ type: 'stop' });
  context.decodeAudioData = async data => data;
  await p.play('new');
  reject(new Error('old decode failed')); await stale;
  assert.equal(context.sources.length, 2);
  assert.equal(p.messages.at(-1).type, 'resumed');
  assert.equal(p.messages.at(-1).id, 'new');
  assert.ok(!p.messages.some(message => message.type === 'audioError'));
});

test('invalid audio is reported as a playback error instead of an autoplay block', async t => {
  const p = player(t);
  await p.play('initial');
  p.contexts[0].decodeAudioData = async () => { throw new Error('invalid audio'); };
  await p.play('invalid');
  assert.equal(p.messages.at(-1).type, 'audioError');
  assert.equal(p.messages.at(-1).id, 'invalid');
  assert.equal(p.element('pause').disabled, true);
  assert.ok(!p.messages.some(message => message.type === 'blocked'));
});

test('a canceled permission request cannot change the state of a newer reply', async t => {
  const p = player(t, true);
  await p.play('canceled');
  await p.send({ type: 'stop' });
  p.contexts[0].allowed = true;
  await p.play('current'); await flush();
  assert.equal(p.messages.filter(message => message.type === 'resumed').length, 1);
  assert.equal(p.messages.at(-1).id, 'current');
  assert.ok(!p.messages.some(message => message.type === 'blocked'));
});
