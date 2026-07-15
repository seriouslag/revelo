import { describe, it, expect, vi } from 'vitest';
import { GitHubClient, NotFoundError, RateLimitError } from '../providers/github/api';

// Octokit only parses the response body when content-type is JSON, and reads
// the etag header for conditional requests.
function jsonResponse(body: unknown, init: { status?: number; etag?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (init.etag) headers.set('etag', init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('GitHubClient.fetchIssueOrPr', () => {
  it('returns an issue directly when no pull_request key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ number: 1, title: 'Bug', state: 'open', html_url: 'u' }),
    );
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });
    const { data } = await client.fetchIssueOrPr('a', 'b', '1');
    expect(data.title).toBe('Bug');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('makes a second /pulls call when pull_request key present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ number: 2, title: 'PR', state: 'open', html_url: 'u', pull_request: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ number: 2, title: 'PR', state: 'open', html_url: 'u', merged: true }),
      );
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });
    const { data } = await client.fetchIssueOrPr('a', 'b', '2');
    expect(data.merged).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/pulls/2');
  });

  it('throws NotFoundError on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });
    await expect(client.fetchIssueOrPr('a', 'b', '9')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws RateLimitError when remaining is 0', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1700000000',
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 403, headers }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });
    await expect(client.fetchIssueOrPr('a', 'b', '1')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('reuses cached data on 304 via If-None-Match', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ number: 1, title: 'Cached', state: 'open', html_url: 'u' }, { etag: 'W/"abc"' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });

    const first = await client.fetchIssueOrPr('a', 'b', '1');
    expect(first.data.title).toBe('Cached');
    const second = await client.fetchIssueOrPr('a', 'b', '1');
    expect(second.data.title).toBe('Cached');

    const sentHeaders = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(sentHeaders['if-none-match']).toBe('W/"abc"');
  });
});

function writeClient(fetchImpl: typeof fetch) {
  return new GitHubClient({ baseUrl: 'https://api.github.com', token: 'tok', fetchImpl });
}

describe('GitHubClient write operations', () => {
  const client = writeClient;

  it('PATCHes state to close an issue', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ number: 1, state: 'closed' }));
    await client(fetchImpl).updateState('a', 'b', '1', 'closed');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/a/b/issues/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ state: 'closed' });
  });

  it('PUTs the full label set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ name: 'bug' }]));
    await client(fetchImpl).setLabels('a', 'b', '1', ['bug', 'p1']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/a/b/issues/1/labels');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ labels: ['bug', 'p1'] });
  });

  it('PATCHes assignees', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ number: 1 }));
    await client(fetchImpl).setAssignees('a', 'b', '1', ['octocat']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/a/b/issues/1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ assignees: ['octocat'] });
  });

  it('lists repo labels', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ name: 'bug', color: 'f00' }, { name: 'docs' }]),
    );
    const labels = await client(fetchImpl).listRepoLabels('a', 'b');
    expect(labels.map((l) => l.name)).toEqual(['bug', 'docs']);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/repos/a/b/labels');
  });

  it('lists assignable users', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ login: 'octocat' }]));
    const users = await client(fetchImpl).listAssignableUsers('a', 'b');
    expect(users[0].login).toBe('octocat');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/repos/a/b/assignees');
  });

  it('sends auth + content-type on writes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await client(fetchImpl).updateState('a', 'b', '1', 'open');
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('token tok');
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

describe('GitHubClient.canPush', () => {
  it('returns true when permissions.push is true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ permissions: { push: true } }));
    expect(await writeClient(fetchImpl).canPush('a', 'b')).toBe(true);
  });

  it('returns true for maintain/admin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ permissions: { admin: true } }));
    expect(await writeClient(fetchImpl).canPush('a', 'b')).toBe(true);
  });

  it('returns false when only pull/triage', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ permissions: { pull: true, triage: true } }));
    expect(await writeClient(fetchImpl).canPush('a', 'b')).toBe(false);
  });

  it('returns false when permissions absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    expect(await writeClient(fetchImpl).canPush('a', 'b')).toBe(false);
  });

  it('returns false when unauthenticated (no token, no request)', async () => {
    const fetchImpl = vi.fn();
    const anon = new GitHubClient({ baseUrl: 'https://api.github.com', fetchImpl });
    expect(await anon.canPush('a', 'b')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns false on error (e.g. 404)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    expect(await writeClient(fetchImpl).canPush('a', 'b')).toBe(false);
  });
});
