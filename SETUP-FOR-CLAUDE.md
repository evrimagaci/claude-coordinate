# Setup guide — for a Claude Code agent installing claude-coordinate

You are a Claude Code session and your user asked you to install
**claude-coordinate** (local cross-session coordination). Follow these steps
in order, verify each one, and report what you did. Do not skip the security
review step. Everything here is reversible; the uninstall section is at the
bottom.

## 0. What you are installing (tell your user this first)

Three pieces, all local, no network services:

1. **`claude-coordinate` CLI** → `~/.local/bin/` — list / live-watch / message
   Claude Code sessions on this machine.
2. **`coordinate` MCP channel server** (user-scope registration) — lets
   sessions launched with a special flag receive messages **live in their
   TUI**, like the official Telegram channel but over the local filesystem.
3. **`/coordinate` skill** (optional) → `~/.claude/skills/coordinate/` — lets
   any session orchestrate tasks with peer sessions on command.

Honest caveats to relay to your user:

- Live injection requires launching receiving sessions with
  `--dangerously-load-development-channels server:coordinate` (custom channels
  aren't on Anthropic's allowlist; this flag is the supported local-dev path
  and shows a one-keystroke confirmation at each launch).
- A channel-enabled session can be driven by **any process running as this
  user** — same trust level as the keyboard. Don't enable it on machines
  where other people or untrusted software share this user account.
- The channels API is experimental and may change with Claude Code updates.

## 1. Clone to a stable location

```bash
git clone https://github.com/evrimagaci/claude-coordinate ~/.claude/claude-coordinate
```

(Any stable path works; the MCP registration below stores an absolute path,
so don't use a temp dir.)

## 2. Security review (do not skip)

Read these two files end to end — they are short and dependency-free — and
give your user a 3-5 sentence summary of what they do and confirm you found
nothing beyond what the README promises (local files only; no network code;
replies path-constrained to `/tmp` and the channel state dir):

- `~/.claude/claude-coordinate/coordinate-channel/server.js` (~190 lines)
- `~/.claude/claude-coordinate/bin/claude-coordinate` (~400 lines of Python)

If anything contradicts the README, STOP and show the user.

## 3. Install the CLI

```bash
mkdir -p ~/.local/bin
cp ~/.claude/claude-coordinate/bin/claude-coordinate ~/.local/bin/claude-coordinate
chmod +x ~/.local/bin/claude-coordinate
claude-coordinate list   # verify: prints recent sessions (yours included)
```

If `claude-coordinate` isn't found, `~/.local/bin` isn't on PATH — add it in
the user's shell rc and tell them.

Requirements check: `python3 --version` (3.9+), `node --version` (18+),
Linux or macOS.

## 4. Register the channel server (user scope)

```bash
claude mcp add -s user coordinate -- node ~/.claude/claude-coordinate/coordinate-channel/server.js
```

Use the expanded absolute home path if your `claude mcp add` stores `~`
literally — verify with `claude mcp list` afterwards.

Note: as a plain MCP server this adds one lightweight tool (`reply`) to every
session. The inbox/live machinery only activates in sessions launched with the
channel flag (auto-detected from the launch command on Linux;
on macOS set `COORDINATE_CHANNEL=1` in the launch environment).

## 5. Install the skill (optional but recommended)

```bash
mkdir -p ~/.claude/skills
cp -r ~/.claude/claude-coordinate/skills/coordinate ~/.claude/skills/coordinate
```

New sessions then understand `/coordinate <task>`, `/coordinate list`,
`/coordinate watch <target>`.

## 6. Verify with a sandboxed round-trip (recommended)

Run this yourself; it proves live injection end to end without touching any
real session. Requires `tmux`.

```bash
mkdir -p /tmp/coordinate-selftest && cd /tmp/coordinate-selftest
tmux new-session -d -s coordselftest -x 200 -y 50 \
  "cd /tmp/coordinate-selftest && claude --dangerously-load-development-channels server:coordinate"
# wait for the trust + 'local development' prompts, then accept both:
sleep 8; tmux send-keys -t coordselftest Enter; sleep 6; tmux send-keys -t coordselftest Enter
# wait for the channel registry to appear (up to ~60s):
until ls ~/.claude/channels/coordinate/sessions/*.json >/dev/null 2>&1; do sleep 3; done
# round-trip:
claude-coordinate send coordinate-selftest "Reply via the coordinate reply tool with exactly: CHANNEL OK"
# expect the line: CHANNEL OK
tmux kill-session -t coordselftest
```

If the registry never appears, capture `tmux capture-pane -t coordselftest -p`
and debug from what the session shows (trust prompt? channel warning?).

## 7. Teach the user the launch pattern

For a session to be **live-addressable**, it must be started like this
(suggest they alias it):

```bash
# Linux:
claude --dangerously-load-development-channels server:coordinate
# macOS (no /proc, so flag auto-detection needs the env hint):
COORDINATE_CHANNEL=1 claude --dangerously-load-development-channels server:coordinate
```

zsh users with a `claude` wrapper *function*: prefer an alias/function that
sets the env var inside (a bare `VAR=1 claude` prefix does not propagate
through a zsh function to the real binary).

Composes with other channels, e.g. Telegram:

```bash
claude --channels plugin:telegram@claude-plugins-official \
  --dangerously-load-development-channels server:coordinate
```

Sessions launched normally remain reachable via the transcript-resume
fallback (reply works; it just won't render in an already-open TUI).

## 8. Report

Tell the user: what was installed where, the result of the security review,
the self-test outcome (quote the round-trip reply), the launch pattern, and
the caveats from step 0.

## Uninstall

```bash
claude mcp remove -s user coordinate
rm -f ~/.local/bin/claude-coordinate
rm -rf ~/.claude/skills/coordinate ~/.claude/claude-coordinate ~/.claude/channels/coordinate
```
