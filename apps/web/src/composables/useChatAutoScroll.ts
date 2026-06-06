import { nextTick, watch, type Ref } from 'vue';
import type { RunMessage } from '@agent-bridge/shared';

export function useChatAutoScroll(
  container: Ref<HTMLElement | null>,
  messages: Ref<RunMessage[]>,
  isRunning: Ref<boolean>,
  activeRunId: Ref<string | null>
) {
  let forceScrollNext = false;

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
    nextTick(scrollToBottom);
  });

  watch(
    messages,
    (newMessages) => {
      if (!container.value) return;

      const lastMsg = newMessages && newMessages.length > 0 ? newMessages[newMessages.length - 1] : null;

      // We force scroll if:
      // - forceScrollNext flag is set (e.g. activeRunId changed)
      // - The last message is a user message (user just sent a message)
      const forceScroll = forceScrollNext || (lastMsg && lastMsg.role === 'user');

      // Clear the forceScrollNext flag for future message updates
      forceScrollNext = false;

      const wasAtBottom = isAtBottom(container.value);

      nextTick(() => {
        if (forceScroll || wasAtBottom) {
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

