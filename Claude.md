# Claude.md

## Project

Agent Bridge is a local-first AI orchestration tool. The user picks one provider
and model, gives it a task, and the assistant works inside a selected project
folder on the local machine.

The current implementation is a **single-model workspace assistant** with
filesystem tools and explicit permission modes:

```txt
User Task
  -> Orchestrator creates a run
  -> Model generates a response (optionally calling workspace tools)
  -> Tool calls are gated by the active mode / permissions
  -> Tool results are fed back to the model
  -> Loop until the model returns a final answer with no tool calls
  -> Run is marked done; messages are streamed live and saved
```

> The original Agent Bridge vision was a two-model planner → coder → review
> bridge. That is **not** what the code does today; it is a possible future
> direction (see "Future Features"). Document and build against the
> single-model reality described here.

---

## Tech Stack

```txt
Frontend: Vue 3 + Vite + TypeScript (Composition API, <script setup>)
Backend:  Node.js + TypeScript + Fastify
Database: SQLite via the built-in node:sqlite module
Realtime: SSE (Server-Sent Events)
Package manager: pnpm (workspaces)
Repository style: monorepo
```

---

## Repository Structure

```txt
apps/
  api/                         Fastify backend
    src/
      server.ts                Bootstrap only: Fastify + CORS + listen
      context.ts               Shared dependencies (registry, repos, orchestrator)
      routes/
        index.ts               Registers all route groups + /ping
        providers.ts           Provider metadata/config/test/model-fetch routes
        projects.ts            CRUD + macOS folder picker
        runs.ts                Create/continue/cancel/permission/list/SSE
        permissions.ts         List/revoke standing tool permissions
      orchestrator/
        Orchestrator.ts        Run lifecycle + shared generation loop (drive)
        workspaceTools.ts      Tool schemas + executeWorkspaceTool (fs access)
        systemPrompt.ts        buildSystemPrompt (mode-aware)
        eventBus.ts            EventEmitter used for SSE fan-out
      providers/
        ModelProvider.ts       complete() interface
        OpenAICompatibleProvider.ts
        AnthropicProvider.ts
        ProviderFactory.ts     type -> adapter
        ProviderRegistry.ts    loads providers.local.json, exposes safe metadata
      database/
        db.ts                  Connection + schema + migrations + startup cleanup
        repositories.ts        RunRepository, MessageRepository, ProjectRepository

  web/                         Vue frontend
    src/
      App.vue                  Thin shell: wires useAppShell to components
      main.ts
      api/client.ts            Typed fetch wrappers for every endpoint
      composables/
        useAppShell.ts         Composes the other composables + lifecycle
        useChatSession.ts      Runs/messages/SSE/send/continue/cancel/permission
        useProjects.ts         Project list + active project + add/remove flow
        usePermissions.ts      Standing-permissions list + settings modal
        useComposerSettings.ts Mode / model settings (persisted to localStorage)
        useChatAutoScroll.ts   Scroll-to-bottom watchers
      lib/                     Pure helpers (no state)
        markdown.ts            Marked setup + renderMarkdown + cleanMessageContent
        format.ts              Time/status/json formatting, splitCombined, constants
        messageGroups.ts       Groups flat messages into renderable blocks
        confirmation.ts        Yes/no detection + permission path helpers
      components/
        AppSidebar.vue         Projects accordion + chat history
        MessageThread.vue      Message list (user / assistant / tool groups)
        ToolGroup.vue          Collapsible tool-call/response block
        ChatComposer.vue       Input + mode menu + model menu + cards
        ConfirmationCard.vue   Inline yes/no quick reply
        PermissionCard.vue     Inline tool permission request (diff + options)
        AddProjectModal.vue
        settings/              Provider and permission settings screens

packages/
  shared/src/index.ts          Shared TS contracts (Run, RunMessage, events, ...)

providers.example.json         Template (committed)
providers.local.json           Real credentials (git-ignored, never committed)
agent-bridge.db                Local SQLite file (git-ignored)
```

---

## Core Principles

Keep the architecture simple. No heavy agent frameworks.

Prefer readable code over clever abstractions. Keep functions small and
purpose-driven. Avoid premature abstraction.

Backend layering: `routes` (HTTP) -> `orchestrator` / `repositories` /
`registry` (logic) -> `database` / `providers` (I/O). Routes never contain
provider-specific or SQL-heavy logic directly.

Frontend layering: `App.vue` (view) -> `useAppShell` (coordination) ->
domain composables -> `api/` + `lib/` (pure infrastructure). Components are
presentational and communicate via props/emits.

---

## Provider Configuration

Provider credentials are read from local, git-ignored config:

```txt
providers.example.json   (template, committed)
providers.local.json     (real keys, never committed)
```

The backend may read API keys. The frontend must never receive them.

`GET /api/providers` returns only safe metadata:

```txt
id, displayName, type, models
```

Never expose `apiKey`, authorization headers, or raw secrets to the browser.

Optionally, `providers.local.json` may also define an `agentPresets` block: named
dual-model pairings (an **architect** model + a **coder** model + `maxSubAgents`).
`GET /api/agent-presets` returns this as safe metadata (only provider ids + model
names, already public). `PUT /api/agent-presets` saves the full set back via
`ProviderRegistry.saveAgentPresets`. See "Dual-Model Agent Presets" below.

---

## Provider Adapter Rules

Use the adapter pattern. The orchestrator must not know provider-specific
request formats — it only calls `complete(request)`.

```ts
export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
```

Adapters:

```txt
OpenAICompatibleProvider   /chat/completions, OpenAI tools/tool_calls shape
AnthropicProvider          /v1/messages, tool_use/tool_result blocks
```

OpenAI-compatible providers (OpenAI, OpenCode, CommandCode, etc.) share
`OpenAICompatibleProvider`. Anthropic uses its own adapter because the
Messages API differs.

Both adapters support workspace tools. The orchestrator always passes the
OpenAI-shaped `WORKSPACE_TOOLS`; each adapter maps to/from its own wire format
so the orchestrator only ever sees the common `ToolCall` shape. The Anthropic
adapter converts tool definitions to `input_schema`, assistant tool calls to
`tool_use` blocks, and tool results to `tool_result` blocks on a user turn.

---

## Orchestrator Rules

The orchestrator (`Orchestrator.ts`) owns a single-model conversation loop.

It should:

```txt
load the run
build a mode-aware system prompt (systemPrompt.ts)
call the model with WORKSPACE_TOOLS available
if the model returns tool calls:
  gate each call by mode/permissions, execute it, feed the result back
otherwise:
  save the final assistant message and finish
stream every state change and message over SSE
```

`run()` starts a fresh run; `continueRun()` replays persisted history and
continues the same thread. Both share one private `drive()` loop — do not
re-introduce duplicated tool-execution code across the two paths.

The loop terminates when the model responds with no tool calls, on
cancellation, or on error. Cancellation is cooperative (`checkCancelled`) and
also resolves any pending permission request so the loop can unwind.

---

## Operational Modes

The run's `mode` shapes the system prompt and tool gating:

```txt
chat             Lightweight conversation; no proactive workspace work.
plan             Discuss/plan only; do not write files.
accept_edits     May call tools; edits applied directly.
ask_permissions  Each tool call requires explicit user approval first.
auto             Autonomous build mode; still gates dangerous tools.
```

The web UI exposes three modes: **Chat**, **Build** (the `accept_edits` backend
mode — applies edits directly) and **Plan**. `ask_permissions` / `auto` remain
valid backend modes (e.g. for older persisted runs and the permission flow) but
are no longer offered in the mode picker.

**Chat** mode is a lightweight conversational mode: `buildSystemPrompt` returns
a short prompt with no tool catalog or planning scaffolding, and the model is
told not to proactively scan/read/modify the workspace (only on explicit
request). This keeps casual chats cheap on context. Build/Plan keep the full
prompt. The picker defaults to Chat for new sessions.

In **plan mode** the model records a structured, chat-specific plan via the
`update_plan` tool (see Workspace Tools / Plan Panel below). That plan is a
*stable document* shown in the right-hand panel — it is created once and only
changes on an explicit revision request. Live progress is tracked separately by
the text `<task_list>` block the model re-emits in each message (all modes),
which the web UI pins above the composer. So the panel = the fixed plan; the
pinned bar = the live, per-message checklist. They are independent.

`run_command` and `fetch_url` always pause for approval unless a matching
standing grant exists. In `ask_permissions` mode every tool call is gated the
same way. The approval flow emits `permission_requested`, sets status
`awaiting_permission`, and waits for a decision: `allow_once`, `allow_project`,
`allow_always`, or `deny`. `allow_project` / `allow_always` are persisted in
the `permissions` table.

The `permission_requested` event carries a `PermissionPreview` (built by
`buildPermissionPreview`): the tool, action
(create/edit/delete/read/list/mkdir/move/search/command/fetch), path, and any
available old/new content so the UI can render a preview before the tool runs.

Standing `allow_project` / `allow_always` grants are silent until revoked.
The Settings modal (sidebar → Settings) lists them and can revoke individual
rules or clear all, via `GET /api/permissions` and
`DELETE /api/permissions[/:id]`.

---

## Workspace Tools

Tools are defined and executed in `workspaceTools.ts`:

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
```

Safety: every path resolves against the run's project directory and must stay
inside it. Access outside the workspace is denied. Tool failures are returned
to the model as JSON `{ success: false, error }` rather than thrown.

`run_command` runs a shell command with the workspace as the working directory
(timeout 120s, output truncated). It is listed in `DANGEROUS_TOOLS` and is
therefore **always** routed through the permission flow before it executes,
regardless of the run's mode — the model can build/compile/test, but only after
the user approves. Standing `allow_project` / `allow_always` grants still apply.

`fetch_url` performs network I/O: it GETs an http(s) URL (timeout 30s, output
truncated) and returns the response body so the model can read online docs or
an API response. It is also in `DANGEROUS_TOOLS`, so it **always** asks before
running. Its standing grants are scoped per host (approving one site does not
approve the whole web). Because it is the only async tool, the orchestrator
executes tools through `executeWorkspaceToolAsync`.

Do not add git integration or further network tools without an explicit request.

### Plan Panel (`update_plan`)

In plan mode the orchestrator additionally advertises an `update_plan` tool:

```txt
update_plan(title, tasks[{ text, status }], body?, start_new?)
```

It performs no filesystem/network I/O, so it runs silently (no permission
prompt). The orchestrator persists the plan to the `plans` table via
`PlanRepository` and emits a `plan_updated` SSE event. The plan is meant to be
stable: the model creates it once and only calls `update_plan` again to revise
on request (updating the same plan in place); `start_new: true` supersedes a
finished plan with a new versioned one. Progress is *not* tracked here — that
lives in the per-message `<task_list>` (see Operational Modes).

The web client (`useChatSession.currentPlan`, `PlanPanel.vue`) renders the
active plan in a right-hand side panel. The panel opens automatically once a
plan exists and then stays open across mode switches until the user closes it
(an in-thread "Plan: …" link re-opens it once collapsed). The active plan is
loaded on run select via `GET /api/runs/:id/plan`.

---

## Dual-Model Agent Presets (`delegate_tasks`)

A run can optionally use **two models**: an **architect** (the run's normal
`providerId`/`model`) that plans and coordinates, and a **coder** (the run's
`coderProviderId`/`coderModel`) that does the actual code-writing as 1–3 sub-agents.
This pairing is a named **preset** ("opusplan"-style) defined server-side in
`providers.local.json` under `agentPresets` and selectable, optionally, next to
the model picker in the composer (`useComposerSettings.selectedPresetId`). When no
preset is selected the run is plain single-model and behaves exactly as before.

When (and only when) a coder model is configured, the architect loop is given an
extra `delegate_tasks` tool:

```txt
delegate_tasks(tasks[{ title, instructions, files? }], parallel?)
```

The architect writes self-contained `instructions` per sub-task (the coder does
NOT see the conversation) and decides concurrency: `parallel: true` only when the
tasks touch disjoint files, otherwise they run sequentially. The orchestrator caps
the list at the preset's `maxSubAgents` (1–3) and runs each sub-task through the
SAME generation loop (`runAgentLoop`) on the coder model, in the same workspace,
tagging those messages `agentRole: "coder"`. Each sub-agent's final text is
returned to the architect as the tool result.

Implementation notes:
- `Orchestrator.drive()` sets up the architect loop (adding `DELEGATE_TASKS_TOOL`
  and architect instructions when a coder is configured); `runAgentLoop` is the
  shared, model-agnostic loop used by both the architect and every coder sub-agent.
- Coder sub-agents get `WORKSPACE_TOOLS` only — never `delegate_tasks` or
  `update_plan` — so delegation depth is hard-capped at 1 (no recursion).
- Sub-agents share the run's `runId`, so cancellation and the permission flow just
  work; because parallel sub-agents share the single pending-permission slot, their
  approval prompts are serialized via `permissionChain` (one prompt at a time).
- Coder prompt is `buildCoderSystemPrompt`; the web UI badges coder messages
  (`MessageThread.vue`, `ToolGroup.vue`). Presets are managed in Settings →
  Agents (`AgentPresetsTab.vue`).

---

## Run States

Use explicit run states (`RunStatus` in shared):

```ts
export type RunStatus =
  | "created"
  | "generating"
  | "awaiting_permission"
  | "done"
  | "failed"
  | "cancelled";
```

---

## Persistence

SQLite via `node:sqlite`. Tables (created/migrated in `db.ts`):

```txt
runs         id, title, task, project_path/name, status, provider, model, mode,
             coder_provider_id?, coder_model?, agent_preset?, ...
messages     id, run_id, role, agent_role?, provider/model?, content, raw_response?, ...
projects     path (pk), name, created_at
permissions  scope, project_path, tool, command, status; UNIQUE(scope, project_path, tool, command)
plans        id, run_id, title, body?, tasks (JSON), status ('active'|'completed'), version
```

All agent messages are stored. A run must be reopenable after restart. On
startup, runs stuck in active states are marked `failed`. Provider credentials
stay in JSON, never in the database.

---

## Realtime Rules

Use SSE (`GET /api/runs/:id/events`). The backend fans events out through
`eventBus`. Structured event types (see `RunEvent` in shared):

```txt
run_started
status_changed
message_created
message_updated
model_snapshot_locked
permission_requested
plan_updated
run_completed
run_failed
```

The stream closes on `run_completed`, `run_failed`, or a terminal
`status_changed` (done/failed/cancelled). The frontend updates live.

---

## Error Handling

Handle clearly and save to the run record without losing prior messages:

```txt
missing provider config        invalid/empty model response
invalid API key                invalid model name
provider timeout (idle 300s)   network error
rate limit                     cancelled run
permission denied
```

Failed runs keep their messages; the error is stored in `error_message`.

---

## Security Rules

```txt
Never commit real API keys (providers.local.json is ignored).
Never return provider secrets to the browser.
Never log secrets.
Keep the local SQLite file out of git.
Constrain all file access to the active project workspace.
No telemetry or external tracking unless explicitly requested.
```

---

## Coding Style

Use shared TypeScript types for cross-boundary contracts (`packages/shared`).

Prefer specific names:

```txt
ProviderRegistry  Orchestrator  RunRepository  OpenAICompatibleProvider
useChatSession    useProjects   buildSystemPrompt  executeWorkspaceTool
```

Avoid vague names like `helper`, `manager`, `processor`, `data`, `stuff`.

---

## Future Features

Not implemented today; do not build without an explicit request:

```txt
two-model planner -> coder -> review bridge (the original Agent Bridge concept)
direct git integration
manual approval checkpoints beyond the existing permission flow
token cost tracking
agent presets
multi-user auth / cloud deployment
```
