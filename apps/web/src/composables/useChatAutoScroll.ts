import { nextTick, watch, type Ref } from 'vue';
import type { RunMessage } from '@bridgemind/shared';

export function useChatAutoScroll(
  container: Ref<HTMLElement | null>,
  messages: Ref<RunMessage[]>,
  isRunning: Ref<boolean>,
  activeRunId: Ref<string | null>
) {
  function scrollToBottom() {
    if (!container.value) return;
    container.value.scrollTop = container.value.scrollHeight;
  }

  watch(messages, () => nextTick(scrollToBottom), { deep: true });
  watch(isRunning, () => nextTick(scrollToBottom));
  watch(activeRunId, () => nextTick(scrollToBottom));

  return { scrollToBottom };
}
