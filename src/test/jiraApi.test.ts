import { describe, it, expect, vi } from 'vitest';
import { JiraClient, JiraAuthError, JiraNotFoundError } from '../providers/jira/api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('JiraClient.fetchIssue', () => {
  it('sends Basic auth and requests the issue with fields', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ key: 'ABC-1', fields: { summary: 'Bug' } }));
    const client = new JiraClient({
      siteUrl: 'https://acme.atlassian.net',
      email: 'me@x.com',
      token: 'tok',
      fetchImpl,
    });
    const issue = await client.fetchIssue('ABC-1');
    expect(issue.fields.summary).toBe('Bug');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/rest/api/3/issue/ABC-1?fields=');
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    // decode to verify email:token
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    expect(decoded).toBe('me@x.com:tok');
  });

  it('strips a trailing slash from the site url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ key: 'A-1', fields: {} }));
    const client = new JiraClient({
      siteUrl: 'https://acme.atlassian.net/',
      email: 'e',
      token: 't',
      fetchImpl,
    });
    await client.fetchIssue('A-1');
    expect(fetchImpl.mock.calls[0][0]).toContain('https://acme.atlassian.net/rest/api/3/issue/A-1');
  });

  it('throws JiraAuthError on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const client = new JiraClient({ siteUrl: 'https://a.atlassian.net', email: 'e', token: 't', fetchImpl });
    await expect(client.fetchIssue('A-1')).rejects.toBeInstanceOf(JiraAuthError);
  });

  it('throws JiraNotFoundError on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const client = new JiraClient({ siteUrl: 'https://a.atlassian.net', email: 'e', token: 't', fetchImpl });
    await expect(client.fetchIssue('A-1')).rejects.toBeInstanceOf(JiraNotFoundError);
  });
});

function makeClient(fetchImpl: typeof fetch) {
  return new JiraClient({ siteUrl: 'https://a.atlassian.net', email: 'e', token: 't', fetchImpl });
}

describe('JiraClient write operations', () => {
  it('lists transitions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ transitions: [{ id: '31', name: 'Done' }] }),
    );
    const t = await makeClient(fetchImpl).getTransitions('A-1');
    expect(t).toEqual([{ id: '31', name: 'Done' }]);
    expect(fetchImpl.mock.calls[0][0]).toContain('/issue/A-1/transitions');
  });

  it('POSTs a transition with the id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await makeClient(fetchImpl).doTransition('A-1', '31');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/issue/A-1/transitions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ transition: { id: '31' } });
  });

  it('searches assignable users', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ accountId: 'a1', displayName: 'Jane' }]),
    );
    const users = await makeClient(fetchImpl).getAssignableUsers('A-1', 'jan');
    expect(users[0].displayName).toBe('Jane');
    expect(fetchImpl.mock.calls[0][0]).toContain('issueKey=A-1');
    expect(fetchImpl.mock.calls[0][0]).toContain('query=jan');
  });

  it('PUTs an assignee accountId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await makeClient(fetchImpl).updateAssignee('A-1', 'a1');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/issue/A-1/assignee');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'a1' });
  });

  it('unassigns with null accountId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await makeClient(fetchImpl).updateAssignee('A-1', null);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({ accountId: null });
  });

  it('PUTs a description as ADF', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const adf = { type: 'doc', version: 1, content: [] };
    await makeClient(fetchImpl).updateDescription('A-1', adf);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/issue/A-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ fields: { description: adf } });
  });
});

describe('JiraClient.getMyPermissions', () => {
  it('maps permission booleans and queries the issue', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        permissions: {
          EDIT_ISSUES: { havePermission: true },
          ASSIGN_ISSUES: { havePermission: false },
          TRANSITION_ISSUES: { havePermission: true },
        },
      }),
    );
    const perms = await makeClient(fetchImpl).getMyPermissions('ABC-1');
    expect(perms).toEqual({ edit: true, assign: false, transition: true });
    expect(fetchImpl.mock.calls[0][0]).toContain('/mypermissions?issueKey=ABC-1');
    expect(fetchImpl.mock.calls[0][0]).toContain('EDIT_ISSUES');
  });

  it('defaults missing permissions to false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ permissions: {} }));
    const perms = await makeClient(fetchImpl).getMyPermissions('ABC-1');
    expect(perms).toEqual({ edit: false, assign: false, transition: false });
  });
});
