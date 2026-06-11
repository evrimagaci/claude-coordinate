#!/usr/bin/env node
/**
 * coordinate — local cross-session channel for Claude Code.
 *
 * Same contract as the official Telegram channel (an MCP stdio server pushing
 * `notifications/claude/channel` into the running session) but the transport
 * is the local filesystem, so OTHER Claude sessions on this machine can
 * message THIS session live via the `claude-coordinate` CLI.
 *
 * Wire-up:
 *   claude --channels plugin:coordinate-channel@claude-local-plugins
 *
 * State (all under ~/.claude/channels/coordinate/):
 *   sessions/<claudePid>.json   registry: {pid, cwd, inbox, started} — how
 *                               senders find live sessions (stale = dead pid)
 *   inbox/<claudePid>/*.json    one inbound message per file:
 *                               {id, content, from, reply_to}
 *   replies are written to the sender-provided `reply_to` path (one JSON
 *   line per reply tool call) — the sender polls that file.
 *
 * Dependency-free: speaks newline-delimited JSON-RPC 2.0 on stdio directly.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE = path.join(os.homedir(), '.claude', 'channels', 'coordinate');
const CLAUDE_PID = process.ppid; // the interactive claude process that spawned us
const SESSIONS = path.join(STATE, 'sessions');
const INBOX = path.join(STATE, 'inbox', String(CLAUDE_PID));
const REG = path.join(SESSIONS, `${CLAUDE_PID}.json`);

function claudeCwd() {
  try { return fs.readlinkSync(`/proc/${CLAUDE_PID}/cwd`); } catch { return process.cwd(); }
}

// Inbox/registry only when actually wired as a CHANNEL. The server is also
// installed as a plain user-scope MCP server; in that mode the harness drops
// our notifications, so registering an inbox would make senders believe they
// delivered into a void. Channel mode is auto-detected from the parent claude
// process's command line (it was launched with `…-channels server:coordinate`);
// COORDINATE_CHANNEL=1/0 overrides for platforms without /proc (e.g. macOS,
// where you should launch channel sessions with COORDINATE_CHANNEL=1).
function detectChannelMode() {
  if (process.env.COORDINATE_CHANNEL === '1') return true;
  if (process.env.COORDINATE_CHANNEL === '0') return false;
  try {
    const cmdline = fs.readFileSync(`/proc/${CLAUDE_PID}/cmdline`, 'utf8');
    return cmdline.includes('server:coordinate');
  } catch {
    return false;
  }
}
const IS_CHANNEL = detectChannelMode();
if (IS_CHANNEL) {
  fs.mkdirSync(SESSIONS, { recursive: true, mode: 0o700 });
  fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 });
  fs.writeFileSync(REG, JSON.stringify({
    pid: CLAUDE_PID, serverPid: process.pid, cwd: claudeCwd(),
    inbox: INBOX, started: new Date().toISOString(),
  }, null, 2));
}

function cleanup() {
  try { fs.unlinkSync(REG); } catch {}
  try { fs.rmSync(INBOX, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { cleanup(); process.exit(0); });
}
process.on('unhandledRejection', e => process.stderr.write(`coordinate: unhandled rejection: ${e}\n`));
process.on('uncaughtException', e => process.stderr.write(`coordinate: uncaught exception: ${e}\n`));

// ── JSON-RPC over stdio (newline-delimited) ─────────────────────────────────
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const TOOLS = [{
  name: 'reply',
  description: 'Reply to a coordination message from another Claude session. Pass the reply_to path from the inbound message meta verbatim. Call again for follow-up updates on the same reply_to.',
  inputSchema: {
    type: 'object',
    properties: {
      reply_to: { type: 'string', description: 'the meta.reply_to path of the inbound message' },
      text: { type: 'string', description: 'your reply (plain text)' },
    },
    required: ['reply_to', 'text'],
  },
}];

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      // experimental['claude/channel'] is what makes the harness accept our
      // notifications/claude/channel pushes (without it: "Channel
      // notifications skipped: server did not declare claude/channel
      // capability"). We do NOT declare claude/channel/permission — we don't
      // authenticate senders beyond same-user file permissions.
      capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
      serverInfo: { name: 'coordinate', version: '0.1.0' },
      instructions: 'The sender is another Claude Code session on this machine, reading replies through the coordinate reply tool only — your transcript output never reaches it. Inbound messages carry meta.reply_to; pass it verbatim to the reply tool.',
    }});
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    if (name === 'reply') {
      let out;
      try {
        // Only allow replies into our own state dir or /tmp — the model
        // passes reply_to verbatim from meta, but cap the blast radius.
        const target = path.resolve(String(args.reply_to || ''));
        if (!target.startsWith('/tmp/') && !target.startsWith(STATE)) {
          throw new Error(`reply_to outside allowed dirs: ${target}`);
        }
        fs.appendFileSync(target, JSON.stringify({ text: String(args.text || ''), ts: new Date().toISOString() }) + '\n');
        out = { content: [{ type: 'text', text: 'reply delivered' }] };
      } catch (e) {
        out = { content: [{ type: 'text', text: `reply failed: ${e.message}` }], isError: true };
      }
      send({ jsonrpc: '2.0', id, result: out });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${name}` } });
    }
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else if (id !== undefined) {
    // Any other REQUEST gets an empty result so the client never hangs.
    send({ jsonrpc: '2.0', id, result: {} });
  } // notifications (initialized, cancelled, …) need no response
}

let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { process.stderr.write(`coordinate: bad frame: ${e.message}\n`); }
  }
});
process.stdin.on('end', () => process.exit(0));

// ── Inbox: deliver each message file as a live channel notification ─────────
const seen = new Set();
function drainInbox() {
  let names;
  try { names = fs.readdirSync(INBOX); } catch { return; }
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || seen.has(name)) continue;
    seen.add(name);
    const file = path.join(INBOX, name);
    let m;
    try { m = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { seen.delete(name); continue; } // partially written — retry next tick
    if (!m || typeof m.content !== 'string') { try { fs.unlinkSync(file); } catch {} continue; }
    send({ jsonrpc: '2.0', method: 'notifications/claude/channel', params: {
      content: m.content,
      meta: {
        from: m.from || 'unknown-session',
        msg_id: m.id || name,
        ts: m.ts || new Date().toISOString(),
        ...(m.reply_to ? { reply_to: m.reply_to } : {}),
      },
    }});
    try { fs.unlinkSync(file); } catch {}
  }
}
if (IS_CHANNEL) {
  // fs.watch can drop events on some filesystems; pair it with a slow poll.
  try { fs.watch(INBOX, () => setTimeout(drainInbox, 50)); } catch {}
  setInterval(drainInbox, 2000).unref();
  drainInbox();
  process.stderr.write(`coordinate channel: up for claude pid ${CLAUDE_PID} (${claudeCwd()}), inbox ${INBOX}\n`);
} else {
  process.stderr.write(`coordinate: loaded as plain MCP server (no COORDINATE_CHANNEL=1) — inbox disabled\n`);
}
