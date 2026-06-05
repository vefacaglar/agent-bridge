# Claude.md

## Project

BridgeMind is a local-first AI orchestration tool for connecting two AI models in a structured workflow.

The main workflow is:

```txt
User Task
  -> Planner Model
  -> Coder Model
  -> Planner Review
  -> Coder Fix
  -> Final Output
```

The application should reduce manual copy-paste between different AI tools. One model should reason, plan, or review. The other model should implement the requested output.

This project is not a full autonomous coding agent in the first phase. The MVP must focus on provider adapters, orchestration, run history, and a clean Vue-based interface.

---

## Tech Stack

Preferred stack:

```txt
Frontend: Vue 3 + Vite + TypeScript
Backend: Node.js + TypeScript + Fastify
Database: SQLite
Realtime: SSE first, WebSocket later if needed
Package manager: pnpm
Repository style: monorepo
```

Suggested structure:

```txt
apps/
  web/
  api/

packages/
  shared/

providers.example.json
providers.local.json
DEVELOPMENT_PLAN.md
AGENTS.md
Claude.md
```

---

## Core Principles

Keep the architecture simple.

Do not introduce heavy agent frameworks unless there is a clear need. The first version should use a direct orchestrator service, provider adapters, and explicit run states.

Prefer readable code over clever abstractions.

Do not add cloud deployment, auth, repository editing, terminal execution, or automatic patching during MVP unless explicitly requested.

---

## Provider Configuration

Provider credentials must be read from local ignored configuration files.

Use:

```txt
providers.example.json
providers.local.json
```

`providers.local.json` must never be committed.

The backend may read API keys. The frontend must never receive API keys.

The `/api/providers` endpoint should return only safe metadata:

```txt
provider id
display name
provider type
available models
```

Do not expose:

```txt
apiKey
authorization headers
raw secrets
local credentials
```

---

## Provider Adapter Rules

Use an adapter pattern.

The orchestrator must not know provider-specific request formats.

Common interface:

```ts
export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
```

Required adapters for MVP:

```txt
OpenAICompatibleProvider
AnthropicProvider
```

OpenAI, OpenCode, and CommandCode should use `OpenAICompatibleProvider` when they expose an OpenAI-compatible `/chat/completions` API.

Anthropic should use a separate adapter because its Messages API differs from OpenAI-compatible APIs.

---

## Orchestrator Rules

The orchestrator controls the conversation between agents.

It should:

```txt
create a run
save the user task
call the planner model
send planner output to coder model
send coder output back to planner model
continue until accepted or maxRounds is reached
save every message
stream events to the UI
```

The orchestrator must enforce loop limits.

Default:

```txt
maxRounds = 3
```

Allowed range:

```txt
minimum = 1
maximum = 10
```

The planner review must use one of these markers:

```txt
FINAL_ACCEPTED
CHANGES_REQUIRED
```

If no clear marker is provided, treat the review as `CHANGES_REQUIRED` until max rounds is reached.

---

## Run States

Use explicit run states.

```ts
export type RunStatus =
  | "created"
  | "planning"
  | "implementing"
  | "reviewing"
  | "fixing"
  | "done"
  | "failed"
  | "cancelled";
```

Do not use vague states like `processing` for the core workflow.

---

## Persistence

Use SQLite for MVP.

Minimum tables:

```txt
runs
messages
```

Provider config can stay in JSON for MVP. Do not move provider credentials into the database in the first phase.

All agent messages should be stored. A run should be reopenable after app restart.

---

## Frontend Rules

The UI should be a single-screen workflow.

Suggested layout:

```txt
Left Panel:
- task input
- planner provider select
- planner model select
- coder provider select
- coder model select
- max rounds
- start button

Center Panel:
- planner messages

Right Panel:
- coder messages

Bottom Panel:
- final output
```

The user should be able to see what each model said without switching screens.

Do not hide important agent decisions in logs.

---

## Realtime Rules

Use SSE for MVP unless bidirectional control is needed.

Stream structured events:

```txt
run_started
status_changed
round_started
message_created
run_completed
run_failed
```

The frontend should update live while the run is active.

---

## Error Handling

Handle these cases clearly:

```txt
missing provider config
invalid API key
provider timeout
rate limit
empty model response
invalid model name
network error
cancelled run
max rounds reached
```

Errors should be saved to the run record.

Do not lose previous messages when a run fails.

---

## Security Rules

Never commit real API keys.

Never return provider secrets to the browser.

Never log secrets.

Avoid committing local database files.

Keep local config files ignored by Git.

Do not add telemetry or external tracking unless explicitly requested.

---

## Coding Style

Use TypeScript types for shared contracts.

Prefer explicit names.

Avoid vague names like:

```txt
helper
manager
processor
data
stuff
```

Prefer specific names like:

```txt
ProviderRegistry
RunOrchestrator
RunEventStream
OpenAICompatibleProvider
AnthropicProvider
```

Keep functions small and purpose-driven.

Avoid premature abstraction.

---

## MVP Boundary

The MVP is complete when:

```txt
the app starts locally
providers.local.json is loaded
providers are listed in the UI
the user can select planner and coder models
the user can start a run
planner output is passed to coder
coder output is passed to planner review
messages are streamed live
runs and messages are saved in SQLite
previous runs can be opened
API keys are not exposed to the frontend
```

Do not expand scope before this works.

---

## Future Features

Do not implement these during MVP unless explicitly requested:

```txt
repository workspace
file patching
terminal execution
git integration
manual approval checkpoints
token cost tracking
agent presets
file uploads
multi-user auth
cloud deployment
```

These are valid future phases, not MVP requirements.
