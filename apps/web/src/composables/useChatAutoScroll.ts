import { nextTick, watch, type Ref } from 'vue';
import type { RunMessage } from '@agent-bridge/shared';

export function useChatAutoScroll(
  container: Ref<HTMLElement | null>,
  messages: Ref<RunMessage[]>,
  isRunning: Ref<boolean>,
  activeRunId: Ref<string | null>
) {
  let forceScrollNext = false;
  let wasThinkingLastTime = false;

  function scrollToBottom() {
    if (!container.value) return;
    container.value.scrollTop = container.value.scrollHeight;
  }

  function isAtBottom(el: HTMLElement, threshold = 60) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  // Watch activeRunId to force scroll when chat loads.
  watch(activeRunId, () => {
    forceScrollNext = true;
    wasThinkingLastTime = false;
    nextTick(scrollToBottom);
  });

  watch(
    messages,
    (newMessages) => {
      if (!container.value) return;

      const lastMsg = newMessages && newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;

      // Avoid scrolling the main chat screen down when the model is only in the thinking/reasoning phase
      const isThinking = lastMsg && lastMsg.role === 'assistant' && lastMsg.reasoningContent && !lastMsg.content;

      // Detect transition from thinking to responding
      const transitionedToResponding = wasThinkingLastTime && !isThinking;
      wasThinkingLastTime = !!isThinking;

      // We force scroll if:
      // - forceScrollNext flag is set (e.g. activeRunId changed)
      // - The last message is a user message (user just sent a message)
      // - The model just transitioned from thinking to responding
      const forceScroll = forceScrollNext || (lastMsg && lastMsg.role === 'user') || transitionedToResponding;

      // Clear the forceScrollNext flag for future message updates
      forceScrollNext = false;

      const wasAtBottom = isAtBottom(container.value);

      nextTick(() => {
        if (!isThinking && (forceScroll || wasAtBottom)) {
          scrollToBottom();
        }
      });
    },
    { deep: true }
  );

  // Watch container in case it gets mounted/unmounted.
  watch(container, (newVal) => {
    if (newVal) {
      nextTick(scrollToBottom);
    }
  });

  // Watch isRunning to auto-scroll on start/stop.
  watch(isRunning, (running) => {
    if (!container.value) return;
    const wasAtBottom = isAtBottom(container.value);
    nextTick(() => {
      if (running || wasAtBottom) {
        scrollToBottom();
      }
    });
  });

  return { scrollToBottom };
}

