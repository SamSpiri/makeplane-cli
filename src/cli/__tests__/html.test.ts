import { describe, it, expect } from 'vitest';
import {
  bodyToHtml,
  detectMarkdown,
  inputToHtml,
  markdownToHtml,
  plainTextToHtml,
  parseInputFormat,
  renderRichHtml,
} from '../html.js';

describe('plainTextToHtml', () => {
  it('wraps single line in paragraph', () => {
    expect(plainTextToHtml('Hello world')).toBe('<p>Hello world</p>');
  });

  it('converts newlines within paragraph to <br>', () => {
    expect(plainTextToHtml('Line 1\nLine 2')).toBe('<p>Line 1<br>Line 2</p>');
  });

  it('splits blank-line-separated paragraphs', () => {
    expect(plainTextToHtml('Para 1\n\nPara 2')).toBe('<p>Para 1</p>\n<p>Para 2</p>');
  });

  it('escapes HTML entities', () => {
    expect(plainTextToHtml('<script>alert("xss")</script>')).toBe(
      '<p>&lt;script&gt;alert("xss")&lt;/script&gt;</p>',
    );
  });

  it('handles ampersand', () => {
    expect(plainTextToHtml('A & B')).toBe('<p>A &amp; B</p>');
  });

  it('trims whitespace in paragraphs', () => {
    expect(plainTextToHtml('  hello  \n  world  ')).toBe('<p>hello<br>world</p>');
  });

  it('skips empty paragraphs', () => {
    expect(plainTextToHtml('Para 1\n\n\n\nPara 2')).toBe('<p>Para 1</p>\n<p>Para 2</p>');
  });

  it('returns empty string for empty input', () => {
    expect(plainTextToHtml('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(plainTextToHtml('   \n\n  ')).toBe('');
  });
});

// ── parseInputFormat ──

describe('parseInputFormat', () => {
  it('accepts html', () => {
    expect(parseInputFormat('html')).toBe('html');
  });
  it('accepts markdown', () => {
    expect(parseInputFormat('markdown')).toBe('markdown');
  });
  it('accepts text', () => {
    expect(parseInputFormat('text')).toBe('text');
  });
  it('rejects unknown', () => {
    expect(() => parseInputFormat('json')).toThrow(/Invalid --format/);
    expect(() => parseInputFormat('md')).toThrow(/Invalid --format/);
    expect(() => parseInputFormat('')).toThrow(/Invalid --format/);
  });
});

// ── markdownToHtml ──

describe('markdownToHtml', () => {
  it('converts headings', () => {
    expect(markdownToHtml('## Section')).toContain('<h2>Section</h2>');
  });

  it('converts bold and italic', () => {
    const out = markdownToHtml('**bold** and *italic*');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('converts unordered lists', () => {
    const out = markdownToHtml('- one\n- two');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<li>two</li>');
  });

  it('converts inline code', () => {
    expect(markdownToHtml('use `npm install`')).toContain('<code>npm install</code>');
  });

  it('converts links', () => {
    expect(markdownToHtml('[click](https://example.com)')).toContain(
      '<a href="https://example.com">click</a>',
    );
  });
});

// ── inputToHtml dispatch ──

describe('inputToHtml', () => {
  it('passes html through unchanged when format is html', () => {
    const raw = '<p>raw <strong>html</strong></p>';
    expect(inputToHtml(raw, 'html')).toBe(raw);
  });

  it('does not escape when format is html (trust caller)', () => {
    expect(inputToHtml('<script>x</script>', 'html')).toBe('<script>x</script>');
  });

  it('converts markdown when format is markdown', () => {
    expect(inputToHtml('## Hi', 'markdown')).toContain('<h2>Hi</h2>');
  });

  it('wraps plain text when format is undefined (default)', () => {
    expect(inputToHtml('hello', undefined)).toBe('<p>hello</p>');
  });

  it('wraps plain text when format is text', () => {
    expect(inputToHtml('hello', 'text')).toBe('<p>hello</p>');
  });
});

// ── detectMarkdown ──

describe('detectMarkdown', () => {
  it('false for plain text', () => {
    expect(detectMarkdown('hello world')).toBe(false);
  });
  it('false for bullet-like dashes', () => {
    expect(detectMarkdown('- fix bug\n- add test')).toBe(false);
  });
  it('true for ATX heading', () => {
    expect(detectMarkdown('## Summary')).toBe(true);
  });
  it('true for fenced code', () => {
    expect(detectMarkdown('```js\ncode\n```')).toBe(true);
  });
  it('true for [link](url)', () => {
    expect(detectMarkdown('see [docs](https://x.com)')).toBe(true);
  });
  it('true for table row', () => {
    expect(detectMarkdown('| a | b |')).toBe(true);
  });
  it('false for #hashtag without space', () => {
    expect(detectMarkdown('#hashtag')).toBe(false);
  });
});

// ── bodyToHtml ──

describe('bodyToHtml', () => {
  it('auto-detects markdown from heading', () => {
    const html = bodyToHtml('## Hi');
    expect(html).toContain('<h2>Hi</h2>');
  });
  it('auto-detects markdown from code fence', () => {
    const html = bodyToHtml('```\ncode\n```');
    expect(html).toContain('<pre>');
  });
  it('auto-detects markdown from link', () => {
    const html = bodyToHtml('see [x](https://x.com)');
    expect(html).toContain('<a href="https://x.com">x</a>');
  });
  it('wraps plain text when nothing detected', () => {
    expect(bodyToHtml('hello')).toContain('<p>hello</p>');
  });
  it('explicit text skips detection', () => {
    const html = bodyToHtml('## heading', 'text');
    expect(html).not.toContain('<h2>');
    expect(html).toContain('## heading');
  });
  it('explicit markdown always converts', () => {
    expect(bodyToHtml('plain text', 'markdown')).toContain('<p>plain text</p>');
  });
  it('explicit html passes through', () => {
    expect(bodyToHtml('<p>hi</p>', 'html')).toBe('<p>hi</p>');
  });
  it('rejects invalid format', () => {
    expect(() => bodyToHtml('body', 'json')).toThrow(/Invalid --format/);
  });
});

// ── Terminal renderer tests ──

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('renderRichHtml text', () => {
  it('renders headings as bold text', () => {
    const result = renderRichHtml('<h2>Issue</h2>', 'text');
    expect(stripAnsi(result)).toContain('Issue');
  });

  it('renders bold inline text', () => {
    const result = renderRichHtml('<p>Hello <strong>world</strong></p>', 'text');
    expect(stripAnsi(result)).toContain('Hello world');
  });

  it('renders italic inline text', () => {
    const result = renderRichHtml('<p>Hello <em>world</em></p>', 'text');
    expect(stripAnsi(result)).toContain('Hello world');
  });

  it('renders unordered lists with bullets', () => {
    const result = renderRichHtml('<ul><li>one</li><li>two</li></ul>', 'text');
    expect(stripAnsi(result)).toContain('• one');
    expect(stripAnsi(result)).toContain('• two');
  });

  it('renders ordered lists with numbers', () => {
    const result = renderRichHtml('<ol><li>first</li><li>second</li></ol>', 'text');
    expect(stripAnsi(result)).toContain('1. first');
    expect(stripAnsi(result)).toContain('2. second');
  });

  it('renders inline code as dim text', () => {
    const result = renderRichHtml('<p>Use <code>const x = 1</code></p>', 'text');
    expect(stripAnsi(result)).toContain('Use const x = 1');
  });

  it('renders links as underlined text with URL', () => {
    const result = renderRichHtml('<a href="https://example.com">click</a>', 'text');
    const plain = stripAnsi(result);
    expect(plain).toContain('click');
    expect(plain).toContain('https://example.com');
  });

  it('renders blockquotes with bar prefix', () => {
    const result = renderRichHtml('<blockquote><p>quoted text</p></blockquote>', 'text');
    expect(stripAnsi(result)).toContain('quoted text');
  });

  it('strips unknown tags preserving text', () => {
    const result = renderRichHtml('<div><span>text</span></div>', 'text');
    expect(stripAnsi(result)).toBe('text');
  });

  it('decodes HTML entities', () => {
    const result = renderRichHtml('<p>a &amp; b</p>', 'text');
    expect(stripAnsi(result)).toBe('a & b');
  });

  it('renders images as alt text placeholder', () => {
    const result = renderRichHtml('<img alt="screenshot" src="img.png">', 'text');
    expect(stripAnsi(result)).toContain('[Image: screenshot]');
  });

  it('renders nested blockquotes with depth', () => {
    const html = '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>';
    const result = renderRichHtml(html, 'text');
    const plain = stripAnsi(result);
    expect(plain).toContain('outer');
    expect(plain).toContain('inner');
  });
});

// ── Markdown renderer tests ──

describe('renderRichHtml markdown', () => {
  it('renders h2 as markdown heading', () => {
    const result = renderRichHtml('<h2>Issue</h2>', 'markdown');
    expect(result).toBe('## Issue');
  });

  it('renders h1 as markdown heading', () => {
    const result = renderRichHtml('<h1>Title</h1>', 'markdown');
    expect(result).toBe('# Title');
  });

  it('renders bold inline', () => {
    const result = renderRichHtml('<p>Hello <strong>world</strong></p>', 'markdown');
    expect(result).toBe('Hello **world**');
  });

  it('renders italic inline', () => {
    const result = renderRichHtml('<p>Hello <em>world</em></p>', 'markdown');
    expect(result).toBe('Hello *world*');
  });

  it('renders unordered lists', () => {
    const result = renderRichHtml('<ul><li>one</li><li>two</li></ul>', 'markdown');
    expect(result).toContain('- one');
    expect(result).toContain('- two');
  });

  it('renders ordered lists', () => {
    const result = renderRichHtml('<ol><li>first</li><li>second</li></ol>', 'markdown');
    expect(result).toContain('1. first');
    expect(result).toContain('2. second');
  });

  it('renders inline code', () => {
    const result = renderRichHtml('<p>Use <code>x</code></p>', 'markdown');
    expect(result).toContain('`x`');
  });

  it('renders links', () => {
    const result = renderRichHtml('<a href="https://x.com">click</a>', 'markdown');
    expect(result).toContain('[click](https://x.com)');
  });

  it('renders blockquotes with > prefix', () => {
    const result = renderRichHtml('<blockquote><p>quote</p></blockquote>', 'markdown');
    expect(result).toContain('> quote');
  });

  it('renders nested blockquotes with > > prefix', () => {
    const html = '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toContain('> outer');
    expect(result).toContain('> > inner');
  });

  it('renders code blocks as fenced code', () => {
    const result = renderRichHtml('<pre>const x = 1;</pre>', 'markdown');
    expect(result).toBe('```\nconst x = 1;\n```');
  });

  it('renders images', () => {
    const result = renderRichHtml('<img alt="pic" src="img.png">', 'markdown');
    expect(result).toContain('![pic](img.png)');
  });

  it('renders horizontal rule', () => {
    const result = renderRichHtml('<hr>', 'markdown');
    expect(result).toContain('---');
  });

  it('renders table with thead', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>foo</td><td>1</td></tr></tbody></table>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    // Header row
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Value');
    // Separator after header
    expect(lines[1]).toMatch(/^[| -]+$/);
    // Data row
    expect(lines[2]).toContain('foo');
    expect(lines[2]).toContain('1');
  });

  it('escapes pipe characters in table cells', () => {
    const html = '<table><tr><td>a | b</td></tr></table>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toContain('a \\| b');
  });

  it('renders ordered list inside unordered list', () => {
    const html = '<ul><li>item<ol><li>sub 1</li><li>sub 2</li></ol></li></ul>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toContain('- item');
    expect(result).toContain('1. sub 1');
    expect(result).toContain('2. sub 2');
  });

  // ── Correctness fixes ──

  it('prefixes every line in blockquote paragraph with br', () => {
    const html = '<blockquote><p>a<br>b</p></blockquote>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    expect(lines[0]).toBe('> a');
    expect(lines[1]).toBe('> b');
  });

  it('prefixes every line in blockquote paragraph (terminal)', () => {
    const html = '<blockquote><p>a<br>b</p></blockquote>';
    const result = renderRichHtml(html, 'text');
    const plain = stripAnsi(result);
    expect(plain).toContain('a');
    expect(plain).toContain('b');
  });

  it('normalizes table cell newlines in markdown', () => {
    const html = '<table><tr><td>a<br>b</td><td>c\nd</td></tr></table>';
    const result = renderRichHtml(html, 'markdown');
    // Embedded <br> and \\n should be collapsed to <br>
    const lines = result.split('\n');
    expect(lines[0]).toContain('a<br>b');
    expect(lines[0]).toContain('c<br>d');
    // Table should still be a single row
    expect(lines.length).toBe(2); // data row + separator (no header)
  });

  it('normalizes table cell newlines in terminal', () => {
    const html = '<table><tr><td>a<br>b</td></tr></table>';
    const result = renderRichHtml(html, 'text');
    const plain = stripAnsi(result);
    // Newlines collapsed to spaces
    expect(plain).toContain('a b');
  });

  it('renders list inside blockquote', () => {
    const html = '<blockquote><ul><li>item 1</li><li>item 2</li></ul></blockquote>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toContain('> - item 1');
    expect(result).toContain('> - item 2');
  });

  it('renders blockquote inside list item', () => {
    const html = '<ul><li>item<blockquote><p>quoted</p></blockquote></li></ul>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toContain('- item');
    expect(result).toContain('> quoted');
  });

  it('renders table with th cells but no thead', () => {
    const html =
      '<table><tr><th>Name</th><th>Value</th></tr><tr><td>foo</td><td>1</td></tr></table>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    expect(lines[0]).toContain('Name');
    // Separator after header row
    expect(lines[1]).toMatch(/^[| -]+$/);
    expect(lines[2]).toContain('foo');
  });

  it('renders table without header row', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr></table>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    // GH fallback: separator after row 0
    expect(lines[0]).toContain('a');
    expect(lines[1]).toMatch(/^[| -]+$/);
  });

  it('renders pre inside blockquote', () => {
    const html = '<blockquote><pre>code</pre></blockquote>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    expect(lines[0]).toBe('> ```');
    expect(lines[1]).toBe('> code');
    expect(lines[2]).toBe('> ```');
  });

  it('handles fence collision in pre block', () => {
    const html = '<pre>content with ``` backticks</pre>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    // Fence should be longer than 3 to avoid collision with content
    expect(lines[0]).toBe('````');
    expect(lines[2]).toBe('````');
  });

  it('renders list item with multi-line inline paragraph', () => {
    const html = '<ul><li><p>line1<br>line2</p></li></ul>';
    const result = renderRichHtml(html, 'markdown');
    const lines = result.split('\n');
    expect(lines[0]).toBe('- line1');
    expect(lines[1]).toBe('  line2');
  });

  it('renders bold inside heading without double-bold in markdown', () => {
    const html = '<h2>Text with <strong>bold</strong></h2>';
    const result = renderRichHtml(html, 'markdown');
    expect(result).toBe('## Text with bold');
  });
});
