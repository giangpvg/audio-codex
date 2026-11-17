'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

function sessionsPath(configured, environment = process.env, home = os.homedir()) {
  if (configured) return path.resolve(configured.replace(/^~(?=[/\\]|$)/, home));
  return path.join(environment.CODEX_HOME || path.join(home, '.codex'), 'sessions');
}

function belongsToWorkspace(cwd, folders, platform = process.platform) {
  if (!cwd) return false;
  const paths = platform === 'win32' ? path.win32 : path;
  const normalize = value => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  return folders.some(folder => {
    const relative = paths.relative(normalize(folder), normalize(cwd));
    return relative === '' || (!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative));
  });
}

async function sessionFiles(root, depth = 0) {
  if (depth > 5) return [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sessionFiles(filename, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(filename);
  }
  return files;
}

class SessionTail {
  constructor(filename) {
    this.filename = filename;
    this.offset = 0;
    this.carry = Buffer.alloc(0);
    this.cwd = '';
    this.hasMetadata = false;
    this.isSubagent = false;
    this.pendingFinal = '';
  }

  metadata(record) {
    if (record.type === 'session_meta') {
      this.hasMetadata = true;
      this.cwd = record.payload?.cwd || '';
      const source = record.payload?.source;
      this.isSubagent = !!source && typeof source === 'object' && JSON.stringify(source).includes('"subagent"');
    }
  }

  async initialize(skipExisting) {
    const handle = await fs.open(this.filename, 'r');
    try {
      const initialSize = (await handle.stat()).size;
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(Math.min(initialSize, 1024 * 1024)), 0, Math.min(initialSize, 1024 * 1024), 0);
      const first = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
      try { this.metadata(JSON.parse(first)); } catch { /* The writer may still be creating this file. */ }
      if (skipExisting) this.offset = initialSize;
    } finally { await handle.close(); }
  }

  async readCompleted(since) {
    const replies = [];
    const stat = await fs.stat(this.filename);
    if (stat.size < this.offset) {
      this.offset = 0; this.carry = Buffer.alloc(0); this.pendingFinal = '';
      this.hasMetadata = false; this.cwd = ''; this.isSubagent = false;
    }
    if (stat.size === this.offset) return replies;
    const handle = await fs.open(this.filename, 'r');
    try {
      while (this.offset < stat.size) {
        const buffer = Buffer.alloc(Math.min(stat.size - this.offset, 1024 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.carry = Buffer.concat([this.carry, buffer.subarray(0, bytesRead)]);
        let newline;
        let consumed = 0;
        while ((newline = this.carry.indexOf(10, consumed)) !== -1) {
          const line = this.carry.subarray(consumed, newline).toString('utf8');
          consumed = newline + 1;
          let record;
          try { record = JSON.parse(line); } catch { continue; }
          const reply = this.accept(record, since);
          if (reply) replies.push(reply);
        }
        this.carry = Buffer.from(this.carry.subarray(consumed));
      }
    } finally { await handle.close(); }
    return replies;
  }

  accept(record, since) {
    this.metadata(record);
    if (!this.hasMetadata || this.isSubagent || record.type !== 'event_msg') return;
    const payload = record.payload || {};
    if (payload.type === 'task_started') this.pendingFinal = '';
    if (payload.type === 'agent_message' && payload.phase === 'final_answer') this.pendingFinal = payload.message || '';
    if (payload.type !== 'task_complete') return;
    const text = payload.last_agent_message || this.pendingFinal;
    this.pendingFinal = '';
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < since || typeof text !== 'string' || !text.trim()) return;
    return { id: `${this.filename}:${payload.turn_id || record.timestamp}`, text, cwd: this.cwd };
  }
}

class SessionWatcher {
  constructor(root, onReply, onError) {
    this.root = root; this.onReply = onReply; this.onError = onError;
    this.tails = new Map(); this.running = false; this.timer = undefined;
  }
  async start() {
    this.running = true;
    this.since = Date.now();
    for (const filename of await sessionFiles(this.root)) {
      if (!this.running) return;
      try {
        const tail = new SessionTail(filename);
        await tail.initialize(true);
        this.tails.set(filename, tail);
      } catch (error) { if (error.code !== 'ENOENT') this.onError(error); }
    }
    if (this.running) this.timer = setTimeout(() => this.poll(), 1000);
  }
  async poll() {
    try {
      for (const filename of await sessionFiles(this.root)) {
        if (!this.running) return;
        try {
          if (!this.tails.has(filename)) {
            const tail = new SessionTail(filename);
            await tail.initialize(false);
            this.tails.set(filename, tail);
          }
          for (const reply of await this.tails.get(filename).readCompleted(this.since)) {
            if (this.running) await this.onReply(reply);
          }
        } catch (error) {
          if (error.code === 'ENOENT') this.tails.delete(filename);
          else this.onError(error);
        }
      }
    } catch (error) { this.onError(error); }
    finally { if (this.running) this.timer = setTimeout(() => this.poll(), 1000); }
  }
  dispose() { this.running = false; clearTimeout(this.timer); }
}

async function claimReply(directory, id) {
  await fs.mkdir(directory, { recursive: true });
  const name = createHash('sha256').update(id).digest('hex');
  try {
    const handle = await fs.open(path.join(directory, name), 'wx', 0o600);
    try { await handle.writeFile(String(Date.now())); } finally { await handle.close(); }
    return true;
  } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

module.exports = { sessionsPath, belongsToWorkspace, sessionFiles, SessionTail, SessionWatcher, claimReply };
