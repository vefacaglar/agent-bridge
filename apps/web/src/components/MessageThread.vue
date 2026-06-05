<script setup lang="ts">
import type { Run } from '@bridgemind/shared';
import type { MessageGroup } from '../lib/messageGroups';
import { renderMarkdown, cleanMessageContent } from '../lib/markdown';
import { formatTime } from '../lib/format';
import ToolGroup from './ToolGroup.vue';

defineProps<{
  activeRun: Run | null;
  groupedMessages: MessageGroup[];
  isRunning: boolean;
}>();

function copyText(value: string) {
  navigator.clipboard.writeText(value);
}
</script>

<template>
  <div v-if="!activeRun" class="empty-chat">
    <div class="welcome-gradient-logo">BM</div>
    <h1>BridgeMind</h1>
    <p>Select a model below and type a prompt to start a local or cloud chat session.</p>
  </div>

  <div v-else class="messages-inner">
    <article class="user-bubble">
      <pre>{{ activeRun.task }}</pre>
    </article>

    <template v-for="group in groupedMessages" :key="group.id">
      <article v-if="group.type === 'user'" class="user-bubble">
        <pre>{{ group.message.content }}</pre>
      </article>

      <ToolGroup
        v-else-if="group.type === 'tool_group'"
        :tool-calls="group.toolCalls"
        :tool-responses="group.toolResponses"
      />

      <article v-else-if="group.type === 'assistant'" class="assistant-message">
        <div class="assistant-meta">
          <span class="agent-badge">AI Assistant</span>
          <span>{{ group.message.providerDisplayName }} / {{ group.message.model }}</span>
          <span>{{ formatTime(group.message.createdAt) }}</span>
        </div>
        <div class="markdown-body" v-html="renderMarkdown(cleanMessageContent(group.message.content))"></div>
        <button class="copy-button" @click="copyText(group.message.content)">Copy entire response</button>
      </article>
    </template>

    <div v-if="activeRun.status === 'failed'" class="system-line danger">
      {{ activeRun.errorMessage || 'Chat generation failed.' }}
    </div>

    <div v-if="isRunning" class="system-line active pulsing-loader">
      AI is thinking...
    </div>
  </div>
</template>

<style scoped>
.welcome-gradient-logo {
  width: 68px;
  height: 68px;
  border-radius: 20px;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 850;
  font-size: 1.6rem;
  background: linear-gradient(135deg, var(--success), var(--planner));
  color: var(--bg);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  animation: logoPulse 4s infinite alternate;
}

@keyframes logoPulse {
  0% { transform: scale(1); filter: brightness(1); }
  100% { transform: scale(1.05); filter: brightness(1.1); }
}

.pulsing-loader {
  animation: pulseOpacity 1.5s infinite alternate;
}

@keyframes pulseOpacity {
  0% { opacity: 0.6; }
  100% { opacity: 1; }
}
</style>
