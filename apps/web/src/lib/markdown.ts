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

/** Strips internal <plan>...</plan> and <task_list>...</task_list> blocks before displaying assistant text. */
export function cleanMessageContent(content: string): string {
  return content
    .replace(/<plan>[\s\S]*?<\/plan>/g, '')
    .replace(/<task_list>[\s\S]*?<\/task_list>/g, '')
    .trim();
}
