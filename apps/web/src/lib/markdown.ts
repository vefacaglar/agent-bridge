import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  renderer: {
    code(token: { text: string; lang?: string; escaped?: boolean }) {
      const code = token.text;
      const lang = token.lang || 'code';

      // Escape HTML entities to prevent rendering issues in raw code blocks.
      const safeCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-block-lang">${lang}</span>
            <button class="code-block-copy-btn" onclick="
              const codeText = this.closest('.code-block-wrapper').querySelector('code').innerText;
              navigator.clipboard.writeText(codeText);
              this.innerText = 'Copied!';
              this.classList.add('copied');
              setTimeout(() => { this.innerText = 'Copy'; this.classList.remove('copied'); }, 2000);
            ">Copy</button>
          </div>
          <pre><code class="language-${lang}">${safeCode}</code></pre>
        </div>
      `;
    }
  }
});

/** Renders markdown to HTML, falling back to raw text on parse errors. */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  try {
    return marked.parse(content) as string;
  } catch (err) {
    console.error('Markdown parsing error:', err);
    return content;
  }
}

/** Strips internal <plan>...</plan> blocks before displaying assistant text. */
export function cleanMessageContent(content: string): string {
  return content.replace(/<plan>[\s\S]*?<\/plan>/g, '').trim();
}
