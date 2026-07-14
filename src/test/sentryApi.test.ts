import { describe, it, expect, vi } from 'vitest';
import {
  SentryClient,
  SentryAuthError,
  SentryNotFoundError,
  SentryRateLimitError,
} from '../providers/sentry/api';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: new Headers(headers) });
}

describe('SentryClient', () => {
  it('fetches an issue with a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '1', title: 'Boom' }));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 'tok', fetchImpl });
    const issue = await client.fetchIssue('acme', '1');
    expect(issue.title).toBe('Boom');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sentry.io/api/0/organizations/acme/issues/1/');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('strips a trailing slash from the base url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '1', title: 'x' }));
    const client = new SentryClient({ baseUrl: 'https://sentry.io/', token: 't', fetchImpl });
    await client.fetchIssue('acme', '1');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://sentry.io/api/0/organizations/acme/issues/1/');
  });

  it('resolves a short id', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ shortId: 'BACKEND-42', groupId: '9', organizationSlug: 'acme', projectSlug: 'backend', group: { id: '9', title: 'E' } }),
      );
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    const res = await client.resolveShortId('acme', 'BACKEND-42');
    expect(res.group.title).toBe('E');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://sentry.io/api/0/organizations/acme/shortids/BACKEND-42/',
    );
  });

  it('throws SentryAuthError on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    await expect(client.fetchIssue('a', '1')).rejects.toBeInstanceOf(SentryAuthError);
  });

  it('throws SentryNotFoundError on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    await expect(client.fetchIssue('a', '1')).rejects.toBeInstanceOf(SentryNotFoundError);
  });

  it('throws SentryRateLimitError on 429', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, 429, { 'x-sentry-rate-limit-reset': '1700000000' }));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    await expect(client.fetchIssue('a', '1')).rejects.toBeInstanceOf(SentryRateLimitError);
  });
});

describe('SentryClient write operations', () => {
  it('PUTs a status update', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '1', status: 'resolved' }));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    await client.updateStatus('acme', '1', 'resolved');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sentry.io/api/0/organizations/acme/issues/1/');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'resolved' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('PUTs an assignee update', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
    const client = new SentryClient({ baseUrl: 'https://sentry.io', token: 't', fetchImpl });
    await client.updateAssignee('acme', '1', 'user:42');
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ assignedTo: 'user:42' });
  });
});
