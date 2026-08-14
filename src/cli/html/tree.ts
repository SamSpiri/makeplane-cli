import type { Token } from './tokenize.js';

// ── AST types ──

export type InlineStyle = 'bold' | 'italic' | 'code' | 'link';

export interface InlineSegment {
  text: string;
  styles: InlineStyle[];
  url?: string;
  image?: { alt: string; src: string };
}

export interface ParagraphNode {
  type: 'paragraph';
  children: InlineSegment[];
}
export interface HeadingNode {
  type: 'heading';
  level: number;
  children: InlineSegment[];
}
export interface BlockquoteNode {
  type: 'blockquote';
  children: BlockNode[];
}
export interface ListNode {
  type: 'list';
  ordered: boolean;
  children: ListItemNode[];
}
export interface ListItemNode {
  type: 'list_item';
  children: BlockNode[];
}
export interface PreNode {
  type: 'pre';
  text: string;
}
export interface HrNode {
  type: 'hr';
}
export interface TableNode {
  type: 'table';
  headerRowIndex: number;
  rows: TableRow[];
}
export interface TableRow {
  cells: TableCell[];
}
export interface TableCell {
  header: boolean;
  children: InlineSegment[];
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | ListNode
  | ListItemNode
  | PreNode
  | HrNode
  | TableNode
  | RootNode;

/** Block nodes that can contain child block nodes. */
export type BlockContainer = RootNode | BlockquoteNode | ListNode | ListItemNode | TableNode;

export interface RootNode {
  type: 'root';
  children: BlockNode[];
}

// ── Tree builder ──

const HEADING_TAGS = new Set(['h1', 'h2', 'h3']);

interface TableBuildState {
  rows: TableRow[];
  currentRow: TableCell[];
  inThead: boolean;
}

export function buildTree(tokens: Token[]): RootNode {
  const root: RootNode = { type: 'root', children: [] };

  // Stack of block containers that can nest other blocks.
  const blockPath: BlockContainer[] = [root];

  // Inline accumulation.
  const inlineBuffer: InlineSegment[] = [];
  const activeStyles: InlineStyle[] = [];
  let pendingLinkUrl: string | undefined;
  let headingStyleCount = 0;

  // Table building.
  let table: TableBuildState | null = null;

  // <pre> raw text accumulation.
  let preBuffer: string | null = null;

  function blockAcceptsChildren(
    parent: BlockContainer,
  ): parent is RootNode | BlockquoteNode | ListItemNode {
    return (
      parent.type === 'root' ||
      parent.type === 'blockquote' ||
      parent.type === 'list_item'
    );
  }

  function addText(text: string) {
    if (!text) return;
    inlineBuffer.push({
      text,
      styles: [...activeStyles],
      url: pendingLinkUrl,
    });
    pendingLinkUrl = undefined;
  }

  function flushInline(): InlineSegment[] {
    const segs = [...inlineBuffer];
    inlineBuffer.length = 0;
    return segs;
  }

  function addParagraph(): void {
    if (inlineBuffer.length === 0) return;
    const segs = flushInline();
    const parent = blockPath[blockPath.length - 1];
    if (blockAcceptsChildren(parent)) {
      parent.children.push({ type: 'paragraph', children: segs });
    }
  }

  function addHeading(level: number): void {
    if (inlineBuffer.length === 0) return;
    while (headingStyleCount > 0) {
      const idx = activeStyles.lastIndexOf('bold');
      if (idx >= 0) activeStyles.splice(idx, 1);
      headingStyleCount--;
    }
    const segs = flushInline();
    const parent = blockPath[blockPath.length - 1];
    if (blockAcceptsChildren(parent)) {
      parent.children.push({ type: 'heading', level, children: segs });
    }
  }

  function addTableCell(isTh: boolean): void {
    if (inlineBuffer.length === 0) return;
    if (!table) return;
    const segs = flushInline();
    table.currentRow.push({ header: isTh || table.inThead, children: segs });
  }

  function pushBlock(node: BlockquoteNode | ListNode | ListItemNode | TableNode): void {
    const parent = blockPath[blockPath.length - 1];
    if (parent.type === 'list' && node.type === 'list_item') {
      parent.children.push(node);
    } else if (blockAcceptsChildren(parent)) {
      parent.children.push(node);
    }
    blockPath.push(node);
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // ── <pre> mode ──
    if (preBuffer !== null) {
      if (t.type === 'close' && t.name === 'pre') {
        const parent = blockPath[blockPath.length - 1];
        if (blockAcceptsChildren(parent)) {
          parent.children.push({ type: 'pre', text: preBuffer });
        }
        preBuffer = null;
      } else if (t.type === 'text') {
        preBuffer += t.content;
      } else if (t.type === 'self_close' && t.name === 'br') {
        preBuffer += '\n';
      }
      continue;
    }

    // ── text ──
    if (t.type === 'text') {
      addText(t.content);
      continue;
    }

    // ── self-close ──
    if (t.type === 'self_close') {
      if (t.name === 'br') {
        addText('\n');
      } else if (t.name === 'hr') {
        addParagraph();
        const parent = blockPath[blockPath.length - 1];
        if (blockAcceptsChildren(parent)) {
          parent.children.push({ type: 'hr' });
        }
      } else if (t.name === 'img') {
        inlineBuffer.push({
          text: '',
          styles: [...activeStyles],
          url: pendingLinkUrl,
          image: { alt: t.attrs.alt || 'image', src: t.attrs.src || '' },
        });
        pendingLinkUrl = undefined;
      }
      continue;
    }

    // ── close ──
    if (t.type === 'close') {
      const name = t.name;

      if (name === 'p') {
        addParagraph();
      } else if (HEADING_TAGS.has(name)) {
        const level = name === 'h1' ? 1 : name === 'h2' ? 2 : 3;
        addHeading(level);
      } else if (name === 'li') {
        addParagraph();
        blockPath.pop();
      } else if (name === 'ul' || name === 'ol') {
        blockPath.pop();
      } else if (name === 'blockquote') {
        addParagraph();
        blockPath.pop();
      } else if (name === 'td' || name === 'th') {
        addTableCell(name === 'th');
      } else if (name === 'tr') {
        if (table && table.currentRow.length > 0) {
          table.rows.push({ cells: [...table.currentRow] });
          table.currentRow = [];
        }
      } else if (name === 'thead' || name === 'tbody') {
        if (table) table.inThead = false;
      } else if (name === 'table') {
        if (table) {
          if (table.currentRow.length > 0) {
            table.rows.push({ cells: [...table.currentRow] });
          }
          let headerRowIndex = -1;
          for (let ri = 0; ri < table.rows.length; ri++) {
            if (table.rows[ri].cells.some((c) => c.header)) {
              headerRowIndex = ri;
              break;
            }
          }
          const tableNode: TableNode = {
            type: 'table',
            headerRowIndex,
            rows: table.rows,
          };
          table = null;
          blockPath.pop();
          const parent = blockPath[blockPath.length - 1];
          if (blockAcceptsChildren(parent)) {
            parent.children.push(tableNode);
          }
        }
      }
      // Inline close tags
      else if (name === 'strong' || name === 'b') {
        const idx = activeStyles.lastIndexOf('bold');
        if (idx >= 0) activeStyles.splice(idx, 1);
      } else if (name === 'em' || name === 'i') {
        const idx = activeStyles.lastIndexOf('italic');
        if (idx >= 0) activeStyles.splice(idx, 1);
      } else if (name === 'code') {
        const idx = activeStyles.lastIndexOf('code');
        if (idx >= 0) activeStyles.splice(idx, 1);
      } else if (name === 'a') {
        const idx = activeStyles.lastIndexOf('link');
        if (idx >= 0) activeStyles.splice(idx, 1);
        pendingLinkUrl = undefined;
      }
      continue;
    }

    // ── open ──
    if (t.type === 'open') {
      const name = t.name;
      const isDivHr = name === 'div' && t.attrs['data-type'] === 'horizontalRule';

      if (name === 'p') {
        addParagraph();
      } else if (HEADING_TAGS.has(name)) {
        addParagraph();
        activeStyles.push('bold');
        headingStyleCount = 1;
        if (name === 'h1') {
          activeStyles.push('bold');
          headingStyleCount = 2;
        }
      } else if (name === 'li') {
        addParagraph();
        const li: ListItemNode = { type: 'list_item', children: [] };
        pushBlock(li);
      } else if (name === 'ul') {
        addParagraph();
        const list: ListNode = { type: 'list', ordered: false, children: [] };
        pushBlock(list);
      } else if (name === 'ol') {
        addParagraph();
        const list: ListNode = { type: 'list', ordered: true, children: [] };
        pushBlock(list);
      } else if (name === 'blockquote') {
        addParagraph();
        const bq: BlockquoteNode = { type: 'blockquote', children: [] };
        pushBlock(bq);
      } else if (name === 'pre') {
        addParagraph();
        preBuffer = '';
      } else if (name === 'table') {
        addParagraph();
        table = { rows: [], currentRow: [], inThead: false };
        const tbl: TableNode = { type: 'table', headerRowIndex: -1, rows: [] };
        pushBlock(tbl);
      } else if (name === 'thead') {
        if (table) table.inThead = true;
      } else if (name === 'tbody') {
        if (table) table.inThead = false;
      } else if (name === 'tr') {
        if (table) table.currentRow = [];
      } else if (name === 'th' || name === 'td') {
        // inline accumulation continues; header tracking happens on close
      } else if (isDivHr) {
        addParagraph();
        const parent = blockPath[blockPath.length - 1];
        if (blockAcceptsChildren(parent)) {
          parent.children.push({ type: 'hr' });
        }
      }
      // Inline open tags
      else if (name === 'strong' || name === 'b') {
        activeStyles.push('bold');
      } else if (name === 'em' || name === 'i') {
        activeStyles.push('italic');
      } else if (name === 'code') {
        activeStyles.push('code');
      } else if (name === 'a') {
        activeStyles.push('link');
        pendingLinkUrl = t.attrs.href || '';
      }
      // img as open tag (non-self-closing variant)
      else if (name === 'img') {
        inlineBuffer.push({
          text: '',
          styles: [...activeStyles],
          url: pendingLinkUrl,
          image: { alt: t.attrs.alt || 'image', src: t.attrs.src || '' },
        });
        pendingLinkUrl = undefined;
      }
      continue;
    }
  }

  // Final flush of any pending inline text.
  addParagraph();

  return root;
}
