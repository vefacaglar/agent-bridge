import { Marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

const marked = new Marked({ gfm: true, breaks: true });

let codeBlockCounter = 0;
let currentPrefix = '';

marked.use({
  renderer: {
    code(token: { text: string; lang?: string; escaped?: boolean }) {
      const code = token.text;
      const lang = token.lang || '';

      let highlightedCode = '';
      let hasHighlighting = false;

      if (lang && hljs.getLanguage(lang)) {
        try {
          highlightedCode = hljs.highlight(code, { language: lang }).value;
          hasHighlighting = true;
        } catch (e) {
          console.error('highlight.js error:', e);
        }
      } else if (!lang) {
        try {
          const result = hljs.highlightAuto(code);
          highlightedCode = result.value;
          hasHighlighting = true;
        } catch (e) {
          // ignore
        }
      }

      if (hasHighlighting) {
        highlightedCode = highlightedCode.replace(
          /<span class="hljs-string">(?:&quot;&quot;&quot;|&#x27;&#x27;&#x27;|&#x39;&#x39;&#x39;|&#39;&#39;&#39;)[\s\S]*?(?:&quot;&quot;&quot;|&#x27;&#x27;&#x27;|&#x39;&#x39;&#x39;|&#39;&#39;&#39;)<\/span>/g,
          (match) => match.replace('hljs-string', 'hljs-comment')
        );
      }

      // Escape HTML entities as fallback to prevent rendering issues in raw code blocks.
      if (!hasHighlighting) {
        highlightedCode = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      const displayLang = lang || 'code';
      const blockId = currentPrefix ? `${currentPrefix}-code-${codeBlockCounter++}` : `code-block-${codeBlockCounter++}`;

      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-block-lang">${displayLang}</span>
            <button class="code-block-copy-btn" onclick="
              const codeText = this.closest('.code-block-wrapper').querySelector('code').innerText;
              navigator.clipboard.writeText(codeText);
              this.classList.add('copied');
              this.querySelector('.copy-icon').style.display = 'none';
              this.querySelector('.check-icon').style.display = 'inline-block';
              setTimeout(() => {
                this.classList.remove('copied');
                this.querySelector('.copy-icon').style.display = 'inline-block';
                this.querySelector('.check-icon').style.display = 'none';
              }, 2000);
            " title="Copy code">
              <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
          </div>
          <pre id="${blockId}"><code class="hljs language-${displayLang}">${highlightedCode}</code></pre>
        </div>
      `;
    }
  }
});

const markdownCache = new Map<string, { content: string; rendered: string }>();
const MAX_CACHE_SIZE = 500;

export function clearMarkdownCache(): void {
  markdownCache.clear();
}

/** Renders markdown to HTML, falling back to raw text on parse errors. */
export function renderMarkdown(content: string, idPrefix?: string): string {
  if (!content) return '';

  const cacheKey = idPrefix ? `${idPrefix}:${content.length}` : null;
  if (cacheKey) {
    const cached = markdownCache.get(cacheKey);
    if (cached && cached.content === content) {
      return cached.rendered;
    }
  }

  codeBlockCounter = 0;
  currentPrefix = idPrefix || '';
  try {
    const rendered = marked.parse(content) as string;
    if (cacheKey) {
      if (markdownCache.size >= MAX_CACHE_SIZE) {
        const firstKey = markdownCache.keys().next().value;
        if (firstKey !== undefined) {
          markdownCache.delete(firstKey);
        }
      }
      markdownCache.set(cacheKey, { content, rendered });
    }
    return rendered;
  } catch (err) {
    console.error('Markdown parsing error:', err);
    return content;
  }
}

/** Strips internal <plan>...</plan> and <task_list>...</task_list> blocks before displaying assistant text.
 *  Also strips a not-yet-closed block (open tag with no closing tag) so a partial block being
 *  streamed in is hidden instead of rendering raw markdown until generation finishes. */
export function cleanMessageContent(content: string): string {
  return content
    .replace(/<plan>[\s\S]*?<\/plan>/g, '')
    .replace(/<task_list>[\s\S]*?<\/task_list>/g, '')
    .replace(/<plan>[\s\S]*$/g, '')
    .replace(/<task_list>[\s\S]*$/g, '')
    .replace(/<\/?confirm\b[^>]*>/ig, '')
    .trim();
}

/** Parses and cleans up system error messages that might contain raw provider JSON */
export function formatSystemErrorMessage(content: string): string {
  if (!content) return '';
  const jsonMatch = content.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    const rawJson = jsonMatch[1];
    try {
      const parsed = JSON.parse(rawJson);
      let cleanMsg = "";
      if (parsed.error) {
        if (typeof parsed.error === "object" && typeof parsed.error.message === "string") {
          cleanMsg = parsed.error.message;
        } else if (typeof parsed.error === "string") {
          cleanMsg = parsed.error;
        }
      } else if (typeof parsed.message === "string") {
        cleanMsg = parsed.message;
      } else if (typeof parsed.msg === "string") {
        cleanMsg = parsed.msg;
      }
      
      if (cleanMsg) {
        return content.replace(rawJson, cleanMsg);
      }
    } catch {
      // ignore
    }
  }
  return content;
}

export interface PreScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  wasAtBottom: boolean;
}

/**
 * Captures scroll state of all pre elements inside a container.
 */
export function capturePreScrollStates(container: HTMLElement | null): Map<string, PreScrollState> {
  const states = new Map<string, PreScrollState>();
  if (!container) return states;

  const preElements = container.querySelectorAll('pre[id]');
  preElements.forEach((el) => {
    const pre = el as HTMLElement;
    const wasAtBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight <= 60;
    states.set(pre.id, {
      scrollTop: pre.scrollTop,
      scrollHeight: pre.scrollHeight,
      clientHeight: pre.clientHeight,
      wasAtBottom
    });
  });

  return states;
}

/**
 * Restores scroll state of all pre elements inside a container.
 */
export function restorePreScrollStates(container: HTMLElement | null, states: Map<string, PreScrollState>) {
  if (!container) return;

  const preElements = container.querySelectorAll('pre[id]');
  preElements.forEach((el) => {
    const pre = el as HTMLElement;
    if (states.has(pre.id)) {
      const state = states.get(pre.id)!;
      if (state.wasAtBottom) {
        pre.scrollTop = pre.scrollHeight;
      } else {
        pre.scrollTop = state.scrollTop;
      }
    } else {
      // New code block being generated: default to auto-scrolling to the bottom.
      pre.scrollTop = pre.scrollHeight;
    }
  });
}
