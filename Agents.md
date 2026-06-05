# Agents.md

## Purpose

This file describes how the agent currently works inside Agent Bridge.

Agent Bridge runs a **single workspace agent**. The user selects one
provider/model, chooses a local project folder, sends a task, and the
orchestrator lets that model respond, call workspace tools when appropriate,
read tool results, and continue until it returns a final answer.

The original two-agent planner/coder bridge is a future direction only. Do not
document or implement against that model unless the code is explicitly changed
back to it.

---

## Agent Role

The workspace agent should understand the user's request and act inside the
active project directory.

Responsibilities:

```txt
answer normal questions concisely
plan before implementation work
inspect files when context is needed
modify files through workspace tools in build modes
surface important decisions and uncertainty
stop when the task is done or blocked
```

The agent must not:

```txt
touch files outside the active project workspace
invent provider behavior or tool capabilities
expand scope beyond the user's request without saying so
silently perform destructive actions
hide tool failures
```

---

## System Prompt

The system prompt is built per run by `buildSystemPrompt(projectName,
projectPath, mode)` in `apps/api/src/orchestrator/systemPrompt.ts`.

The prompt always includes the active project context when available. Non-chat
modes include the workspace tool catalog and planning/checklist instructions.
Chat mode intentionally stays lightweight and tells the model not to scan or
modify the workspace unless the user explicitly asks.

---

## Operational Modes

The run's `mode` controls the prompt and permission behavior:

```txt
chat             Lightweight conversation; no proactive workspace work.
plan             Planning only; no file mutation or commands.
accept_edits     Build mode; file edits are applied directly.
ask_permissions  Every tool call requires user approval unless already granted.
auto             Autonomous build mode; still gates dangerous tools.
```

The web UI currently exposes Chat, Build (`accept_edits`), and Plan. Older runs
or API callers may still use `ask_permissions` and `auto`.

---

## Workspace Tools

The agent is offered these tools from `apps/api/src/orchestrator/workspaceTools.ts`:

```txt
write_file(path, content)
edit_file(path, old_string, new_string, replace_all?)
delete_file(path)
read_file(path)
list_directory(path)
create_directory(path)
move_file(source_path, destination_path)
search_files(query, path?)
run_command(command)
fetch_url(url)
update_plan(title, tasks, body?, start_new?)   plan mode only
```

Rules:

```txt
all paths are relative to the active project folder
paths that resolve outside the workspace are rejected
tool failures return JSON, and the model should react to them
prefer read/search/list before editing when context is missing
prefer edit_file for targeted changes to existing files
```

`run_command` and `fetch_url` are dangerous tools. They always route through the
permission flow unless a matching standing grant exists. `update_plan` is
internal bookkeeping only; it does not touch files or network and runs without a
permission prompt.

---

## Permission Flow

When a gated tool call needs approval, the orchestrator pauses:

```txt
1. status becomes "awaiting_permission"
2. a permission_requested event is emitted with a preview
3. the user decides: allow_once | allow_project | allow_always | deny
4. project/global grants are saved in the permissions table
5. deny returns a JSON permission error to the model
```

Standing grants are scoped by tool. `run_command` grants are scoped to the exact
command string; `fetch_url` grants are scoped to the host.

---

## Generation Loop

The orchestrator drives one loop in `Orchestrator.ts`:

```txt
1. build the mode-aware system prompt
2. call the selected provider/model with the current history and tools
3. stream and save assistant output
4. if tool calls are returned, gate/execute/save each tool result
5. append tool results to model history and continue
6. if no tool calls are returned, mark the run done
```

`run()` starts a fresh thread. `continueRun()` replays stored history and
continues the same thread. The loop ends when the model stops calling tools, the
user cancels, or an error occurs.

---

## Safety

The orchestrator enforces:

```txt
workspace path containment
permission gating for dangerous tools and ask_permissions mode
cooperative cancellation between steps
provider timeout (60s per request)
startup cleanup for runs left in active states
error persistence without discarding prior messages
```

Provider secrets stay server-side. The frontend receives only safe provider
metadata.

---

## Done Definition

The current agent system is working when:

```txt
the user can choose one provider/model and one project folder
chat/build/plan modes behave differently and predictably
the agent can read/write workspace files through tools
all filesystem access stays inside the selected workspace
dangerous tools pause for approval and resume correctly
messages, status changes, permissions, and plans stream live and persist
runs can be reopened after restart
provider secrets never reach the browser
```
