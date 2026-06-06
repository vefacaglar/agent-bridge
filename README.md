# Agent Bridge

Agent Bridge is a local-first workspace assistant for local projects.

The user selects one provider/model, chooses a project folder, sends a task, and
the backend orchestrator runs a tool-calling chat loop. The assistant can read,
edit, create, move, delete, and search files inside the selected workspace. It
can also ask for permission to run commands or fetch URLs.

The default product is a **single-model workspace agent**. Optionally, the user
can select an agent preset that splits the run into an architect model plus coder
sub-agents, with an optional utility model for small read/search/rename tasks.

```txt
User Task
  -> Selected Model or Preset Architect
  -> Optional Workspace Tool Calls
  -> Optional Coder / Utility Delegation
  -> Tool Results Back To Model
  -> Final Assistant Response
```

## Current Features

```txt
Vue 3 frontend
Fastify backend
SQLite persistence
OpenAI-compatible provider adapter
Anthropic provider adapter
local providers.local.json configuration
single provider/model run creation
optional architect/coder/utility agent presets
chat, build, and plan modes
workspace filesystem tools
permission flow for commands and URL fetches
SSE live updates
run/message/project/permission persistence
right-hand plan panel
```

## Tech Stack

```txt
Frontend: Vue 3 + Vite + TypeScript
Backend: Node.js + TypeScript + Fastify
Database: SQLite via node:sqlite
Realtime: SSE
Package manager: pnpm
Repository style: monorepo
```

## Project Structure

```txt
agent-bridge/
  apps/
    api/
      src/
        database/
        orchestrator/
        providers/
        routes/
    web/
      src/
        api/
        components/
        composables/
        lib/
  packages/
    shared/
      src/
  providers.example.json
  providers.local.json
  Agents.md
  Claude.md
  README.md
```

## Provider Configuration

Provider credentials are read from local JSON config.

```txt
providers.example.json   committed template
providers.local.json     local secrets, git-ignored
```

Example:

```json
{
  "providers": {
    "openai": {
      "type": "openai-compatible",
      "displayName": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_OPENAI_API_KEY",
      "models": ["gpt-5.5"]
    },
    "anthropic": {
      "type": "anthropic",
      "displayName": "Anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "YOUR_ANTHROPIC_API_KEY",
      "models": ["claude-sonnet-4.5"]
    }
  }
}
```

Provider secrets live in local config. Public provider metadata omits API keys;
the local settings API can read and save full provider config for this
local-first app.

`providers.local.json` may also include `agentPresets`, which define an
architect provider/model, coder provider/model, `maxSubAgents`, and optionally a
utility provider/model.

## Modes

```txt
Chat   lightweight conversation; no proactive workspace scan or edits
Build  applies file edits directly through workspace tools
Plan   writes a stable plan to the plan panel; no file mutations
```

The backend also supports `ask_permissions` and `auto` for older runs or direct
API use. `run_command` and `fetch_url` always require permission unless a
matching standing grant exists.

When an agent preset is active in Build mode, the architect receives read-only
workspace tools and delegates mutations through `delegate_tasks`. Coder
sub-agents receive the normal workspace tools. Utility sub-agents receive read,
list, search, and move tools.

## Workspace Tools

The orchestrator exposes:

```txt
write_file
edit_file
delete_file
read_file
list_directory
create_directory
move_file
search_files
run_command
fetch_url
update_plan
set_chat_title
delegate_tasks
delegate_to_utility
```

All file paths are resolved relative to the selected project folder and cannot
escape it.

## Development

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm --filter @agent-bridge/api test
pnpm --filter @agent-bridge/api build
pnpm --filter @agent-bridge/web build
```
