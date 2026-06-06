import type { RunMessage } from '@agent-bridge/shared';
import { formatJson } from './format';

export interface MessageGroup {
  type: 'user' | 'assistant' | 'tool_group' | 'system' | 'coder_group';
  id: string;
  message: RunMessage;
  toolCalls: any[];
  toolResponses: RunMessage[];
  /** Only set for `coder_group`: the sub-agent's own groups, rendered nested. */
  children?: MessageGroup[];
}

/** Whether an assistant message carries serialized tool calls in rawResponse. */
export function hasToolCalls(message: RunMessage): boolean {
  if (!message.rawResponse) return false;
  try {
    const parsed = JSON.parse(message.rawResponse);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch (e) {
    return false;
  }
}

/** Treats a tool response as successful unless it explicitly reports failure. */
export function isToolSuccess(content: string): boolean {
  try {
    return JSON.parse(content).success !== false;
  } catch (e) {
    return true;
  }
}

/** Collapses structural tool data classes for styling. */
export function getToolStatusClass(response?: RunMessage): string {
  if (!response) return 'pending';
  return isToolSuccess(response.content) ? 'success' : 'failed';
}

export function formatToolArgs(args?: string): string {
  if (!args) return '';
  return formatJson(args);
}

/**
 * Collapses the flat message list into renderable groups, pairing each
 * tool-calling assistant message with the tool responses that follow it.
 */
export function groupMessages(messages: RunMessage[]): MessageGroup[] {
  return foldCoderGroups(buildFlatGroups(messages));
}

/**
 * Collapses runs of consecutive coder (sub-agent) groups into a single
 * `coder_group` so the UI can render them in one contained, scrollable box
 * instead of letting sub-agent chatter spill into the main thread.
 */
function foldCoderGroups(flat: MessageGroup[]): MessageGroup[] {
  const result: MessageGroup[] = [];
  let i = 0;
  while (i < flat.length) {
    if (flat[i].message.agentRole === 'coder') {
      const children: MessageGroup[] = [];
      while (i < flat.length && flat[i].message.agentRole === 'coder') {
        children.push(flat[i]);
        i++;
      }
      result.push({
        type: 'coder_group',
        id: `coder-${children[0].id}`,
        message: children[0].message,
        toolCalls: [],
        toolResponses: [],
        children
      });
    } else {
      result.push(flat[i]);
      i++;
    }
  }
  return result;
}

function buildFlatGroups(messages: RunMessage[]): MessageGroup[] {
  const result: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      result.push({ type: 'user', id: msg.id, message: msg, toolCalls: [], toolResponses: [] });
      i++;
    } else if (msg.role === 'system') {
      result.push({ type: 'system', id: msg.id, message: msg, toolCalls: [], toolResponses: [] });
      i++;
    } else if (msg.role === 'assistant') {
      if (hasToolCalls(msg)) {
        let toolCalls: any[] = [];
        try {
          toolCalls = JSON.parse(msg.rawResponse || '[]');
        } catch (e) {
          toolCalls = [];
        }

        const toolResponses: RunMessage[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role === 'tool') {
          toolResponses.push(messages[j]);
          j++;
        }

        result.push({ type: 'tool_group', id: msg.id, message: msg, toolCalls, toolResponses });
        i = j;
      } else {
        result.push({ type: 'assistant', id: msg.id, message: msg, toolCalls: [], toolResponses: [] });
        i++;
      }
    } else if (msg.role === 'tool') {
      result.push({
        type: 'tool_group',
        id: msg.id,
        message: msg,
        toolCalls: [{ function: { name: 'Workspace Tool Output', arguments: '{}' } }],
        toolResponses: [msg]
      });
      i++;
    } else {
      i++;
    }
  }

  return result;
}
