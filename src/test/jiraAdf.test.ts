import { describe, it, expect } from 'vitest';
import { adfToMarkdown, markdownToHtml, textToAdf, type AdfNode } from '../providers/jira/adf';

const doc: AdfNode = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
      ],
    },
  ],
};

describe('adfToMarkdown', () => {
  it('converts paragraphs and strong marks to markdown', () => {
    const md = adfToMarkdown(doc);
    expect(md).toContain('Hello **world**');
  });
  it('converts bullet lists', () => {
    const md = adfToMarkdown(doc);
    expect(md).toContain('one');
    expect(md).toContain('two');
  });
  it('handles null', () => {
    expect(adfToMarkdown(null)).toBe('');
  });
});

describe('markdownToHtml', () => {
  it('renders bold and italic', () => {
    expect(markdownToHtml('a **b** c')).toBe('<p>a <strong>b</strong> c</p>');
    expect(markdownToHtml('a *b* c')).toBe('<p>a <em>b</em> c</p>');
  });
  it('renders headings', () => {
    expect(markdownToHtml('## Title')).toBe('<h2>Title</h2>');
  });
  it('renders bullet lists', () => {
    expect(markdownToHtml('* one\n* two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });
  it('renders inline code', () => {
    expect(markdownToHtml('use `x` here')).toBe('<p>use <code>x</code> here</p>');
  });
  it('renders links', () => {
    expect(markdownToHtml('[label](https://x.com)')).toBe(
      '<p><a href="https://x.com">label</a></p>',
    );
  });
  it('renders code fences', () => {
    expect(markdownToHtml('```\nconst x = 1;\n```')).toBe('<pre><code>const x = 1;</code></pre>');
  });
  it('escapes html in text', () => {
    expect(markdownToHtml('<script>')).toBe('<p>&lt;script&gt;</p>');
  });
  it('returns empty for empty input', () => {
    expect(markdownToHtml('')).toBe('');
  });
});

describe('textToAdf', () => {
  it('wraps each line in a paragraph', () => {
    expect(textToAdf('hello')).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
  });

  it('preserves blank lines as empty paragraphs', () => {
    const adf = textToAdf('a\n\nb');
    expect(adf.content).toHaveLength(3);
    expect(adf.content?.[1]).toEqual({ type: 'paragraph' });
  });
});
