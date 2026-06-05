# Agents.md

## Purpose

This file defines how AI agents should work inside the BridgeMind project.

BridgeMind uses a two-agent workflow:

```txt
Planner Agent
Coder Agent
```

The planner decides what should be done. The coder implements it. The planner reviews the coder output and either accepts it or requests changes.

The goal is not to make agents debate forever. The goal is to produce a useful final output with limited, controlled rounds.

---

## Agent Roles

## Planner Agent

The Planner Agent is responsible for reasoning, planning, and reviewing.

Responsibilities:

```txt
understand the user task
identify the intended output
create a clear implementation plan
give concrete instructions to the coder
review the coder output
accept the result or request specific changes
```

The Planner Agent must not:

```txt
write the full implementation unless explicitly asked
take over the coder role
expand the scope unnecessarily
request vague improvements
start a new architecture without reason
```

Planner review output must include one of these markers:

```txt
FINAL_ACCEPTED
CHANGES_REQUIRED
```

Use `FINAL_ACCEPTED` only when the coder output is good enough.

Use `CHANGES_REQUIRED` when the coder must revise the output.

---

## Coder Agent

The Coder Agent is responsible for implementation.

Responsibilities:

```txt
follow the planner instructions
produce concrete output
keep the solution scoped
avoid unnecessary redesign
state assumptions briefly when needed
return complete and usable results
```

The Coder Agent must not:

```txt
ignore planner constraints
replace the task with a different task
debate architecture unless required
ask unnecessary questions
invent unsupported provider behavior
```

If something is ambiguous, the coder should make a reasonable assumption and continue.

---

## Default Workflow

The default workflow is:

```txt
1. User submits task.
2. Planner creates a plan.
3. Coder implements the plan.
4. Planner reviews the implementation.
5. If accepted, the run ends.
6. If changes are required, coder revises.
7. The loop stops at maxRounds.
```

Default max rounds:

```txt
3
```

A run must never continue indefinitely.

---

## Planner System Prompt

Use this as the default planner prompt:

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

---

## Coder System Prompt

Use this as the default coder prompt:

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

## Review Contract

The planner review should follow this structure:

```txt
FINAL_ACCEPTED

Reason:
<short reason>
```

or:

```txt
CHANGES_REQUIRED

Required fixes:
1. <specific fix>
2. <specific fix>
3. <specific fix>
```

The orchestrator should parse the marker from the planner response.

If the marker is missing, the orchestrator should treat it as:

```txt
CHANGES_REQUIRED
```

until max rounds is reached.

---

## Message Passing Rules

The coder should receive:

```txt
original user task
planner instructions
relevant previous messages
latest planner review if this is a fix round
```

The planner should receive:

```txt
original user task
planner's own previous plan
coder output
current round number
max round count
```

Do not pass unrelated or excessive history if the context becomes too large.

If history becomes large, summarize older messages before sending them to the next model.

---

## Context Management

The orchestrator should keep the context focused.

Preferred context order:

```txt
system prompt
original user task
current run summary if needed
latest planner instruction
latest coder output
latest review
```

Avoid sending the entire raw history forever.

For MVP, full history is acceptable. Later, add summarization.

---

## Loop Control

The orchestrator must enforce:

```txt
maxRounds
provider timeout
cancel support
failure handling
```

If `maxRounds` is reached without `FINAL_ACCEPTED`, the latest coder output should be shown as the final candidate.

The run status should make this clear.

---

## Agent Output Guidelines

Agents should produce practical output.

Avoid:

```txt
long generic explanations
unnecessary theory
scope expansion
fake certainty
unsupported assumptions
```

Prefer:

```txt
direct plans
concrete implementation steps
specific review notes
complete code blocks when code is requested
clear final output
```

---

## Provider Usage

Supported provider categories:

```txt
openai-compatible
anthropic
```

Initial provider targets:

```txt
OpenAI
Anthropic
OpenCode
CommandCode
```

OpenCode and CommandCode should be treated as OpenAI-compatible only if they expose compatible endpoints.

Provider-specific quirks must stay inside provider adapters, not inside the orchestrator.

---

## Safety and Control

BridgeMind should not automatically modify local files in MVP.

BridgeMind should not run terminal commands in MVP.

Future versions may support repository editing and terminal execution, but only with explicit user approval.

No agent should silently execute destructive actions.

---

## Human Override

Future versions may support manual checkpoints.

Possible checkpoints:

```txt
approve planner plan
approve coder implementation
approve fix request
approve final output
```

For MVP, the workflow can run automatically within the configured max rounds.

---

## Agent Presets

Possible future presets:

```txt
Architect + Coder
Reviewer + Fixer
Planner + Documentation Writer
Backend Architect + Frontend Implementer
Strict Reviewer + Fast Implementer
```

Presets should be stored as editable prompt templates later.

For MVP, hardcoded planner and coder prompts are enough.

---

## Done Definition

The agent system is working when:

```txt
planner and coder roles remain separate
planner output is passed to coder
coder output is passed to planner
review markers are detected
the loop stops correctly
all messages are saved
the UI clearly shows both agents
the final output is easy to copy
```
