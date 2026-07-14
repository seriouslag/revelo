export interface CommentSyntax {
  line: string[];
  block: Array<[start: string, end: string]>;
}

const C_LIKE: CommentSyntax = {
  line: ['//'],
  block: [['/*', '*/']],
};

const HASH: CommentSyntax = {
  line: ['#'],
  block: [],
};

const HTML: CommentSyntax = {
  line: [],
  block: [['<!--', '-->']],
};

// languageId -> comment syntax. Hard-coded because language-configuration
// files are not readable through the public VS Code API.
const SYNTAX: Record<string, CommentSyntax> = {
  typescript: C_LIKE,
  typescriptreact: C_LIKE,
  javascript: C_LIKE,
  javascriptreact: C_LIKE,
  go: C_LIKE,
  rust: C_LIKE,
  java: C_LIKE,
  c: C_LIKE,
  cpp: C_LIKE,
  csharp: C_LIKE,
  php: C_LIKE,
  swift: C_LIKE,
  kotlin: C_LIKE,
  scala: C_LIKE,
  python: HASH,
  ruby: HASH,
  shellscript: HASH,
  yaml: HASH,
  dockerfile: HASH,
  toml: HASH,
  html: HTML,
  xml: HTML,
};

export function getCommentSyntax(languageId: string): CommentSyntax | undefined {
  return SYNTAX[languageId];
}

/** A [start, end) character span within a single line that is comment text. */
export interface Span {
  start: number;
  end: number;
}

export interface ScanState {
  inBlock: boolean;
  blockEnd: string;
}

export function initialState(): ScanState {
  return { inBlock: false, blockEnd: '' };
}

/**
 * Given a line and the carry-in block state, return the comment spans on this
 * line and the state to carry into the next line. Strings are not treated as
 * comments; only comment delimiters are recognized (v1 heuristic).
 */
export function commentSpansForLine(
  line: string,
  syntax: CommentSyntax,
  state: ScanState,
): { spans: Span[]; next: ScanState } {
  const spans: Span[] = [];
  let i = 0;
  let inBlock = state.inBlock;
  let blockEnd = state.blockEnd;
  let spanStart = inBlock ? 0 : -1;

  while (i < line.length) {
    if (inBlock) {
      const endIdx = line.indexOf(blockEnd, i);
      if (endIdx === -1) {
        spans.push({ start: spanStart, end: line.length });
        return { spans, next: { inBlock: true, blockEnd } };
      }
      spans.push({ start: spanStart, end: endIdx + blockEnd.length });
      i = endIdx + blockEnd.length;
      inBlock = false;
      blockEnd = '';
      spanStart = -1;
      continue;
    }

    const lineTok = syntax.line.find((tok) => line.startsWith(tok, i));
    if (lineTok) {
      spans.push({ start: i, end: line.length });
      return { spans, next: { inBlock: false, blockEnd: '' } };
    }

    const block = syntax.block.find(([open]) => line.startsWith(open, i));
    if (block) {
      inBlock = true;
      blockEnd = block[1];
      spanStart = i;
      i += block[0].length;
      continue;
    }

    i += 1;
  }

  return { spans, next: { inBlock, blockEnd } };
}

export function offsetInSpans(offset: number, spans: Span[]): boolean {
  return spans.some((s) => offset >= s.start && offset < s.end);
}
