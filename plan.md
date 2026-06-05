# BridgeMind Development Plan

## 1. Project Overview

BridgeMind is a local-first AI orchestration tool that connects two AI models in a single workflow.

The main goal is to let one model act as the planner, architect, or reviewer, while another model acts as the implementation model. The user should not manually copy messages between different AI tools. Instead, BridgeMind manages the conversation flow, passes outputs between models, stores the full run history, and shows everything in one interface.

The first version should focus on a clean planner-to-coder workflow:

```txt
User Task
  -> Planner Model
  -> Coder Model
  -> Planner Review
  -> Coder Fix
  -> Final Output
```

BridgeMind is not a full coding agent in the first phase. It should not edit repositories, run terminal commands, or apply patches automatically at the beginning. The initial goal is to build the orchestration core and the single-screen user interface.

---

## 2. Core Goals

* Provide a single UI for working with two AI models.
* Allow the user to select different providers and models for each agent.
* Support planner/coder style workflows.
* Store provider settings in a local ignored JSON file.
* Use adapter pattern for different provider APIs.
* Support OpenAI, Anthropic, OpenCode, and CommandCode.
* Show both agents' messages in real time.
* Save runs and messages locally.
* Keep the architecture simple and extensible.

---

## 3. Initial Scope

The MVP should include:

* Vue-based frontend.
* Backend orchestrator API.
* Local provider configuration via JSON.
* Provider adapter abstraction.
* OpenAI-compatible provider adapter.
* Anthropic provider adapter.
* Planner and coder model selection.
* Run creation.
* Planner -> Coder -> Planner Review loop.
* Max round limit.
* SQLite persistence.
* Real-time message streaming via SSE or WebSocket.
* Final output panel.

The MVP should not include:

* Repository editing.
* Terminal execution.
* Automatic file patching.
* Git integration.
* Long-term memory.
* Multi-user authentication.
* Cloud deployment.
* Complex agent framework integration.

Those can be added later after the orchestration flow is stable.

---

## 4. Suggested Tech Stack

### Frontend

```txt
Vue 3
Vite
TypeScript
Pinia
CSS Modules or plain CSS
```

### Backend

Either of these is acceptable:

```txt
Node.js + Fastify
```

or:

```txt
Go + Fiber/Echo
```

For the first version, Node.js with TypeScript may be faster because the frontend and backend can share types more easily.

### Database

```txt
SQLite
```

SQLite is enough for local-first usage. It keeps the project simple and avoids external dependencies.

### Real-time Communication

Use one of these:

```txt
SSE
WebSocket
```

SSE is enough for one-way live streaming from backend to frontend. WebSocket is better if the UI later needs pause/resume, manual intervention, or interactive agent control.

For MVP, SSE is simpler.

---

## 5. Project Structure

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
      package.json

    api/
      src/
        config/
        database/
        providers/
        orchestrator/
        routes/
        prompts/
        shared/
      package.json

  packages/
    shared/
      src/
        types/
        contracts/
      package.json

  providers.example.json
  providers.local.json
  .gitignore
  package.json
  pnpm-workspace.yaml
  README.md
  DEVELOPMENT_PLAN.md
```

---

## 6. Local Provider Configuration

Provider credentials should not be committed to the repository.

The repository should include:

```txt
providers.example.json
```

The local machine should use:

```txt
providers.local.json
```

`providers.local.json` must be ignored by Git.

### .gitignore

```gitignore
providers.local.json
*.local.json
.env
.env.*
node_modules
dist
.vite
.DS_Store
```

### providers.example.json

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

---

## 7. Provider Adapter Design

Different providers use different request and response formats.

BridgeMind should hide those differences behind a common interface.

### Common Interface

```ts
export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
```

### CompletionRequest

```ts
export type CompletionRequest = {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};
```

### ChatMessage

```ts
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
```

### CompletionResponse

```ts
export type CompletionResponse = {
  content: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};
```

---

## 8. Provider Implementations

### Required Providers

```txt
OpenAICompatibleProvider
AnthropicProvider
```

OpenAI, OpenCode, and CommandCode should use `OpenAICompatibleProvider` if they expose an OpenAI-compatible API.

Anthropic should use a separate adapter because its messages API has a different structure.

### Provider Folder Structure

```txt
apps/api/src/providers/
  ModelProvider.ts
  OpenAICompatibleProvider.ts
  AnthropicProvider.ts
  ProviderFactory.ts
  ProviderRegistry.ts
```

### ProviderFactory

```ts
export function createProvider(config: ProviderConfig): ModelProvider {
  if (config.type === "anthropic") {
    return new AnthropicProvider(config);
  }

  if (config.type === "openai-compatible") {
    return new OpenAICompatibleProvider(config);
  }

  throw new Error(`Unsupported provider type: ${config.type}`);
}
```

---

## 9. Orchestrator Design

The orchestrator is the core of the application.

It should not know provider-specific API details. It should only work with the `ModelProvider` interface.

### Main Responsibilities

* Create a new run.
* Load selected planner and coder providers.
* Build prompts.
* Call planner model.
* Send planner output to coder model.
* Send coder output back to planner for review.
* Continue until accepted or max rounds is reached.
* Save every message.
* Stream messages to the frontend.

### Run Flow

```txt
1. User creates a task.
2. Backend creates a run.
3. Planner model creates an implementation plan.
4. Coder model implements the plan.
5. Planner model reviews the implementation.
6. If accepted, the run is marked as done.
7. If rejected, planner sends fix instructions.
8. Coder applies the fix.
9. Loop continues until accepted or maxRounds is reached.
```

### Run States

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

### Run Config

```ts
export type RunConfig = {
  planner: {
    providerId: string;
    model: string;
  };
  coder: {
    providerId: string;
    model: string;
  };
  maxRounds: number;
  temperature?: number;
  maxTokens?: number;
};
```

---

## 10. Prompt Design

Prompting should be strict and role-based.

### Planner System Prompt

```txt
You are the planner and reviewer agent.

Your responsibilities:
- Understand the user's task.
- Create a clear implementation plan.
- Give concrete instructions to the coder model.
- Review the coder model's output.
- Decide whether the output is acceptable.

Rules:
- Do not implement the task yourself unless explicitly asked.
- Do not rewrite the coder's output.
- Give specific, actionable feedback.
- Keep the scope limited to the user's original request.
- If the coder output is acceptable, respond with: FINAL_ACCEPTED.
- If changes are needed, respond with: CHANGES_REQUIRED and list the required fixes.
```

### Coder System Prompt

```txt
You are the coder and implementation agent.

Your responsibilities:
- Follow the planner's instructions.
- Produce concrete implementation output.
- Keep the solution scoped.
- Avoid redesigning the architecture unless the planner explicitly asks for it.
- Do not ignore planner constraints.
- If something is ambiguous, make a reasonable assumption and state it briefly.
```

---

## 11. Database Schema

Use SQLite for local persistence.

### runs

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  planner_provider_id TEXT NOT NULL,
  planner_model TEXT NOT NULL,
  coder_provider_id TEXT NOT NULL,
  coder_model TEXT NOT NULL,
  max_rounds INTEGER NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  final_output TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### messages

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_role TEXT,
  provider_id TEXT,
  model TEXT,
  content TEXT NOT NULL,
  raw_response TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

### providers

Provider config can stay in JSON for MVP. A database table is not required at first.

Later, provider metadata can be moved into the database if UI-based provider management is needed.

---

## 12. API Endpoints

### Providers

```txt
GET /api/providers
```

Returns configured providers and available models.

The response must not expose API keys.

### Runs

```txt
POST /api/runs
```

Creates and starts a new run.

```txt
GET /api/runs
```

Lists previous runs.

```txt
GET /api/runs/:id
```

Returns run details and messages.

```txt
GET /api/runs/:id/events
```

Streams live run events to the frontend via SSE.

```txt
POST /api/runs/:id/cancel
```

Cancels an active run.

---

## 13. Frontend UI

The UI should be simple and focused.

### Main Screen

```txt
Left Panel:
- Task input
- Planner provider select
- Planner model select
- Coder provider select
- Coder model select
- Max rounds
- Start button

Center Panel:
- Planner messages

Right Panel:
- Coder messages

Bottom or Separate Panel:
- Final output
```

### Run History

A small sidebar can show previous runs:

```txt
Run title
Status
Created date
Planner model
Coder model
```

### Message Display

Each message should show:

```txt
Agent role
Provider
Model
Timestamp
Content
```

Example:

```txt
Planner / Anthropic / claude-opus-4.5
Coder / OpenCode / qwen
```

---

## 14. Real-time Event Types

The backend should stream structured events.

```ts
export type RunEvent =
  | {
      type: "run_started";
      runId: string;
    }
  | {
      type: "status_changed";
      status: RunStatus;
    }
  | {
      type: "message_created";
      message: RunMessage;
    }
  | {
      type: "round_started";
      round: number;
    }
  | {
      type: "run_completed";
      finalOutput: string;
    }
  | {
      type: "run_failed";
      errorMessage: string;
    };
```

---

## 15. Loop Control Rules

The orchestrator must prevent endless loops.

Rules:

```txt
maxRounds default: 3
maxRounds minimum: 1
maxRounds maximum: 10
```

The planner must produce one of these review markers:

```txt
FINAL_ACCEPTED
CHANGES_REQUIRED
```

If the planner does not provide a clear marker, the orchestrator should treat it as `CHANGES_REQUIRED` until max rounds is reached.

If max rounds is reached without acceptance, the run should stop and show the latest coder output as the final candidate.

---

## 16. Error Handling

The system should handle:

* Missing provider config.
* Invalid API key.
* Provider timeout.
* Provider rate limit.
* Empty model response.
* Invalid model name.
* Network errors.
* Cancelled run.
* Max round limit reached.

Errors should be saved into the run record.

The frontend should show the error clearly without losing previous messages.

---

## 17. Security Notes

* Never commit real provider API keys.
* Never expose API keys through frontend endpoints.
* Provider config should be read only by the backend.
* `GET /api/providers` should return display names, provider ids, types, and models only.
* Do not return `apiKey` to the browser.
* Avoid logging full raw provider responses if they may contain sensitive data.
* Keep local config files ignored by Git.

---

## 18. Development Phases

## Phase 1 — Project Setup

Goals:

* Create monorepo.
* Add Vue frontend.
* Add backend API.
* Add shared package.
* Add TypeScript config.
* Add linting and formatting.
* Add local provider config loading.
* Add `.gitignore`.

Deliverables:

```txt
Working monorepo
Frontend starts locally
Backend starts locally
Provider config can be loaded
```

---

## Phase 2 — Provider Adapter Layer

Goals:

* Define `ModelProvider` interface.
* Implement `OpenAICompatibleProvider`.
* Implement `AnthropicProvider`.
* Implement `ProviderFactory`.
* Implement `ProviderRegistry`.
* Add provider health check endpoint.

Deliverables:

```txt
OpenAI-compatible models can be called
Anthropic models can be called
OpenCode can be called if it exposes OpenAI-compatible API
CommandCode can be called if it exposes OpenAI-compatible API
```

---

## Phase 3 — Run Orchestrator

Goals:

* Create run state machine.
* Implement planner call.
* Implement coder call.
* Implement planner review call.
* Add max round control.
* Save messages.
* Save final output.

Deliverables:

```txt
User can start a run
Planner creates a plan
Coder responds to planner
Planner reviews coder output
Run completes or stops at maxRounds
```

---

## Phase 4 — SQLite Persistence

Goals:

* Add SQLite database.
* Create `runs` table.
* Create `messages` table.
* Store all runs and messages.
* Add run history endpoints.

Deliverables:

```txt
Runs persist after restart
Messages persist after restart
Previous runs can be opened from UI
```

---

## Phase 5 — Vue User Interface

Goals:

* Build task input screen.
* Add provider/model selectors.
* Add start run button.
* Add planner message panel.
* Add coder message panel.
* Add final output panel.
* Add run history sidebar.

Deliverables:

```txt
Single-screen workflow UI
User can select planner and coder models
User can see both agents' outputs
User can view final output
```

---

## Phase 6 — Real-time Streaming

Goals:

* Add SSE or WebSocket endpoint.
* Stream status changes.
* Stream new messages.
* Stream final result.
* Update UI live.

Deliverables:

```txt
Messages appear in UI while the run is active
User does not need to refresh
Run status updates live
```

---

## Phase 7 — Stabilization

Goals:

* Improve error handling.
* Add cancellation.
* Add provider timeout settings.
* Add better empty-response handling.
* Add UI loading states.
* Add run failure display.
* Add basic tests for provider adapters and orchestrator.

Deliverables:

```txt
Stable local MVP
Clear errors
Cancelable runs
Basic test coverage
```

---

## 19. Future Features

After the MVP is stable, these features can be added.

### Manual Control Mode

Allow the user to approve each step manually.

```txt
Planner creates plan
User approves
Coder implements
User approves
Planner reviews
```

### File Context Upload

Allow the user to attach files as context.

```txt
Markdown files
Text files
Code snippets
JSON files
```

### Repository Workspace

Allow BridgeMind to work with a local repository.

Possible features:

```txt
Read project files
Generate patches
Show diffs
Apply patches manually
```

### Terminal Execution

Allow the coder agent to request terminal commands.

This should require explicit user approval.

```txt
npm install
npm test
pnpm build
go test
dotnet test
```

### Cost Tracking

Track token usage and estimated cost per run.

```txt
Input tokens
Output tokens
Total tokens
Estimated cost
Provider
Model
```

### Agent Presets

Add reusable workflows.

Examples:

```txt
Architect + Coder
Reviewer + Fixer
Planner + Documentation Writer
Senior Backend + Frontend Implementer
```

---

## 20. MVP Acceptance Criteria

The MVP is complete when:

* The app starts locally.
* The backend can read `providers.local.json`.
* The frontend can list configured providers and models.
* The user can enter a task.
* The user can choose a planner provider/model.
* The user can choose a coder provider/model.
* The user can start a run.
* Planner output is sent to coder.
* Coder output is sent back to planner.
* The loop stops when accepted or when max rounds is reached.
* All messages are visible in the UI.
* Runs are saved in SQLite.
* Previous runs can be reopened.
* No API keys are exposed to the frontend.

---

## 21. Recommended First Implementation Order

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

---

## 22. Design Principle

BridgeMind should stay simple.

The first version should not try to become a full autonomous coding agent. It should solve one clear problem:

```txt
Stop manually copying messages between two AI models.
```

Everything else should be built after that core flow works reliably.
