import fs from "node:fs";
import path from "node:path";
import type { Run, RunStatus, RunMessage, ChatMessage } from "@bridgemind/shared";
import { RunRepository, MessageRepository } from "../database/repositories.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { eventBus } from "./eventBus.js";
import { db } from "../database/db.js";

const WORKSPACE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Writes or overwrites content to a specified file in the local workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory (e.g., 'src/main.js' or 'index.html')."
          },
          content: {
            type: "string",
            description: "The exact text content to write to the file."
          }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Deletes a specified file from the local workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory."
          }
        },
        required: ["path"]
      }
    }
  }
];

function buildSystemPrompt(projectName?: string, projectPath?: string, mode?: string): string {
  let prompt = `You are BridgeMind, a helpful local-first AI assistant. You help the user with code development, analysis, and general tasks in their active project workspace. You run locally on their machine, so you should refer to their local workspace directory when helpful.

IMPORTANT INSTRUCTION FOR PLANNING & CODING:
- Whenever you are asked to implement a feature, make changes, or build a file, you MUST first outline your plan/steps.
- You MUST wrap your entire planning section inside <plan>...</plan> XML-like tags. (e.g. <plan>1. Create file. 2. Verify.</plan>).
- Wrap any code changes inside standard markdown fenced code blocks. Specify the filename as a comment or header if possible.`;

  // Inject Mode specific instructions
  if (mode === "plan") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: PLAN MODE
- Focus purely on planning, architecture, design steps, and explaining concepts.
- You should NOT modify the filesystem or write any files.
- DO NOT call any file-writing, creating, or deleting tools (like 'write_file' or 'delete_file'). If you feel changes are needed, describe them in text and ask the user to switch to Auto/Build mode.`;
  } else if (mode === "auto") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: AUTO/BUILD MODE
- You have autonomous permission to directly perform file edits, write code, create or delete files.
- Proactively call workspace tools (like 'write_file' and 'delete_file') as needed to complete the user's tasks.`;
  } else if (mode === "ask_permissions") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: ASK PERMISSIONS MODE
- You are allowed to use workspace tools (like 'write_file' and 'delete_file') to write code and perform modifications.
- However, note that all tool executions will be presented to the user for explicit confirmation/approval before being executed.`;
  } else if (mode === "accept_edits") {
    prompt += `\n\nCURRENT OPERATIONAL MODE: ACCEPT EDITS MODE
- You can suggest code changes and make tool calls to write files.
- The user will manually review each proposed file modification before it is applied to their workspace.`;
  }

  if (projectName || projectPath) {
    prompt += `\n\nActive Project Workspace Context:`;
    if (projectName) {
      prompt += `\n- Project Name: ${projectName}`;
    }
    if (projectPath) {
      prompt += `\n- Project Folder Path: ${projectPath}`;
    }
  }

  return prompt;
}

export class Orchestrator {
  private activeRuns: Set<string> = new Set();
  private pendingPermissions = new Map<string, {
    resolve: (decision: "allow_once" | "allow_project" | "allow_always" | "deny") => void;
    toolCall: any;
  }>();

  constructor(
    private runRepo: RunRepository,
    private messageRepo: MessageRepository,
    private registry: ProviderRegistry
  ) {}

  resolvePermission(runId: string, decision: "allow_once" | "allow_project" | "allow_always" | "deny"): boolean {
    const pending = this.pendingPermissions.get(runId);
    if (pending) {
      pending.resolve(decision);
      this.pendingPermissions.delete(runId);
      return true;
    }
    return false;
  }

  getPendingPermission(runId: string) {
    return this.pendingPermissions.get(runId);
  }

  private checkPermission(projectPath?: string): boolean {
    try {
      // Check global permission
      const globalPerm = db.prepare("SELECT * FROM permissions WHERE scope = 'global' AND status = 'allowed'").get();
      if (globalPerm) return true;

      // Check project permission
      if (projectPath) {
        const projectPerm = db.prepare("SELECT * FROM permissions WHERE scope = 'project' AND project_path = ? AND status = 'allowed'").get(projectPath);
        if (projectPerm) return true;
      }
    } catch (err) {
      console.error("[Orchestrator] Error checking permissions:", err);
    }
    return false;
  }

  private async requestPermission(runId: string, toolCall: any): Promise<"allow_once" | "allow_project" | "allow_always" | "deny"> {
    return new Promise((resolve) => {
      this.pendingPermissions.set(runId, { resolve, toolCall });
      
      this.emitStatus(runId, "awaiting_permission");
      
      eventBus.emit(`run:${runId}`, {
        type: "permission_requested",
        runId,
        toolCall
      });
    });
  }

  private emitStatus(runId: string, status: RunStatus, extraUpdates?: Partial<Run>) {
    this.runRepo.update(runId, { status, ...extraUpdates });
    eventBus.emit(`run:${runId}`, { type: "status_changed", status });
  }

  private emitMessage(runId: string, msg: RunMessage) {
    this.messageRepo.create(msg);
    eventBus.emit(`run:${runId}`, { type: "message_created", message: msg });
  }

  cancel(runId: string): boolean {
    if (this.activeRuns.has(runId)) {
      this.activeRuns.delete(runId);
      this.emitStatus(runId, "cancelled");
      eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: "Chat generation cancelled by user." });
      console.log(`[Orchestrator] Run ${runId} has been cancelled by user.`);
      return true;
    }
    return false;
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async run(runId: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found in database.`);
      return;
    }

    console.log(`[Orchestrator] Starting single-model chat session: ${runId} ("${run.title}")`);
    this.activeRuns.add(runId);

    // Broadcast starting event
    eventBus.emit(`run:${runId}`, { type: "run_started", runId });
    eventBus.emit(`run:${runId}`, {
      type: "model_snapshot_locked",
      snapshot: {
        providerId: run.providerId,
        providerDisplayName: run.providerDisplayName,
        model: run.model
      }
    });

    try {
      const provider = this.registry.getProvider(run.providerId);

      const checkCancelled = () => {
        if (!this.activeRuns.has(runId)) {
          throw new Error("ORCHESTRATION_CANCELLED");
        }
      };

      checkCancelled();

      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state`);
      this.emitStatus(runId, "generating");

      const chatMessages: ChatMessage[] = [
        { role: "user", content: run.task }
      ];

      let completionDone = false;
      let currentMessages = [...chatMessages];

      while (!completionDone) {
        checkCancelled();

        // Request completion
        const response = await provider.complete({
          model: run.model,
          systemPrompt: buildSystemPrompt(run.projectName, run.projectPath, run.mode),
          messages: currentMessages,
          tools: WORKSPACE_TOOLS
        });

        checkCancelled();

        if (response.toolCalls && response.toolCalls.length > 0) {
          // Save assistant message with tool calls
          const assistantMsgId = `msg-res-tools-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const assistantMsg: RunMessage = {
            id: assistantMsgId,
            runId,
            role: "assistant",
            providerId: run.providerId,
            providerDisplayName: run.providerDisplayName,
            model: run.model,
            content: response.content || "Calling workspace tools...",
            rawResponse: JSON.stringify(response.toolCalls),
            createdAt: new Date().toISOString()
          };
          this.emitMessage(runId, assistantMsg);

          // Append to history for the next turn
          currentMessages.push({
            role: "assistant",
            content: response.content || "",
            toolCalls: response.toolCalls
          });

          // Execute each tool call
          for (const tc of response.toolCalls) {
            checkCancelled();
            let result = "";

            try {
              const args = JSON.parse(tc.function.arguments);
              const relativePath = args.path;
              if (!relativePath) {
                throw new Error("Missing parameter: path");
              }

              // Resolve absolute path safely
              const baseDir = run.projectPath || process.cwd();
              const absolutePath = path.resolve(baseDir, relativePath);

              // Safety check: ensure file path is inside workspace
              if (!absolutePath.startsWith(baseDir)) {
                throw new Error(`Access denied: path '${relativePath}' is outside of the workspace directory.`);
              }

              // Check permission if in 'ask_permissions' mode
              if (run.mode === "ask_permissions") {
                const allowed = this.checkPermission(run.projectPath);
                if (!allowed) {
                  const decision = await this.requestPermission(runId, tc);
                  if (decision === "deny") {
                    throw new Error("Permission denied by user.");
                  }
                  this.emitStatus(runId, "generating");
                }
              }

              if (tc.function.name === "write_file") {
                // Ensure parent directory exists
                fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                fs.writeFileSync(absolutePath, args.content || "", "utf-8");
                result = JSON.stringify({ success: true, message: `File written successfully at ${relativePath}` });
              } else if (tc.function.name === "delete_file") {
                if (fs.existsSync(absolutePath)) {
                  fs.unlinkSync(absolutePath);
                  result = JSON.stringify({ success: true, message: `File deleted successfully at ${relativePath}` });
                } else {
                  result = JSON.stringify({ success: false, message: `File not found at ${relativePath}` });
                }
              } else {
                throw new Error(`Unknown function: ${tc.function.name}`);
              }
            } catch (err: any) {
              result = JSON.stringify({ success: false, error: err.message });
            }

            // Save tool response
            const toolMsg: RunMessage = {
              id: `msg-tool-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              runId,
              role: "tool",
              content: result,
              createdAt: new Date().toISOString()
            };
            this.emitMessage(runId, toolMsg);

            // Append to messages history
            currentMessages.push({
              role: "tool",
              content: result,
              tool_call_id: tc.id,
              name: tc.function.name
            });
          }
        } else {
          // Final assistant message with no tool calls
          const assistantMsg: RunMessage = {
            id: `msg-res-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            runId,
            role: "assistant",
            providerId: run.providerId,
            providerDisplayName: run.providerDisplayName,
            model: run.model,
            content: response.content,
            createdAt: new Date().toISOString()
          };
          this.emitMessage(runId, assistantMsg);
          completionDone = true;
        }
      }

      this.emitStatus(runId, "done");
      const lastContent = currentMessages[currentMessages.length - 1]?.content || "";
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: lastContent });
      console.log(`[Orchestrator] Run ${runId} - Completed successfully.`);

    } catch (error: any) {
      if (error.message === "ORCHESTRATION_CANCELLED") {
        console.log(`[Orchestrator] Run ${runId} - Process safely stopped by cancellation.`);
      } else {
        console.error(`[Orchestrator] Run ${runId} - Failed with error:`, error.message);
        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async continueRun(runId: string, newUserMessage: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run) {
      console.error(`[Orchestrator] Run with id "${runId}" not found for continuation.`);
      return;
    }

    console.log(`[Orchestrator] Continuing single-model chat session: ${runId}`);
    this.activeRuns.add(runId);

    try {
      const provider = this.registry.getProvider(run.providerId);

      const checkCancelled = () => {
        if (!this.activeRuns.has(runId)) {
          throw new Error("ORCHESTRATION_CANCELLED");
        }
      };

      // Fetch all messages (this includes the user message created in server.ts)
      const allMessages = this.messageRepo.listByRunId(runId);
      
      const chatMessages: ChatMessage[] = [
        { role: "user", content: run.task }
      ];

      // Convert DB messages to ChatMessage list correctly preserving toolCall raw format if present
      for (const m of allMessages) {
        const chatMsg: ChatMessage = {
          role: m.role,
          content: m.content
        };
        if (m.role === "tool") {
          const precedingAssistant = allMessages
            .slice(0, allMessages.indexOf(m))
            .reverse()
            .find(msg => msg.role === "assistant" && msg.rawResponse);
          
          if (precedingAssistant && precedingAssistant.rawResponse) {
            try {
              const tcList = JSON.parse(precedingAssistant.rawResponse);
              if (Array.isArray(tcList) && tcList.length > 0) {
                const toolIndex = allMessages
                  .slice(allMessages.indexOf(precedingAssistant) + 1, allMessages.indexOf(m))
                  .filter(msg => msg.role === "tool").length;
                
                if (tcList[toolIndex]) {
                  chatMsg.tool_call_id = tcList[toolIndex].id;
                  chatMsg.name = tcList[toolIndex].function.name;
                }
              }
            } catch (e) {}
          }
          
          if (!chatMsg.tool_call_id) {
            chatMsg.tool_call_id = "call_fallback";
            chatMsg.name = "write_file";
          }
        } else if (m.role === "assistant" && m.rawResponse) {
          try {
            const tcs = JSON.parse(m.rawResponse);
            if (Array.isArray(tcs)) {
              chatMsg.toolCalls = tcs;
            }
          } catch (e) {}
        }
        chatMessages.push(chatMsg);
      }

      let completionDone = false;
      let currentMessages = [...chatMessages];

      console.log(`[Orchestrator] Run ${runId} - Entering GENERATING state for continuation`);
      this.emitStatus(runId, "generating");

      while (!completionDone) {
        checkCancelled();

        const response = await provider.complete({
          model: run.model,
          systemPrompt: buildSystemPrompt(run.projectName, run.projectPath, run.mode),
          messages: currentMessages,
          tools: WORKSPACE_TOOLS
        });

        checkCancelled();

        if (response.toolCalls && response.toolCalls.length > 0) {
          // Save assistant message
          const assistantMsgId = `msg-res-tools-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const assistantMsg: RunMessage = {
            id: assistantMsgId,
            runId,
            role: "assistant",
            providerId: run.providerId,
            providerDisplayName: run.providerDisplayName,
            model: run.model,
            content: response.content || "Calling workspace tools...",
            rawResponse: JSON.stringify(response.toolCalls),
            createdAt: new Date().toISOString()
          };
          this.emitMessage(runId, assistantMsg);

          currentMessages.push({
            role: "assistant",
            content: response.content || "",
            toolCalls: response.toolCalls
          });

          // Execute each tool call
          for (const tc of response.toolCalls) {
            checkCancelled();
            let result = "";

            try {
              const args = JSON.parse(tc.function.arguments);
              const relativePath = args.path;
              if (!relativePath) {
                throw new Error("Missing parameter: path");
              }

              const baseDir = run.projectPath || process.cwd();
              const absolutePath = path.resolve(baseDir, relativePath);

              if (!absolutePath.startsWith(baseDir)) {
                throw new Error(`Access denied: path '${relativePath}' is outside of the workspace directory.`);
              }

              // Check permission if in 'ask_permissions' mode
              if (run.mode === "ask_permissions") {
                const allowed = this.checkPermission(run.projectPath);
                if (!allowed) {
                  const decision = await this.requestPermission(runId, tc);
                  if (decision === "deny") {
                    throw new Error("Permission denied by user.");
                  }
                  this.emitStatus(runId, "generating");
                }
              }

              if (tc.function.name === "write_file") {
                fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                fs.writeFileSync(absolutePath, args.content || "", "utf-8");
                result = JSON.stringify({ success: true, message: `File written successfully at ${relativePath}` });
              } else if (tc.function.name === "delete_file") {
                if (fs.existsSync(absolutePath)) {
                  fs.unlinkSync(absolutePath);
                  result = JSON.stringify({ success: true, message: `File deleted successfully at ${relativePath}` });
                } else {
                  result = JSON.stringify({ success: false, message: `File not found at ${relativePath}` });
                }
              } else {
                throw new Error(`Unknown function: ${tc.function.name}`);
              }
            } catch (err: any) {
              result = JSON.stringify({ success: false, error: err.message });
            }

            const toolMsg: RunMessage = {
              id: `msg-tool-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              runId,
              role: "tool",
              content: result,
              createdAt: new Date().toISOString()
            };
            this.emitMessage(runId, toolMsg);

            currentMessages.push({
              role: "tool",
              content: result,
              tool_call_id: tc.id,
              name: tc.function.name
            });
          }
        } else {
          // Final assistant message
          const assistantMsg: RunMessage = {
            id: `msg-res-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            runId,
            role: "assistant",
            providerId: run.providerId,
            providerDisplayName: run.providerDisplayName,
            model: run.model,
            content: response.content,
            createdAt: new Date().toISOString()
          };
          this.emitMessage(runId, assistantMsg);
          completionDone = true;
        }
      }

      this.emitStatus(runId, "done");
      const lastContent = currentMessages[currentMessages.length - 1]?.content || "";
      eventBus.emit(`run:${runId}`, { type: "run_completed", finalOutput: lastContent });
      console.log(`[Orchestrator] Run ${runId} continuation completed successfully.`);

    } catch (error: any) {
      if (error.message === "ORCHESTRATION_CANCELLED") {
        console.log(`[Orchestrator] Run ${runId} - Continuation safely cancelled.`);
      } else {
        console.error(`[Orchestrator] Run ${runId} - Continuation failed:`, error.message);
        this.emitStatus(runId, "failed", { errorMessage: error.message });
        eventBus.emit(`run:${runId}`, { type: "run_failed", errorMessage: error.message });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }
}
