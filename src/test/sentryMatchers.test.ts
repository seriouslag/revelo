import { describe, it, expect } from 'vitest';
import {
  SENTRY_MATCHERS,
  parseSentryMatch,
  orgFromHost,
  shortIdPrefix,
} from '../providers/sentry/matchers';

function matcher(kind: string) {
  const m = SENTRY_MATCHERS.find((x) => x.kind === kind)!;
  return new RegExp(m.regex.source, m.regex.flags);
}

function firstMatch(kind: string, text: string) {
  const m = matcher(kind).exec(text);
  return m ? parseSentryMatch(kind, m) : undefined;
}

describe('orgFromHost', () => {
  it('extracts org from subdomain', () => {
    expect(orgFromHost('acme.sentry.io')).toBe('acme');
  });
  it('extracts org from region subdomain', () => {
    expect(orgFromHost('acme.us.sentry.io')).toBe('acme');
    expect(orgFromHost('acme.de.sentry.io')).toBe('acme');
  });
  it('returns empty for bare sentry.io', () => {
    expect(orgFromHost('sentry.io')).toBe('');
  });
  it('returns empty for region-only host', () => {
    expect(orgFromHost('us.sentry.io')).toBe('');
  });
  it('returns empty for self-hosted host', () => {
    expect(orgFromHost('sentry.mycorp.com')).toBe('');
  });
});

describe('sentry issue-url matcher', () => {
  it('parses org-subdomain url', () => {
    expect(firstMatch('issue-url', 'https://acme.sentry.io/issues/123456/')).toEqual({
      kind: 'issue',
      host: 'acme.sentry.io',
      orgSlug: 'acme',
      issueId: '123456',
      eventId: undefined,
    });
  });

  it('parses legacy /organizations/ path url', () => {
    expect(
      firstMatch('issue-url', 'https://sentry.io/organizations/acme/issues/123456/'),
    ).toMatchObject({ orgSlug: 'acme', issueId: '123456' });
  });

  it('parses region host url', () => {
    expect(firstMatch('issue-url', 'https://acme.us.sentry.io/issues/999/')).toMatchObject({
      host: 'acme.us.sentry.io',
      orgSlug: 'acme',
      issueId: '999',
    });
  });

  it('captures the event id', () => {
    const r = firstMatch(
      'issue-url',
      'https://acme.sentry.io/issues/1/events/' + 'a'.repeat(32) + '/',
    );
    expect(r).toMatchObject({ issueId: '1', eventId: 'a'.repeat(32) });
  });

  it('parses self-hosted url with org path', () => {
    expect(
      firstMatch('issue-url', 'https://sentry.mycorp.com/organizations/acme/issues/42/'),
    ).toMatchObject({ host: 'sentry.mycorp.com', orgSlug: 'acme', issueId: '42' });
  });
});

describe('sentry short-id matcher', () => {
  it('parses a short id', () => {
    expect(firstMatch('short-id', 'see BACKEND-42 for details')).toEqual({
      kind: 'short-id',
      shortId: 'BACKEND-42',
    });
  });

  it('matches base32-ish suffix', () => {
    expect(firstMatch('short-id', 'PROJECT-1AB')).toMatchObject({ shortId: 'PROJECT-1AB' });
  });

  it('matches a two-segment slug (C3-FRONTEND-71)', () => {
    expect(firstMatch('short-id', 'error C3-FRONTEND-71 here')).toMatchObject({
      shortId: 'C3-FRONTEND-71',
    });
  });

  it('matches a long multi-hyphen slug', () => {
    expect(
      firstMatch('short-id', 'crash CASH-SMARTCASH-HSBC-INTEGRATION-2 today'),
    ).toMatchObject({ shortId: 'CASH-SMARTCASH-HSBC-INTEGRATION-2' });
  });
});

describe('shortIdPrefix', () => {
  it('takes everything before the last hyphen', () => {
    expect(shortIdPrefix('C3-FRONTEND-71')).toBe('C3-FRONTEND');
    expect(shortIdPrefix('CASH-SMARTCASH-HSBC-INTEGRATION-2')).toBe(
      'CASH-SMARTCASH-HSBC-INTEGRATION',
    );
    expect(shortIdPrefix('BACKEND-42')).toBe('BACKEND');
  });
});
