// ── HTML entity decoding ──

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&[#a-zA-Z0-9]+;/g, (e) => HTML_ENTITIES[e] || e);
}

// ── Tokenizer ──

export interface TokenText {
  type: 'text';
  content: string;
}
export interface TokenOpen {
  type: 'open';
  name: string;
  attrs: Record<string, string>;
}
export interface TokenClose {
  type: 'close';
  name: string;
}
export interface TokenSelfClose {
  type: 'self_close';
  name: string;
  attrs: Record<string, string>;
}
export type Token = TokenText | TokenOpen | TokenClose | TokenSelfClose;

const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    if (html[pos] === '<') {
      if (html.startsWith('<!--', pos)) {
        const end = html.indexOf('-->', pos);
        pos = end === -1 ? len : end + 3;
        continue;
      }

      const tagEnd = html.indexOf('>', pos);
      if (tagEnd === -1) {
        pos++;
        continue;
      }
      const inner = html.slice(pos + 1, tagEnd);
      pos = tagEnd + 1;

      const isClose = inner.startsWith('/');
      const rawName = isClose ? inner.slice(1).trim() : inner.trim();
      const isSelfClose = rawName.endsWith('/');
      const cleanName = isSelfClose ? rawName.slice(0, -1).trim() : rawName;
      const spaceIdx = cleanName.search(/\s/);
      const name = (spaceIdx === -1 ? cleanName : cleanName.slice(0, spaceIdx)).toLowerCase();
      const attrStr = spaceIdx === -1 ? '' : cleanName.slice(spaceIdx + 1);

      if (isClose) {
        tokens.push({ type: 'close', name });
      } else if (isSelfClose || VOID_ELEMENTS.has(name)) {
        tokens.push({ type: 'self_close', name, attrs: parseAttrs(attrStr) });
      } else {
        tokens.push({ type: 'open', name, attrs: parseAttrs(attrStr) });
      }
    } else {
      const nextTag = html.indexOf('<', pos);
      const text = nextTag === -1 ? html.slice(pos) : html.slice(pos, nextTag);
      pos = nextTag === -1 ? len : nextTag;
      const decoded = decodeEntities(text);
      if (decoded) tokens.push({ type: 'text', content: decoded });
    }
  }
  return tokens;
}
