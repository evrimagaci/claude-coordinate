---
name: coordinate
description: Coordinate a task with another Claude Code session on this machine — /coordinate <what to coordinate> makes this session run a cross-session dialog to get it done. Also /coordinate list (session table) and /coordinate watch <target> (live view). Use when the user types /coordinate, or asks to hand off / discuss / verify something with another Claude session.
---

# Coordinate — get work done WITH another session

Backed by the CLI **`claude-coordinate`** (`~/.local/bin`; plain `claude` is
untouched). Two delivery paths, tried in order by `send`:

1. **Live channel** (preferred): sessions launched with
   `claude --dangerously-load-development-channels server:coordinate`
   (channel mode is auto-detected from the flag on Linux; macOS needs
   COORDINATE_CHANNEL=1 in the env) run a local channel — the message INJECTS into the
   running TUI instantly (Telegram-style), the session processes it live, and
   its reply streams back via the channel's `reply` tool. Registry of live
   channels: `~/.claude/channels/coordinate/sessions/`.
2. **Transcript resume** (fallback): for sessions without a live channel,
   `send` appends a turn via `claude -p --resume` — full context, but an
   already-open TUI won't display it until reopened.

`list`/`watch` are read-only over the transcripts (`~/.claude/projects/`).

## The main form: `/coordinate <task description>`

The user is telling YOU to coordinate that task with another session. You are
the orchestrator; the other session is a peer with its own context. Workflow:

1. **Pick the target session.** If the prompt names one (project, session-id
   prefix, or an obvious alias like "the orchestrator claude"), use it.
   Otherwise run `claude-coordinate list -n 15` and infer from project paths +
   conversation gists which session owns the task's domain. Ask the user only
   if genuinely ambiguous.
2. **Open the dialog.** Compose a self-contained brief: who you are ("the
   <project> session"), what's needed, acceptance criteria, relevant
   evidence/paths — the peer hasn't seen this conversation. Send it:
   `claude-coordinate send <target> "<brief>"`.
3. **Iterate to completion.** Read the reply; relay follow-ups, answer its
   questions, verify its claims from your side (it may say "done" — check).
   Multi-turn is normal: each `send` resumes the same conversation, so context
   accumulates. A `send` that triggers real work can take many minutes — run it
   in the background and monitor rather than blocking.
4. **Report back** with the outcome, quoting the peer's key statements and
   noting what you verified yourself.

Guardrails:
- `send` refuses targets written to in the last 90 s (mid-turn; concurrent
  writers interleave). Surface it; use `--force` only with explicit user OK.
- A `send` runs the other session's agentic loop — it can execute tools there.
  That's the point, but don't fire destructive asks without the user's intent.
- Keep one writer per session: don't `send` while the user has that session
  open and active.

## Subcommands

- **`/coordinate list`** → `claude-coordinate list -n 15`; present the table
  (ACTIVE = written <90 s ago, open = a claude process sits in that project,
  idle = neither), each with its opening gist.
- **`/coordinate watch <target>`** → show recent turns via
  `claude-coordinate watch <target> --history 8 --no-follow`, then give the
  user the live command for their own terminal:
  `claude-coordinate watch <target>` (Ctrl-C stops; read-only; `--thinking`
  for thinking excerpts) — or `claude-coordinate watch --all` for one
  machine-wide feed of every session's new turns, prefixed by project.
  Never run the following forms yourself — they don't exit. The chat UI
  can't stream, so live viewing belongs in the user's tab.

## Target resolution

Session-id prefix (`5e6880a2`) or project-path substring
(`browser-orchestrator`, `darvin`) — freshest session in that project wins.
Konsole tab names are NOT addressable (no tab→session mapping exists); map a
tab name to its project.
