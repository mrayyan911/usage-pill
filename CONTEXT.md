# Usage Pill

Usage Pill shows Claude Code and Codex usage while a user has an agent session open.

## Language

**Agent session**:
An interactive Claude Code or Codex CLI session, including time spent waiting for a user prompt, or a scripted agent run such as `codex exec` or `claude -p`. A session ends when the CLI exits; utility commands such as `--help` and `--version` are excluded.
_Avoid_: Turn, activity

**Turn**:
A period in an agent session during which the agent handles a user request. Finishing a turn does not end the session.
_Avoid_: Session

**Shared pill**:
The single usage overlay shared by all open agent sessions, including sessions in different terminals.
_Avoid_: Per-session pill

**Shared pill placement**:
The shared pill's position on a display, including its saved position and its placement while collapsed or expanded.
_Avoid_: Per-session position

**Automatic visibility**:
The pill appearing when an agent session opens, staying visible between turns, and disappearing when the last agent session closes.
_Avoid_: Turn-triggered visibility

**Background monitor**:
The part of Usage Pill that remains running while the pill is hidden and watches for agent sessions.
_Avoid_: Agent session, pill window
