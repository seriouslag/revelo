import { describe, it, expect } from 'vitest';
import { findTodos } from '../core/todo';
import type { Span } from '../core/commentRanges';

// A span covering the whole line (simulates "this line is a comment").
function wholeLine(line: string): Span[] {
  return [{ start: 0, end: line.length }];
}

describe('findTodos', () => {
  it('detects a bare TODO with no linked key', () => {
    const line = '// TODO: refactor this';
    const [t] = findTodos(line, wholeLine(line));
    expect(t.keyword).toBe('TODO');
    expect(t.hasKey).toBe(false);
    expect(t.summary).toBe('refactor this');
  });

  it('detects a TODO that already links a key', () => {
    const line = '// TODO(ABC-123): refactor this';
    const [t] = findTodos(line, wholeLine(line));
    expect(t.hasKey).toBe(true);
    expect(t.key).toBe('ABC-123');
    expect(t.summary).toBe('refactor this');
  });

  it('detects a key that follows without parentheses', () => {
    const line = '// TODO ABC-9 fix the thing';
    const [t] = findTodos(line, wholeLine(line));
    expect(t.hasKey).toBe(true);
    expect(t.key).toBe('ABC-9');
    expect(t.summary).toBe('fix the thing');
  });

  it('matches FIXME and is case-insensitive', () => {
    const line = '# fixme handle nulls';
    const [t] = findTodos(line, wholeLine(line));
    expect(t.keyword).toBe('fixme');
    expect(t.hasKey).toBe(false);
    expect(t.summary).toBe('handle nulls');
  });

  it('ignores TODO outside comment spans', () => {
    const line = 'const TODO = 1; // real comment';
    // Comment span only covers the trailing "// real comment".
    const spans: Span[] = [{ start: 16, end: line.length }];
    expect(findTodos(line, spans)).toHaveLength(0);
  });

  it('scans the whole line when spans is undefined (prose)', () => {
    const line = 'TODO write docs';
    const [t] = findTodos(line, undefined);
    expect(t.keyword).toBe('TODO');
    expect(t.summary).toBe('write docs');
  });

  it('respects custom keywords', () => {
    const line = '// HACK work around bug';
    expect(findTodos(line, wholeLine(line))).toHaveLength(0);
    const [t] = findTodos(line, wholeLine(line), ['HACK']);
    expect(t.keyword).toBe('HACK');
  });

  it('does not match TODO as a substring of another word', () => {
    const line = '// TODOS list';
    expect(findTodos(line, wholeLine(line), ['TODO'])).toHaveLength(0);
  });
});
