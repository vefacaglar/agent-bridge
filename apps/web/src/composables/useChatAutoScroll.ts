import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import type { RunMessage } from '@agent-bridge/shared';

export function useChatAutoScroll(
  container: Ref<HTMLElement | null>,
  messages: Ref<RunMessage[]>,
  isRunning: Ref<boolean>,
  activeRunId: Ref<string | null>
) {
  let forceScrollNext = false;
  const stickyBottomThreshold = 24;
  const userScrollQuietMs = 700;
  let suppressAutoScrollUntil = 0;
  let programmaticScrollFrame: number | null = null;
  let isProgrammaticScrolling = false;
  let programmaticScrollTimeout: number | null = null;

  function isUserScrollActive() {
    return Date.now() < suppressAutoScrollUntil;
  }

  function setProgrammaticScrollActive(duration = 800) {
    isProgrammaticScrolling = true;
    if (programmaticScrollTimeout !== null) {
      clearTimeout(programmaticScrollTimeout);
    }
    programmaticScrollTimeout = window.setTimeout(() => {
      isProgrammaticScrolling = false;
      programmaticScrollTimeout = null;
    }, duration);
  }

  function markProgrammaticScroll() {
    if (programmaticScrollFrame !== null) {
      cancelAnimationFrame(programmaticScrollFrame);
    }
    programmaticScrollFrame = requestAnimationFrame(() => {
      programmaticScrollFrame = null;
    });
  }

  function scrollToBottom(force = false) {
    if (!container.value) return;
    if (!force && isUserScrollActive()) return;

    markProgrammaticScroll();

    // Temporarily disable smooth scroll to avoid triggering pauseAutoScroll during animation
    const el = container.value;
    const originalScrollBehavior = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    el.style.scrollBehavior = originalScrollBehavior;
  }

  function isAtBottom(el: HTMLElement, threshold = stickyBottomThreshold) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }

  function scrollToUserMessage() {
    if (!container.value) return;
    const userContainers = container.value.querySelectorAll('.user-message-container');
    const lastUserContainer = userContainers[userContainers.length - 1] as HTMLElement | undefined;
    if (lastUserContainer) {
      // Put the new user turn as high as possible while leaving a small visual inset.
      const topOffset = lastUserContainer.getBoundingClientRect().top - container.value.getBoundingClientRect().top + container.value.scrollTop - 16;
      
      markProgrammaticScroll();
      
      // Set programmatic scrolling active so that async smooth scroll events do not trigger pauseAutoScroll
      setProgrammaticScrollActive(800);

      container.value.scrollTo({
        top: Math.max(0, topOffset),
        behavior: 'smooth'
      });
    }
  }

  function pauseAutoScroll() {
    suppressAutoScrollUntil = Date.now() + userScrollQuietMs;
  }

  function handleScrollInteraction() {
    pauseAutoScroll();
  }

  function handleScroll() {
    if (programmaticScrollFrame !== null || isProgrammaticScrolling || !container.value) return;
    if (!isAtBottom(container.value)) pauseAutoScroll();
  }

  // Watch activeRunId to force scroll when chat loads.
  watch(activeRunId, () => {
    forceScrollNext = true;
    suppressAutoScrollUntil = 0;
    nextTick(() => scrollToBottom(true));
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

      const isUserMsg = lastMsg && lastMsg.role === 'user';

      // Only force scroll when a different run is loaded. Streaming updates
      // should follow the bottom only while the user is already pinned there.
      const forceScroll = forceScrollNext;

      // Clear the forceScrollNext flag for future message updates
      forceScrollNext = false;

      const wasAtBottom = isAtBottom(container.value);

      nextTick(() => {
        if (isUserMsg && (forceScroll || wasAtBottom)) {
          scrollToUserMessage();
        } else if (forceScroll || wasAtBottom) {
          scrollToBottom(forceScroll || wasAtBottom);
          if (forceScroll) {
            requestAnimationFrame(() => scrollToBottom(true));
          }
        }
      });
    }
  );

  // Watch container in case it gets mounted/unmounted.
  function removeContainerListeners(el: HTMLElement | null) {
    el?.removeEventListener('wheel', handleScrollInteraction);
    el?.removeEventListener('touchstart', handleScrollInteraction);
    el?.removeEventListener('pointerdown', handleScrollInteraction);
    el?.removeEventListener('scroll', handleScroll);
  }

  function addContainerListeners(el: HTMLElement | null) {
    el?.addEventListener('wheel', handleScrollInteraction, { passive: true });
    el?.addEventListener('touchstart', handleScrollInteraction, { passive: true });
    el?.addEventListener('pointerdown', handleScrollInteraction, { passive: true });
    el?.addEventListener('scroll', handleScroll, { passive: true });
  }

  watch(container, (newVal, oldVal) => {
    removeContainerListeners(oldVal);
    addContainerListeners(newVal);
    if (newVal) {
      suppressAutoScrollUntil = 0;
      nextTick(() => scrollToBottom(true));
    }
  });

  // Watch isRunning to auto-scroll on start/stop.
  watch(isRunning, () => {
    if (!container.value) return;
    const wasAtBottom = isAtBottom(container.value);
    nextTick(() => {
      if (wasAtBottom) {
        scrollToBottom(true);
      }
    });
  });

  onBeforeUnmount(() => {
    removeContainerListeners(container.value);
    if (programmaticScrollFrame !== null) {
      cancelAnimationFrame(programmaticScrollFrame);
    }
    if (programmaticScrollTimeout !== null) {
      clearTimeout(programmaticScrollTimeout);
    }
  });

  return { scrollToBottom };
}
