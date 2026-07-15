import { offsetInSpans, type Span } from './commentRanges';

export const DEFAULT_TODO_KEYWORDS = ['TODO', 'FIXME'];

// Jira issue key, e.g. ABC-123. Mirrors the key matcher in jira/matchers.ts.
const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;

export interface TodoMatch {
  /** The matched keyword as written, e.g. "TODO". */
  keyword: string;
  /** Range of the whole TODO annotation start (keyword) within the line. */
  start: number;
  end: number;
  /** Whether a Jira key already appears after the keyword on this line. */
  hasKey: boolean;
  /** The linked key, if present. */
  key?: string;
  /** Trailing prose after the keyword (and any punctuation) — the summary. */
  summary: string;
}

function buildKeywordRegex(keywords: string[]): RegExp {
  const alt = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`\\b(${alt})\\b`, 'gi');
}

/**
 * Find TODO-style annotations on a line that fall inside comment text. When
 * `spans` is undefined the whole line is scannable (prose). For each keyword
 * hit, reports whether a Jira key already follows it and the trailing summary.
 */
export function findTodos(
  line: string,
  spans: Span[] | undefined,
  keywords: string[] = DEFAULT_TODO_KEYWORDS,
): TodoMatch[] {
  const regex = buildKeywordRegex(keywords);
  const matches: TodoMatch[] = [];

  for (const m of line.matchAll(regex)) {
    const start = m.index ?? 0;
    if (spans && !offsetInSpans(start, spans)) {
      continue;
    }
    const end = start + m[0].length;
    // Rest of the line after the keyword is where a key / summary lives.
    const rest = line.slice(end);
    const keyMatch = rest.match(JIRA_KEY);
    // Strip a leading "(KEY)" or ":" and surrounding whitespace/punctuation.
    const summary = rest
      .replace(/^\s*\([A-Z][A-Z0-9]+-\d+\)\s*/, '')
      .replace(/^[\s:().-]+/, '')
      .replace(JIRA_KEY, '')
      .trim();
    matches.push({
      keyword: m[0],
      start,
      end,
      hasKey: Boolean(keyMatch),
      key: keyMatch?.[0],
      summary,
    });
  }
  return matches;
}
