# BridgeMind

BridgeMind is a local-first AI orchestration tool that connects two AI models in a single structured workflow.

The goal is simple: stop manually copying messages between different AI tools.

One model can act as the planner, architect, or reviewer. Another model can act as the coder or implementation agent. BridgeMind manages the flow between them, stores the conversation, and shows both agents in one interface.

```txt
User Task
  -> Planner Model
  -> Coder Model
  -> Planner Review
  -> Coder Fix
  -> Final Output
```

## What This Project Solves

When working with AI models, it is common to use one strong reasoning model for planning and another model for implementation. Doing this manually requires copying outputs between tools.

BridgeMind automates that bridge.

It lets you:

```txt
write one task
select a planner model
select a coder model
run a controlled agent loop
watch both models respond in one screen
save the full run history
copy the final output
```

## MVP Scope

The first version focuses only on the core orchestration flow.

Included in MVP:

```txt
Vue-based frontend
backend orchestrator API
local provider configuration
OpenAI-compatible provider adapter
Anthropic provider adapter
OpenAI support
Anthropic support
OpenCode support
CommandCode support
planner/coder model selection
run creation
planner -> coder -> planner review loop
SQLite run/message persistence
SSE or WebSocket live updates
final output panel
```

Not included in MVP:

```txt
repository editing
terminal execution
automatic patching
git integration
multi-user auth
cloud deployment
long-term memory
complex agent framework integration
```

These can be added later after the orchestration core is stable.

## Suggested Tech Stack

```txt
Frontend: Vue 3 + Vite + TypeScript
Backend: Node.js + TypeScript + Fastify
Database: SQLite
Realtime: SSE first, WebSocket later if needed
Package manager: pnpm
Repository style: monorepo
```

## Project Structure

```txt
bridgemind/
  apps/
    web/
      src/
        components/
        pages/
        stores/
        api/
        styles/

    api/
      src/
        config/
        database/
        providers/
        orchestrator/
        routes/
        prompts/
        shared/

  packages/
    shared/
      src/
        types/
        contracts/

  providers.example.json
  providers.local.json
  DEVELOPMENT_PLAN.md
  Claude.md
  Agents.md
  README.md
```

## Provider Configuration

Provider credentials are read from a local JSON file.

The repository should include:

```txt
providers.example.json
```

Your local machine should use:

```txt
providers.local.json
```

`providers.local.json` must be ignored by Git.

Example:

```json
{
  "providers": {
    "openai": {
      "type": "openai-compatible",
      "displayName": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_OPENAI_API_KEY",
      "models": [
        "gpt-5.5",
        "gpt-5.5-thinking"
      ]
    },
    "anthropic": {
      "type": "anthropic",
      "displayName": "Anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "YOUR_ANTHROPIC_API_KEY",
      "models": [
        "claude-opus-4.5",
        "claude-sonnet-4.5"
      ]
    },
    "opencode": {
      "type": "openai-compatible",
      "displayName": "OpenCode",
      "baseUrl": "http://localhost:4096/v1",
      "apiKey": "YOUR_OPENCODE_API_KEY",
      "models": [
        "qwen",
        "glm",
        "deepseek"
      ]
    },
    "commandcode": {
      "type": "openai-compatible",
      "displayName": "CommandCode",
      "baseUrl": "http://localhost:3000/v1",
      "apiKey": "YOUR_COMMANDCODE_API_KEY",
      "models": [
        "default"
      ]
    }
  }
}
```

The backend may read API keys. The frontend must never receive API keys.

## Provider Adapter Design

Different providers use different APIs. BridgeMind hides those differences behind a common interface.

```ts
export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
```

Required adapters:

```txt
OpenAICompatibleProvider
AnthropicProvider
```

OpenAI, OpenCode, and CommandCode should use `OpenAICompatibleProvider` if they expose an OpenAI-compatible `/chat/completions` API.

Anthropic should use a separate adapter because its Messages API has a different request/response format.

## Agent Roles

BridgeMind uses two core agent roles.

### Planner Agent

The planner understands the task, creates the plan, reviews the coder output, and decides whether the result is acceptable.

The planner should not implement the full task unless explicitly requested.

### Coder Agent

The coder follows the planner instructions and produces the actual implementation output.

The coder should not redesign the architecture unless the planner explicitly asks for it.

## Review Markers

The planner review must include one of these markers:

```txt
FINAL_ACCEPTED
CHANGES_REQUIRED
```

If the marker is missing, the orchestrator should treat the review as `CHANGES_REQUIRED` until `maxRounds` is reached.

## Run States

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

## Database

SQLite is enough for the MVP.

Minimum tables:

```txt
runs
messages
```

All messages should be saved. A previous run should be reopenable after app restart.

## API Endpoints

Suggested endpoints:

```txt
GET  /api/providers
POST /api/runs
GET  /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/events
POST /api/runs/:id/cancel
```

`GET /api/providers` must not expose API keys.

## UI Concept

Single-screen interface:

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

The user should be able to see both agents without switching screens.

## Loop Control

Default max rounds:

```txt
3
```

Allowed range:

```txt
1-10
```

The run must stop when:

```txt
planner returns FINAL_ACCEPTED
maxRounds is reached
user cancels the run
provider fails
```

If max rounds is reached without acceptance, the latest coder output can be shown as the final candidate.

## Security Rules

```txt
do not commit real API keys
do not expose API keys to the frontend
do not log secrets
do not commit providers.local.json
do not commit local SQLite database files
```

## Development Order

Recommended first implementation order:

```txt
1. Create monorepo
2. Create backend API
3. Load providers.local.json
4. Implement provider adapters
5. Test provider calls from backend
6. Create SQLite schema
7. Implement run creation
8. Implement orchestrator loop
9. Save messages
10. Create Vue UI
11. Add provider/model selectors
12. Add run screen
13. Add SSE/WebSocket streaming
14. Add run history
15. Stabilize errors and cancellation
```

## Related Project Files

```txt
DEVELOPMENT_PLAN.md  detailed development plan
Claude.md           Claude/Claude Code project instructions
Agents.md           agent role and workflow rules
providers.example.json provider config example
```

## Design Principle

BridgeMind should stay simple.

The first version should solve one clear problem:

```txt
Stop manually copying messages between two AI models.
```

Everything else should come after that core flow works reliably.
