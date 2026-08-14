import { marked } from 'marked';
import { tokenize } from './html/tokenize.js';
import { buildTree } from './html/tree.js';
import { renderBlock } from './html/render.js';
import type { RenderMode } from './html/render.js';

export type { RenderMode };

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => ENTITIES[ch]);
}

export function plainTextToHtml(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      const lines = trimmed
        .split('\n')
        .map((line) => escapeHtml(line.trim()))
        .join('<br>');
      return `<p>${lines}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

export function markdownToHtml(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

export type InputFormat = 'text' | 'html' | 'markdown';

const INPUT_FORMATS: ReadonlySet<string> = new Set(['text', 'html', 'markdown']);

export function parseInputFormat(raw: string): InputFormat {
  if (!INPUT_FORMATS.has(raw)) {
    throw new Error(`Invalid --format "${raw}". Must be one of: text, html, markdown.`);
  }
  return raw as InputFormat;
}

const MARKDOWN_SIGNALS: readonly RegExp[] = [
  /^#{1,6}\s\S/m, // ATX heading
  /^```\w*/m, // fenced code block
  /\[[^\]\n]+\]\([^)\n]+\)/, // [text](url)
  /^\|.+\|/m, // | table | row |
];

export function detectMarkdown(text: string): boolean {
  if (!text) return false;
  for (const re of MARKDOWN_SIGNALS) {
    if (re.test(text)) return true;
  }
  return false;
}

export function bodyToHtml(text: string, rawFormat?: string): string {
  if (rawFormat !== undefined) return inputToHtml(text, parseInputFormat(rawFormat));
  const fmt: InputFormat = detectMarkdown(text) ? 'markdown' : 'text';
  return inputToHtml(text, fmt);
}

export function inputToHtml(text: string, format: InputFormat | undefined): string {
  if (format === 'html') return text;
  if (format === 'markdown') return markdownToHtml(text);
  return plainTextToHtml(text);
}

export function renderRichHtml(html: string, mode: RenderMode): string {
  const tokens = tokenize(html);
  const tree = buildTree(tokens);
  return renderBlock(tree, mode, '').join('\n').trim();
}
