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
              this.innerText = 'Copied!';
              this.classList.add('copied');
              setTimeout(() => { this.innerText = 'Copy'; this.classList.remove('copied'); }, 2000);
            ">Copy</button>
          </div>
          <pre id="${blockId}"><code class="hljs language-${displayLang}">${highlightedCode}</code></pre>
        </div>
      `;
    }
  }
});

/** Renders markdown to HTML, falling back to raw text on parse errors. */
export function renderMarkdown(content: string, idPrefix?: string): string {
  if (!content) return '';
  codeBlockCounter = 0;
  currentPrefix = idPrefix || '';
  try {
    const html = marked.parse(content) as string;
    
    // Process text nodes to wrap emojis in muted spans
    // Splitting by HTML tags guarantees that even indices are text nodes and odd indices are tags.
    const parts = html.split(/(<[^>]+>)/g);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        parts[i] = parts[i].replace(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu, '<span class="muted-emoji">$1</span>');
      }
    }
    return parts.join('');
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
