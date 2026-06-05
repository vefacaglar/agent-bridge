# Agents.md

## Purpose

This file defines how the AI agent works inside the Agent Bridge project.

Agent Bridge currently runs a **single workspace agent**: one provider/model
chosen by the user, given a task, operating inside a selected local project
folder. The agent reasons, optionally calls workspace filesystem tools, reads
the results, and continues until it produces a final answer.

> A two-agent planner/coder bridge was the original concept and is documented
> only as a future direction. The sections below describe the agent that
> actually exists.

---

## Agent Role

The workspace agent is responsible for understanding a task and carrying it out
inside the active project directory.

Responsibilities:

```txt
understand the user's task
plan the work (wrap planning in <plan>...</plan> tags)
read existing files when context is needed
write or modify files via workspace tools
explain what it did and surface important decisions
```

The agent must not:

```txt
touch files outside the active project workspace
run terminal commands or git operations (not available)
invent provider behavior or tool capabilities it does not have
expand scope beyond the user's request without saying so
silently perform destructive actions
```

---

## System Prompt

The system prompt is built per-run by `buildSystemPrompt(projectName,
projectPath, mode)` in `apps/api/src/orchestrator/systemPrompt.ts`.

It always instructs the agent to:

```txt
- outline a plan first, wrapped in <plan>...</plan> tags
- wrap code changes in fenced markdown code blocks
- treat the given project folder as its workspace
```

It then appends mode-specific guidance and the active project context.

---

## Operational Modes

The run's `mode` decides how freely the agent may act:

```txt
plan             Planning and explanation only. Do NOT write/delete files.
accept_edits     May call tools; edits are applied directly. (default)
ask_permissions  Each tool call must be approved by the user first.
auto             Autonomous; calls tools freely to finish the task.
```

In `plan` mode the agent should describe needed changes in text and ask the
user to switch to a build mode instead of calling write/delete tools.

---

## Workspace Tools

The agent is offered these tools (defined in `workspaceTools.ts`):

```txt
write_file(path, content)    create or overwrite a file
delete_file(path)            delete a file
read_file(path)              read a file's contents
list_directory(path)         list a directory ('' or '.' = workspace root)
```

Rules:

```txt
all paths are relative to the active project folder
paths that resolve outside the workspace are rejected
tool failures come back as JSON { success: false, error } — react to them
prefer read_file / list_directory to understand context before editing
```

---

## Permission Flow (ask_permissions mode)

When a tool call is attempted in `ask_permissions` mode and no standing
permission exists, the orchestrator pauses:

```txt
1. status becomes "awaiting_permission"
2. a permission_requested event is emitted to the UI
3. the user responds with one decision:
     allow_once | allow_project | allow_always | deny
4. allow_project / allow_always are persisted in the permissions table
5. deny returns a permission error to the agent (the run continues)
```

A standing project/global permission skips the prompt on later calls.

---

## Generation Loop

The orchestrator drives one shared loop (`drive()` in `Orchestrator.ts`):

```txt
1. build the mode-aware system prompt
2. call the model with the workspace tools available
3. if the model returns tool calls:
     - save the assistant message (with raw tool calls)
     - for each call: gate by mode/permissions, execute, save the tool result
     - loop again with the tool results appended
4. if the model returns no tool calls:
     - save the final assistant message and finish (status "done")
```

`run()` starts a fresh thread; `continueRun()` replays stored history and
continues it. There is no fixed round limit — the loop ends when the model
stops calling tools, the user cancels, or an error occurs.

---

## Loop Control & Safety

The orchestrator enforces:

```txt
cooperative cancellation (checkCancelled between steps)
provider timeout (60s per request)
permission gating in ask_permissions mode
workspace path containment for every tool call
failure handling that preserves prior messages
```

Cancelling a run also resolves any pending permission request so the loop can
unwind cleanly. Errors are saved to the run's `error_message`; previous
messages are never discarded.

---

## Message Passing

Every message is persisted and streamed over SSE. The model receives, in order:

```txt
system prompt (mode + project context)
the original user task
the full prior conversation (assistant text, tool calls, tool results)
any new user follow-up (on continueRun)
```

For MVP the full history is sent each turn. Summarization of long histories is
a future improvement, not a current requirement.

---

## Agent Output Guidelines

Prefer:

```txt
a short <plan> before doing work
concrete file edits via tools
clear explanations of what changed and why
complete, copy-pasteable code blocks when code is requested
```

Avoid:

```txt
long generic theory
scope expansion
fake certainty about tools or provider behavior
editing files the user did not ask about
```

---

## Provider Notes

Supported provider types:

```txt
openai-compatible   (OpenAI, OpenCode, CommandCode, ... — tools/tool_calls)
anthropic           (Messages API — tool_use/tool_result blocks)
```

Provider-specific request/response details live inside the adapters, never in
the orchestrator. Both adapters support the workspace tools: the orchestrator
passes one OpenAI-shaped tool list, and each adapter maps it to/from its own
wire format, returning the common `ToolCall` shape.

---

## Done Definition

The agent system is working when:

```txt
the user can pick one provider/model and a project folder
the agent plans, then reads/writes files via workspace tools
all file access stays inside the active workspace
ask_permissions mode pauses for approval and resumes correctly
every message and status change streams live and is saved
runs can be reopened after restart
no provider secrets ever reach the browser
```
