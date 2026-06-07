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

  function scrollToUserMessage() {
    if (!container.value) return;
    const userContainers = container.value.querySelectorAll('.user-message-container');
    const lastUserContainer = userContainers[userContainers.length - 1] as HTMLElement | undefined;
    if (lastUserContainer) {
      // Put the new user turn as high as possible while leaving a small visual inset.
      const topOffset = lastUserContainer.getBoundingClientRect().top - container.value.getBoundingClientRect().top + container.value.scrollTop - 16;
      container.value.scrollTo({
        top: Math.max(0, topOffset),
        behavior: 'smooth'
      });
    }
  }

  // Watch activeRunId to force scroll when chat loads.
  watch(activeRunId, () => {
    forceScrollNext = true;
    wasThinkingLastTime = false;
    nextTick(scrollToBottom);
  });

  watch(
    () => {
      const last = messages.value[messages.value.length - 1];
      return {
        length: messages.value.length,
        lastId: last?.id,
        lastContentLength: last?.content?.length ?? 0,
        lastReasoningLength: last?.reasoningContent?.length ?? 0
      };
    },
    () => {
      if (!container.value) return;

      const lastMsg = messages.value.length > 0 ? messages.value[messages.value.length - 1] : null;

      // Avoid scrolling the main chat screen down when the model is only in the thinking/reasoning phase
      const isThinking = lastMsg && lastMsg.role === 'assistant' && lastMsg.reasoningContent && !lastMsg.content;

      // Detect transition from thinking to responding
      const transitionedToResponding = wasThinkingLastTime && !isThinking;
      wasThinkingLastTime = !!isThinking;

      const isUserMsg = lastMsg && lastMsg.role === 'user';

      // We force scroll if:
      // - forceScrollNext flag is set (e.g. activeRunId changed)
      // - The model just transitioned from thinking to responding
      const forceScroll = forceScrollNext || transitionedToResponding;

      // Clear the forceScrollNext flag for future message updates
      forceScrollNext = false;

      const wasAtBottom = isAtBottom(container.value, 180);

      nextTick(() => {
        if (isUserMsg && (forceScroll || wasAtBottom)) {
          scrollToUserMessage();
        } else if (!isThinking && (forceScroll || wasAtBottom)) {
          scrollToBottom();
          if (forceScroll) {
            setTimeout(scrollToBottom, 50);
            setTimeout(scrollToBottom, 150);
          }
        }
      });
    }
  );

  // Watch container in case it gets mounted/unmounted.
  watch(container, (newVal) => {
    if (newVal) {
      nextTick(scrollToBottom);
      setTimeout(scrollToBottom, 50);
      setTimeout(scrollToBottom, 150);
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
