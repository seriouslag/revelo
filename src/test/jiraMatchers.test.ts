import { describe, it, expect } from 'vitest';
import {
  JIRA_MATCHERS,
  parseJiraMatch,
  projectKeyOf,
  KEY_DENYLIST,
} from '../providers/jira/matchers';

function matcher(kind: string) {
  const m = JIRA_MATCHERS.find((x) => x.kind === kind)!;
  return new RegExp(m.regex.source, m.regex.flags);
}

function firstMatch(kind: string, text: string) {
  const m = matcher(kind).exec(text);
  return m ? parseJiraMatch(kind, m) : undefined;
}

describe('jira cloud-url matcher', () => {
  it('parses a cloud browse url and captures the site', () => {
    expect(firstMatch('cloud-url', 'https://acme.atlassian.net/browse/ABC-123')).toEqual({
      kind: 'issue',
      site: 'acme',
      key: 'ABC-123',
    });
  });
});

describe('jira server-url matcher', () => {
  it('parses a self-hosted browse url', () => {
    expect(firstMatch('server-url', 'https://jira.corp.com/jira/browse/PROJ-7')).toMatchObject({
      kind: 'key',
      key: 'PROJ-7',
    });
  });
});

describe('jira key matcher', () => {
  it('parses a bare key', () => {
    expect(firstMatch('key', 'see ABC-123 now')).toEqual({ kind: 'key', key: 'ABC-123' });
  });

  it('matches false-positive shapes at the regex level', () => {
    // The regex matches these; the provider filters via the denylist.
    expect(firstMatch('key', 'UTF-8')).toEqual({ kind: 'key', key: 'UTF-8' });
    expect(firstMatch('key', 'SHA-256')).toEqual({ kind: 'key', key: 'SHA-256' });
  });
});

describe('projectKeyOf', () => {
  it('extracts the project key', () => {
    expect(projectKeyOf('ABC-123')).toBe('ABC');
    expect(projectKeyOf('PROJ-7')).toBe('PROJ');
  });
});

describe('KEY_DENYLIST', () => {
  it('contains common false positives', () => {
    expect(KEY_DENYLIST.has('UTF')).toBe(true);
    expect(KEY_DENYLIST.has('SHA')).toBe(true);
    expect(KEY_DENYLIST.has('HTTP')).toBe(true);
    expect(KEY_DENYLIST.has('ABC')).toBe(false);
  });
});
