import { bold, dim, italic, underline } from '../output.js';
import type {
  BlockNode,
  InlineSegment,
  ListItemNode,
  TableNode,
} from './tree.js';

export type RenderMode = 'text' | 'markdown';

// ── Inline rendering ──

function renderInlineTerminal(segments: InlineSegment[]): string {
  let out = '';
  for (const seg of segments) {
    if (seg.image) {
      out += `[Image: ${seg.image.alt}]`;
      continue;
    }
    let s = seg.text;
    if (seg.styles.includes('code')) s = dim(s);
    if (seg.styles.includes('bold')) s = bold(s);
    if (seg.styles.includes('italic')) s = italic(s);
    if (seg.styles.includes('link')) {
      s = underline(s) + (seg.url ? ` (${dim(seg.url)})` : '');
    }
    out += s;
  }
  return out;
}

function renderInlineMarkdown(segments: InlineSegment[]): string {
  let out = '';
  for (const seg of segments) {
    if (seg.image) {
      out += `![${seg.image.alt}](${seg.image.src})`;
      continue;
    }
    let s = seg.text;
    if (seg.styles.includes('code')) s = '`' + s + '`';
    if (seg.styles.includes('bold')) s = '**' + s + '**';
    if (seg.styles.includes('italic')) s = '*' + s + '*';
    if (seg.styles.includes('link')) {
      s = seg.url ? `[${s}](${seg.url})` : s;
    }
    out += s;
  }
  return out;
}

function renderInline(segments: InlineSegment[], mode: RenderMode): string {
  return mode === 'markdown' ? renderInlineMarkdown(segments) : renderInlineTerminal(segments);
}

function renderInlinePlain(segments: InlineSegment[]): string {
  let out = '';
  for (const seg of segments) {
    if (seg.image) {
      out += `![${seg.image.alt}](${seg.image.src})`;
      continue;
    }
    out += seg.text;
  }
  return out;
}

// ── Line-aware prefixing ──

/** Apply prefix to every line of text (splitting on newlines). */
function applyPrefix(prefix: string, text: string): string {
  if (!prefix) return text;
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

// ── Table helpers ──

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function padCell(text: string, width: number): string {
  const plain = stripAnsi(text);
  const padding = width - plain.length;
  return text + ' '.repeat(Math.max(0, padding));
}

function escapeMarkdownTableCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Collapse embedded newlines in table cell text so they don't break layout. */
function normalizeTableCellText(text: string, mode: RenderMode): string {
  if (mode === 'markdown') return text.replace(/\n/g, '<br>');
  return text.replace(/\n/g, ' ');
}

// ── Fence helper ──

/** Pick a backtick fence at least 3 long, longer than any backtick run in content. */
function pickFence(content: string): string {
  const match = content.match(/`{3,}/g);
  const maxRun = match ? Math.max(...match.map((m) => m.length)) : 0;
  return '`'.repeat(Math.max(3, maxRun + 1));
}

// ── Block rendering ──

function renderTableLines(node: TableNode, mode: RenderMode, prefix: string): string[] {
  const { rows, headerRowIndex } = node;
  if (rows.length === 0) return [];

  const strRows = rows.map((row) =>
    row.cells.map((cell) =>
      normalizeTableCellText(
        mode === 'markdown' ? renderInlineMarkdown(cell.children) : renderInlineTerminal(cell.children),
        mode,
      ),
    ),
  );

  const colCount = Math.max(...strRows.map((r) => r.length), 1);
  const colWidths = new Array(colCount).fill(0);
  for (const row of strRows) {
    for (let ci = 0; ci < row.length; ci++) {
      const plain = stripAnsi(row[ci]).length;
      colWidths[ci] = Math.max(colWidths[ci], plain);
    }
  }

  const lines: string[] = [];

  if (mode === 'markdown') {
    let hasHeader = false;
    for (let ri = 0; ri < strRows.length; ri++) {
      const cells = strRows[ri].map((c, ci) => {
        const escaped = escapeMarkdownTableCell(c);
        const plainLen = escaped.length;
        return escaped + ' '.repeat(Math.max(0, colWidths[ci] - plainLen));
      });
      lines.push(prefix + '| ' + cells.join(' | ') + ' |');
      if (ri === headerRowIndex && headerRowIndex >= 0) {
        const seps = colWidths.map((w) => '-'.repeat(Math.max(w, 3)));
        lines.push(prefix + '|' + seps.join('|') + '|');
        hasHeader = true;
      }
    }
    if (!hasHeader && strRows.length > 0) {
      const sepParts = colWidths.map((w) => '-'.repeat(Math.max(w, 3)));
      lines.splice(1, 0, prefix + '|' + sepParts.join('|') + '|');
    }
  } else {
    for (let ri = 0; ri < strRows.length; ri++) {
      const cells = strRows[ri].map((c, ci) => padCell(c, colWidths[ci]));
      lines.push(prefix + ' ' + cells.join(dim(' │ ')));
      if (ri === 0) {
        const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * 3;
        lines.push(prefix + dim('─' + '─'.repeat(totalWidth + 2)));
      }
    }
  }

  return lines;
}

export function renderBlock(node: BlockNode, mode: RenderMode, prefix: string): string[] {
  switch (node.type) {
    case 'root': {
      const lines: string[] = [];
      for (let i = 0; i < node.children.length; i++) {
        const childLines = renderBlock(node.children[i], mode, prefix);
        if (childLines.length === 0) continue;
        if (lines.length > 0) lines.push('');
        lines.push(...childLines);
      }
      return lines;
    }

    case 'paragraph': {
      const text = renderInline(node.children, mode);
      if (!text.trim()) return [];
      const lines = text
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .filter((line) => line.length > 0);
      if (lines.length === 0) return [];
      return lines.map((line) => applyPrefix(prefix, line));
    }

    case 'heading': {
      const text =
        mode === 'markdown'
          ? renderInlinePlain(node.children)
          : renderInline(node.children, mode);
      if (mode === 'markdown') {
        return [prefix + '#'.repeat(node.level) + ' ' + text];
      }
      const styled = node.level === 1 ? bold(bold(text)) : bold(text);
      const lines = [applyPrefix(prefix, styled)];
      if (node.level === 1) {
        lines.push(prefix + dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      }
      return lines;
    }

    case 'blockquote': {
      const bqPrefix = mode === 'markdown' ? '> ' : dim('│ ');
      const innerPrefix = prefix + bqPrefix;
      const lines: string[] = [];
      for (const child of node.children) {
        lines.push(...renderBlock(child, mode, innerPrefix));
      }
      return lines;
    }

    case 'list': {
      const lines: string[] = [];
      let counter = 0;
      for (const item of node.children) {
        counter++;
        const marker = node.ordered
          ? `${counter}. `
          : mode === 'markdown'
            ? '- '
            : '• ';
        lines.push(...renderListItem(item, marker, mode, prefix));
      }
      return lines;
    }

    case 'list_item': {
      return [];
    }

    case 'pre': {
      const fence = pickFence(node.text);
      if (mode === 'markdown') {
        const lines = [applyPrefix(prefix, fence)];
        for (const line of node.text.split('\n')) {
          lines.push(applyPrefix(prefix, line));
        }
        lines.push(applyPrefix(prefix, fence));
        return lines;
      }
      return node.text.split('\n').map((line) => prefix + dim(line));
    }

    case 'hr':
      return [
        prefix +
          (mode === 'markdown'
            ? '---'
            : dim('────────────────────────────────────────')),
      ];

    case 'table':
      return renderTableLines(node, mode, prefix);
  }
}

function renderListItem(
  item: ListItemNode,
  marker: string,
  mode: RenderMode,
  prefix: string,
): string[] {
  if (item.children.length === 0) return [prefix + marker];

  const indent = ' '.repeat(marker.length);
  const lines: string[] = [];

  for (let i = 0; i < item.children.length; i++) {
    const child = item.children[i];

    if (
      i === 0 &&
      (child.type === 'paragraph' || child.type === 'heading')
    ) {
      const childLines = renderBlock(child, mode, '');
      for (let li = 0; li < childLines.length; li++) {
        const sublines = childLines[li].split('\n');
        for (let si = 0; si < sublines.length; si++) {
          const linePrefix =
            li === 0 && si === 0 ? prefix + marker : prefix + indent;
          lines.push(linePrefix + sublines[si]);
        }
      }
    } else {
      const childLines = renderBlock(child, mode, prefix + indent);
      lines.push(...childLines);
    }
  }

  return lines;
}
