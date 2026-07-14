import { describe, it, expect } from 'vitest';
import {
  authorUrl,
  cleanBody,
  deriveState,
  escapeHtml,
  escapeMarkdown,
  formatDate,
  labelNames,
} from '../providers/github/render';
import type { GitHubIssue } from '../providers/github/api';

const base: GitHubIssue = {
  number: 1,
  title: 'x',
  state: 'open',
  html_url: 'https://github.com/a/b/issues/1',
};

describe('deriveState', () => {
  it('open issue', () => {
    expect(deriveState(base)).toEqual({ label: 'Open', kind: 'open' });
  });
  it('closed issue (completed) is purple', () => {
    expect(deriveState({ ...base, state: 'closed', state_reason: 'completed' })).toEqual({
      label: 'Closed',
      kind: 'closed-completed',
    });
  });
  it('closed issue with no reason defaults to completed', () => {
    expect(deriveState({ ...base, state: 'closed' })).toEqual({
      label: 'Closed',
      kind: 'closed-completed',
    });
  });
  it('closed issue (not planned) is gray', () => {
    expect(deriveState({ ...base, state: 'closed', state_reason: 'not_planned' })).toEqual({
      label: 'Closed (not planned)',
      kind: 'closed-notplanned',
    });
  });
  it('merged PR is purple', () => {
    expect(deriveState({ ...base, state: 'closed', merged: true })).toEqual({
      label: 'Merged',
      kind: 'merged',
    });
  });
  it('closed unmerged PR is red', () => {
    expect(deriveState({ ...base, state: 'closed', merged: false, draft: false })).toEqual({
      label: 'Closed',
      kind: 'closed-pr',
    });
  });
  it('draft PR', () => {
    expect(deriveState({ ...base, draft: true })).toEqual({ label: 'Draft', kind: 'draft' });
  });
  it('open PR via pull_request key', () => {
    expect(deriveState({ ...base, pull_request: {} })).toEqual({ label: 'Open', kind: 'open' });
  });
});

describe('escaping', () => {
  it('escapes markdown control chars', () => {
    expect(escapeMarkdown('a*b_c`d')).toBe('a\\*b\\_c\\`d');
  });
  it('escapes html', () => {
    expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });
});

describe('labelNames', () => {
  it('handles object and string labels', () => {
    expect(labelNames({ ...base, labels: [{ name: 'bug' }, 'wontfix'] })).toEqual(['bug', 'wontfix']);
  });
});

describe('authorUrl', () => {
  it('uses the same origin as the item url', () => {
    expect(authorUrl('https://github.com/a/b/issues/1', 'octocat')).toBe(
      'https://github.com/octocat',
    );
  });
  it('supports enterprise hosts', () => {
    expect(authorUrl('https://ghe.corp.net/a/b/pull/9', 'jane')).toBe('https://ghe.corp.net/jane');
  });
  it('falls back to github.com on invalid url', () => {
    expect(authorUrl('not a url', 'bob')).toBe('https://github.com/bob');
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp', () => {
    expect(formatDate('2023-12-04T10:20:30Z')).toBe('Dec 4, 2023');
  });
  it('returns empty for missing input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
  });
  it('returns empty for invalid input', () => {
    expect(formatDate('not a date')).toBe('');
  });
});

describe('cleanBody', () => {
  it('truncates long bodies with an ellipsis', () => {
    expect(cleanBody('word '.repeat(100)).endsWith('…')).toBe(true);
  });
  it('returns empty for null', () => {
    expect(cleanBody(null)).toBe('');
  });
  it('strips HTML comments (PR templates)', () => {
    expect(cleanBody('<!-- Thank you for submitting -->Real content')).toBe('Real content');
  });
  it('strips images', () => {
    expect(cleanBody('See ![alt](http://x/y.png) done')).toBe('See done');
  });
  it('collapses whitespace and blank lines', () => {
    expect(cleanBody('a\n\n\nb   c')).toBe('a\nb c');
  });
  it('strips heading markers', () => {
    expect(cleanBody('## Heading')).toBe('Heading');
  });
});
