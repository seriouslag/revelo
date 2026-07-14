import { convert } from 'adf-to-md';
import { escapeHtml } from '../github/render';

export interface AdfNode {
  type: string;
  version?: number;
  text?: string;
  content?: AdfNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

/**
 * Convert an ADF document to Markdown using adf-to-md, which handles the full
 * node/mark set (headings, lists, tables, code, links, marks, etc.). Markdown
 * is rendered natively by VS Code hovers and is the editable form in the panel.
 */
export function adfToMarkdown(node: AdfNode | undefined | null): string {
  if (!node) {
    return '';
  }
  try {
    return convert(node).result;
  } catch {
    return '';
  }
}

/**
 * Minimal, safe Markdown -> HTML for the webview panel. Covers the common
 * subset adf-to-md emits (headings, bold/italic/code, links, lists, code
 * fences). All text is HTML-escaped first, so this cannot inject markup.
 */
export function markdownToHtml(md: string): string {
  if (!md) {
    return '';
  }
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  const codeBuffer: string[] = [];

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    const fence = line.trim().startsWith('```');
    if (fence) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer.length = 0;
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*[*-]\s+(.*)$/);
    if (listItem) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(listItem[1])}</li>`);
      continue;
    }

    closeList();
    if (line.trim() === '') {
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }
  closeList();
  return out.join('\n');
}

/** Inline markdown (bold, italic, code, links) on already-escaped text. */
function inline(text: string): string {
  let s = escapeHtml(text);
  // links [label](href) — href is escaped by the earlier escapeHtml pass.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return s;
}

/**
 * Convert plain text (from the edit textarea) into a minimal ADF document:
 * each line becomes a paragraph. Empty lines become empty paragraphs so blank
 * separation is preserved. This is lossy — it does not round-trip rich marks —
 * but is safe and predictable for edits.
 */
export function textToAdf(text: string): AdfNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) =>
      line.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    ),
  };
}
