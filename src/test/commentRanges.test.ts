import { describe, it, expect } from 'vitest';
import {
  commentSpansForLine,
  getCommentSyntax,
  initialState,
  offsetInSpans,
} from '../core/commentRanges';

const ts = getCommentSyntax('typescript')!;
const py = getCommentSyntax('python')!;

function spansFor(lines: string[], syntax = ts) {
  let state = initialState();
  return lines.map((line) => {
    const r = commentSpansForLine(line, syntax, state);
    state = r.next;
    return r.spans;
  });
}

describe('commentSpansForLine', () => {
  it('detects a line comment', () => {
    const [spans] = spansFor(['const x = 1; // see #123']);
    expect(offsetInSpans('const x = 1; // see #'.length, spans)).toBe(true);
    expect(offsetInSpans('const '.length, spans)).toBe(false);
  });

  it('detects a single-line block comment', () => {
    const [spans] = spansFor(['/* #123 */ const x = 1;']);
    expect(offsetInSpans(3, spans)).toBe(true);
    expect(offsetInSpans('/* #123 */ const '.length, spans)).toBe(false);
  });

  it('carries block state across lines', () => {
    const result = spansFor(['/* start', '#123 still in block', 'end */ code']);
    expect(offsetInSpans(0, result[1])).toBe(true);
    expect(offsetInSpans('end */ '.length, result[2])).toBe(false);
    expect(offsetInSpans(0, result[2])).toBe(true);
  });

  it('supports hash comments for python', () => {
    const [spans] = spansFor(['x = 1  # ABC-123'], py);
    expect(offsetInSpans('x = 1  # '.length, spans)).toBe(true);
    expect(offsetInSpans(0, spans)).toBe(false);
  });

  it('returns no spans for code-only lines', () => {
    const [spans] = spansFor(['const x = 1;']);
    expect(spans).toHaveLength(0);
  });
});
