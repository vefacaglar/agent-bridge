import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

createApp(App).mount('#app')

// Global scrollbar visibility handler during active scrolling
const scrollTimeouts = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

window.addEventListener('scroll', (event) => {
  const target = event.target as HTMLElement;
  if (!target || !target.classList || (target as any) === document || (target as any) === window) return;

  target.classList.add('is-scrolling');

  const prevTimeout = scrollTimeouts.get(target);
  if (prevTimeout) {
    clearTimeout(prevTimeout);
  }

  const timeout = setTimeout(() => {
    target.classList.remove('is-scrolling');
    scrollTimeouts.delete(target);
  }, 800); // Hide 800ms after scrolling stops

  scrollTimeouts.set(target, timeout);
}, true); // Capture phase is necessary since scroll events do not bubble
