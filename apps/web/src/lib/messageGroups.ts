import type { RunMessage } from '@bridgemind/shared';
import { formatJson } from './format';

export interface MessageGroup {
  type: 'user' | 'assistant' | 'tool_group';
  id: string;
  message: RunMessage;
  toolCalls: any[];
  toolResponses: RunMessage[];
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
  const result: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      result.push({ type: 'user', id: msg.id, message: msg, toolCalls: [], toolResponses: [] });
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
